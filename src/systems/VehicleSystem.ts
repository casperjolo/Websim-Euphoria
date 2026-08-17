import * as THREE from "three";
import type { playerController } from "../playerController";
import { loadVehicleModel as loadVehicleModelUtil } from "../utils/vehicleLoader";
import { applyCapsuleCollision, createCollisionTemps } from "../utils/capsuleCollision";
import type { VehicleInstance, VehicleOptions, KinematicColliderEntry } from "../types";
import { CollisionGroup } from "../collision/groups";
import { createObbObbTemps, resolveObbObb } from "../collision/ObbObb";

export class VehicleSystem {
    private ctrl: playerController; // 主控制器引用

    list: VehicleInstance[] = []; // 车辆实例列表
    active: VehicleInstance | null = null; // 当前乘坐车辆
    meshSkipIds: number[] = []; // 全部车辆外观 collider id，网格查询时跳过
    vehicleLength = 6; // 车辆模型归一化后的最大边长度
    params = {
        debug: { showPhysicsBox: false }, // 调试显示
        chassis: { mass: 1500, linearDamping: 0.05, angularDamping: 0.5 }, // 车身参数
        model: { rotation: -Math.PI / 2 }, // 模型旋转
        power: { acceleration: 8, deceleration: 8, maxSpeed: 300 }, // 动力参数
        steering: { maxSteerAngle: Math.PI / 4, steerTime: 1, steerReturnTimeSlow: 1, steerReturnTimeFast: 1 }, // 转向参数：打满/低速回正/高速回正（秒）
        grip: {
            maxG: 1.2,
            sideFrictionIdle: 2,
            sideFrictionFrontMin: 1.1,
            sideFrictionRearMin: 0.9,
            handbrakeRearFriction: 0.35,
            handbrakeRearDriveScale: 0.65,
            handbrakeReleaseTime: 0.15,
            wheelbaseRatio: 0.55,
        }, // 抓地预算
        followVehicleDirection: true, // 相机跟随方向
    };

    boardingPadding = 0.25; // 上车/下车余量基准值（按车辆 scale 缩放）
    parkingCreepThreshold = 0.05; // 驻车状态下清除低速蠕动的水平速度阈值
    private handbrakeBlend = 0; // 1 为手刹全开，松键后插值回 0

    private scratchLocal = new THREE.Vector3();
    private scratchWorld = new THREE.Vector3();
    private scratchForward = new THREE.Vector3();
    private scratchUp = new THREE.Vector3();
    private scratchQuat = new THREE.Quaternion();
    private scratchDown = new THREE.Vector3(0, -1, 0);
    private carryPrevInv = new THREE.Matrix4();
    private carryYaw = new THREE.Quaternion();
    private carryUp = new THREE.Vector3(0, 1, 0);
    private raycaster = new THREE.Raycaster();
    private exitCheckTemps = createCollisionTemps();
    private obbTemps = createObbObbTemps();

    constructor(ctrl: playerController) {
        this.ctrl = ctrl;
        (this.raycaster as any).firstHitOnly = true;
    }

    /** 由车身水平包围圆和人物胶囊半径推算上车范围。 */
    boardingRadius(v: VehicleInstance): number {
        return Math.hypot(v.halfExtents.x, v.halfExtents.z)
            + this.capsuleRadius()
            + this.boardingPadding * v.scale;
    }

    /** 返回人物到车辆中心的水平距离，高度超出车辆邻域时返回 Infinity。 */
    boardingDistance(v: VehicleInstance, position: THREE.Vector3): number {
        v.vehicleGroup.updateMatrixWorld(true);
        this.scratchLocal.copy(position);
        v.vehicleGroup.worldToLocal(this.scratchLocal);
        const verticalLimit = v.halfExtents.y + this.capsuleHeight();
        if (Math.abs(this.scratchLocal.y) > verticalLimit) return Infinity;
        return Math.hypot(this.scratchLocal.x, this.scratchLocal.z);
    }

