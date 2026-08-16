import * as THREE from "three";
import type { VehicleRigidBody } from "../VehicleRigidBody";
import { ContactManifold } from "./ContactManifold";
import { ContactPoint, CONTACT_SKIN, type RawContact } from "./ContactPoint";

const NORMAL_MERGE = 0.98; // 法线点积超过此值则并入同一流形
const MAX_POINTS = 4; // 每个流形最多保留的支撑点
const SUPPORT_Y = 0.7; // 视为台面支撑的法线 y 下限
const WALL_Y = 0.35; // 视为立面的法线 y 上限

const _invQuat = new THREE.Quaternion();
const _ab = new THREE.Vector3();
const _ac = new THREE.Vector3();
const _ap = new THREE.Vector3();
const _n = new THREE.Vector3();

/** 将原始接触按法线聚类，并裁成至多 4 个支撑点。 */
export function reduceContacts(
    raw: RawContact[],
    count: number,
    body: VehicleRigidBody,
    out: ContactManifold[],
): ContactManifold[] {
    for (const m of out) m.clear();
    let manifoldCount = 0;

    // 按法线点积把接触并入同一流形
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

    for (let i = 0; i < manifoldCount; i++) {
        const manifold = out[i];
        if (manifold.normalSum.lengthSq() < 1e-8) manifold.normal.set(0, 1, 0);
        else manifold.normal.copy(manifold.normalSum).normalize();
        // 每簇最多留 4 个支撑点
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

/** 按法线 y 分量区分台面、立面和斜面。 */
export function normalClass(normal: THREE.Vector3): "support" | "wall" | "slant" {
    if (normal.y >= SUPPORT_Y) return "support";
    if (normal.y <= WALL_Y) return "wall";
    return "slant";
}

/** 台面与立面共存时丢掉斜面；没有台面时把斜面抬成支撑。 */
function stabilizeEdgeManifolds(manifolds: ContactManifold[]): void {
    let hasSupport = false;
    let hasWall = false;
    for (const m of manifolds) {
        const cls = normalClass(m.normal);
        if (cls === "support") hasSupport = true;
        else if (cls === "wall") hasWall = true;
    }

    // 同时有台面和立面时丢掉斜面，避免棱边把车抬飞
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

    // 没有台面时把斜面抬成支撑，避免贴边滑落
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

/** 由原始接触生成约束点，并写出底盘局部坐标。 */
function makePoint(raw: RawContact, body: VehicleRigidBody): ContactPoint {
    const point = new ContactPoint();
    point.worldPoint.copy(raw.point);
    point.penetration = raw.penetration;
    _invQuat.copy(body.quaternion).invert();
    point.localPoint.subVectors(raw.point, body.position).applyQuaternion(_invQuat);
    return point;
}

/** 从过密接触里挑最多 4 个支撑点。 */
function pickSupportPoints(points: ContactPoint[]): ContactPoint[] {
    if (points.length <= MAX_POINTS) return points;

    // 最深点 + 最远点 + 最大面积点 + 离平面最远点
    let i0 = 0;
    for (let i = 1; i < points.length; i++) {
        if (points[i].penetration > points[i0].penetration) i0 = i;
    }
    const p0 = points[i0];

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

/** 由法线构造一对正交切向。 */
function buildTangents(normal: THREE.Vector3, point: ContactPoint): void {
    if (Math.abs(normal.y) < 0.99) point.tangent1.set(0, 1, 0).cross(normal);
    else point.tangent1.set(1, 0, 0).cross(normal);
    if (point.tangent1.lengthSq() < 1e-8) point.tangent1.set(0, 0, 1).cross(normal);
    point.tangent1.normalize();
    point.tangent2.copy(normal).cross(point.tangent1).normalize();
}
