import * as THREE from "three";
import type { ContactManifold } from "../../collision/contacts/ContactManifold";
import { CONTACT_SKIN, contactSkinForExtent, type RawContact } from "../../collision/contacts/ContactPoint";
import { reduceContacts } from "../../collision/contacts/contactReducer";
import { closestPointOnTriangle } from "./vehicleMath";
import type { ImpulseBody } from "../../collision/solver/ImpulseBody";
import type { VehicleRigidBody } from "./VehicleRigidBody";

const MAX_RAW = 96; // 单帧原始接触上限
const CCD_SIZE_RATIO = 0.12; // 位移超过最小边长该比例时启用扫掠

/** detect 所需的 OBB 刚体（车辆底盘 / 动态盒共用）。 */
export type ObbMeshBody = ImpulseBody & {
    halfExtents: THREE.Vector3;
};

/** 车身 OBB 与 BVH 三角网格：只收集接触，高速时做扫掠。 */
export class VehicleCollision {
    private raw: RawContact[] = Array.from({ length: MAX_RAW }, () => ({
        point: new THREE.Vector3(),
        normal: new THREE.Vector3(),
        penetration: 0,
    }));
    private rawCount = 0;
    private manifolds: ContactManifold[] = [];
    private toward = new THREE.Vector3();

    private invMat = new THREE.Matrix4();
    private worldMat = new THREE.Matrix4();
    private normalMat = new THREE.Matrix3();
    private localAABB = new THREE.Box3();
    private worldAABB = new THREE.Box3();
    private corner = new THREE.Vector3();
    private prevCorner = new THREE.Vector3();
    private axisX = new THREE.Vector3();
    private axisY = new THREE.Vector3();
    private axisZ = new THREE.Vector3();
    private prevAxisX = new THREE.Vector3();
    private prevAxisY = new THREE.Vector3();
    private prevAxisZ = new THREE.Vector3();
    private toiQuat = new THREE.Quaternion();
    private localCenter = new THREE.Vector3();
    private localAxisX = new THREE.Vector3();
    private localAxisY = new THREE.Vector3();
    private localAxisZ = new THREE.Vector3();
    private triN = new THREE.Vector3();
    private edge = new THREE.Vector3();
    private testAxis = new THREE.Vector3();
    private bestAxis = new THREE.Vector3();
    private rangeA = { min: 0, max: 0 };
    private rangeB = { min: 0, max: 0 };
    private closest = new THREE.Vector3();
    private ab = new THREE.Vector3();
    private ac = new THREE.Vector3();
    private ap = new THREE.Vector3();
    private bp = new THREE.Vector3();
    private cp = new THREE.Vector3();
    private impulse = new THREE.Vector3();
    private support = new THREE.Vector3();
    private bodyHalf = new THREE.Vector3();
    private raycaster = new THREE.Raycaster();
    /** 当前 detect 按刚体尺寸缩放后的接触皮肤。 */
    private contactSkin = CONTACT_SKIN;

    /** 配置射线只取最近命中。 */
    constructor() {
        (this.raycaster as any).firstHitOnly = true;
    }

    /** 收集 OBB 与一组网格的接触流形。 */
    detect(
        body: ObbMeshBody,
        colliders: THREE.Mesh[] | THREE.Mesh | null | undefined,
    ): ContactManifold[] {
        this.rawCount = 0;
        this.manifolds.length = 0;
        const extent = Math.max(body.halfExtents.x, body.halfExtents.y, body.halfExtents.z);
        this.contactSkin = contactSkinForExtent(extent);
        for (const collider of this.toList(colliders)) {
            const tree = (collider.geometry as any)?.boundsTree;
            if (!tree) continue;
            this.collectRawContacts(body, collider, tree);
        }
        if (this.rawCount === 0) return this.manifolds;
        return reduceContacts(this.raw, this.rawCount, body, this.manifolds);
    }

    /** 本帧位移是否大到需要扫掠。 */
    needsSwept(body: VehicleRigidBody, dt: number): boolean {
        const hx = body.halfExtents.x;
        const hy = body.halfExtents.y;
        const hz = body.halfExtents.z;
        const minSize = 2 * Math.min(hx, hy, hz);
        const linTravel = body.linearVelocity.length() * dt;
        const angTravel = body.angularVelocity.length() * Math.hypot(hx, hy, hz) * dt;
        return linTravel + angTravel > minSize * CCD_SIZE_RATIO;
    }