    /** 是否处于车辆中心的上车范围内。 */
    isInBoardingRange(v: VehicleInstance, position: THREE.Vector3): boolean {
        return this.boardingDistance(v, position) <= this.boardingRadius(v);
    }

    // 加载车辆模型
    async load(opts: VehicleOptions): Promise<VehicleInstance | undefined> {
        try {
            const instance = await loadVehicleModelUtil(opts, {
                loader: this.ctrl.loader,
                scene: this.ctrl.scene,
                vehicleParams: this.params,
                vehicleLength: this.vehicleLength,
            });

            this.list.push(instance);
            const kin = this.ctrl.addCollider({
                motion: "kinematic",
                shape: { kind: "mesh", source: instance.vehicleGroup },
                follow: instance.vehicleGroup,
            });
            instance.meshColliderId = kin.id;
            const chassis = this.ctrl.addCollider({
                motion: "dynamic",
                shape: { kind: "box", halfExtents: instance.halfExtents.clone() },
                groups: CollisionGroup.VEHICLE,
                mask: CollisionGroup.DEFAULT | CollisionGroup.VEHICLE | CollisionGroup.DEBRIS,
                userData: instance,
            });
            instance.chassisColliderId = chassis.id;
            this.setTransition();
            return instance;
        } catch (e) {
            console.error("加载车辆模型失败:", e);
            return undefined;
        }
    }

    // 触发上车流程
    enter() {
        if (!this.list.length || this.ctrl.controllerMode === 1) return;

        // 查找最近可上车的车辆
        let nearest: VehicleInstance | null = null;
        let nearestDist = Infinity;
        const pos = this.ctrl.playerCapsule.position;
        for (const v of this.list) {
            const dist = this.boardingDistance(v, pos);
            if (dist <= this.boardingRadius(v) && dist < nearestDist) {
                nearestDist = dist;
                nearest = v;
            }
        }

        if (!nearest) return;
        // 车辆移动中不允许上车
        const vel = nearest.chassisBody.linvel();
        if (Math.hypot(vel.x, vel.z) > 0.1) return;
        this.releaseParkingBrake(nearest);
        this.active = nearest;
        const c = this.ctrl;
        c.controllerMode = 1;
        c.playerVelocity.set(0, 0, 0);
        c.mobileControls?.syncControllerModeBtn(1);
        c.cam.setOverShoulder(false);
        c.animation.playByName("driving");
        c.syncMountedPlayer(nearest);
        c.syncDebugVisibility();
        c.onVehicleEnter?.(nearest);
    }

    // 触发下车流程
    exit() {
        const c = this.ctrl;
        const v = this.active;
        if (!v) return;

        this.applyParkingBrake(v, c.getCurrentDelta() || 1 / 60);
        this.findExitPosition(v, this.scratchWorld);
        this.getDriverForward(v, this.scratchForward);
        c.controllerMode = 0;
        c.mobileControls?.syncControllerModeBtn(0);
        c.cam.setOverShoulder(c.enableOverShoulderView);
        c.leaveVehicleAt(this.scratchWorld, this.scratchForward);
        c.animation.playByName("idle");
        c.syncDebugVisibility();
        this.setTransition();
        this.handbrakeBlend = 0;
        c.onVehicleExit?.(v);
    }

    // 物理步进前更新车辆控制器
    preparePhysics(delta: number) {
        if (this.ctrl.controllerMode === 1 && this.active) this.applyDriving(delta, this.active);
    }

