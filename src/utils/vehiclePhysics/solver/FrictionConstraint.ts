import * as THREE from "three";
import type { ContactManifold } from "../contacts/ContactManifold";
import type { ContactPoint } from "../contacts/ContactPoint";
import { effectiveMass } from "../VehicleMath";
import type { VehicleRigidBody } from "../VehicleRigidBody";

const FRICTION = 0.45; // 车身接触摩擦系数上限
const _r = new THREE.Vector3();
const _gcross = new THREE.Vector3();
const _local = new THREE.Vector3();
const _world = new THREE.Vector3();
const _invQuat = new THREE.Quaternion();
const _vel = new THREE.Vector3();
const _impulse = new THREE.Vector3();

/** 施加上一帧切向冲量。 */
export function warmStartFriction(
    body: VehicleRigidBody,
    point: ContactPoint,
): void {
    if (point.tangentImpulse1 === 0 && point.tangentImpulse2 === 0) return;
    // 把上一帧两个切向冲量合成后打到接触点
    _impulse.copy(point.tangent1).multiplyScalar(point.tangentImpulse1);
    _impulse.addScaledVector(point.tangent2, point.tangentImpulse2);
    body.applyImpulseAtPoint(_impulse, point.worldPoint);
}

/** 解切向摩擦，冲量钳在摩擦锥内。 */
export function solveFrictionConstraint(
    body: VehicleRigidBody,
    _manifold: ContactManifold,
    point: ContactPoint,
): void {
    // 库仑上限：μ × 法向冲量，没有压力就没有摩擦
    const maxF = FRICTION * point.normalImpulse;
    if (maxF <= 1e-8) {
        point.tangentImpulse1 = 0;
        point.tangentImpulse2 = 0;
        return;
    }

    // 沿两个切向消掉相对滑动
    body.getVelocityAtPoint(point.worldPoint, _vel);
    const vt1 = _vel.dot(point.tangent1);
    const vt2 = _vel.dot(point.tangent2);
    const mass1 = effectiveMass(body, point.worldPoint, point.tangent1, _r, _gcross, _local, _world, _invQuat);
    const mass2 = effectiveMass(body, point.worldPoint, point.tangent2, _r, _gcross, _local, _world, _invQuat);

    const old1 = point.tangentImpulse1;
    const old2 = point.tangentImpulse2;
    point.tangentImpulse1 += mass1 > 0 ? -vt1 * mass1 : 0;
    point.tangentImpulse2 += mass2 > 0 ? -vt2 * mass2 : 0;

    // 超出摩擦锥则等比例缩小，保持方向
    const magSq = point.tangentImpulse1 * point.tangentImpulse1 + point.tangentImpulse2 * point.tangentImpulse2;
    const maxSq = maxF * maxF;
    if (magSq > maxSq && magSq > 1e-12) {
        const scale = maxF / Math.sqrt(magSq);
        point.tangentImpulse1 *= scale;
        point.tangentImpulse2 *= scale;
    }

    // 只施加本轮增量，避免重复打完整冲量
    const d1 = point.tangentImpulse1 - old1;
    const d2 = point.tangentImpulse2 - old2;
    if (d1 === 0 && d2 === 0) return;
    _impulse.copy(point.tangent1).multiplyScalar(d1).addScaledVector(point.tangent2, d2);
    body.applyImpulseAtPoint(_impulse, point.worldPoint);
}
