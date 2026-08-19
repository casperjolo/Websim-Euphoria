import * as THREE from "three";
import { integrateQuaternion } from "../utils/vehiclePhysics/VehicleMath";

/** 动态刚体形状判别。 */
export type DynamicBodyKind = "sphere" | "box";

/** 动态刚体材质 / 初态可选字段（各形状 options 共用）。 */
export type DynamicBodyMaterialOptions = {
    /** 密度，质量 = 体积 × 密度；默认见 DYNAMIC_BODY_DEFAULTS。 */
    density?: number;
    /** 弹性，0 不反弹，1 完全弹；默认见 DYNAMIC_BODY_DEFAULTS。 */
    restitution?: number;
    /** 摩擦；默认见 DYNAMIC_BODY_DEFAULTS。 */
    friction?: number;
    /** 线阻尼，越大滑行越快停；默认见 DYNAMIC_BODY_DEFAULTS。 */
    linearDamping?: number;
    /** 角阻尼，越大旋转越快停；默认见 DYNAMIC_BODY_DEFAULTS。 */
    angularDamping?: number;
    /** 重力，默认沿用控制器重力。 */
    gravity?: number;
    /** 初速度。 */
    velocity?: THREE.Vector3;
    /** 初角速度。 */
    angularVelocity?: THREE.Vector3;
    /** 视觉网格。 */
    mesh?: THREE.Mesh;
};

/** 子类构造时传入的已解析材质与视觉（缺省已在上层填好）。 */
export type DynamicBodyBaseInit = {
    density: number; // 密度
    mass: number; // 质量（体积 × 密度）
    restitution: number; // 弹性
    gravity: number; // 重力加速度
    position: THREE.Vector3; // 世界位置
    velocity: THREE.Vector3; // 线速度
    angularVelocity?: THREE.Vector3; // 角速度
    linearDamping: number; // 线阻尼
    angularDamping: number; // 角阻尼
    friction: number; // 摩擦
    mesh: THREE.Mesh; // 视觉网格
    debugMesh: THREE.Mesh; // 碰撞线框
};

/**
 * 动态刚体基类（ImpulseBody + 材质）。
 * 形状相关惯量 / 特征尺寸由子类提供；窄相算法按 kind 分派。
 */
export abstract class DynamicBody {
    abstract readonly kind: DynamicBodyKind; // 形状判别

    density: number; // 密度
    /** 由 density × 体积得到，供冲量求解使用。 */
    mass: number;
    restitution: number; // 弹性 [0, 1]
    gravity: number; // 重力加速度（通常为负）
    position = new THREE.Vector3(); // 世界位置
    quaternion = new THREE.Quaternion(); // 世界朝向
    /** 线速度（保留 velocity 命名以兼容现有调用）。 */
    velocity = new THREE.Vector3();
    angularVelocity = new THREE.Vector3(); // 角速度
    invMass = 0; // 质量倒数
    invInertia = new THREE.Vector3(); // 局部惯量倒数对角元
    linearDamping: number; // 线阻尼
    angularDamping: number; // 角阻尼
    friction: number; // 碰撞摩擦
    mesh: THREE.Mesh; // 视觉网格
    /** 碰撞形状线框，由 setDynamicBodyDebug 显隐。 */
    debugMesh: THREE.Mesh;
    contactMesh: THREE.Mesh | null = null; // 本帧接触的网格（平台携带用）
    colliderId = 0; // CollisionWorld 登记 id
    /** 休眠中则跳过积分与窄相。 */
    sleeping = false;
    /** 是否允许进入休眠。 */
    canSleep = true;
    /** 连续低于休眠阈值的累计时间（秒）。 */
    sleepTimer = 0;

    private _r = new THREE.Vector3();
    private _torque = new THREE.Vector3();
    private _local = new THREE.Vector3();
    private _world = new THREE.Vector3();
    private _invQuat = new THREE.Quaternion();

