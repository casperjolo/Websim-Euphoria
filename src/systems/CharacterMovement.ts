import * as THREE from "three";
import type { playerController } from "../PlayerController";
import type { KinematicColliderEntry } from "../types";
import { CHARACTER_QUERY_MASK } from "../collision/groups";
import type { DynamicBody } from "../collision/DynamicBody";
import type { PlayerDebug } from "./PlayerDebug";
import { applyCapsuleCollision } from "../utils/capsuleCollision";

/**
 * 人物胶囊移动：地面射线、分步推出、重力 snap、平台携带。
 * 不走刚体冲量核（位置推出式 CharacterController）。
 */
export class CharacterMovement {
    private dynamicSupportBody: DynamicBody | null = null;
    private dynamicSupportPrevPosition = new THREE.Vector3();
    private dynamicSupportPrevQuaternion = new THREE.Quaternion();
    private dynamicSupportInvQuaternion = new THREE.Quaternion();
    private dynamicSupportLocal = new THREE.Vector3();
    private dynamicSupportBefore = new THREE.Vector3();
    private dynamicSupportDelta = new THREE.Vector3();

    constructor(
        private readonly ctrl: playerController,
        private readonly debug: PlayerDebug,
    ) {}

    /** 步行 / 飞行一帧：输入速度 → 落地 → 分步碰撞 → 朝向与相机。 */
    update(delta: number): void {
        const c = this.ctrl;
        // 载具模式只跑动画，移动由车辆系统负责
        if (c.controllerMode === 1) {
            this.debug.clearGroundProbe();
            c.runAnimationPass(delta);
            return;
        }
        // —— 输入与目标速度 ——
        c.camera.getWorldDirection(c.camDir);
        const angle = 2 * Math.PI - (Math.atan2(c.camDir.z, c.camDir.x) + Math.PI / 2);

        const moveAxes = c.input.getMoveAxes();
        c.moveDir.copy(c.DIR_RGT).multiplyScalar(moveAxes.x).addScaledVector(c.DIR_FWD, moveAxes.y);
        if (c.isFlying) {
            if (c.input.fwd || moveAxes.isAnalog) c.moveDir.copy(c.camDir);
            if (c.input.space) c.moveDir.y += 1;
            c.curPlayerSpeed = c.input.shift ? c.playerFlySpeed * 2 : c.playerFlySpeed;
        } else {
            c.curPlayerSpeed = c.input.shift ? c.playerRunSpeed : c.playerSpeed;
        }

        c.moveDir.normalize();
        // 步行：相对相机水平朝向；飞行且镜头前进时已用 camDir，不再绕 Y 转
        if (!c.isFlying || (!moveAxes.isAnalog && !c.input.fwd)) {
            c.moveDir.applyAxisAngle(c.upVector, angle);
        }

        // 水平速度向目标加速 / 无输入时减速
        const accelStep = c.playerAcceleration * c.decelBase * delta;
        const decelStep = c.playerDeceleration * c.decelBase * delta;
        const targetX = c.moveDir.x * c.curPlayerSpeed;
        const targetZ = c.moveDir.z * c.curPlayerSpeed;
        const diffX = targetX - c.playerVelocity.x;
        const diffZ = targetZ - c.playerVelocity.z;
        const hasXZInput = c.moveDir.x !== 0 || c.moveDir.z !== 0;
        const xzDiffLen = Math.hypot(diffX, diffZ);
        if (xzDiffLen > 0) {
            const xzApplied = Math.min(xzDiffLen, hasXZInput ? accelStep : decelStep);
            c.playerVelocity.x += (diffX / xzDiffLen) * xzApplied;
            c.playerVelocity.z += (diffZ / xzDiffLen) * xzApplied;
        }
        if (c.isFlying) {
            const targetY = c.moveDir.y * c.curPlayerSpeed;
            const diffY = targetY - c.playerVelocity.y;
            c.playerVelocity.y += Math.sign(diffY) * Math.min(Math.abs(diffY), c.moveDir.y !== 0 ? accelStep : decelStep);
        }

        // —— 脚下射线：静态 / 运动学网格 / 动态体，取最高命中 ——
        c.groundRaycaster.ray.origin.copy(c.playerCapsule.position);
        let bestHit: THREE.Intersection | undefined;
        let hitEntry: KinematicColliderEntry | null = null;
        for (const col of c.collisionWorld.query({ mask: CHARACTER_QUERY_MASK })) {
            if (col.shape.kind !== "mesh") continue;
            const hits = c.groundRaycaster.intersectObject(col.shape.mesh, false);
            if (hits.length > 0 && (!bestHit || hits[0].point.y > bestHit.point.y)) {
                bestHit = hits[0];
                hitEntry = col.motion === "kinematic" ? col.userData as KinematicColliderEntry : null;
            }
        }
        let dynamicHit = c.dynamics.raycastGround(c.playerCapsule.position);
        if (dynamicHit && bestHit && dynamicHit.point.y <= bestHit.point.y) dynamicHit = null;
        if (dynamicHit) {
            bestHit = undefined;
            hitEntry = null;
        }
        const groundPoint = dynamicHit?.point ?? bestHit?.point;
        this.debug.updateGroundProbe(
            c.groundRaycaster.ray.origin,
            groundPoint ?? null,
            c.maxH,
            c.groundRaycaster.near,
        );
        // —— 重力 / 贴地 snap（飞行跳过） ——
        if (!c.isFlying) {
            if (groundPoint) {
                const snapY = groundPoint.y + c.snapH;
                const dist = c.playerCapsule.position.y - groundPoint.y;
                if (dist > c.maxH) {
                    c.applyGravity(delta); // 离地过远当坠落
                } else if (c.playerVelocity.y <= 0) {
                    if (c.playerIsOnGround) {
                        c.snapToGround(
                            snapY,
                            dynamicHit ? dynamicHit.normal.y >= c.minFloorNormalY : c.isFlatFloor(bestHit!),
                            delta,
                        );
                    } else {
                        // 下落中：本帧会落到地面则贴地，否则继续重力
                        const predictedY = c.playerCapsule.position.y + c.playerVelocity.y * delta;
                        if (predictedY <= snapY) c.snapToGround(snapY);
                        else c.applyGravity(delta);
                    }
                } else {
                    c.applyGravity(delta); // 上升（跳跃）
                }
            } else {
                c.applyGravity(delta);
            }
            c.playerCapsule.position.y += c.playerVelocity.y * delta;
        }

        c.activeDynamicBody = c.playerIsOnGround ? dynamicHit?.body ?? null : null;
        c.activeKinematicCollider = c.playerIsOnGround && !c.activeDynamicBody ? hitEntry : null;
        this.setDynamicSupport(c.activeDynamicBody);

        // —— 水平（飞行则含竖直）分步移动 + 胶囊推出 ——
        const capsuleInfo = c.playerCapsule.capsuleInfo;
        const xzSpeed = Math.hypot(c.playerVelocity.x, c.playerVelocity.z);
        const totalDist = c.isFlying ? c.playerVelocity.length() * delta : xzSpeed * delta;
        c.xzDir.set(c.playerVelocity.x, c.isFlying ? c.playerVelocity.y : 0, c.playerVelocity.z).normalize();
        const maxStep = capsuleInfo.radius * 0.8;
        const steps = Math.min(Math.max(1, Math.ceil(totalDist / maxStep)), c.maxMoveSteps);
        const stepDist = totalDist / steps;
        const blockedEpsSq = (maxStep * 0.05) ** 2;
        for (let i = 0; i < steps; i++) {
            c.moveStepOrigin.copy(c.playerCapsule.position);
            c.playerCapsule.position.addScaledVector(c.xzDir, stepDist);
            c.playerCapsule.updateMatrixWorld();

            if (!c.skipCapsuleCollision) {
                const kinMeshes = c.getKinematicColliderEntries();
                for (const mesh of c.getColliderMeshes()) {
                    c.playerCapsule.updateMatrixWorld();
                    const isKin = kinMeshes.some(e => e.mesh === mesh);
                    // 飞行用接到脚底的段；步行用悬空段便于上台阶
                    applyCapsuleCollision(
                        c.playerCapsule,
                        capsuleInfo,
                        mesh,
                        isKin ? c.kinematicTemps : c.staticTemps,
                        undefined,
                        c.isFlying,
                    );
                }
                c.dynamics.collideWithCapsule();

                // 本步几乎没走出去：卡住则提前结束剩余子步
                if (c.playerCapsule.position.distanceToSquared(c.moveStepOrigin) < blockedEpsSq) {
                    break;
                }
            }
        }

        // 站在运动学平台上时跟随平台位移 / 偏航
        if (c.activeKinematicCollider && c.playerIsOnGround && !c.isFlying) {
            c.playerCapsule.position.add(c.activeKinematicCollider.deltaPos);
            if (c.activeKinematicCollider.deltaRotY !== 0) {
                c.playerCapsule.rotateY(c.activeKinematicCollider.deltaRotY);
            }
        }

        // —— 角色朝向（第三人称 / 飞行） ——
        if (!c.isFirstPerson) {
            const camDirFlat = c.camDir.clone().setY(0).normalize().negate();
            const moveDirFlat = c.moveDir.clone().normalize().negate();

            if (!c.isFlying) {
                if (c.cam.mouseMode === 4 || c.cam.mouseMode === 5) {
                    c.targetMat.lookAt(c.playerCapsule.position, c.playerCapsule.position.clone().add(camDirFlat), c.playerCapsule.up);
                    c.playerCapsule.quaternion.copy(c.targetQuat.setFromRotationMatrix(c.targetMat));
                } else if (c.cam.mouseMode === 0 || c.cam.mouseMode === 2) {
                    const lookTarget = c.playerCapsule.position.clone().add(moveDirFlat.lengthSq() > 0 ? moveDirFlat : camDirFlat);
                    c.targetMat.lookAt(c.playerCapsule.position, lookTarget, c.playerCapsule.up);
                    c.playerCapsule.quaternion.slerp(c.targetQuat.setFromRotationMatrix(c.targetMat), Math.min(1, c.rotationSpeed * delta));
                } else if (moveDirFlat.lengthSq() > 0) {
                    c.targetMat.lookAt(c.playerCapsule.position, c.playerCapsule.position.clone().add(moveDirFlat), c.playerCapsule.up);
                    c.playerCapsule.quaternion.slerp(c.targetQuat.setFromRotationMatrix(c.targetMat), Math.min(1, c.rotationSpeed * delta));
                }
            } else {
                const lookTarget = c.playerCapsule.position.clone().add(c.input.fwd ? moveDirFlat : camDirFlat);
                c.targetMat.lookAt(c.playerCapsule.position, lookTarget, c.playerCapsule.up);
                c.playerCapsule.quaternion.slerp(c.targetQuat.setFromRotationMatrix(c.targetMat), Math.min(1, c.rotationSpeed * delta));
            }
        }

        // —— 第三人称相机跟随 ——
        if (!c.isFirstPerson) {
            const lookTarget = c.cam.springTarget(c.cam.getLookAtPoint(), delta);
            c.camera.position.sub(c.controls.target);
            c.camera.position.add(lookTarget);
            c.controls.target.copy(lookTarget);
            c.controls.update();
            if (!c.cam.zoomEnabled) {
                c.cam.updateWithRaycast(c.controls.target);
            }
        }

        // 靠近车辆时显示上车按钮
        if (c.isShowMobileControls && c.vehicle.list.length) {
            let near = false;
            for (const veh of c.vehicle.list) {
                if (c.vehicle.isInBoardingRange(veh, c.playerCapsule.position)) {
                    near = true;
                    break;
                }
            }
            if (near !== c.isNearVehicle) {
                c.isNearVehicle = near;
                c.mobileControls?.syncVehicleBtn(near);
            }
        }

        c.animation.setAnimationByPressed();
        c.runAnimationPass(delta);
    }

