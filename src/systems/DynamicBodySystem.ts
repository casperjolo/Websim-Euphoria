import * as THREE from "three";
import type { playerController } from "../playerController";
import { CollisionGroup } from "../collision/groups";
import { ContactCache } from "../collision/contacts/ContactCache";
import { ContactManifold } from "../collision/contacts/ContactManifold";
import { CONTACT_SKIN, type RawContact } from "../collision/contacts/ContactPoint";
import { reduceContacts } from "../collision/contacts/ContactReducer";
import { ContactImpulseSolver } from "../collision/solver/ContactImpulseSolver";
import { DynamicBody } from "../collision/DynamicBody";
import {
    collectSphereVsMeshContacts,
    collideSphereVsObb,
    createSphereCollisionTemps,
    resolveSphereSphere,
    DynamicSphereBody,
    isSphereBody,
} from "../collision/DynamicSphere";
import { DYNAMIC_BODY_DEFAULTS, type DynamicColliderDesc } from "../collision/ColliderDesc";
import type { VehicleInstance } from "../types";
import { capsuleSphereOverlap, createCollisionTemps } from "../utils/capsuleCollision";

const SUBSTEPS = 5; // 每帧物理子步
const MAX_PUSH_RATIO = 2; // 单次位置修正不超过特征尺寸的倍数
const MAX_SPEED_GRAVITY = 2; // 速度上限相对 |gravity| 的倍数
const PLAYER_MASS_RATIO = 8; // 人物相对单体的质量倍数
const MAX_RAW = 64; // 单体单帧原始接触上限
const POS_CORRECT = 0.4; // 求解后残留穿透的位置修正比例
const ROLL_BLEND = 0.45; // 支撑面上向无滑滚动收敛的插值比例
const SUPPORT_Y = 0.5; // 视为支撑面的法线 y 下限
const DYNAMIC_MASK = CollisionGroup.DEFAULT | CollisionGroup.VEHICLE | CollisionGroup.DEBRIS;

/**
 * 动态刚体推进：按 kind 分派形状窄相（当前实现为球）。
 * 网格接触走 ContactImpulseSolver；球–球 / 球–人 / 球–车仍用简化冲量。
 */
export class DynamicBodySystem {
    private ctrl: playerController;
    list: DynamicBody[] = []; // 全部动态刚体
    private temps = createSphereCollisionTemps();
    private carryPrevInv = new THREE.Matrix4();
    private skipVehicleMeshes: number[] = []; // 跳过车辆外观，避免与底盘盒重复
    private capsuleTemps = createCollisionTemps();
    private contactSolver = new ContactImpulseSolver();
    private contactCaches = new Map<DynamicBody, ContactCache>();
    private raw: RawContact[] = Array.from({ length: MAX_RAW }, () => ({
        point: new THREE.Vector3(),
        normal: new THREE.Vector3(),
        penetration: 0,
    }));
    private manifolds: ContactManifold[] = [];
    private bodyVel = new THREE.Vector3();
    private rollTarget = new THREE.Vector3();

    constructor(ctrl: playerController) {
        this.ctrl = ctrl;
        this.contactSolver.velocityIterations = 12;
    }