    // 物理步进后同步车辆视觉
    finishPhysics(delta: number) {
        for (const v of this.list) {
            const parked = this.ctrl.controllerMode !== 1 || this.active !== v;
            if (parked) this.applyParkingBrake(v, delta);
            v.vehicleController.updateVehicle(delta, this.ctrl.getVehicleGroundMeshes(v));
            this.applyKinematicCarry(v);
        }
        this.resolveVehiclePairs();
        for (const v of this.list) {
            const parked = this.ctrl.controllerMode !== 1 || this.active !== v;
            const vel = v.chassisBody.linvel();
            const speed = Math.hypot(vel.x, vel.z);
            const max = v.maxSpeed / 3.6;
            if (speed > max) {
                const s = max / speed;
                v.chassisBody.setLinvel({ x: vel.x * s, y: vel.y, z: vel.z * s });
            } else if (parked && speed > 0 && speed <= this.parkingCreepThreshold) {
                let hasWheelContact = false;
                for (let i = 0; i < v.vehicleController.numWheels(); i++) {
                    if (v.vehicleController.wheelIsInContact(i)) { hasWheelContact = true; break; }
                }
                if (hasWheelContact) v.chassisBody.setLinvel({ x: 0, y: vel.y, z: 0 });
            }
            this.syncVehicleVisual(v);
        }
        if (this.ctrl.controllerMode === 1 && this.active) this.ctrl.syncMountedPlayer(this.active);
    }

    /** 两车底盘盒对盒：跳过自身，驻车中的车仍可被撞开。 */
    private resolveVehiclePairs() {
        const n = this.list.length;
        if (n < 2) return;
        for (let iter = 0; iter < 2; iter++) {
            for (let i = 0; i < n; i++) {
                for (let j = i + 1; j < n; j++) {
                    resolveObbObb(this.list[i].chassisBody, this.list[j].chassisBody, this.obbTemps);
                }
            }
        }
    }

    // 更新车辆驾驶
    private applyDriving(delta: number, v: VehicleInstance) {
        const c = this.ctrl;
        const { vehicleController, chassisBody } = v;

        // 坡度补偿
        const rotation = chassisBody.rotation();
        this.scratchQuat.set(rotation.x, rotation.y, rotation.z, rotation.w);
        const forward = this.scratchForward.copy(v.forwardLocal).applyQuaternion(this.scratchQuat);
        const throttle = Number(c.input.fwd) - Number(c.input.bkd);
        const sinTheta = Math.max(-1, Math.min(1, forward.y));
        const gEff = 9.81 * v.scale;
        const extraAccel = (throttle * sinTheta > 0.05) ? Math.abs(sinTheta) * gEff : 0;
        const wheelCount = Math.max(1, vehicleController.numWheels());
        const mass = chassisBody.mass();
        const linv = chassisBody.linvel();
        const speed01 = Math.min(1, Math.hypot(linv.x, linv.z) / Math.max(0.01, v.maxSpeed / 3.6));

        // 转向：参数为走完满舵行程的时间（秒），打方向与回正都按恒定角速度逼近
        const { maxSteerAngle, steerTime, steerReturnTimeSlow, steerReturnTimeFast } = this.params.steering;
        const currentSteering = vehicleController.wheelSteering(0) || 0;
        const steerDir = Number(c.input.lft) - Number(c.input.rgt);
        const targetSteering = maxSteerAngle * steerDir;
        const responseTime = steerDir === 0
            ? steerReturnTimeSlow + (steerReturnTimeFast - steerReturnTimeSlow) * speed01
            : steerTime;
        const maxStep = maxSteerAngle / Math.max(1e-4, responseTime) * delta;
        const steeringDelta = targetSteering - currentSteering;
        const steering = currentSteering + Math.sign(steeringDelta) * Math.min(Math.abs(steeringDelta), maxStep);
        vehicleController.setWheelSteering(0, steering);
        vehicleController.setWheelSteering(1, steering);

        // 抓地预算：侧向占用 latG 后削减纵向驱动力
        const { maxG, sideFrictionIdle, sideFrictionFrontMin, sideFrictionRearMin, handbrakeRearFriction, handbrakeRearDriveScale, handbrakeReleaseTime, wheelbaseRatio } = this.params.grip;
        const vFwd = linv.x * forward.x + linv.y * forward.y + linv.z * forward.z;
        const wheelbase = Math.max(0.01, v.size.l * wheelbaseRatio);
        const latA = vFwd * vFwd * Math.tan(Math.min(1.5, Math.abs(steering))) / wheelbase;
        const latG = Math.min(maxG, latA / gEff);
        const longG = Math.sqrt(Math.max(0, maxG * maxG - latG * latG));
        const wantedDrive = throttle * mass * (v.acceleration + extraAccel) / wheelCount;
        const maxDrive = mass * longG * gEff / wheelCount;
        const engineForce = throttle === 0 ? 0 : Math.sign(wantedDrive) * Math.min(Math.abs(wantedDrive), maxDrive);

        // Shift 漂移：降后轮侧向摩擦甩尾，保留部分后驱维持车速，不额外后轮制动
        if (c.input.shift) this.handbrakeBlend = 1;
        else if (this.handbrakeBlend > 0) {
            this.handbrakeBlend = Math.max(0, this.handbrakeBlend - delta / Math.max(1e-4, handbrakeReleaseTime));
        }
        const rearDriveScale = 1 - this.handbrakeBlend * (1 - handbrakeRearDriveScale);
        for (let i = 0; i < wheelCount; i++) {
            vehicleController.setWheelEngineForce(i, i >= 2 ? engineForce * rearDriveScale : engineForce);
        }

        const spaceBrake = Number(c.input.space) * mass * v.deceleration / wheelCount * delta;
        for (let i = 0; i < wheelCount; i++) {
            vehicleController.setWheelBrake(i, spaceBrake);
        }

        const gripUsed = latG / maxG;
        const frontFriction = sideFrictionIdle + (sideFrictionFrontMin - sideFrictionIdle) * gripUsed;
        const gripRearFriction = sideFrictionIdle + (sideFrictionRearMin - sideFrictionIdle) * gripUsed;
        const rearFriction = gripRearFriction + (handbrakeRearFriction - gripRearFriction) * this.handbrakeBlend;
        vehicleController.setWheelSideFrictionStiffness(0, frontFriction);
        vehicleController.setWheelSideFrictionStiffness(1, frontFriction);
        vehicleController.setWheelSideFrictionStiffness(2, rearFriction);
        vehicleController.setWheelSideFrictionStiffness(3, rearFriction);
    }

