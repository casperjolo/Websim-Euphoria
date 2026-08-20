import * as THREE from "three";

import type { playerController } from "../PlayerController";

const HIT_COLOR = 0x66ff66;
const FAR_HIT_COLOR = 0xffcc33;
const MISS_COLOR = 0xff5555;

/** 绘制玩家胶囊与地面探测结果。 */
export class PlayerDebug {
    private visible = false;
    private hasGroundProbe = false;
    private groundProbeHasHit = false;
    private groundProbeMaxDistance = 0;
    private groundProbeNear = 0;
    private groundRay: THREE.Line | null = null;
    private groundHit: THREE.Mesh | null = null;
    private groundProbeOrigin = new THREE.Vector3();
    private groundProbePoint = new THREE.Vector3();

    constructor(private readonly ctrl: playerController) {}

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
        if (this.groundRay) this.groundRay.visible = showProbe;
        if (this.groundHit) this.groundHit.visible = showProbe && this.groundProbeHasHit;
        if (showProbe) this.renderGroundProbe();
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
        this.groundProbeOrigin.copy(origin);
        this.groundProbeMaxDistance = Math.max(0, maxDistance);
        this.groundProbeNear = Math.max(0, near);
        if (hitPoint) this.groundProbePoint.copy(hitPoint);
        else this.groundProbePoint.copy(origin).y -= this.groundProbeMaxDistance;
        if (this.visible && this.ctrl.controllerMode === 0) this.renderGroundProbe();
    }

    /** 清除当前地面探测显示。 */
    clearGroundProbe(): void {
        this.hasGroundProbe = false;
        if (this.groundRay) this.groundRay.visible = false;
        if (this.groundHit) this.groundHit.visible = false;
    }

    /** 释放人物调试几何与材质。 */
    dispose(): void {
        if (this.groundRay) {
            this.groundRay.removeFromParent();
            this.groundRay.geometry.dispose();
            (this.groundRay.material as THREE.Material).dispose();
            this.groundRay = null;
        }
        if (this.groundHit) {
            this.groundHit.removeFromParent();
            this.groundHit.geometry.dispose();
            (this.groundHit.material as THREE.Material).dispose();
            this.groundHit = null;
        }
        this.hasGroundProbe = false;
    }

    /** 按当前探测结果更新线段、命中点和颜色。 */
    private renderGroundProbe(): void {
        this.ensureGroundProbeObjects();
        if (!this.groundRay || !this.groundHit) return;

        const positions = this.groundRay.geometry.getAttribute("position") as THREE.BufferAttribute;
        positions.setXYZ(0, this.groundProbeOrigin.x, this.groundProbeOrigin.y, this.groundProbeOrigin.z);
        positions.setXYZ(1, this.groundProbePoint.x, this.groundProbePoint.y, this.groundProbePoint.z);
        positions.needsUpdate = true;

        const distance = this.groundProbeOrigin.y - this.groundProbePoint.y;
        const hitInRange = this.groundProbeHasHit
            && distance >= this.groundProbeNear
            && distance <= this.groundProbeMaxDistance;
        const color = hitInRange ? HIT_COLOR : this.groundProbeHasHit ? FAR_HIT_COLOR : MISS_COLOR;
        (this.groundRay.material as THREE.LineBasicMaterial).color.setHex(color);
        this.groundRay.visible = true;

        this.groundHit.visible = this.groundProbeHasHit;
        if (this.groundProbeHasHit) {
            this.groundHit.position.copy(this.groundProbePoint);
            this.groundHit.scale.setScalar(Math.max(0.001, this.ctrl.playerModelConfig.scale));
            (this.groundHit.material as THREE.MeshBasicMaterial).color.setHex(color);
        }
    }

    /** 延迟创建地面射线和命中标记。 */
    private ensureGroundProbeObjects(): void {
        if (!this.groundRay) {
            this.groundRay = new THREE.Line(
                new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
                new THREE.LineBasicMaterial({
                    color: MISS_COLOR,
                    depthTest: false,
                    transparent: true,
                    opacity: 0.9,
                }),
            );
            this.groundRay.name = "playerGroundRayDebug";
            this.groundRay.renderOrder = 30;
            this.groundRay.frustumCulled = false;
            this.ctrl.scene.add(this.groundRay);
        }

        if (!this.groundHit) {
            this.groundHit = new THREE.Mesh(
                new THREE.SphereGeometry(2, 10, 8),
                new THREE.MeshBasicMaterial({
                    color: HIT_COLOR,
                    wireframe: true,
                    depthTest: false,
                    transparent: true,
                    opacity: 0.9,
                }),
            );
            this.groundHit.name = "playerGroundRayHitDebug";
            this.groundHit.renderOrder = 31;
            this.groundHit.frustumCulled = false;
            this.ctrl.scene.add(this.groundHit);
        }
    }
}
