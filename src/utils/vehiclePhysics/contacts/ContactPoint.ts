import * as THREE from "three";

export const CONTACT_SKIN = 0.002; // 接触容差，避免数值抖动

export type RawContact = {
    point: THREE.Vector3; // 接触点（世界）
    normal: THREE.Vector3; // 接触法线
    penetration: number; // 穿透深度
};

/** 约束求解用的单个接触点。 */
export class ContactPoint {
    worldPoint = new THREE.Vector3(); // 世界接触点
    localPoint = new THREE.Vector3(); // 相对底盘的局部点
    penetration = 0; // 穿透深度
    biasVelocity = 0; // 位置修正偏置速度
    normalImpulse = 0; // 法向累积冲量
    tangentImpulse1 = 0; // 切向 1 累积冲量
    tangentImpulse2 = 0; // 切向 2 累积冲量
    tangent1 = new THREE.Vector3(); // 第一切向
    tangent2 = new THREE.Vector3(); // 第二切向

    /** 复制接触点状态，用于帧间热启动。 */
    copyFrom(other: ContactPoint): void {
        this.worldPoint.copy(other.worldPoint);
        this.localPoint.copy(other.localPoint);
        this.penetration = other.penetration;
        this.normalImpulse = other.normalImpulse;
        this.tangentImpulse1 = other.tangentImpulse1;
        this.tangentImpulse2 = other.tangentImpulse2;
        this.tangent1.copy(other.tangent1);
        this.tangent2.copy(other.tangent2);
    }

    /** 清除累积冲量。 */
    resetImpulses(): void {
        this.normalImpulse = 0;
        this.tangentImpulse1 = 0;
        this.tangentImpulse2 = 0;
    }
}
