import * as THREE from "three";

import type { playerController } from "../PlayerController";

const HIT_COLOR = 0x66ff66;
const FAR_HIT_COLOR = 0xffcc33;
const MISS_COLOR = 0xff5555;
const SENSOR_IDLE_COLOR = 0x45d7ff;

/** 绘制玩家胶囊与地面探测结果。 */
export class PlayerDebug {
    private visible = false;
    private hasGroundProbe = false;
    private groundProbeHasHit = false;
    private groundProbeMaxDistance = 0;
    private groundProbeNear = 0;
    private groundRay: THREE.Line | null = null;
    private groundHit: THREE.Mesh | null = null;
    private groundProbePoint = new THREE.Vector3();
    private hasGroundSensor = false;
    private groundSensorActive = false;
    private groundSensorHasHit = false;
    private groundSensorMaxDistance = 0;
    private groundSensorRadius = 0;
    private groundSensor: THREE.Mesh | null = null;
    private readonly probeLocalPoint = new THREE.Vector3();
    private readonly capsuleLocalDown = new THREE.Vector3(0, -1, 0);
    private debugRoot: THREE.Group | null = null;

    constructor(private readonly ctrl: playerController) { }

    /** 返回人物调试开关。 */
    isVisible(): boolean {
        return this.visible;
    }

    /** 切换人物胶囊与地面探测调试。 */
    setVisible(visible: boolean): void {
        this.visible = visible;
        this.syncVisibility();
    }

    /** 在玩家模型或控制模式变化后重新同步显隐。 */
    syncVisibility(): void {
        const capsule = this.ctrl.playerCapsule;
        if (capsule) {
            const materials = Array.isArray(capsule.material) ? capsule.material : [capsule.material];
            for (const material of materials) material.visible = this.visible;
        }

        const showProbe = this.visible && this.hasGroundProbe && this.ctrl.controllerMode === 0;
        const showSensor = this.visible && this.hasGroundSensor && this.ctrl.controllerMode === 0;
        if (this.groundRay) this.groundRay.visible = showProbe;
        if (this.groundHit) this.groundHit.visible = showProbe && this.groundProbeHasHit;
        if (this.groundSensor) this.groundSensor.visible = showSensor;
        if (showProbe) this.renderGroundProbe();
        if (showSensor) this.renderGroundSensor();
    }

    /**
     * 移动结束后刷新调试体姿态，使射线/体积传感区跟随胶囊实时位置。
     */
    refreshTransforms(): void {
        if (!this.visible || this.ctrl.controllerMode !== 0) return;
        if (this.hasGroundProbe) this.renderGroundProbe();
        if (this.hasGroundSensor) this.renderGroundSensor();
    }

    /** 写入移动系统本帧实际使用的中心地面探测结果。 */
    updateGroundProbe(
        origin: THREE.Vector3,
        hitPoint: THREE.Vector3 | null,
        maxDistance: number,
        near = 0,
    ): void {
        this.hasGroundProbe = true;
        this.groundProbeHasHit = hitPoint !== null;
        this.groundProbeMaxDistance = Math.max(0, maxDistance);
        this.groundProbeNear = Math.max(0, near);
        if (hitPoint) this.groundProbePoint.copy(hitPoint);
        else this.groundProbePoint.copy(origin).y -= this.groundProbeMaxDistance;
    }

    /** 写入胶囊下方体积地面传感区的当前状态。 */
    updateGroundSensor(
        _start: THREE.Vector3,
        _down: THREE.Vector3,
        maxDistance: number,
        radius: number,
        active: boolean,
        hasHit: boolean,
    ): void {
        this.hasGroundSensor = maxDistance > 0 && radius > 0;
        this.groundSensorActive = active;
        this.groundSensorHasHit = hasHit;
        this.groundSensorMaxDistance = Math.max(0, maxDistance);
        this.groundSensorRadius = Math.max(0, radius);
    }

    /** 清除当前地面探测显示。 */
    clearGroundProbe(): void {
        this.hasGroundProbe = false;
        this.hasGroundSensor = false;
        if (this.groundRay) this.groundRay.visible = false;
        if (this.groundHit) this.groundHit.visible = false;
        if (this.groundSensor) this.groundSensor.visible = false;
    }

    /** 释放人物调试几何与材质。 */
    dispose(): void {
        if (this.debugRoot) {
            this.debugRoot.removeFromParent();
            this.debugRoot.traverse((obj) => {
                const mesh = obj as THREE.Mesh;
                mesh.geometry?.dispose();
                const mat = mesh.material;
                if (mat) {
                    if (Array.isArray(mat)) mat.forEach(m => m.dispose());
                    else mat.dispose();
                }
            });
            this.debugRoot = null;
        }
        this.groundRay = null;
        this.groundHit = null;
        this.groundSensor = null;
        this.hasGroundProbe = false;
        this.hasGroundSensor = false;
    }

    private ensureDebugRoot(): THREE.Group | null {
        const capsule = this.ctrl.playerCapsule;
        if (!capsule) return null;

        if (!this.debugRoot) {
            this.debugRoot = new THREE.Group();
            this.debugRoot.name = "playerDebugRoot";
            capsule.add(this.debugRoot);
        } else if (this.debugRoot.parent !== capsule) {
            capsule.add(this.debugRoot);
        }
        return this.debugRoot;
    }

