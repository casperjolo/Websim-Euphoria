import * as THREE from "three";
import { DynamicBody } from "./DynamicBody";
import type { CollisionTemps } from "../utils/capsuleCollision";

/**
 * 动态盒刚体。
 * 惯量按实心长方体；与网格的接触冲量走 ContactImpulseSolver，盒–盒走 resolveObbObb。
 */
export class DynamicBoxBody extends DynamicBody {
    readonly kind = "box" as const; // 形状判别
    halfExtents = new THREE.Vector3(); // 碰撞盒半边长

    /** 按体积 × 密度算质量，并写入长方体惯量。 */
    constructor(opts: {
        halfExtents: THREE.Vector3;
        density: number;
        restitution: number;
        gravity: number;
        position: THREE.Vector3;
        quaternion?: THREE.Quaternion;
        velocity: THREE.Vector3;
        angularVelocity?: THREE.Vector3;
        linearDamping: number;
        angularDamping: number;
        friction: number;
        mesh: THREE.Mesh;
        debugMesh: THREE.Mesh;
    }) {
        const hx = Math.max(1e-4, opts.halfExtents.x);
        const hy = Math.max(1e-4, opts.halfExtents.y);
        const hz = Math.max(1e-4, opts.halfExtents.z);
        const volume = 8 * hx * hy * hz;
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
        this.halfExtents.set(hx, hy, hz);
        if (opts.quaternion) this.quaternion.copy(opts.quaternion);
        this.setCuboidInertia();
    }

    /** 特征半尺寸取三边最大值。 */
    characteristicExtent(): number {
        return Math.max(this.halfExtents.x, this.halfExtents.y, this.halfExtents.z);
    }

    /** 实心长方体惯量 I = m/12 (h²+d²) 等，并写 invInertia。 */
    setCuboidInertia(): void {
        const m = this.mass;
        const w = this.halfExtents.x * 2;
        const h = this.halfExtents.y * 2;
        const d = this.halfExtents.z * 2;
        const ix = m / 12 * (h * h + d * d);
        const iy = m / 12 * (w * w + d * d);
        const iz = m / 12 * (w * w + h * h);
        this.invInertia.set(
            ix > 1e-8 ? 1 / ix : 0,
            iy > 1e-8 ? 1 / iy : 0,
            iz > 1e-8 ? 1 / iz : 0,
        );
    }
}

/** 类型收窄：动态盒。 */
export function isBoxBody(body: DynamicBody): body is DynamicBoxBody {
    return body.kind === "box";
}

const CAPSULE_OBB_SAMPLES = 8; // 胶囊轴采样点数（含端点）

const _invQuat = new THREE.Quaternion();
const _local = new THREE.Vector3();
const _sample = new THREE.Vector3();
const _bestOnSeg = new THREE.Vector3();
const _bestDirLocal = new THREE.Vector3();
const _candDir = new THREE.Vector3();

/**
 * 胶囊 vs OBB：沿胶囊段采样，取到 AABB 的最近距离。
 * 命中时 temps.closestTri 为**胶囊指向刚体**的单位法线（与 capsuleSphereOverlap 一致），
 * temps.closestSeg 为段上点，返回穿透深度。
 */
export function capsuleObbOverlap(
    capsule: THREE.Object3D,
    capsuleInfo: { segment: THREE.Line3; radius: number; dynamicsSegment?: THREE.Line3 },
    boxPos: THREE.Vector3,
    boxQuat: THREE.Quaternion,
    half: THREE.Vector3,
    temps: CollisionTemps,
): number {
    const segment = capsuleInfo.dynamicsSegment ?? capsuleInfo.segment;
    temps.localSeg.start.copy(segment.start).applyMatrix4(capsule.matrixWorld);
    temps.localSeg.end.copy(segment.end).applyMatrix4(capsule.matrixWorld);

    _invQuat.copy(boxQuat).invert();
    const hx = half.x;
    const hy = half.y;
    const hz = half.z;
    let bestDist = Infinity;
    let insideAxis = -1; // 0/1/2 表示在盒内时选的推出轴
    let insideSign = 1;
    let insideDepth = 0;

    for (let i = 0; i <= CAPSULE_OBB_SAMPLES; i++) {
        const t = i / CAPSULE_OBB_SAMPLES;
        _sample.lerpVectors(temps.localSeg.start, temps.localSeg.end, t);
        _local.copy(_sample).sub(boxPos).applyQuaternion(_invQuat);

        const inside =
            Math.abs(_local.x) <= hx &&
            Math.abs(_local.y) <= hy &&
            Math.abs(_local.z) <= hz;

        if (inside) {
            const dx = hx - Math.abs(_local.x);
            const dy = hy - Math.abs(_local.y);
            const dz = hz - Math.abs(_local.z);
            const depth = capsuleInfo.radius + Math.min(dx, dy, dz);
            if (depth > insideDepth) {
                insideDepth = depth;
                _bestOnSeg.copy(_sample);
                // 取穿透最小的面，法线先取盒心→外侧（稍后翻成胶囊→盒）
                if (dx <= dy && dx <= dz) {
                    insideAxis = 0;
                    insideSign = Math.sign(_local.x || 1);
                } else if (dy <= dz) {
                    insideAxis = 1;
                    insideSign = Math.sign(_local.y || 1);
                } else {
                    insideAxis = 2;
                    insideSign = Math.sign(_local.z || 1);
                }
            }
            continue;
        }

        const cx = Math.min(hx, Math.max(-hx, _local.x));
        const cy = Math.min(hy, Math.max(-hy, _local.y));
        const cz = Math.min(hz, Math.max(-hz, _local.z));
        // 盒表面 → 采样点（盒→胶囊）；返回前取反
        _candDir.set(_local.x - cx, _local.y - cy, _local.z - cz);
        const dist = _candDir.length();
        if (dist >= bestDist) continue;
        bestDist = dist;
        _bestOnSeg.copy(_sample);
        if (dist > 1e-8) _bestDirLocal.copy(_candDir).multiplyScalar(1 / dist);
        else _bestDirLocal.set(0, 1, 0);
    }

    if (insideDepth > 0) {
        temps.closestSeg.copy(_bestOnSeg);
        if (insideAxis === 0) temps.closestTri.set(insideSign, 0, 0);
        else if (insideAxis === 1) temps.closestTri.set(0, insideSign, 0);
        else temps.closestTri.set(0, 0, insideSign);
        // 盒外法线 → 翻成胶囊指向刚体（进入盒的方向）
        temps.closestTri.applyQuaternion(boxQuat).negate();
        return insideDepth;
    }

    if (bestDist >= capsuleInfo.radius) return 0;
    temps.closestSeg.copy(_bestOnSeg);
    // 盒→胶囊 取反 → 胶囊→盒
    temps.closestTri.copy(_bestDirLocal).applyQuaternion(boxQuat).negate();
    return capsuleInfo.radius - bestDist;
}
