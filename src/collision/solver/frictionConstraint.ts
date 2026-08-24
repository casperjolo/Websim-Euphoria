import * as THREE from "three";
import { effectiveMass } from "../../utils/vehiclePhysics/vehicleMath";
import type { ContactManifold } from "../contacts/ContactManifold";
import type { ContactPoint } from "../contacts/ContactPoint";
import type { ImpulseBody } from "./ImpulseBody";

const DEFAULT_FRICTION = 0.6; // body.friction 未设时的库仑系数 μ

const _r = new THREE.Vector3();
const _gcross = new THREE.Vector3();
const _local = new THREE.Vector3();
const _world = new THREE.Vector3();
const _invQuat = new THREE.Quaternion();
const _vel = new THREE.Vector3();
const _impulse = new THREE.Vector3();

/** 热启动：施加上一帧累计的切向冲量。 */
export function warmStartFriction(
    body: ImpulseBody,
    point: ContactPoint,
): void {
    if (point.tangentImpulse1 === 0 && point.tangentImpulse2 === 0) return;
    _impulse.copy(point.tangent1).multiplyScalar(point.tangentImpulse1);
    _impulse.addScaledVector(point.tangent2, point.tangentImpulse2);
    body.applyImpulseAtPoint(_impulse, point.worldPoint);
}

/**
 * 解切向摩擦约束（库仑锥）。
 * 上限 maxF = μ · 法向冲量；超出则等比缩放两切向冲量。
 */
export function solveFrictionConstraint(
    body: ImpulseBody,
    _manifold: ContactManifold,
    point: ContactPoint,
): void {
    const mu = body.friction ?? DEFAULT_FRICTION;
    const maxF = mu * point.normalImpulse;
    if (maxF <= 1e-8) {
        // 无法向压力则无摩擦
        point.tangentImpulse1 = 0;
        point.tangentImpulse2 = 0;
        return;
    }

    body.getVelocityAtPoint(point.worldPoint, _vel);
    const vt1 = _vel.dot(point.tangent1);
    const vt2 = _vel.dot(point.tangent2);
    const mass1 = effectiveMass(body, point.worldPoint, point.tangent1, _r, _gcross, _local, _world, _invQuat);
    const mass2 = effectiveMass(body, point.worldPoint, point.tangent2, _r, _gcross, _local, _world, _invQuat);

    // 累计切向冲量，使切向相对速度趋近 0
    const old1 = point.tangentImpulse1;
    const old2 = point.tangentImpulse2;
    point.tangentImpulse1 += mass1 > 0 ? -vt1 * mass1 : 0;
    point.tangentImpulse2 += mass2 > 0 ? -vt2 * mass2 : 0;

    // 钳到摩擦锥：‖λt‖ ≤ μ λn
    const magSq = point.tangentImpulse1 * point.tangentImpulse1 + point.tangentImpulse2 * point.tangentImpulse2;
    const maxSq = maxF * maxF;
    if (magSq > maxSq && magSq > 1e-12) {
        const scale = maxF / Math.sqrt(magSq);
        point.tangentImpulse1 *= scale;
        point.tangentImpulse2 *= scale;
    }

    // 只施加本轮增量
    const d1 = point.tangentImpulse1 - old1;
    const d2 = point.tangentImpulse2 - old2;
    if (d1 === 0 && d2 === 0) return;
    _impulse.copy(point.tangent1).multiplyScalar(d1).addScaledVector(point.tangent2, d2);
    body.applyImpulseAtPoint(_impulse, point.worldPoint);
}
