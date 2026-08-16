import * as THREE from "three";
import type { ContactManifold } from "../contacts/ContactManifold";
import type { ContactPoint } from "../contacts/ContactPoint";
import { effectiveMass } from "../VehicleMath";
import type { VehicleRigidBody } from "../VehicleRigidBody";

const PENETRATION_SLOP = 0.003; // 允许的残余穿透
const PENETRATION_BIAS_FACTOR = 0.05; // Baumgarte 修正系数
const MAX_CORRECTION_VELOCITY = 0.04; // 位置修正速度上限
const SUPPORT_BIAS_Y = 0.5; // 仅对偏台面的法线做穿透偏置

const _r = new THREE.Vector3();
const _gcross = new THREE.Vector3();
const _local = new THREE.Vector3();
const _world = new THREE.Vector3();
const _invQuat = new THREE.Quaternion();
const _vel = new THREE.Vector3();
const _impulse = new THREE.Vector3();

/** 计算台面接触的穿透偏置速度。 */
export function prepareNormalConstraint(
    manifold: ContactManifold,
    point: ContactPoint,
    dt: number,
): void {
    point.biasVelocity = 0;
    if (dt <= 1e-8) return;
    // 立面不做穿透偏置，避免把车从墙上顶飞
    if (manifold.normal.y <= SUPPORT_BIAS_Y) return;
    const error = point.penetration - PENETRATION_SLOP;
    if (error <= 0) return;
    // Baumgarte：把多余穿透变成有上限的分离速度
    point.biasVelocity = Math.min(
        error * PENETRATION_BIAS_FACTOR / dt,
        MAX_CORRECTION_VELOCITY,
    );
}

/** 施加上一帧法向冲量。 */
export function warmStartNormal(
    body: VehicleRigidBody,
    manifold: ContactManifold,
    point: ContactPoint,
): void {
    if (point.normalImpulse === 0) return;
    _impulse.copy(manifold.normal).multiplyScalar(point.normalImpulse);
    body.applyImpulseAtPoint(_impulse, point.worldPoint);
}

/** 解单点法向速度约束，冲量不小于 0。 */
export function solveNormalConstraint(
    body: VehicleRigidBody,
    manifold: ContactManifold,
    point: ContactPoint,
): void {
    const n = manifold.normal;
    body.getVelocityAtPoint(point.worldPoint, _vel);
    const vn = _vel.dot(n);
    const mass = effectiveMass(body, point.worldPoint, n, _r, _gcross, _local, _world, _invQuat);
    if (mass <= 0) return;

    // 抵消靠近表面的相对速度，并叠加上偏置；冲量不能为负（不可拉）
    const lambda = -(vn - point.biasVelocity) * mass;
    const old = point.normalImpulse;
    point.normalImpulse = Math.max(0, old + lambda);
    const applied = point.normalImpulse - old;
    if (applied === 0) return;
    _impulse.copy(n).multiplyScalar(applied);
    body.applyImpulseAtPoint(_impulse, point.worldPoint);
}