    // 翻车复位
    resetUpright() {
        const v = this.active;
        if (!v || this.ctrl.controllerMode !== 1) return;
        const { chassisBody } = v;
        const t = chassisBody.translation();
        chassisBody.setTranslation({ x: t.x, y: t.y + v.size.h, z: t.z });
        chassisBody.setRotation({ x: 0, y: 0, z: 0, w: 1 });
        chassisBody.setLinvel({ x: 0, y: 0, z: 0 });
        chassisBody.setAngvel({ x: 0, y: 0, z: 0 });
        this.handbrakeBlend = 0;
    }

    // 计算车身外侧的可用下车位置
    private findExitPosition(v: VehicleInstance, out: THREE.Vector3): THREE.Vector3 {
        v.vehicleGroup.updateMatrixWorld(true);
        this.scratchLocal.copy(v.driverSeatPosition).multiplyScalar(v.scale);
        const seatX = Math.max(-v.halfExtents.x, Math.min(v.halfExtents.x, this.scratchLocal.x));
        const side = this.scratchLocal.z >= 0 ? 1 : -1;
        const clearance = this.capsuleRadius() + this.boardingPadding * v.scale;
        const sideOffset = v.halfExtents.z + clearance;
        const endOffset = v.halfExtents.x + clearance;
        const candidates = [
            { x: seatX, z: side * sideOffset },
            { x: seatX, z: -side * sideOffset },
            { x: endOffset, z: 0 },
            { x: -endOffset, z: 0 },
        ];
        let groundedFallback: THREE.Vector3 | null = null;
        const maxDist = v.size.h + this.capsuleHeight() * 3 + 2;
        this.raycaster.far = maxDist;

        for (const candidate of candidates) {
            this.scratchLocal.set(candidate.x, v.halfExtents.y + this.capsuleHeight() + 0.5, candidate.z);
            v.vehicleGroup.localToWorld(this.scratchLocal);
            out.copy(this.scratchLocal);
            this.raycaster.set(out, this.scratchDown);
            let bestHit: THREE.Intersection | undefined;
            for (const mesh of this.ctrl.getColliderMeshes()) {
                const hits = this.raycaster.intersectObject(mesh, false);
                if (hits.length && (!bestHit || hits[0].distance < bestHit.distance)) {
                    bestHit = hits[0];
                }
            }
            if (!bestHit) continue;
            out.copy(bestHit.point);
            out.y += this.ctrl.getCapsuleGroundHeight();
            groundedFallback ??= out.clone();
            if (this.isCharacterPositionFree(out, v)) return out;
        }

        if (groundedFallback) return out.copy(groundedFallback);
        this.scratchLocal.set(seatX, -v.halfExtents.y + this.ctrl.getCapsuleGroundHeight(), side * sideOffset);
        v.vehicleGroup.localToWorld(this.scratchLocal);
        return out.copy(this.scratchLocal);
    }

