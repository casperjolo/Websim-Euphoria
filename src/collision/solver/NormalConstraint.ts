import * as THREE from "three";
import { effectiveMass } from "../../utils/vehiclePhysics/VehicleMath";
import type { ContactManifold } from "../contacts/ContactManifold";
import type { ContactPoint } from "../contacts/ContactPoint";
import type { ImpulseBody } from "./ImpulseBody";

const PENETRATION_SLOP = 0.003; // 允许的残留穿透，小于此不修正
const PENETRATION_BIAS_FACTOR = 0.05; // Baumgarte 系数
const MAX_CORRECTION_VELOCITY = 0.04; // 穿透修正速度上限，避免弹飞
const SUPPORT_BIAS_Y = 0.5; // 仅对偏竖直的支撑面做法向 bias
const RESTITUTION_THRESHOLD = 0.1; // 接近静止时不再加弹性，避免微弹

const _r = new THREE.Vector3();
const _gcross = new THREE.Vector3();
const _local = new THREE.Vector3();
const _world = new THREE.Vector3();
const _invQuat = new THREE.Quaternion();
const _vel = new THREE.Vector3();
const _impulse = new THREE.Vector3();

/**
 * 准备法向约束的 biasVelocity。
 * 含弹性目标分离速度，以及支撑面上的穿透位置修正。
 */
export function prepareNormalConstraint(
    body: ImpulseBody,
    manifold: ContactManifold,
    point: ContactPoint,
    dt: number,
): void {
    point.biasVelocity = 0;
    body.getVelocityAtPoint(point.worldPoint, _vel);
    const vn = _vel.dot(manifold.normal);
    const e = body.restitution ?? 0;
    if (e > 0 && vn < -RESTITUTION_THRESHOLD) {
        // 目标分离速度 ≈ -e·vn；并入 bias 后 λ = -(vn - bias)·m ≈ (1+e)|vn|·m
        point.biasVelocity += -e * vn;
    }
    if (dt <= 1e-8) return;
    // 墙面等非支撑接触不做穿透 bias，减少侧向拉扯
    if (manifold.normal.y <= SUPPORT_BIAS_Y) return;
    const error = point.penetration - PENETRATION_SLOP;
    if (error <= 0) return;
    point.biasVelocity += Math.min(
        error * PENETRATION_BIAS_FACTOR / dt,
        MAX_CORRECTION_VELOCITY,
    );
}

/** 热启动：施加上一帧累计的法向冲量。 */
export function warmStartNormal(
    body: ImpulseBody,
    manifold: ContactManifold,
    point: ContactPoint,
): void {
    if (point.normalImpulse === 0) return;
    _impulse.copy(manifold.normal).multiplyScalar(point.normalImpulse);
    body.applyImpulseAtPoint(_impulse, point.worldPoint);
}

/**
 * 解法向非穿透约束。
 * 冲量累计且钳制为 ≥ 0（只推开、不拉回）。
 */
export function solveNormalConstraint(
    body: ImpulseBody,
    manifold: ContactManifold,
    point: ContactPoint,
): void {
    const n = manifold.normal;
    body.getVelocityAtPoint(point.worldPoint, _vel);
    const vn = _vel.dot(n);
    const mass = effectiveMass(body, point.worldPoint, n, _r, _gcross, _local, _world, _invQuat);
    if (mass <= 0) return;

    // 使 vn 趋向 biasVelocity（弹性 + 穿透修正）
    const lambda = -(vn - point.biasVelocity) * mass;
    const old = point.normalImpulse;
    point.normalImpulse = Math.max(0, old + lambda);
    const applied = point.normalImpulse - old;
    if (applied === 0) return;
    _impulse.copy(n).multiplyScalar(applied);
    body.applyImpulseAtPoint(_impulse, point.worldPoint);
}
