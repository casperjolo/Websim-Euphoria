import type * as THREE from "three";

/**
 * 接触冲量求解所需的刚体接口。
 */
export type ImpulseBody = {
    /** 世界质心位置。 */
    position: THREE.Vector3;
    /** 世界朝向。 */
    quaternion: THREE.Quaternion;
    /** 质量倒数。 */
    invMass: number;
    /** 局部惯量倒数对角元。 */
    invInertia: THREE.Vector3;
    /** 摩擦系数 μ；缺省由摩擦约束使用默认值。 */
    friction?: number;
    /** 弹性，0 不反弹，1 完全弹；缺省 0。 */
    restitution?: number;
    /** 读取世界点处速度：v + ω × r。 */
    getVelocityAtPoint(point: THREE.Vector3, out: THREE.Vector3): THREE.Vector3;
    /** 在世界点施加冲量（线速度 + 角速度）。 */
    applyImpulseAtPoint(impulse: THREE.Vector3, point: THREE.Vector3): void;
};