    /** 检测下车点处胶囊是否与静态/其他运动学碰撞体重叠。 */
    private isCharacterPositionFree(position: THREE.Vector3, v: VehicleInstance): boolean {
        const cap = this.ctrl.playerCapsule;
        const info = cap.capsuleInfo;
        if (!info || !this.ctrl.getColliderMeshes().length) return true;

        const origParent = cap.parent;
        const origPos = cap.position.clone();
        const origQuat = cap.quaternion.clone();
        const skipMesh = this.ctrl.getKinematicColliderEntries().find(e => e.source === v.vehicleGroup)?.mesh;
        this.ctrl.scene.attach(cap);
        cap.position.copy(position);
        cap.updateMatrixWorld(true);
        const before = position.clone();
        for (const mesh of this.ctrl.getColliderMeshes()) {
            if (mesh === skipMesh) continue;
            cap.updateMatrixWorld(true);
            applyCapsuleCollision(cap, info, mesh, this.exitCheckTemps);
        }
        const free = cap.position.distanceTo(before) < info.radius * 0.5;
        origParent?.attach(cap);
        cap.position.copy(origPos);
        cap.quaternion.copy(origQuat);
        cap.updateMatrixWorld(true);
        return free;
    }

    /** 有轮子打在运动学网格上时，按平台 prev→current 带走车身。 */
    private applyKinematicCarry(v: VehicleInstance) {
        const votes = new Map<KinematicColliderEntry, number>();
        const n = v.vehicleController.numWheels();
        for (let i = 0; i < n; i++) {
            const mesh = v.vehicleController.wheelContactMesh(i);
            if (!mesh) continue;
            const entry = this.ctrl.getKinematicColliderEntries().find(e => e.mesh === mesh);
            if (!entry) continue;
            votes.set(entry, (votes.get(entry) ?? 0) + 1);
        }

        let best: KinematicColliderEntry | null = null;
        let bestCount = 0;
        for (const [entry, count] of votes) {
            if (count > bestCount) {
                best = entry;
                bestCount = count;
            }
        }
        if (!best) return;

        this.carryPrevInv.copy(best.prevWorldMatrix).invert();
        this.scratchWorld.copy(v.chassisBody.position).applyMatrix4(this.carryPrevInv);
        v.chassisBody.position.copy(this.scratchWorld).applyMatrix4(best.source.matrixWorld);
        if (best.deltaRotY !== 0) {
            this.carryYaw.setFromAxisAngle(this.carryUp, best.deltaRotY);
            v.chassisBody.quaternion.premultiply(this.carryYaw);
        }
    }

    // 同步单辆车的模型、车轮和调试盒
    private syncVehicleVisual(v: VehicleInstance) {
        const t = v.chassisBody.translation();
        const r = v.chassisBody.rotation();
        v.vehicleGroup.position.set(t.x, t.y, t.z);
        v.vehicleGroup.quaternion.set(r.x, r.y, r.z, r.w);
        v.updateWheelVisuals?.();
    }

    /** 取车辆世界前向。 */
    getForward(v: VehicleInstance, out = new THREE.Vector3()): THREE.Vector3 {
        v.vehicleGroup.updateMatrixWorld(true);
        return out.copy(v.forwardLocal).transformDirection(v.vehicleGroup.matrixWorld).normalize();
    }

