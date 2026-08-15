import * as THREE from "three";
import type { World } from "@dimforge/rapier3d-compat";
import type { playerController } from "../playerController";
import { loadVehicleModel as loadVehicleModelUtil } from "../utils/vehicleLoader";
import { applyCapsuleCollision, createCollisionTemps } from "../utils/capsuleCollision";
import type { VehicleInstance, VehicleOptions } from "../types";

export class VehicleSystem {
    private ctrl: playerController; // 主控制器引用

    list: VehicleInstance[] = []; // 车辆实例列表
    active: VehicleInstance | null = null; // 当前乘坐车辆
    vehicleLength = 6; // 车辆模型归一化后的最大边长度
    RAPIER: any = null; // 物理引擎模块
    world: World | null = null; // 物理世界实例
    params = {
        debug: { showPhysicsBox: false }, // 调试显示
        chassis: { mass: 1500, linearDamping: 0.05, angularDamping: 0.5 }, // 车身参数
        model: { rotation: -Math.PI / 2 }, // 模型旋转
        power: { acceleration: 8, deceleration: 8, maxSpeed: 300 }, // 动力参数
        steering: { maxSteerAngle: Math.PI / 4, steerSpeed: 0.5, steerReturnTimeSlow: 0.4, steerReturnTimeFast: 0.15 }, // 转向参数
        followVehicleDirection: true, // 相机跟随方向
    };

    boardingPadding = 0.25; // 上车/下车余量基准值（按车辆 scale 缩放）
    parkingCreepThreshold = 0.05; // 驻车状态下清除低速蠕动的水平速度阈值

    private scratchLocal = new THREE.Vector3();
    private scratchWorld = new THREE.Vector3();
    private scratchForward = new THREE.Vector3();
    private scratchUp = new THREE.Vector3();
    private scratchQuat = new THREE.Quaternion();
    private scratchDown = new THREE.Vector3(0, -1, 0);
    private raycaster = new THREE.Raycaster();
    private exitCheckTemps = createCollisionTemps();

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

    // 初始化物理引擎
    async initRapier() {
        if (this.RAPIER) return;
        this.RAPIER = await import("@dimforge/rapier3d-compat");
        await this.RAPIER.init();

        this.world = new this.RAPIER.World(new this.RAPIER.Vector3(0, -9.81, 0)) as World;
        (this.world as any).maxCcdSubsteps = 2;

        // 构建三角网格碰撞体
        const addTrimesh = (RAPIER: any, world: any, geom: THREE.BufferGeometry) => {
            let g = geom.index ? geom.clone().toNonIndexed() : geom.clone();
            const pos = g.attributes.position;
            const count = pos.count;
            const verts = new Float32Array(count * 3);
            const tmp = new THREE.Vector3();
            for (let i = 0; i < count; i++) {
                tmp.fromBufferAttribute(pos, i);
                verts[i * 3] = tmp.x; verts[i * 3 + 1] = tmp.y; verts[i * 3 + 2] = tmp.z;
            }
            const indices = count > 65535 ? new Uint32Array(count) : new Uint16Array(count);
            for (let i = 0; i < count; i++) indices[i] = i;

            const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
            world.createCollider(
                RAPIER.ColliderDesc.trimesh(verts, indices).setRestitution(0).setFriction(0.8),
                body,
            );
        };

        for (const g of this.ctrl.collected) addTrimesh(this.RAPIER, this.world, g);

        // 添加地面刚体
        const groundBody = this.world.createRigidBody(this.RAPIER.RigidBodyDesc.fixed());
        groundBody.userData = { outOfBounds: true };
    }

