import * as THREE from "three";
import { CONTACT_SKIN, type RawContact } from "./contacts/ContactPoint";
import { DynamicBody } from "./DynamicBody";

/**
 * 动态球刚体。
 * 球惯量 I = ⅖ m r²；与网格的接触冲量走 ContactImpulseSolver。
 */
export class DynamicSphereBody extends DynamicBody {
    readonly kind = "sphere" as const; // 形状判别
    radius: number; // 碰撞半径

    /** 按体积 × 密度算质量，并写入球惯量。 */
    constructor(opts: {
        radius: number;
        density: number;
        restitution: number;
        gravity: number;
        position: THREE.Vector3;
        velocity: THREE.Vector3;
        angularVelocity?: THREE.Vector3;
        linearDamping: number;
        angularDamping: number;
        friction: number;
        mesh: THREE.Mesh;
        debugMesh: THREE.Mesh;
    }) {
        const volume = (4 / 3) * Math.PI * opts.radius * opts.radius * opts.radius;
        super({
            density: opts.density,
            mass: volume * Math.max(1e-8, opts.density),
            restitution: opts.restitution,
            gravity: opts.gravity,
            position: opts.position,
            velocity: opts.velocity,
            angularVelocity: opts.angularVelocity,
            linearDamping: opts.linearDamping,
            angularDamping: opts.angularDamping,
            friction: opts.friction,
            mesh: opts.mesh,
            debugMesh: opts.debugMesh,
        });
        this.radius = opts.radius;
        this.setSphereInertia();
    }

    /** 特征半尺寸即半径。 */
    characteristicExtent(): number {
        return this.radius;
    }

    /** 实心球惯量 I = ⅖ m r²（对角），并写 invInertia。 */
    setSphereInertia(): void {
        const i = 0.4 * this.mass * this.radius * this.radius;
        const inv = i > 1e-8 ? 1 / i : 0;
        this.invInertia.set(inv, inv, inv);
    }
}

/** 类型收窄：动态球。 */
export function isSphereBody(body: DynamicBody): body is DynamicSphereBody {
    return body.kind === "sphere";
}

/** 球窄相预分配临时量（避免每帧 new）。 */
export type SphereCollisionTemps = {
    invMat: THREE.Matrix4; // mesh.matrixWorld 的逆
    normalMat: THREE.Matrix3; // 法线变换矩阵
    invQuat: THREE.Quaternion; // 盒朝向的逆
    localSphere: THREE.Sphere; // 网格本地空间中的查询球
    closest: THREE.Vector3; // 三角面 / 盒上最近点（本地）
    worldClosest: THREE.Vector3; // 最近点世界坐标
    offset: THREE.Vector3; // 球心到最近点的偏移
    before: THREE.Vector3; // 推出前位置备份
    normal: THREE.Vector3; // 接触法线（由对面指向球）
    local: THREE.Vector3; // 盒局部坐标
    contact: THREE.Vector3; // 世界接触点
    boxVel: THREE.Vector3; // 盒上接触点速度
    impulse: THREE.Vector3; // 冲量缓冲
};

/** 创建球碰撞临时量。 */
export function createSphereCollisionTemps(): SphereCollisionTemps {
    return {
        invMat: new THREE.Matrix4(),
        normalMat: new THREE.Matrix3(),
        invQuat: new THREE.Quaternion(),
        localSphere: new THREE.Sphere(),
        closest: new THREE.Vector3(),
        worldClosest: new THREE.Vector3(),
        offset: new THREE.Vector3(),
        before: new THREE.Vector3(),
        normal: new THREE.Vector3(),
        local: new THREE.Vector3(),
        contact: new THREE.Vector3(),
        boxVel: new THREE.Vector3(),
        impulse: new THREE.Vector3(),
    };
}

/**
 * 收集球 vs 单个 BVH 网格的原始接触（不移动球心）。
 * 法线由表面指向球心；penetration = radius - 距离；返回写入后的 rawCount。
 */
export function collectSphereVsMeshContacts(
    position: THREE.Vector3,
    radius: number,
    mesh: THREE.Mesh,
    temps: SphereCollisionTemps,
    raw: RawContact[],
    rawCount: number,
    maxRaw: number,
): number {
    const tree = (mesh.geometry as any)?.boundsTree;
    if (!tree || rawCount >= maxRaw) return rawCount;

    // 球变到网格本地，均匀缩放用 scale.x 近似
    temps.invMat.copy(mesh.matrixWorld).invert();
    temps.localSphere.center.copy(position).applyMatrix4(temps.invMat);
    const scale = mesh.scale.x || 1;
    temps.localSphere.radius = radius / scale;

    temps.normalMat.getNormalMatrix(mesh.matrixWorld);

    tree.shapecast({
        intersectsBounds: (box: THREE.Box3) => box.intersectsSphere(temps.localSphere),
        intersectsTriangle: (tri: any) => {
            if (rawCount >= maxRaw) return true; // 触达上限则提前结束遍历
            tri.closestPointToPoint(temps.localSphere.center, temps.closest);
            temps.offset.subVectors(temps.localSphere.center, temps.closest);
            const dist = temps.offset.length();
            const penetration = temps.localSphere.radius - dist;
            // 允许轻微皮肤重叠；再远则不是接触
            if (penetration < -CONTACT_SKIN) return;

            if (dist > 1e-8) temps.normal.copy(temps.offset).multiplyScalar(1 / dist);
            else temps.normal.set(0, 1, 0); // 球心几乎落在面上时给默认上法线
            temps.normal.applyMatrix3(temps.normalMat).normalize();

            temps.worldClosest.copy(temps.closest).applyMatrix4(mesh.matrixWorld);
            const slot = raw[rawCount++];
            slot.point.copy(temps.worldClosest);
            slot.normal.copy(temps.normal);
            slot.penetration = penetration * scale; // 穿透深度还原到世界尺度
        },
        boundsTraverseOrder: (box: THREE.Box3) => box.distanceToPoint(temps.localSphere.center) - temps.localSphere.radius,
    });

    return rawCount;
}

