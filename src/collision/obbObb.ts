import * as THREE from "three";
import { impulseDenominator } from "../utils/vehiclePhysics/vehicleMath";
import type { ImpulseBody } from "./solver/ImpulseBody";

const EPS = 1e-8; // 退化轴 / 零长度下限
const AXIS_EPS = 1e-10; // 平行边叉积视为退化
const BAUMGARTE = 0.8; // 每帧推出重叠的比例
const RESTITUTION = 0.2; // 车车法向弹性
const FRICTION = 0.4; // 切向摩擦相对法向冲量的上限

/** OBB–OBB 解算所需的刚体字段（扩展共享 ImpulseBody）。 */
export type ObbRigidBody = ImpulseBody & {
    halfExtents: THREE.Vector3; // 碰撞盒半边长
};

/** OBB SAT / 接触冲量的预分配临时量。 */
export type ObbObbTemps = {
    ax: THREE.Vector3; // A 盒世界轴 X
    ay: THREE.Vector3;
    az: THREE.Vector3;
    bx: THREE.Vector3; // B 盒世界轴 X
    by: THREE.Vector3;
    bz: THREE.Vector3;
    axis: THREE.Vector3; // 当前测试分离轴
    bestN: THREE.Vector3; // 最小平移法线（A → B）
    tangent: THREE.Vector3; // 摩擦切向
    invQuatA: THREE.Quaternion;
    invQuatB: THREE.Quaternion;
    local: THREE.Vector3; // 支撑点局部缓冲
    supportA: THREE.Vector3; // A 沿法线的支撑点
    supportB: THREE.Vector3; // B 沿反法线的支撑点
    contact: THREE.Vector3; // 世界接触点（两支撑中点）
    velA: THREE.Vector3; // 接触点处 A 速度
    velB: THREE.Vector3;
    rel: THREE.Vector3; // 质心差 / 相对速度缓冲
    impulse: THREE.Vector3;
    r: THREE.Vector3; // impulseDenominator 用
    gcross: THREE.Vector3;
    localI: THREE.Vector3;
    worldI: THREE.Vector3;
    invQuat: THREE.Quaternion;
};

/** 创建 OBB 碰撞临时量。 */
export function createObbObbTemps(): ObbObbTemps {
    return {
        ax: new THREE.Vector3(),
        ay: new THREE.Vector3(),
        az: new THREE.Vector3(),
        bx: new THREE.Vector3(),
        by: new THREE.Vector3(),
        bz: new THREE.Vector3(),
        axis: new THREE.Vector3(),
        bestN: new THREE.Vector3(),
        tangent: new THREE.Vector3(),
        invQuatA: new THREE.Quaternion(),
        invQuatB: new THREE.Quaternion(),
        local: new THREE.Vector3(),
        supportA: new THREE.Vector3(),
        supportB: new THREE.Vector3(),
        contact: new THREE.Vector3(),
        velA: new THREE.Vector3(),
        velB: new THREE.Vector3(),
        rel: new THREE.Vector3(),
        impulse: new THREE.Vector3(),
        r: new THREE.Vector3(),
        gcross: new THREE.Vector3(),
        localI: new THREE.Vector3(),
        worldI: new THREE.Vector3(),
        invQuat: new THREE.Quaternion(),
    };
}

/** 盒在轴 n 上的投影半径（半宽之和）。 */
function radiusOnAxis(ax: THREE.Vector3, ay: THREE.Vector3, az: THREE.Vector3, half: THREE.Vector3, n: THREE.Vector3): number {
    return half.x * Math.abs(n.dot(ax)) + half.y * Math.abs(n.dot(ay)) + half.z * Math.abs(n.dot(az));
}

/**
 * 盒在 dir 方向上的支撑点（取各轴符号 * 半边，面法向时落在对应面心附近）。
 */
function supportPoint(
    pos: THREE.Vector3,
    quat: THREE.Quaternion,
    invQuat: THREE.Quaternion,
    half: THREE.Vector3,
    dir: THREE.Vector3,
    local: THREE.Vector3,
    out: THREE.Vector3,
): THREE.Vector3 {
    local.copy(dir).applyQuaternion(invQuat);
    out.set(
        Math.sign(local.x) * half.x,
        Math.sign(local.y) * half.y,
        Math.sign(local.z) * half.z,
    );
    return out.applyQuaternion(quat).add(pos);
}