    /** 写入材质、位姿与视觉引用，并计算 invMass。 */
    protected constructor(opts: DynamicBodyBaseInit) {
        this.density = Math.max(1e-8, opts.density);
        this.mass = Math.max(1e-6, opts.mass);
        this.restitution = Math.max(0, Math.min(1, opts.restitution));
        this.gravity = opts.gravity;
        this.position.copy(opts.position);
        this.velocity.copy(opts.velocity);
        if (opts.angularVelocity) this.angularVelocity.copy(opts.angularVelocity);
        this.linearDamping = opts.linearDamping;
        this.angularDamping = opts.angularDamping;
        this.friction = opts.friction;
        this.mesh = opts.mesh;
        this.debugMesh = opts.debugMesh;
        this.invMass = 1 / this.mass;
    }

    /** 用于速度钳制 / 携带阈值的特征半尺寸。 */
    abstract characteristicExtent(): number;

    /** 唤醒刚体。 */
    wakeUp(): void {
        if (!this.sleeping) return;
        this.sleeping = false;
        this.sleepTimer = 0;
    }

    /** 进入休眠并清零速度。 */
    putToSleep(): void {
        if (!this.canSleep) return;
        this.sleeping = true;
        this.sleepTimer = 0;
        this.velocity.set(0, 0, 0);
        this.angularVelocity.set(0, 0, 0);
        this.contactMesh = null;
    }

    /** 线速度 / 角速度是否低于给定阈值。 */
    isRestingCandidate(linearThreshold: number, angularThreshold: number): boolean {
        return (
            this.velocity.lengthSq() <= linearThreshold * linearThreshold
            && this.angularVelocity.lengthSq() <= angularThreshold * angularThreshold
        );
    }

    /** 读取世界点处的刚体速度：v + ω × r。 */
    getVelocityAtPoint(point: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
        this._r.subVectors(point, this.position);
        return out.copy(this.velocity).add(this._world.copy(this.angularVelocity).cross(this._r));
    }

    /** 在质心施加冲量。 */
    applyImpulse(impulse: THREE.Vector3): void {
        if (this.sleeping && impulse.lengthSq() > 1e-4) this.wakeUp();
        this.velocity.addScaledVector(impulse, this.invMass);
    }

    /** 在世界点施加冲量，同时产生角速度。 */
    applyImpulseAtPoint(impulse: THREE.Vector3, contactPoint: THREE.Vector3): void {
        if (this.sleeping && impulse.lengthSq() > 1e-4) this.wakeUp();
        this.velocity.addScaledVector(impulse, this.invMass);
        this._r.subVectors(contactPoint, this.position);
        this.angularVelocity.add(this.angularDeltaFromImpulse(impulse, this._r));
    }

    /** 将冲量转为世界角速度增量：ω += R I⁻¹ Rᵀ (r × J)。 */
    private angularDeltaFromImpulse(impulse: THREE.Vector3, r: THREE.Vector3): THREE.Vector3 {
        this._torque.copy(r).cross(impulse);
        this._invQuat.copy(this.quaternion).invert();
        this._local.copy(this._torque).applyQuaternion(this._invQuat);
        this._local.x *= this.invInertia.x;
        this._local.y *= this.invInertia.y;
        this._local.z *= this.invInertia.z;
        return this._world.copy(this._local).applyQuaternion(this.quaternion);
    }

    /** 指数线 / 角阻尼。 */
    applyDamping(dt: number): void {
        const lin = Math.exp(-this.linearDamping * dt);
        const ang = Math.exp(-this.angularDamping * dt);
        this.velocity.multiplyScalar(lin);
        this.angularVelocity.multiplyScalar(ang);
    }

    /** 用当前速度积分位置和朝向。 */
    integrate(dt: number): void {
        this.position.addScaledVector(this.velocity, dt);
        integrateQuaternion(this.quaternion, this.angularVelocity, dt);
    }
}