    /** 高速穿模时按 TOI 回退位置和朝向。 */
    solveSwept(
        body: VehicleRigidBody,
        colliders: THREE.Mesh[] | THREE.Mesh | null | undefined,
        prevPosition: THREE.Vector3,
        prevQuaternion: THREE.Quaternion,
    ): void {
        const list = this.toList(colliders);
        if (!list.length) return;
        this.solveSweptCollision(body, list, prevPosition, prevQuaternion);
    }

    /** 对 8 个角点和中心扫过所有网格，按最早 TOI 回退。 */
    private solveSweptCollision(
        body: VehicleRigidBody,
        colliders: THREE.Mesh[],
        prevPosition: THREE.Vector3,
        prevQuaternion: THREE.Quaternion,
    ): void {
        this.bodyHalf.copy(body.halfExtents);
        this.setAxes(prevQuaternion, this.prevAxisX, this.prevAxisY, this.prevAxisZ);
        this.setAxes(body.quaternion, this.axisX, this.axisY, this.axisZ);
        this.raycaster.near = 0;
        let minToi = 1;
        let hitNormal: THREE.Vector3 | null = null;

        // 8 角点 + 中心沿本帧位移射线，取最早命中
        for (let i = 0; i < 9; i++) {
            if (i === 8) {
                this.prevCorner.copy(prevPosition);
                this.corner.copy(body.position);
            } else {
                const sx = (i & 1) ? 1 : -1;
                const sy = (i & 2) ? 1 : -1;
                const sz = (i & 4) ? 1 : -1;
                this.cornerFrom(prevPosition, this.prevAxisX, this.prevAxisY, this.prevAxisZ, sx, sy, sz, this.prevCorner);
                this.cornerFrom(body.position, this.axisX, this.axisY, this.axisZ, sx, sy, sz, this.corner);
            }
            this.impulse.subVectors(this.corner, this.prevCorner);
            const len = this.impulse.length();
            if (len < 1e-6) continue;
            this.impulse.multiplyScalar(1 / len);
            this.raycaster.set(this.prevCorner, this.impulse);
            this.raycaster.far = len;
            const hits = this.raycaster.intersectObjects(colliders, false);
            if (!hits.length) continue;
            const hit = hits[0];
            const toi = hit.distance / len;
            if (toi >= minToi || toi <= 1e-4) continue;
            minToi = toi;
            if (hit.face) {
                this.normalMat.getNormalMatrix(hit.object.matrixWorld);
                this.bestAxis.copy(hit.face.normal).applyMatrix3(this.normalMat).normalize();
                if (this.bestAxis.dot(this.impulse) > 0) this.bestAxis.negate();
                this.toward.copy(this.bestAxis);
                hitNormal = this.toward;
            }
        }

        if (minToi >= 1) return;
        const t = minToi * 0.95; // 略提前停在命中前
        body.position.lerpVectors(prevPosition, body.position, t);
        this.toiQuat.slerpQuaternions(prevQuaternion, body.quaternion, t);
        body.quaternion.copy(this.toiQuat);
        // 去掉沿命中法线的入射速度
        if (!hitNormal) return;
        const vn = body.linearVelocity.dot(hitNormal);
        if (vn < 0) body.linearVelocity.addScaledVector(hitNormal, -vn);
    }

    /** 把单个网格或列表收成可遍历数组。 */
    private toList(
        colliders: THREE.Mesh[] | THREE.Mesh | null | undefined,
    ): THREE.Mesh[] {
        if (!colliders) return [];
        return Array.isArray(colliders) ? colliders : [colliders];
    }