/**
 * 两车底盘 OBB：SAT 最小平移推出，再按质量在接触点施法向 / 摩擦冲量。
 * `temps.bestN` 指向从 A 到 B；有重叠并处理则返回 true。
 */
export function resolveObbObb(a: ObbRigidBody, b: ObbRigidBody, temps: ObbObbTemps): boolean {
    // 两盒局部轴变到世界
    temps.ax.set(1, 0, 0).applyQuaternion(a.quaternion);
    temps.ay.set(0, 1, 0).applyQuaternion(a.quaternion);
    temps.az.set(0, 0, 1).applyQuaternion(a.quaternion);
    temps.bx.set(1, 0, 0).applyQuaternion(b.quaternion);
    temps.by.set(0, 1, 0).applyQuaternion(b.quaternion);
    temps.bz.set(0, 0, 1).applyQuaternion(b.quaternion);

    let minOverlap = Infinity;
    /** 测试一根分离轴：无重叠返回 false；否则更新最小平移轴。 */
    const tryAxis = (x: number, y: number, z: number): boolean => {
        temps.axis.set(x, y, z);
        const lenSq = temps.axis.lengthSq();
        if (lenSq < AXIS_EPS) return true; // 平行边叉积退化，跳过
        temps.axis.multiplyScalar(1 / Math.sqrt(lenSq));
        // 重叠深度 = 两投影半径之和 - 质心差在轴上的投影
        const overlap =
            radiusOnAxis(temps.ax, temps.ay, temps.az, a.halfExtents, temps.axis)
            + radiusOnAxis(temps.bx, temps.by, temps.bz, b.halfExtents, temps.axis)
            - Math.abs(temps.axis.dot(temps.rel.subVectors(b.position, a.position)));
        if (overlap <= EPS) return false; // 分离
        if (overlap < minOverlap) {
            minOverlap = overlap;
            temps.bestN.copy(temps.axis);
            // 法线统一为 A → B
            if (temps.bestN.dot(temps.rel) < 0) temps.bestN.negate();
        }
        return true;
    };

    // 面法线：A、B 各 3 轴
    if (!tryAxis(temps.ax.x, temps.ax.y, temps.ax.z)) return false;
    if (!tryAxis(temps.ay.x, temps.ay.y, temps.ay.z)) return false;
    if (!tryAxis(temps.az.x, temps.az.y, temps.az.z)) return false;
    if (!tryAxis(temps.bx.x, temps.bx.y, temps.bx.z)) return false;
    if (!tryAxis(temps.by.x, temps.by.y, temps.by.z)) return false;
    if (!tryAxis(temps.bz.x, temps.bz.y, temps.bz.z)) return false;

    // 边叉积：A 的 3 边 × B 的 3 边
    temps.axis.copy(temps.ax).cross(temps.bx);
    if (!tryAxis(temps.axis.x, temps.axis.y, temps.axis.z)) return false;
    temps.axis.copy(temps.ax).cross(temps.by);
    if (!tryAxis(temps.axis.x, temps.axis.y, temps.axis.z)) return false;
    temps.axis.copy(temps.ax).cross(temps.bz);
    if (!tryAxis(temps.axis.x, temps.axis.y, temps.axis.z)) return false;
    temps.axis.copy(temps.ay).cross(temps.bx);
    if (!tryAxis(temps.axis.x, temps.axis.y, temps.axis.z)) return false;
    temps.axis.copy(temps.ay).cross(temps.by);
    if (!tryAxis(temps.axis.x, temps.axis.y, temps.axis.z)) return false;
    temps.axis.copy(temps.ay).cross(temps.bz);
    if (!tryAxis(temps.axis.x, temps.axis.y, temps.axis.z)) return false;
    temps.axis.copy(temps.az).cross(temps.bx);
    if (!tryAxis(temps.axis.x, temps.axis.y, temps.axis.z)) return false;
    temps.axis.copy(temps.az).cross(temps.by);
    if (!tryAxis(temps.axis.x, temps.axis.y, temps.axis.z)) return false;
    temps.axis.copy(temps.az).cross(temps.bz);
    if (!tryAxis(temps.axis.x, temps.axis.y, temps.axis.z)) return false;

    if (!Number.isFinite(minOverlap)) return false;

    // 位置修正：深度钳制后按 invMass 分配，乘 Baumgarte
    const minHalf = Math.min(
        a.halfExtents.x, a.halfExtents.y, a.halfExtents.z,
        b.halfExtents.x, b.halfExtents.y, b.halfExtents.z,
    );
    const depth = Math.min(minOverlap, minHalf * 2) * BAUMGARTE;
    const invSum = a.invMass + b.invMass;
    if (invSum <= EPS || depth <= EPS) return false;

    // 接触点 ≈ 两盒沿法线方向支撑点的中点
    temps.invQuatA.copy(a.quaternion).invert();
    temps.invQuatB.copy(b.quaternion).invert();
    supportPoint(a.position, a.quaternion, temps.invQuatA, a.halfExtents, temps.bestN, temps.local, temps.supportA);
    supportPoint(b.position, b.quaternion, temps.invQuatB, b.halfExtents, temps.rel.copy(temps.bestN).negate(), temps.local, temps.supportB);
    temps.contact.copy(temps.supportA).add(temps.supportB).multiplyScalar(0.5);

    a.position.addScaledVector(temps.bestN, -depth * (a.invMass / invSum));
    b.position.addScaledVector(temps.bestN, depth * (b.invMass / invSum));

    // 法向冲量：仅处理接近中的相对速度
    a.getVelocityAtPoint(temps.contact, temps.velA);
    b.getVelocityAtPoint(temps.contact, temps.velB);
    const relN = temps.velB.dot(temps.bestN) - temps.velA.dot(temps.bestN);
    if (relN >= 0) return true;

    const denomN =
        impulseDenominator(a, temps.contact, temps.bestN, temps.r, temps.gcross, temps.localI, temps.worldI, temps.invQuat)
        + impulseDenominator(b, temps.contact, temps.bestN, temps.r, temps.gcross, temps.localI, temps.worldI, temps.invQuat);
    if (denomN <= EPS) return true;

    const jn = -(1 + RESTITUTION) * relN / denomN;
    temps.impulse.copy(temps.bestN).multiplyScalar(-jn);
    a.applyImpulseAtPoint(temps.impulse, temps.contact);
    temps.impulse.copy(temps.bestN).multiplyScalar(jn);
    b.applyImpulseAtPoint(temps.impulse, temps.contact);

    // 库仑摩擦：切向相对速度，冲量钳在 μ|jn|
    a.getVelocityAtPoint(temps.contact, temps.velA);
    b.getVelocityAtPoint(temps.contact, temps.velB);
    temps.rel.subVectors(temps.velA, temps.velB);
    temps.rel.addScaledVector(temps.bestN, -temps.rel.dot(temps.bestN)); // 去掉法向分量
    const tLen = temps.rel.length();
    if (tLen <= EPS) return true;
    temps.tangent.copy(temps.rel).multiplyScalar(1 / tLen);

    const denomT =
        impulseDenominator(a, temps.contact, temps.tangent, temps.r, temps.gcross, temps.localI, temps.worldI, temps.invQuat)
        + impulseDenominator(b, temps.contact, temps.tangent, temps.r, temps.gcross, temps.localI, temps.worldI, temps.invQuat);
    if (denomT <= EPS) return true;

    let jt = -tLen / denomT;
    const maxF = FRICTION * Math.abs(jn);
    jt = Math.max(-maxF, Math.min(maxF, jt));
    temps.impulse.copy(temps.tangent).multiplyScalar(jt);
    a.applyImpulseAtPoint(temps.impulse, temps.contact);
    temps.impulse.negate();
    b.applyImpulseAtPoint(temps.impulse, temps.contact);
    return true;
}
