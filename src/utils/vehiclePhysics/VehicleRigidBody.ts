import * as THREE from "three";
import { integrateQuaternion } from "./VehicleMath";

export type VehicleRigidBodyOptions = {
    position: THREE.Vector3; // 初始世界位置
    mass: number; // 质量（kg）
    halfExtents: THREE.Vector3; // 碰撞盒半边长
    linearDamping?: number; // 线阻尼
    angularDamping?: number; // 角阻尼
    gravityScale?: number; // 重力缩放
};

const GRAVITY = 9.81; // 重力加速度

/** 车辆专用轻量刚体。 */
export class VehicleRigidBody {
    position = new THREE.Vector3(); // 世界位置
    quaternion = new THREE.Quaternion(); // 世界朝向

    linearVelocity = new THREE.Vector3(); // 线速度
    angularVelocity = new THREE.Vector3(); // 角速度

    private _mass: number; // 质量
    invMass: number; // 质量倒数

    inertia = new THREE.Vector3(); // 局部惯量对角元
    invInertia = new THREE.Vector3(); // 惯量倒数

    linearDamping: number; // 线阻尼
    angularDamping: number; // 角阻尼
    gravityScale: number; // 重力缩放
    halfExtents: THREE.Vector3; // 碰撞盒半边长

    private _r = new THREE.Vector3();
    private _torque = new THREE.Vector3();
    private _local = new THREE.Vector3();
    private _world = new THREE.Vector3();
    private _invQuat = new THREE.Quaternion();

    constructor(opts: VehicleRigidBodyOptions) {
        this.position.copy(opts.position);
        this.halfExtents = opts.halfExtents.clone();
        this._mass = Math.max(1e-6, opts.mass);
        this.invMass = 1 / this._mass;
        this.linearDamping = opts.linearDamping ?? 0.05;
        this.angularDamping = opts.angularDamping ?? 0.5;
        this.gravityScale = opts.gravityScale ?? 1;
        this.setCuboidInertia(this._mass, this.halfExtents);
    }

    /** 按长方体质量分布设置惯量。 */
    setCuboidInertia(mass: number, half: THREE.Vector3): void {
        const w = half.x * 2;
        const h = half.y * 2;
        const d = half.z * 2;
        this.inertia.set(
            mass / 12 * (h * h + d * d),
            mass / 12 * (w * w + d * d),
            mass / 12 * (w * w + h * h),
        );
        this.invInertia.set(
            this.inertia.x > 1e-8 ? 1 / this.inertia.x : 0,
            this.inertia.y > 1e-8 ? 1 / this.inertia.y : 0,
            this.inertia.z > 1e-8 ? 1 / this.inertia.z : 0,
        );
    }

    /** 读取线速度。 */
    linvel(): THREE.Vector3 {
        return this.linearVelocity;
    }

    /** 读取角速度。 */
    angvel(): THREE.Vector3 {
        return this.angularVelocity;
    }

    /** 设置线速度（_wake 为 Rapier 兼容参数，忽略）。 */
    setLinvel(v: { x: number; y: number; z: number }, _wake = true): void {
        this.linearVelocity.set(v.x, v.y, v.z);
    }

    /** 设置角速度（_wake 为 Rapier 兼容参数，忽略）。 */
    setAngvel(v: { x: number; y: number; z: number }, _wake = true): void {
        this.angularVelocity.set(v.x, v.y, v.z);
    }

    /** 读取世界位置。 */
    translation(): THREE.Vector3 {
        return this.position;
    }

    /** 读取世界朝向。 */
    rotation(): THREE.Quaternion {
        return this.quaternion;
    }

    /** 设置世界位置（_wake 为 Rapier 兼容参数，忽略）。 */
    setTranslation(v: { x: number; y: number; z: number }, _wake = true): void {
        this.position.set(v.x, v.y, v.z);
    }

    /** 设置世界朝向（_wake 为 Rapier 兼容参数，忽略）。 */
    setRotation(q: { x: number; y: number; z: number; w: number }, _wake = true): void {
        this.quaternion.set(q.x, q.y, q.z, q.w).normalize();
    }

    /** 读取质量。 */
    mass(): number {
        return this._mass;
    }

    /** 在质心施加冲量。 */
    applyImpulse(impulse: THREE.Vector3): void {
        this.linearVelocity.addScaledVector(impulse, this.invMass);
    }

    /** 在世界点施加冲量，同时产生角速度。 */
    applyImpulseAtPoint(impulse: THREE.Vector3, contactPoint: THREE.Vector3): void {
        this.linearVelocity.addScaledVector(impulse, this.invMass);
        this._r.subVectors(contactPoint, this.position);
        this.angularVelocity.add(this.angularDeltaFromImpulse(impulse, this._r));
    }

    // 将冲量转为世界角速度增量：ω += R I⁻¹ Rᵀ (r × J)
    private angularDeltaFromImpulse(impulse: THREE.Vector3, r: THREE.Vector3): THREE.Vector3 {
        this._torque.copy(r).cross(impulse);
        this._invQuat.copy(this.quaternion).invert();
        this._local.copy(this._torque).applyQuaternion(this._invQuat);
        this._local.x *= this.invInertia.x;
        this._local.y *= this.invInertia.y;
        this._local.z *= this.invInertia.z;
        return this._world.copy(this._local).applyQuaternion(this.quaternion);
    }

    /** 读取世界点处的刚体速度。 */
    getVelocityAtPoint(point: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
        this._r.subVectors(point, this.position);
        return out.copy(this.linearVelocity).add(this._world.copy(this.angularVelocity).cross(this._r)); // v + ω × r
    }

    /** 施加重力。 */
    applyGravity(dt: number): void {
        this.linearVelocity.y -= GRAVITY * this.gravityScale * dt;
    }

    /** 施加线/角阻尼。 */
    applyDamping(dt: number): void {
        // 指数阻尼，与步长无关的衰减
        const lin = Math.exp(-this.linearDamping * dt);
        const ang = Math.exp(-this.angularDamping * dt);
        this.linearVelocity.multiplyScalar(lin);
        this.angularVelocity.multiplyScalar(ang);
    }

    /** 用当前速度积分位置和朝向。 */
    integrate(dt: number): void {
        this.position.addScaledVector(this.linearVelocity, dt);
        integrateQuaternion(this.quaternion, this.angularVelocity, dt);
    }
}