    /** 添加动态球。 */
    addSphere(desc: DynamicColliderDesc): DynamicSphereBody {
        if (desc.shape.kind !== "sphere") {
            throw new Error("[DynamicBodySystem] addSphere 需要 shape.kind === \"sphere\"");
        }
        const mesh = desc.mesh;
        if (!mesh) {
            throw new Error("[DynamicBodySystem] addSphere 需要 mesh");
        }

        const radius = Math.max(1e-4, desc.shape.radius);
        const position = (desc.shape.position ?? new THREE.Vector3()).clone();
        const velocity = (desc.velocity ?? new THREE.Vector3()).clone();
        const density = desc.density ?? DYNAMIC_BODY_DEFAULTS.density;
        const restitution = desc.restitution ?? DYNAMIC_BODY_DEFAULTS.restitution;
        const friction = desc.friction ?? DYNAMIC_BODY_DEFAULTS.friction;
        const linearDamping = desc.linearDamping ?? DYNAMIC_BODY_DEFAULTS.linearDamping;
        const angularDamping = desc.angularDamping ?? DYNAMIC_BODY_DEFAULTS.angularDamping;
        const gravity = desc.gravity ?? this.ctrl.gravity;

        mesh.scale.setScalar(radius);
        mesh.position.copy(position);

        const debugMesh = new THREE.Mesh(
            new THREE.SphereGeometry(1, 16, 12),
            new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.35 }),
        );
        debugMesh.scale.setScalar(radius);
        debugMesh.position.copy(position);

        const body = new DynamicSphereBody({
            radius,
            density,
            restitution,
            gravity,
            position,
            velocity,
            angularVelocity: desc.angularVelocity,
            linearDamping,
            angularDamping,
            friction,
            mesh,
            debugMesh,
        });
        const col = this.ctrl.collisionWorld.add({
            motion: "dynamic",
            shape: { kind: "sphere", radius },
            mask: DYNAMIC_MASK,
            userData: body,
        });
        body.colliderId = col.id;
        this.list.push(body);
        this.contactCaches.set(body, new ContactCache());
        if (this.ctrl.getDisplayCollider()) this.ctrl.scene.add(debugMesh);
        return body;
    }

    /** 移除动态刚体。 */
    remove(body: DynamicBody): void {
        const idx = this.list.indexOf(body);
        if (idx === -1) return;
        this.list.splice(idx, 1);
        this.contactCaches.delete(body);
        this.ctrl.collisionWorld.remove(body.colliderId);
        this.ctrl.scene.remove(body.debugMesh);
        body.debugMesh.geometry.dispose();
        (body.debugMesh.material as THREE.Material).dispose();
    }

    /** 按 CollisionWorld id 查找动态刚体。 */
    findByColliderId(id: number): DynamicBody | undefined {
        return this.list.find(b => b.colliderId === id);
    }

    /** 清除全部动态刚体。 */
    clear(): void {
        while (this.list.length) this.remove(this.list[this.list.length - 1]);
    }

    /** 推进全部动态刚体：子步求解 → 平台带走 → 同步视觉。 */
    step(delta: number): void {
        if (!this.list.length) return;
        this.skipVehicleMeshes.length = 0;
        for (const v of this.ctrl.vehicle.list) {
            if (v.meshColliderId != null) this.skipVehicleMeshes.push(v.meshColliderId);
        }
        const sub = delta / SUBSTEPS;
        for (let i = 0; i < SUBSTEPS; i++) this.stepSub(sub);
        for (const body of this.list) this.applyKinematicCarry(body);
        for (const body of this.list) {
            body.mesh.position.copy(body.position);
            body.mesh.quaternion.copy(body.quaternion);
            body.debugMesh.position.copy(body.position);
            body.debugMesh.quaternion.copy(body.quaternion);
            if (isSphereBody(body)) body.debugMesh.scale.setScalar(body.radius);
            else body.debugMesh.scale.setScalar(body.characteristicExtent());
        }
    }

    /** 单次子步：重力积分 → 按形状窄相 → 阻尼与限速。 */
    private stepSub(dt: number): void {
        for (const body of this.list) {
            const col = this.ctrl.collisionWorld.get(body.colliderId);
            if (!col) continue;

            body.velocity.y += body.gravity * dt;
            body.integrate(dt);
            body.contactMesh = null;

            if (isSphereBody(body)) {
                this.collideSphereMeshes(body, dt);
                this.collideSphereVehicleBoxes(body);
                this.collideSphereCapsule(body, false); // 胶囊当运动学障碍，不推人
            }
            body.applyDamping(dt);
            this.clampSpeed(body);
        }
        this.collideSpherePairs();
        for (const body of this.list) this.clampSpeed(body);
    }

    /**
     * 球 vs 静态/平台网格：收集接触 → 过深则硬推 → 否则冲量求解 + 位置修正。
     * 跳过车辆外观 mesh，改由底盘盒处理。
     */
    private collideSphereMeshes(body: DynamicSphereBody, dt: number): void {
        const worldCol = this.ctrl.collisionWorld.get(body.colliderId);
        if (!worldCol) return;
        const meshes = this.ctrl.collisionWorld.queryMeshes(worldCol, { skipIds: this.skipVehicleMeshes });

        let rawCount = 0;
        let deepest = 0;
        let deepestMesh: THREE.Mesh | null = null;
        for (const mesh of meshes) {
            const before = rawCount;
            rawCount = collectSphereVsMeshContacts(
                body.position, body.radius, mesh, this.temps, this.raw, rawCount, MAX_RAW,
            );
            for (let i = before; i < rawCount; i++) {
                if (this.raw[i].penetration > deepest) {
                    deepest = this.raw[i].penetration;
                    deepestMesh = mesh;
                }
            }
        }
        if (rawCount === 0) return;
        body.contactMesh = deepestMesh;

        // 卡进网格过深时先钳制推出，避免冲量爆炸
        const maxPush = body.radius * MAX_PUSH_RATIO;
        if (deepest > maxPush) {
            let nx = 0, ny = 0, nz = 0, w = 0;
            for (let i = 0; i < rawCount; i++) {
                const p = Math.max(this.raw[i].penetration, 0);
                nx += this.raw[i].normal.x * p;
                ny += this.raw[i].normal.y * p;
                nz += this.raw[i].normal.z * p;
                w += p;
            }
            if (w > 1e-8) {
                this.temps.normal.set(nx / w, ny / w, nz / w);
                if (this.temps.normal.lengthSq() > 1e-8) {
                    this.temps.normal.normalize();
                    body.position.addScaledVector(this.temps.normal, Math.min(deepest, maxPush));
                }
            }
            return;
        }

        this.manifolds.length = 0;
        reduceContacts(this.raw, rawCount, body, this.manifolds);
        const cache = this.contactCaches.get(body);
        cache?.match(this.manifolds);
        this.contactSolver.solveVelocity(body, this.manifolds, dt);
        cache?.save(this.manifolds);

        // bias 主要改速度，残留穿透再做一次位置修正
        for (const manifold of this.manifolds) {
            for (const point of manifold.contacts) {
                const corr = (point.penetration - CONTACT_SKIN) * POS_CORRECT;
                if (corr > 0) body.position.addScaledVector(manifold.normal, corr);
            }
        }

        this.applySphereSupportRolling(body);
    }

    /**
     * 在支撑面上将角速度拉向无滑滚动：ω → n × v_tang / R。
     * 补强摩擦迭代不足时的滚动手感。
     */
    private applySphereSupportRolling(body: DynamicSphereBody): void {
        let bestY = SUPPORT_Y;
        let support: ContactManifold | null = null;
        for (const m of this.manifolds) {
            if (m.normal.y > bestY) {
                bestY = m.normal.y;
                support = m;
            }
        }
        if (!support) return;

        const n = support.normal;
        this.temps.offset.copy(body.velocity).addScaledVector(n, -body.velocity.dot(n)); // v_tang
        if (this.temps.offset.lengthSq() < 1e-10) return;
        this.rollTarget.copy(n).cross(this.temps.offset).multiplyScalar(1 / Math.max(body.radius, 1e-6));
        body.angularVelocity.lerp(this.rollTarget, ROLL_BLEND);
    }

    /** 球 vs 车辆底盘 OBB：推出球并双方在接触点施冲量。 */
    private collideSphereVehicleBoxes(body: DynamicSphereBody): void {
        const worldCol = this.ctrl.collisionWorld.get(body.colliderId);
        if (!worldCol) return;
        const boxes = this.ctrl.collisionWorld.query(worldCol, { kinds: ["box"] });
        for (const box of boxes) {
            const vehicle = box.userData as VehicleInstance | undefined;
            const chassis = vehicle?.chassisBody;
            if (!chassis) continue;
            if (!collideSphereVsObb(
                body.position, body.radius,
                chassis.position, chassis.quaternion, chassis.halfExtents,
                this.temps,
            )) continue;

            body.getVelocityAtPoint(this.temps.contact, this.bodyVel);
            chassis.getVelocityAtPoint(this.temps.contact, this.temps.boxVel);
            this.temps.offset.copy(this.bodyVel).sub(this.temps.boxVel);
            const vn = this.temps.offset.dot(this.temps.normal);
            if (vn >= 0) continue; // 已分离
            const deltaVn = -vn * (1 + body.restitution);
            this.temps.impulse.copy(this.temps.normal).multiplyScalar(deltaVn * body.mass);
            body.applyImpulseAtPoint(this.temps.impulse, this.temps.contact);
            this.temps.impulse.multiplyScalar(-1);
            chassis.applyImpulseAtPoint(this.temps.impulse, this.temps.contact);
        }
    }

    /** 球与球两两求解（每对一次）。 */
    private collideSpherePairs(): void {
        for (let i = 0; i < this.list.length; i++) {
            const a = this.list[i];
            if (!isSphereBody(a)) continue;
            for (let j = i + 1; j < this.list.length; j++) {
                const b = this.list[j];
                if (!isSphereBody(b)) continue;
                resolveSphereSphere(a, b, this.temps, 0.5 * (a.restitution + b.restitution));
            }
        }
    }

    /** 人物分步移动时与动态刚体接触（当前仅球；可推开胶囊）。 */
    collideWithCapsule(): void {
        if (this.ctrl.controllerMode === 1 || this.ctrl.skipCapsuleCollision) return;
        for (const body of this.list) {
            if (isSphereBody(body)) this.collideSphereCapsule(body, true);
        }
    }

    /**
     * 球 vs 人物胶囊：法向分离 + 线速度冲量。
     * moveCapsule 为 false 时人物视为无限质量（只推球）。
     */
    private collideSphereCapsule(body: DynamicSphereBody, moveCapsule: boolean): void {
        const cap = this.ctrl.playerCapsule;
        const info = cap?.capsuleInfo;
        if (!cap || !info || this.ctrl.controllerMode === 1) return;

        const depth = capsuleSphereOverlap(cap, info, body.position, body.radius, this.capsuleTemps);
        if (depth <= 0) return;

        const n = this.capsuleTemps.closestTri;
        const playerMass = Math.max(body.mass * PLAYER_MASS_RATIO, 1e-6);
        const invPlayer = moveCapsule ? 1 / playerMass : 0;
        const invBody = body.invMass;
        const invSum = invPlayer + invBody;
        if (moveCapsule) cap.position.addScaledVector(n, -depth * (invPlayer / invSum));
        body.position.addScaledVector(n, depth * (invBody / invSum));
        cap.updateMatrixWorld();

        const playerVel = this.ctrl.playerVelocity;
        const rel = body.velocity.dot(n) - playerVel.dot(n);
        if (rel >= 0) return;
        const impulseMag = -(1 + body.restitution) * rel / invSum;
        body.velocity.addScaledVector(n, impulseMag * invBody);
        if (moveCapsule) {
            playerVel.x += n.x * (-impulseMag * invPlayer);
            playerVel.z += n.z * (-impulseMag * invPlayer);
        }
    }

    /** 限制线速度 / 角速度，避免异常弹出。 */
    private clampSpeed(body: DynamicBody): void {
        const extent = body.characteristicExtent();
        const maxSpeed = Math.max(Math.abs(body.gravity) * MAX_SPEED_GRAVITY, extent * 80);
        const speed = body.velocity.length();
        if (speed > maxSpeed) body.velocity.multiplyScalar(maxSpeed / speed);
        const maxAng = maxSpeed / Math.max(extent, 1e-4);
        const ang = body.angularVelocity.length();
        if (ang > maxAng) body.angularVelocity.multiplyScalar(maxAng / ang);
    }

    /** 刚体停在运动学网格上时按平台 prev→current 矩阵带走；位移过大则回退。 */
    private applyKinematicCarry(body: DynamicBody): void {
        if (!body.contactMesh) return;
        const entry = this.ctrl.getKinematicColliderEntries().find(e => e.mesh === body.contactMesh);
        if (!entry) return;
        this.carryPrevInv.copy(entry.prevWorldMatrix).invert();
        this.temps.before.copy(body.position);
        body.position.applyMatrix4(this.carryPrevInv).applyMatrix4(entry.source.matrixWorld);
        const maxCarry = body.characteristicExtent() * 8;
        if (body.position.distanceToSquared(this.temps.before) > maxCarry * maxCarry) {
            body.position.copy(this.temps.before);
        }
    }
}