    /** 按当前探测结果更新线段、命中点和颜色。 */
    private renderGroundProbe(): void {
        const capsule = this.ctrl.playerCapsule;
        const root = this.ensureDebugRoot();
        if (!capsule || !root) return;

        this.ensureGroundProbeObjects(root);
        if (!this.groundRay || !this.groundHit) return;

        this.worldToCapsuleLocal(this.groundProbePoint, this.probeLocalPoint);
        const positions = this.groundRay.geometry.getAttribute("position") as THREE.BufferAttribute;
        positions.setXYZ(0, 0, 0, 0);
        positions.setXYZ(1, this.probeLocalPoint.x, this.probeLocalPoint.y, this.probeLocalPoint.z);
        positions.needsUpdate = true;

        const distance = capsule.position.y - this.groundProbePoint.y;
        const hitInRange = this.groundProbeHasHit
            && distance >= this.groundProbeNear
            && distance <= this.groundProbeMaxDistance;
        const color = hitInRange ? HIT_COLOR : this.groundProbeHasHit ? FAR_HIT_COLOR : MISS_COLOR;
        (this.groundRay.material as THREE.LineBasicMaterial).color.setHex(color);
        this.groundRay.visible = true;

        this.groundHit.visible = this.groundProbeHasHit;
        if (this.groundProbeHasHit) {
            this.groundHit.position.copy(this.probeLocalPoint);
            const sy = Math.max(1e-6, capsule.scale.y || 1);
            const localRadius = (capsule.capsuleInfo?.radius ?? 0) / sy;
            this.groundHit.scale.setScalar(Math.max(1e-6, localRadius * 0.05));
            (this.groundHit.material as THREE.MeshBasicMaterial).color.setHex(color);
        }
    }

    /** 按当前状态更新体积地面传感区（锚定在胶囊 segment.end）。 */
    private renderGroundSensor(): void {
        const capsule = this.ctrl.playerCapsule;
        const root = this.ensureDebugRoot();
        const segEnd = capsule?.capsuleInfo?.segment.end;
        if (!capsule || !root || !segEnd) return;

        this.ensureGroundSensorObject(root);
        if (!this.groundSensor) return;

        const distance = Math.max(this.groundSensorMaxDistance, 1e-6);
        this.groundSensor.position.copy(segEnd).addScaledVector(this.capsuleLocalDown, distance * 0.5);
        this.groundSensor.quaternion.identity();
        this.groundSensor.scale.set(this.groundSensorRadius, distance, this.groundSensorRadius);

        const material = this.groundSensor.material as THREE.MeshBasicMaterial;
        material.color.setHex(
            this.groundSensorActive
                ? this.groundSensorHasHit ? HIT_COLOR : MISS_COLOR
                : SENSOR_IDLE_COLOR,
        );
        material.opacity = this.groundSensorActive ? 0.75 : 0.4;
        this.groundSensor.visible = this.hasGroundSensor;
    }

    private worldToCapsuleLocal(world: THREE.Vector3, target: THREE.Vector3): THREE.Vector3 {
        target.copy(world);
        this.ctrl.playerCapsule.worldToLocal(target);
        return target;
    }

    /** 延迟创建地面射线和命中标记。 */
    private ensureGroundProbeObjects(root: THREE.Group): void {
        if (!this.groundRay) {
            this.groundRay = new THREE.Line(
                new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
                new THREE.LineBasicMaterial({
                    color: MISS_COLOR,
                    depthTest: true,
                    transparent: true,
                    opacity: 0.9,
                }),
            );
            this.groundRay.name = "playerGroundRayDebug";
            this.groundRay.renderOrder = 30;
            this.groundRay.frustumCulled = false;
            root.add(this.groundRay);
        } else if (this.groundRay.parent !== root) {
            root.add(this.groundRay);
        }

        if (!this.groundHit) {
            this.groundHit = new THREE.Mesh(
                new THREE.SphereGeometry(2, 10, 8),
                new THREE.MeshBasicMaterial({
                    color: HIT_COLOR,
                    wireframe: true,
                    depthTest: true,
                    transparent: true,
                    opacity: 0.9,
                }),
            );
            this.groundHit.name = "playerGroundRayHitDebug";
            this.groundHit.renderOrder = 31;
            this.groundHit.frustumCulled = false;
            root.add(this.groundHit);
        } else if (this.groundHit.parent !== root) {
            root.add(this.groundHit);
        }
    }

    /** 延迟创建体积地面传感区线框。 */
    private ensureGroundSensorObject(root: THREE.Group): void {
        if (this.groundSensor) {
            if (this.groundSensor.parent !== root) root.add(this.groundSensor);
            return;
        }
        this.groundSensor = new THREE.Mesh(
            new THREE.CylinderGeometry(1, 1, 1, 16, 1, true),
            new THREE.MeshBasicMaterial({
                color: SENSOR_IDLE_COLOR,
                wireframe: true,
                depthTest: true,
                depthWrite: true,
                transparent: true,
                opacity: 0.4,
                side: THREE.DoubleSide,
            }),
        );
        this.groundSensor.name = "playerGroundVolumeDebug";
        this.groundSensor.renderOrder = 29;
        this.groundSensor.frustumCulled = false;
        root.add(this.groundSensor);
    }
}