    /** 切换当前动态支撑体并记录位姿。 */
    private setDynamicSupport(body: DynamicBody | null): void {
        if (this.dynamicSupportBody === body) return;
        this.dynamicSupportBody = body;
        if (!body) return;
        this.dynamicSupportPrevPosition.copy(body.position);
        this.dynamicSupportPrevQuaternion.copy(body.quaternion);
    }

    /** 动态支撑体推进后按前后位姿带走人物。 */
    applyDynamicSupportCarry(): void {
        const c = this.ctrl;
        const body = c.activeDynamicBody;
        if (body !== this.dynamicSupportBody) this.setDynamicSupport(body);
        if (!body) return;
        if (!c.dynamics.list.includes(body)) {
            c.activeDynamicBody = null;
            this.setDynamicSupport(null);
            return;
        }
        if (c.controllerMode === 1 || c.isFlying || !c.playerIsOnGround) {
            this.dynamicSupportPrevPosition.copy(body.position);
            this.dynamicSupportPrevQuaternion.copy(body.quaternion);
            return;
        }

        this.dynamicSupportBefore.copy(c.playerCapsule.position);
        this.dynamicSupportInvQuaternion.copy(this.dynamicSupportPrevQuaternion).invert();
        this.dynamicSupportLocal.subVectors(
            c.playerCapsule.position,
            this.dynamicSupportPrevPosition,
        ).applyQuaternion(this.dynamicSupportInvQuaternion);
        c.playerCapsule.position.copy(this.dynamicSupportLocal)
            .applyQuaternion(body.quaternion)
            .add(body.position);
        c.playerCapsule.updateMatrixWorld();

        this.dynamicSupportDelta.subVectors(c.playerCapsule.position, this.dynamicSupportBefore);
        if (!c.isFirstPerson && this.dynamicSupportDelta.lengthSq() > 0) {
            c.camera.position.add(this.dynamicSupportDelta);
            c.controls.target.add(this.dynamicSupportDelta);
        }
        this.dynamicSupportPrevPosition.copy(body.position);
        this.dynamicSupportPrevQuaternion.copy(body.quaternion);
    }
}