/**
 * 球 vs OBB：重叠则推出球并写 temps.normal / contact。
 * 法线由盒指向球；会就地修改 position。
 */
export function collideSphereVsObb(
    position: THREE.Vector3,
    radius: number,
    boxPos: THREE.Vector3,
    boxQuat: THREE.Quaternion,
    half: THREE.Vector3,
    temps: SphereCollisionTemps,
): boolean {
    // 球心变到盒局部
    temps.invQuat.copy(boxQuat).invert();
    temps.local.copy(position).sub(boxPos).applyQuaternion(temps.invQuat);

    const hx = half.x;
    const hy = half.y;
    const hz = half.z;
    const inside =
        Math.abs(temps.local.x) <= hx &&
        Math.abs(temps.local.y) <= hy &&
        Math.abs(temps.local.z) <= hz;

    if (inside) {
        // 球心已在盒内：沿穿透最小的轴推出到表面外 radius
        const dx = hx - Math.abs(temps.local.x);
        const dy = hy - Math.abs(temps.local.y);
        const dz = hz - Math.abs(temps.local.z);
        if (dx <= dy && dx <= dz) {
            temps.local.x = Math.sign(temps.local.x || 1) * (hx + radius);
            temps.normal.set(Math.sign(temps.local.x), 0, 0);
        } else if (dy <= dz) {
            temps.local.y = Math.sign(temps.local.y || 1) * (hy + radius);
            temps.normal.set(0, Math.sign(temps.local.y), 0);
        } else {
            temps.local.z = Math.sign(temps.local.z || 1) * (hz + radius);
            temps.normal.set(0, 0, Math.sign(temps.local.z));
        }
        temps.normal.applyQuaternion(boxQuat);
        position.copy(temps.local).applyQuaternion(boxQuat).add(boxPos);
        temps.contact.copy(position).addScaledVector(temps.normal, -radius);
        return true;
    }

    // 盒外：钳到盒表面最近点，若距球心 < radius 则推出
    temps.closest.set(
        Math.min(hx, Math.max(-hx, temps.local.x)),
        Math.min(hy, Math.max(-hy, temps.local.y)),
        Math.min(hz, Math.max(-hz, temps.local.z)),
    );
    temps.offset.subVectors(temps.local, temps.closest);
    const dist = temps.offset.length();
    if (dist >= radius || dist < 1e-8) return false;
    temps.offset.multiplyScalar(1 / dist);
    temps.local.addScaledVector(temps.offset, radius - dist);
    temps.normal.copy(temps.offset).applyQuaternion(boxQuat);
    position.copy(temps.local).applyQuaternion(boxQuat).add(boxPos);
    temps.contact.copy(temps.closest).applyQuaternion(boxQuat).add(boxPos);
    return true;
}

/**
 * 两球按质量推出并交换法向速度。
 * 暂不走双刚体 ContactImpulseSolver（无摩擦 / 无角冲量）。
 */
export function resolveSphereSphere(
    a: DynamicSphereBody,
    b: DynamicSphereBody,
    temps: SphereCollisionTemps,
    restitution: number,
): void {
    temps.offset.subVectors(a.position, b.position);
    const dist = temps.offset.length();
    const minDist = a.radius + b.radius;
    if (dist >= minDist) return;
    if (dist > 1e-8) temps.normal.copy(temps.offset).multiplyScalar(1 / dist);
    else temps.normal.set(0, 1, 0); // 完全重合时给默认法线

    // 位置分离（按 invMass 分配）
    const depth = minDist - dist;
    const invA = a.invMass;
    const invB = b.invMass;
    const invSum = invA + invB;
    a.position.addScaledVector(temps.normal, depth * (invA / invSum));
    b.position.addScaledVector(temps.normal, -depth * (invB / invSum));

    // 仅处理接近中的法向相对速度
    const rel = a.velocity.dot(temps.normal) - b.velocity.dot(temps.normal);
    if (rel >= 0) return;
    const impulse = -(1 + restitution) * rel / invSum;
    a.velocity.addScaledVector(temps.normal, impulse * invA);
    b.velocity.addScaledVector(temps.normal, -impulse * invB);
}