    /** 取驾驶位世界前向。 */
    getDriverForward(v: VehicleInstance, out = new THREE.Vector3()): THREE.Vector3 {
        this.scratchQuat.setFromAxisAngle(this.scratchUp.set(0, 1, 0), v.driverSeatRotation);
        this.scratchLocal.set(0, 0, -1).applyQuaternion(this.scratchQuat);
        v.vehicleGroup.updateMatrixWorld(true);
        return out.copy(this.scratchLocal).transformDirection(v.vehicleGroup.matrixWorld).normalize();
    }

    /** 取车辆世界上向。 */
    getUp(v: VehicleInstance, out = new THREE.Vector3()): THREE.Vector3 {
        v.vehicleGroup.updateMatrixWorld(true);
        return out.set(0, 1, 0).transformDirection(v.vehicleGroup.matrixWorld).normalize();
    }

    // 销毁全部车辆
    destroy() {
        for (const v of this.list) {
            if (v.meshColliderId != null) this.ctrl.removeCollider(v.meshColliderId);
            if (v.chassisColliderId != null) this.ctrl.removeCollider(v.chassisColliderId);
            this.ctrl.scene.remove(v.vehicleGroup);
            v.destroyVehicleController?.();
        }
        this.list = [];
        this.active = null;
    }

    // 清除活动车辆的驱动力
    stopActive() {
        if (this.active) {
            this.applyParkingBrake(this.active, this.ctrl.getCurrentDelta() || 1 / 60);
        }
    }

    // 对无人车辆施加四轮驻车制动
    private applyParkingBrake(v: VehicleInstance, delta: number) {
        const wheelCount = Math.max(1, v.vehicleController.numWheels());
        const brake = v.chassisBody.mass() * v.deceleration / wheelCount * delta;
        for (let i = 0; i < wheelCount; i++) {
            v.vehicleController.setWheelEngineForce(i, 0);
            v.vehicleController.setWheelBrake(i, brake);
            v.vehicleController.setWheelSideFrictionStiffness(i, 2);
        }
    }

    // 解除四轮驻车制动
    private releaseParkingBrake(v: VehicleInstance) {
        for (let i = 0; i < v.vehicleController.numWheels(); i++) v.vehicleController.setWheelBrake(i, 0);
    }

    // 等待车辆停稳后清除速度
    setTransition() {
        if (this.ctrl.isChangeControllerTransitionTimer) {
            clearTimeout(this.ctrl.isChangeControllerTransitionTimer);
            this.ctrl.isChangeControllerTransitionTimer = null;
        }
        this.ctrl.isChangeControllerTransitionTimer = setTimeout(() => {
            this.ctrl.isChangeControllerTransitionTimer = null;
            this.list.forEach(v => {
                if (this.ctrl.controllerMode === 1 && this.active === v) return;
                this.clearVelocity(v);
            });
        }, 3000);
    }

    // 清除车辆速度
    private clearVelocity(v: VehicleInstance) {
        if (!v) return;
        const { chassisBody, vehicleController } = v;
        chassisBody.setLinvel({ x: 0, y: 0, z: 0 });
        chassisBody.setAngvel({ x: 0, y: 0, z: 0 });
        const n = vehicleController.numWheels();
        for (let i = 0; i < n; i++) { vehicleController.setWheelEngineForce(i, 0); vehicleController.setWheelBrake(i, 1e6); }
        vehicleController.updateVehicle(1 / 60, this.ctrl.getVehicleGroundMeshes(v));
        chassisBody.setLinvel({ x: 0, y: 0, z: 0 });
        chassisBody.setAngvel({ x: 0, y: 0, z: 0 });
        for (let i = 0; i < n; i++) vehicleController.setWheelBrake(i, 0);
    }

    private capsuleRadius(): number {
        return this.ctrl.playerCapsule?.capsuleInfo?.radius ?? 0;
    }

    private capsuleHeight(): number {
        const info = this.ctrl.playerCapsule?.capsuleInfo;
        if (!info) return 0;
        return -info.segment.end.y + 2 * info.radius;
    }
}