    // 加载车辆模型
    async load(opts: VehicleOptions): Promise<VehicleInstance | undefined> {
        try {
            await this.initRapier();
            if (!this.world) return;

            const instance = await loadVehicleModelUtil(opts, {
                loader: this.ctrl.loader,
                scene: this.ctrl.scene,
                world: this.world,
                RAPIER: this.RAPIER,
                vehicleParams: this.params,
                vehicleLength: this.vehicleLength,
            });

            this.list.push(instance);
            this.ctrl.addDynamicCollider(instance.vehicleGroup);
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
        c.onVehicleExit?.(v);
    }

    // 物理步进前更新车辆控制器
    preparePhysics(delta: number) {
        if (!this.RAPIER) return;
        if (this.ctrl.controllerMode === 1 && this.active) this.applyDriving(delta, this.active);
    }

    // 物理步进后同步车辆视觉
    finishPhysics(delta: number) {
        if (!this.world) return;
        this.world.timestep = delta;
        this.world.step();

        for (const v of this.list) {
            const parked = this.ctrl.controllerMode !== 1 || this.active !== v;
            if (parked) this.applyParkingBrake(v, delta);
            v.vehicleController.updateVehicle(delta);
            const vel = v.chassisBody.linvel();
            const speed = Math.hypot(vel.x, vel.z);
            const max = v.maxSpeed / 3.6;
            if (speed > max) {
                const s = max / speed;
                v.chassisBody.setLinvel(new this.RAPIER.Vector3(vel.x * s, vel.y, vel.z * s), true);
            } else if (parked && speed > 0 && speed <= this.parkingCreepThreshold) {
                let hasWheelContact = false;
                for (let i = 0; i < v.vehicleController.numWheels(); i++) {
                    if (v.vehicleController.wheelIsInContact(i)) { hasWheelContact = true; break; }
                }
                if (hasWheelContact) v.chassisBody.setLinvel(new this.RAPIER.Vector3(0, vel.y, 0), true);
            }
            this.syncVehicleVisual(v);
        }
        if (this.ctrl.controllerMode === 1 && this.active) this.ctrl.syncMountedPlayer(this.active);
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

        // 驱动力
        const wheelCount = Math.max(1, vehicleController.numWheels());
        const engineForce = throttle * chassisBody.mass() * (v.acceleration + extraAccel) / wheelCount;
        for (let i = 0; i < vehicleController.numWheels(); i++) vehicleController.setWheelEngineForce(i, engineForce);

        // 制动
        const wheelBrake = Number(c.input.space) * chassisBody.mass() * v.deceleration / wheelCount * delta;
        for (let i = 0; i < vehicleController.numWheels(); i++) vehicleController.setWheelBrake(i, wheelBrake);

        // 转向
        const currentSteering = vehicleController.wheelSteering(0) || 0;
        const steerDir = Number(c.input.lft) - Number(c.input.rgt);
        const targetSteering = this.params.steering.maxSteerAngle * steerDir;
        let blend: number;
        if (steerDir === 0) {
            const linv = chassisBody.linvel();
            const speed01 = Math.min(1, Math.hypot(linv.x, linv.z) / Math.max(0.01, v.maxSpeed / 3.6));
            const returnTime = this.params.steering.steerReturnTimeSlow
                + (this.params.steering.steerReturnTimeFast - this.params.steering.steerReturnTimeSlow) * speed01;
            blend = 1 - Math.exp(-delta / Math.max(1e-4, returnTime));
        } else {
            blend = 1 - Math.pow(1 - this.params.steering.steerSpeed, delta);
        }
        const steering = currentSteering + (targetSteering - currentSteering) * blend;
        vehicleController.setWheelSteering(0, steering);
        vehicleController.setWheelSteering(1, steering);

        // 漂移摩擦
        const driftFriction = ((c.input.rgt || c.input.lft) && c.input.shift) ? 0.5 : 2;
        vehicleController.setWheelSideFrictionStiffness(2, driftFriction);
        vehicleController.setWheelSideFrictionStiffness(3, driftFriction);
    }

    // 翻车复位
    resetUpright() {
        const v = this.active;
        if (!v || this.ctrl.controllerMode !== 1 || !this.RAPIER) return;
        const { chassisBody } = v;
        const t = chassisBody.translation();
        chassisBody.setTranslation(new this.RAPIER.Vector3(t.x, t.y + v.size.h, t.z), true);
        chassisBody.setRotation(new this.RAPIER.Quaternion(0, 0, 0, 1), true);
        chassisBody.setLinvel(new this.RAPIER.Vector3(0, 0, 0), true);
        chassisBody.setAngvel(new this.RAPIER.Vector3(0, 0, 0), true);
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
            const hits = this.ctrl.collider ? this.raycaster.intersectObject(this.ctrl.collider, false) : [];
            if (!hits.length) continue;
            out.copy(hits[0].point);
            out.y += this.ctrl.getCapsuleGroundHeight();
            groundedFallback ??= out.clone();
            if (this.isCharacterPositionFree(out, v)) return out;
        }

        if (groundedFallback) return out.copy(groundedFallback);
        this.scratchLocal.set(seatX, -v.halfExtents.y + this.ctrl.getCapsuleGroundHeight(), side * sideOffset);
        v.vehicleGroup.localToWorld(this.scratchLocal);
        return out.copy(this.scratchLocal);
    }

    /** 检测下车点处胶囊是否与静态/其他动态碰撞体重叠。 */
    private isCharacterPositionFree(position: THREE.Vector3, v: VehicleInstance): boolean {
        const cap = this.ctrl.playerCapsule;
        const info = cap.capsuleInfo;
        if (!info || !this.ctrl.collider) return true;

        const origParent = cap.parent;
        const origPos = cap.position.clone();
        const origQuat = cap.quaternion.clone();
        this.ctrl.scene.attach(cap);
        cap.position.copy(position);
        cap.updateMatrixWorld(true);
        const before = position.clone();
        applyCapsuleCollision(cap, info, this.ctrl.collider, this.exitCheckTemps);
        for (const entry of this.ctrl.getDynamicColliderEntries()) {
            if (entry.source === v.vehicleGroup) continue;
            cap.updateMatrixWorld(true);
            applyCapsuleCollision(cap, info, entry.mesh, this.exitCheckTemps);
        }
        const free = cap.position.distanceTo(before) < info.radius * 0.5;
        origParent?.attach(cap);
        cap.position.copy(origPos);
        cap.quaternion.copy(origQuat);
        cap.updateMatrixWorld(true);
        return free;
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
            this.ctrl.scene.remove(v.vehicleGroup);
            v.destroyVehicleController?.();
            this.world?.removeRigidBody(v.chassisBody);
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
        if (!v || !this.world || !this.RAPIER) return;
        const { chassisBody, vehicleController } = v;
        const ZERO = new this.RAPIER.Vector3(0, 0, 0);
        chassisBody.setLinvel(ZERO, true);
        chassisBody.setAngvel(ZERO, true);
        const n = vehicleController.numWheels();
        for (let i = 0; i < n; i++) { vehicleController.setWheelEngineForce(i, 0); vehicleController.setWheelBrake(i, 1e6); }
        vehicleController.updateVehicle(1 / 60);
        this.world.timestep = 1 / 60;
        this.world.step();
        chassisBody.setLinvel(ZERO, true);
        chassisBody.setAngvel(ZERO, true);
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