    /** 用 BVH shapecast 收集与 OBB 相交的三角。 */
    private collectRawContacts(
        body: ObbMeshBody,
        collider: THREE.Mesh,
        tree: { shapecast: (opts: any) => void },
    ): void {
        this.setWorldAxes(body);
        this.worldMat.copy(collider.matrixWorld);
        this.invMat.copy(this.worldMat).invert();
        this.normalMat.getNormalMatrix(this.worldMat);

        // OBB 变到网格本地，再用 AABB 做 BVH 粗测
        this.localCenter.copy(body.position).applyMatrix4(this.invMat);
        this.localAxisX.copy(this.axisX).transformDirection(this.invMat);
        this.localAxisY.copy(this.axisY).transformDirection(this.invMat);
        this.localAxisZ.copy(this.axisZ).transformDirection(this.invMat);

        this.computeOBBWorldAABB(body.position, this.worldAABB);
        this.localAABB.copy(this.worldAABB).applyMatrix4(this.invMat);

        const self = this;
        tree.shapecast({
            intersectsBounds: (box: THREE.Box3) => box.intersectsBox(self.localAABB),
            intersectsTriangle: (tri: { a: THREE.Vector3; b: THREE.Vector3; c: THREE.Vector3 }) => {
                self.testTriangle(body, tri.a, tri.b, tri.c);
            },
        });
    }

    /** SAT 分离则丢弃；否则用支撑点投影出接触。 */
    private testTriangle(
        body: ObbMeshBody,
        a: THREE.Vector3,
        b: THREE.Vector3,
        c: THREE.Vector3,
    ): void {
        this.ab.subVectors(b, a);
        this.ac.subVectors(c, a);
        this.triN.copy(this.ab).cross(this.ac);
        if (this.triN.lengthSq() < 1e-12) return;
        this.triN.normalize();

        // 面法线、OBB 三轴、边×轴，任一分离则不相交
        if (!this.tryAxis(this.triN, a, b, c)) return;
        if (!this.tryAxis(this.localAxisX, a, b, c)) return;
        if (!this.tryAxis(this.localAxisY, a, b, c)) return;
        if (!this.tryAxis(this.localAxisZ, a, b, c)) return;
        this.edge.subVectors(b, a);
        if (!this.tryCrossAxes(this.edge, a, b, c)) return;
        this.edge.subVectors(c, b);
        if (!this.tryCrossAxes(this.edge, a, b, c)) return;
        this.edge.subVectors(a, c);
        if (!this.tryCrossAxes(this.edge, a, b, c)) return;

        const radius =
            this.bodyHalf.x * Math.abs(this.triN.dot(this.localAxisX)) +
            this.bodyHalf.y * Math.abs(this.triN.dot(this.localAxisY)) +
            this.bodyHalf.z * Math.abs(this.triN.dot(this.localAxisZ));
        const plane = a.dot(this.triN);
        const depth = plane - (this.localCenter.dot(this.triN) - radius);
        if (depth <= -this.contactSkin) return;

        // 沿法线取盒子支撑点，再投影到三角得到接触
        this.support.copy(this.localCenter)
            .addScaledVector(this.localAxisX, -this.bodyHalf.x * Math.sign(this.triN.dot(this.localAxisX) || 1))
            .addScaledVector(this.localAxisY, -this.bodyHalf.y * Math.sign(this.triN.dot(this.localAxisY) || 1))
            .addScaledVector(this.localAxisZ, -this.bodyHalf.z * Math.sign(this.triN.dot(this.localAxisZ) || 1));
        closestPointOnTriangle(
            this.support, a, b, c, this.closest,
            this.ab, this.ac, this.ap, this.bp, this.cp,
        );
        this.addRawContact(this.closest, this.triN, depth, body);
    }

    /** 用三角边与 OBB 轴的叉积做分离轴测试。 */
    private tryCrossAxes(
        edge: THREE.Vector3,
        a: THREE.Vector3,
        b: THREE.Vector3,
        c: THREE.Vector3,
    ): boolean {
        if (!this.tryAxis(this.testAxis.copy(edge).cross(this.localAxisX), a, b, c)) return false;
        if (!this.tryAxis(this.testAxis.copy(edge).cross(this.localAxisY), a, b, c)) return false;
        if (!this.tryAxis(this.testAxis.copy(edge).cross(this.localAxisZ), a, b, c)) return false;
        return true;
    }

