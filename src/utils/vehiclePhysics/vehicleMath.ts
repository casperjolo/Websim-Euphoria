import * as THREE from "three";

const EPS = 1e-8; // 有效质量分母下限

/** 冲量公式所需的刚体字段。 */
type RigidBodyMassProps = {
    position: THREE.Vector3;
    quaternion: THREE.Quaternion;
    invMass: number;
    invInertia: THREE.Vector3;
};

/** 冲量分母：invMass + n · (I⁻¹ (r × n) × r) */
export function impulseDenominator(
    body: RigidBodyMassProps,
    point: THREE.Vector3,
    normal: THREE.Vector3,
    r: THREE.Vector3,
    gcross: THREE.Vector3,
    local: THREE.Vector3,
    world: THREE.Vector3,
    invQuat: THREE.Quaternion,
): number {
    r.subVectors(point, body.position);
    gcross.copy(r).cross(normal);
    // 力矩变到局部惯量，再变回世界：I⁻¹ (r × n)
    invQuat.copy(body.quaternion).invert();
    local.copy(gcross).applyQuaternion(invQuat);
    local.x *= body.invInertia.x;
    local.y *= body.invInertia.y;
    local.z *= body.invInertia.z;
    world.copy(local).applyQuaternion(body.quaternion);
    world.cross(r);
    return body.invMass + normal.dot(world);
}

/** 沿方向约束的有效质量（冲量分母的倒数）。 */
export function effectiveMass(
    body: RigidBodyMassProps,
    point: THREE.Vector3,
    normal: THREE.Vector3,
    r: THREE.Vector3,
    gcross: THREE.Vector3,
    local: THREE.Vector3,
    world: THREE.Vector3,
    invQuat: THREE.Quaternion,
): number {
    const denom = impulseDenominator(body, point, normal, r, gcross, local, world, invQuat);
    return denom > EPS ? 1 / denom : 0;
}

/** 用世界角速度积分四元数：q += 0.5 * ω * q * dt */
export function integrateQuaternion(q: THREE.Quaternion, omega: THREE.Vector3, dt: number): void {
    const halfDt = 0.5 * dt;
    const qx = q.x, qy = q.y, qz = q.z, qw = q.w;
    const wx = omega.x, wy = omega.y, wz = omega.z;
    q.x += halfDt * (wx * qw + wy * qz - wz * qy);
    q.y += halfDt * (wy * qw + wz * qx - wx * qz);
    q.z += halfDt * (wz * qw + wx * qy - wy * qx);
    q.w += halfDt * (-wx * qx - wy * qy - wz * qz);
    q.normalize();
}

/** 三角形上距点 p 最近的点。 */
export function closestPointOnTriangle(
    p: THREE.Vector3,
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
    out: THREE.Vector3,
    ab: THREE.Vector3,
    ac: THREE.Vector3,
    ap: THREE.Vector3,
    bp: THREE.Vector3,
    cp: THREE.Vector3,
): THREE.Vector3 {
    ab.subVectors(b, a);
    ac.subVectors(c, a);
    ap.subVectors(p, a);

    const d1 = ab.dot(ap);
    const d2 = ac.dot(ap);
    if (d1 <= 0 && d2 <= 0) return out.copy(a); // 顶点 A

    bp.subVectors(p, b);
    const d3 = ab.dot(bp);
    const d4 = ac.dot(bp);
    if (d3 >= 0 && d4 <= d3) return out.copy(b); // 顶点 B

    const vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) {
        const v = d1 / (d1 - d3);
        return out.copy(a).addScaledVector(ab, v); // 边 AB
    }

    cp.subVectors(p, c);
    const d5 = ab.dot(cp);
    const d6 = ac.dot(cp);
    if (d6 >= 0 && d5 <= d6) return out.copy(c); // 顶点 C

    const vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) {
        const w = d2 / (d2 - d6);
        return out.copy(a).addScaledVector(ac, w); // 边 AC
    }

    const va = d3 * d6 - d5 * d4;
    if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
        const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
        return out.copy(b).addScaledVector(ab.subVectors(c, b), w); // 边 BC
    }

    const denom = 1 / (va + vb + vc);
    return out.copy(a).addScaledVector(ab, vb * denom).addScaledVector(ac, vc * denom); // 面内
}
