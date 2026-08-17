import * as THREE from "three";
import type { ImpulseBody } from "../solver/ImpulseBody";
import { ContactManifold } from "./ContactManifold";
import { ContactPoint, CONTACT_SKIN, type RawContact } from "./ContactPoint";

const NORMAL_MERGE = 0.98; // 法线点积高于此值并入同一流形
const MAX_POINTS = 4; // 单流形最多保留的接触点
const SUPPORT_Y = 0.7; // ny 以上视为支撑面（地面）
const WALL_Y = 0.35; // ny 以下视为墙面

const _invQuat = new THREE.Quaternion();
const _ab = new THREE.Vector3();
const _ac = new THREE.Vector3();
const _ap = new THREE.Vector3();
const _n = new THREE.Vector3();

/**
 * 将原始接触按法线聚类，并裁成至多 4 个支撑点。
 * 返回写入后的 out（长度收束为有效流形数）。
 */
export function reduceContacts(
    raw: RawContact[],
    count: number,
    body: ImpulseBody,
    out: ContactManifold[],
): ContactManifold[] {
    for (const m of out) m.clear();
    let manifoldCount = 0;

    // 按法线合并进流形，并累计 normalSum
    for (let r = 0; r < count; r++) {
        const contact = raw[r];
        if (contact.penetration < -CONTACT_SKIN || contact.normal.lengthSq() < 1e-8) continue;
        _n.copy(contact.normal).normalize();
        let cluster = -1;
        for (let i = 0; i < manifoldCount; i++) {
            if (out[i].normal.dot(_n) > NORMAL_MERGE) {
                cluster = i;
                break;
            }
        }
        if (cluster < 0) {
            if (manifoldCount === out.length) {
                out.push(new ContactManifold());
            }
            cluster = manifoldCount;
            manifoldCount += 1;
            out[cluster].normalSum.copy(_n);
            out[cluster].normal.copy(_n);
        } else {
            out[cluster].normalSum.add(_n);
            out[cluster].normal.copy(out[cluster].normalSum).normalize();
        }
        out[cluster].contacts.push(makePoint(contact, body));
    }

    // 定稿法线、裁点、建切向基
    for (let i = 0; i < manifoldCount; i++) {
        const manifold = out[i];
        if (manifold.normalSum.lengthSq() < 1e-8) manifold.normal.set(0, 1, 0);
        else manifold.normal.copy(manifold.normalSum).normalize();
        if (manifold.contacts.length > MAX_POINTS) {
            manifold.contacts = pickSupportPoints(manifold.contacts);
        }
        for (const point of manifold.contacts) {
            buildTangents(manifold.normal, point);
        }
    }

    out.length = manifoldCount;
    stabilizeEdgeManifolds(out);
    return out;
}

/** 按法线竖直分量分类：支撑面 / 墙 / 斜面。 */
export function normalClass(normal: THREE.Vector3): "support" | "wall" | "slant" {
    if (normal.y >= SUPPORT_Y) return "support";
    if (normal.y <= WALL_Y) return "wall";
    return "slant";
}

/**
 * 边角同时碰到地面与墙时丢掉斜面流形，避免错误推力。
 * 若没有支撑面，则把斜面法线抬到至少 SUPPORT_Y，减轻卡边抖动。
 */
function stabilizeEdgeManifolds(manifolds: ContactManifold[]): void {
    let hasSupport = false;
    let hasWall = false;
    for (const m of manifolds) {
        const cls = normalClass(m.normal);
        if (cls === "support") hasSupport = true;
        else if (cls === "wall") hasWall = true;
    }

    if (hasSupport && hasWall) {
        let write = 0;
        for (let i = 0; i < manifolds.length; i++) {
            if (normalClass(manifolds[i].normal) === "slant") continue;
            if (write !== i) manifolds[write] = manifolds[i];
            write += 1;
        }
        manifolds.length = write;
        return;
    }

    if (!hasSupport) {
        for (const m of manifolds) {
            if (normalClass(m.normal) !== "slant") continue;
            m.normal.y = Math.max(m.normal.y, SUPPORT_Y);
            m.normal.normalize();
            m.normalSum.copy(m.normal);
            for (const point of m.contacts) {
                buildTangents(m.normal, point);
            }
        }
    }
}

/** 由原始接触生成 ContactPoint，并写入刚体局部坐标（供帧间匹配）。 */
function makePoint(raw: RawContact, body: ImpulseBody): ContactPoint {
    const point = new ContactPoint();
    point.worldPoint.copy(raw.point);
    point.penetration = raw.penetration;
    _invQuat.copy(body.quaternion).invert();
    point.localPoint.subVectors(raw.point, body.position).applyQuaternion(_invQuat);
    return point;
}

/**
 * 从过多接触点中挑最多 4 个：最深穿透 → 最远点 → 最大面积第三点 → 离平面最远第四点。
 * 用于稳定盒/车身 resting 接触。
 */
function pickSupportPoints(points: ContactPoint[]): ContactPoint[] {
    if (points.length <= MAX_POINTS) return points;

    // p0：穿透最深
    let i0 = 0;
    for (let i = 1; i < points.length; i++) {
        if (points[i].penetration > points[i0].penetration) i0 = i;
    }
    const p0 = points[i0];

    // p1：离 p0 最远
    let i1 = i0;
    let best = -1;
    for (let i = 0; i < points.length; i++) {
        const d = points[i].worldPoint.distanceToSquared(p0.worldPoint);
        if (d > best) {
            best = d;
            i1 = i;
        }
    }
    const p1 = points[i1];

    // p2：与 p0p1 构成面积最大
    let i2 = i0;
    best = -1;
    _ab.subVectors(p1.worldPoint, p0.worldPoint);
    for (let i = 0; i < points.length; i++) {
        _ap.subVectors(points[i].worldPoint, p0.worldPoint);
        const area = _ap.cross(_ab).lengthSq();
        if (area > best) {
            best = area;
            i2 = i;
        }
    }
    const p2 = points[i2];

    // p3：离 p0p1p2 平面最远（略加权穿透）
    let i3 = i0;
    best = -1;
    _ab.subVectors(p1.worldPoint, p0.worldPoint);
    _ac.subVectors(p2.worldPoint, p0.worldPoint);
    _n.copy(_ab).cross(_ac);
    for (let i = 0; i < points.length; i++) {
        if (i === i0 || i === i1 || i === i2) continue;
        _ap.subVectors(points[i].worldPoint, p0.worldPoint);
        const d = Math.abs(_ap.dot(_n));
        const score = d + points[i].penetration * 0.01;
        if (score > best) {
            best = score;
            i3 = i;
        }
    }

    const picked = [p0];
    if (i1 !== i0) picked.push(p1);
    if (i2 !== i0 && i2 !== i1) picked.push(p2);
    if (i3 !== i0 && i3 !== i1 && i3 !== i2 && picked.length < MAX_POINTS) picked.push(points[i3]);
    return picked;
}

/** 由流形法线构造正交切向基（摩擦两轴）。 */
function buildTangents(normal: THREE.Vector3, point: ContactPoint): void {
    if (Math.abs(normal.y) < 0.99) point.tangent1.set(0, 1, 0).cross(normal);
    else point.tangent1.set(1, 0, 0).cross(normal); // 法线近竖直时换参考轴
    if (point.tangent1.lengthSq() < 1e-8) point.tangent1.set(0, 0, 1).cross(normal);
    point.tangent1.normalize();
    point.tangent2.copy(normal).cross(point.tangent1).normalize();
}