    /** 沿一根轴投影 OBB 与三角，重叠则通过。 */
    private tryAxis(
        axis: THREE.Vector3,
        a: THREE.Vector3,
        b: THREE.Vector3,
        c: THREE.Vector3,
    ): boolean {
        const lenSq = axis.lengthSq();
        if (lenSq < 1e-10) {
            this.rangeB.max = Infinity;
            return true; // 退化轴视为不分离
        }
        this.testAxis.copy(axis).multiplyScalar(1 / Math.sqrt(lenSq));
        this.projectOBB(this.testAxis, this.rangeA);
        const p0 = a.dot(this.testAxis);
        const p1 = b.dot(this.testAxis);
        const p2 = c.dot(this.testAxis);
        this.rangeB.min = Math.min(p0, p1, p2);
        const triMax = Math.max(p0, p1, p2);
        if (this.rangeA.max + this.contactSkin < this.rangeB.min || this.rangeA.min - this.contactSkin > triMax) return false;
        this.rangeB.max = Math.min(this.rangeA.max, triMax) - Math.max(this.rangeA.min, this.rangeB.min);
        return true;
    }

    /** 把 OBB 投影到指定轴，写出 min/max。 */
    private projectOBB(axis: THREE.Vector3, out: { min: number; max: number }): void {
        const r =
            this.bodyHalf.x * Math.abs(axis.dot(this.localAxisX)) +
            this.bodyHalf.y * Math.abs(axis.dot(this.localAxisY)) +
            this.bodyHalf.z * Math.abs(axis.dot(this.localAxisZ));
        const c = this.localCenter.dot(axis);
        out.min = c - r;
        out.max = c + r;
    }

    /** 写入原始接触；槽满时替换最浅的一个。 */
    private addRawContact(
        localPoint: THREE.Vector3,
        localNormal: THREE.Vector3,
        depth: number,
        body: ObbMeshBody,
    ): void {
        let slot = this.rawCount;
        if (slot === MAX_RAW) {
            let shallow = 0;
            for (let i = 1; i < MAX_RAW; i++) {
                if (this.raw[i].penetration < this.raw[shallow].penetration) shallow = i;
            }
            if (depth <= this.raw[shallow].penetration) return;
            slot = shallow;
        } else {
            this.rawCount += 1;
        }
        const contact = this.raw[slot];
        contact.point.copy(localPoint).applyMatrix4(this.worldMat);
        contact.normal.copy(localNormal).applyMatrix3(this.normalMat).normalize();
        this.toward.subVectors(body.position, contact.point);
        if (contact.normal.dot(this.toward) < 0) contact.normal.negate(); // 法线指向盒子
        contact.penetration = depth;
    }

    /** 从朝向取出世界轴，并缓存半边长。 */
    private setWorldAxes(body: ObbMeshBody): void {
        this.setAxes(body.quaternion, this.axisX, this.axisY, this.axisZ);
        this.bodyHalf.copy(body.halfExtents);
    }

    /** 由四元数写出三个正交轴。 */
    private setAxes(
        quat: THREE.Quaternion,
        x: THREE.Vector3,
        y: THREE.Vector3,
        z: THREE.Vector3,
    ): void {
        x.set(1, 0, 0).applyQuaternion(quat);
        y.set(0, 1, 0).applyQuaternion(quat);
        z.set(0, 0, 1).applyQuaternion(quat);
    }

    /** 由 8 个角点计算 OBB 世界 AABB。 */
    private computeOBBWorldAABB(center: THREE.Vector3, out: THREE.Box3): void {
        out.makeEmpty();
        for (let i = 0; i < 8; i++) {
            this.cornerFrom(
                center, this.axisX, this.axisY, this.axisZ,
                (i & 1) ? 1 : -1, (i & 2) ? 1 : -1, (i & 4) ? 1 : -1,
                this.corner,
            );
            out.expandByPoint(this.corner);
        }
        out.expandByScalar(0.08); // 略放大，避免贴边漏三角
    }

    /** 按轴向符号组合出 OBB 角点。 */
    private cornerFrom(
        center: THREE.Vector3,
        axisX: THREE.Vector3,
        axisY: THREE.Vector3,
        axisZ: THREE.Vector3,
        sx: number,
        sy: number,
        sz: number,
        out: THREE.Vector3,
    ): THREE.Vector3 {
        return out.copy(center)
            .addScaledVector(axisX, sx * this.bodyHalf.x)
            .addScaledVector(axisY, sy * this.bodyHalf.y)
            .addScaledVector(axisZ, sz * this.bodyHalf.z);
    }
}
