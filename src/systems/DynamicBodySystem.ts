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
import {
    capsuleObbOverlap,
    DynamicBoxBody,
    isBoxBody,
} from "../collision/DynamicBox";
import { DYNAMIC_BODY_DEFAULTS, type DynamicColliderDesc } from "../collision/ColliderDesc";
import type { VehicleInstance } from "../types";
import { capsuleSphereOverlap, createCollisionTemps } from "../utils/capsuleCollision";
import { VehicleCollision } from "../utils/vehiclePhysics/VehicleCollision";
import { createObbObbTemps, resolveObbObb } from "../collision/ObbObb";

const SUBSTEPS = 5; // 每帧物理子步
const MAX_PUSH_RATIO = 2; // 单次位置修正不超过特征尺寸的倍数
const MAX_SPEED_GRAVITY = 2; // 速度上限相对 |gravity| 的倍数
/** 推动态体时用的人物质量。 */
const CHARACTER_PUSH_MASS = 10;
const MAX_RAW = 64; // 单体单帧原始接触上限
const POS_CORRECT = 0.4; // 求解后残留穿透的位置修正比例
const ROLL_BLEND = 0.45; // 支撑面上向无滑滚动收敛的插值比例
const SUPPORT_Y = 0.5; // 视为支撑面的法线 y 下限
const DYNAMIC_MASK = CollisionGroup.DEFAULT | CollisionGroup.VEHICLE | CollisionGroup.DEBRIS;
const KIN_CAPSULE_BAUMGARTE = 0.8; // 动态体撞运动学胶囊时的位置修正比例
/** 人物单次相对动态体的最大位置修正（相对胶囊半径）。 */
const CHAR_SEP_MAX_RADIUS = 1.25;
const SLEEP_LINEAR = 0.3; // 线速度低于该值可累计休眠
const SLEEP_ANGULAR = 0.7; // 角速度低于该值可累计休眠
const SLEEP_TIME = 0.35; // 连续满足阈值后进入休眠（秒）
const SLEEP_WAKE_FACTOR = 3; // 超过阈值该倍数才清零休眠计时（迟滞）

/**
 * 动态刚体推进：按 kind 分派形状窄相（球 / 盒）。
 * 网格接触走 ContactImpulseSolver；球–球 / 盒–盒 / 与人 / 与车用简化或 OBB 冲量。
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
    private boxMeshCollision = new VehicleCollision();
    private obbTemps = createObbObbTemps();
    private contactPoint = new THREE.Vector3();

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
        if (this.ctrl.getDisplayDynamicBody()) this.ctrl.scene.add(debugMesh);
        return body;
    }

    /** 添加动态盒。 */
    addBox(desc: DynamicColliderDesc): DynamicBoxBody {
        if (desc.shape.kind !== "box") {
            throw new Error("[DynamicBodySystem] addBox 需要 shape.kind === \"box\"");
        }
        const mesh = desc.mesh;
        if (!mesh) {
            throw new Error("[DynamicBodySystem] addBox 需要 mesh");
        }

        const half = desc.shape.halfExtents.clone();
        half.x = Math.max(1e-4, half.x);
        half.y = Math.max(1e-4, half.y);
        half.z = Math.max(1e-4, half.z);
        const position = (desc.shape.position ?? new THREE.Vector3()).clone();
        const velocity = (desc.velocity ?? new THREE.Vector3()).clone();
        const density = desc.density ?? DYNAMIC_BODY_DEFAULTS.density;
        const restitution = desc.restitution ?? DYNAMIC_BODY_DEFAULTS.restitution;
        const friction = desc.friction ?? DYNAMIC_BODY_DEFAULTS.friction;
        const linearDamping = desc.linearDamping ?? DYNAMIC_BODY_DEFAULTS.linearDamping;
        const angularDamping = desc.angularDamping ?? DYNAMIC_BODY_DEFAULTS.angularDamping;
        const gravity = desc.gravity ?? this.ctrl.gravity;

        mesh.scale.set(half.x * 2, half.y * 2, half.z * 2);
        mesh.position.copy(position);
        if (desc.shape.quaternion) mesh.quaternion.copy(desc.shape.quaternion);

        const debugMesh = new THREE.Mesh(
            new THREE.BoxGeometry(1, 1, 1),
            new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.35 }),
        );
        debugMesh.scale.copy(mesh.scale);
        debugMesh.position.copy(position);
        if (desc.shape.quaternion) debugMesh.quaternion.copy(desc.shape.quaternion);

        const body = new DynamicBoxBody({
            halfExtents: half,
            density,
            restitution,
            gravity,
            position,
            quaternion: desc.shape.quaternion,
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
            shape: { kind: "box", halfExtents: half.clone() },
            mask: DYNAMIC_MASK,
            userData: body,
        });
        body.colliderId = col.id;
        this.list.push(body);
        this.contactCaches.set(body, new ContactCache());
        if (this.ctrl.getDisplayDynamicBody()) this.ctrl.scene.add(debugMesh);
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

    /** 推进全部动态刚体：子步求解 → 平台带走 → 休眠判定 → 同步视觉。 */
    step(delta: number): void {
        if (!this.list.length) return;
        this.skipVehicleMeshes.length = 0;
        for (const v of this.ctrl.vehicle.list) {
            if (v.meshColliderId != null) this.skipVehicleMeshes.push(v.meshColliderId);
        }
        const sub = delta / SUBSTEPS;
        for (let i = 0; i < SUBSTEPS; i++) this.stepSub(sub);
        for (const body of this.list) this.applyKinematicCarry(body);
        for (const body of this.list) this.updateSleep(body, delta);
        for (const body of this.list) {
            body.mesh.position.copy(body.position);
            body.mesh.quaternion.copy(body.quaternion);
            body.debugMesh.position.copy(body.position);
            body.debugMesh.quaternion.copy(body.quaternion);
            if (isSphereBody(body)) body.debugMesh.scale.setScalar(body.radius);
            else if (isBoxBody(body)) {
                body.debugMesh.scale.set(
                    body.halfExtents.x * 2,
                    body.halfExtents.y * 2,
                    body.halfExtents.z * 2,
                );
            }
        }
    }

    /** 单次子步：重力积分 → 按形状窄相 → 阻尼与限速。 */
    private stepSub(dt: number): void {
        for (const body of this.list) {
            if (body.sleeping) {
                // 休眠体仍检测车辆接触，命中则唤醒并解算
                this.collideSleepingBodyWithVehicles(body);
                continue;
            }
            const col = this.ctrl.collisionWorld.get(body.colliderId);
            if (!col) continue;

            body.velocity.y += body.gravity * dt;
            body.integrate(dt);
            body.contactMesh = null;

            if (isSphereBody(body)) {
                this.collideSphereMeshes(body, dt);
                this.collideSphereBoxes(body);
                this.resolveBodyVsKinematicCapsule(body); // 胶囊=运动学：只推刚体
            } else if (isBoxBody(body)) {
                this.collideBoxMeshes(body, dt);
                this.collideBoxVehicleBoxes(body);
                this.resolveBodyVsKinematicCapsule(body);
            }
            body.applyDamping(dt);
            this.clampSpeed(body);
        }
        this.collideSpherePairs();
        this.collideBoxPairs();
        for (const body of this.list) {
            if (!body.sleeping) this.clampSpeed(body);
        }
    }

    /** 休眠刚体与车辆底盘接触检测。 */
    private collideSleepingBodyWithVehicles(body: DynamicBody): void {
        if (isBoxBody(body)) this.collideBoxVehicleBoxes(body);
        else if (isSphereBody(body)) this.collideSphereVehicleBoxes(body);
    }

    /** 按速度阈值累计 / 清除休眠计时。 */
    private updateSleep(body: DynamicBody, dt: number): void {
        if (!body.canSleep) {
            if (body.sleeping) body.wakeUp();
            return;
        }
        if (body.sleeping) return;

        const linSq = body.velocity.lengthSq();
        const angSq = body.angularVelocity.lengthSq();
        const linMax = SLEEP_LINEAR * SLEEP_LINEAR;
        const angMax = SLEEP_ANGULAR * SLEEP_ANGULAR;
        const wakeLin = linMax * SLEEP_WAKE_FACTOR * SLEEP_WAKE_FACTOR;
        const wakeAng = angMax * SLEEP_WAKE_FACTOR * SLEEP_WAKE_FACTOR;

        if (linSq > wakeLin || angSq > wakeAng) {
            body.sleepTimer = 0;
            return;
        }
        if (linSq <= linMax && angSq <= angMax) {
            body.sleepTimer += dt;
            if (body.sleepTimer >= SLEEP_TIME) body.putToSleep();
        }
    }

    /** 双方都休眠则跳过；一方休眠时按需唤醒后再解算。 */
    private shouldSolveDynamicPair(a: DynamicBody, b: DynamicBody): boolean {
        if (a.sleeping && b.sleeping) return false;
        if (a.sleeping || b.sleeping) {
            const awake = a.sleeping ? b : a;
            const sleeper = a.sleeping ? a : b;
            if (awake.isRestingCandidate(SLEEP_LINEAR, SLEEP_ANGULAR)) return false;
            sleeper.wakeUp();
            return true;
        }
        return true;
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

        this.solveMeshManifolds(body, rawCount, dt);
        this.applySphereSupportRolling(body);
    }

    /** 盒 vs 静态/平台网格：复用 VehicleCollision 收集接触后冲量求解。 */
    private collideBoxMeshes(body: DynamicBoxBody, dt: number): void {
        const worldCol = this.ctrl.collisionWorld.get(body.colliderId);
        if (!worldCol) return;
        const meshes = this.ctrl.collisionWorld.queryMeshes(worldCol, { skipIds: this.skipVehicleMeshes });
        if (!meshes.length) return;

        this.manifolds.length = 0;
        let deepest = 0;
        let deepestMesh: THREE.Mesh | null = null;
        for (const mesh of meshes) {
            const found = this.boxMeshCollision.detect(body, mesh);
            if (!found.length) continue;
            let meshDeep = 0;
            for (const m of found) {
                this.manifolds.push(m);
                for (const p of m.contacts) {
                    if (p.penetration > meshDeep) meshDeep = p.penetration;
                }
            }
            if (meshDeep > deepest) {
                deepest = meshDeep;
                deepestMesh = mesh;
            }
        }
        if (!this.manifolds.length) return;
        body.contactMesh = deepestMesh;

        const maxPush = body.characteristicExtent() * MAX_PUSH_RATIO;
        if (deepest > maxPush) {
            let nx = 0, ny = 0, nz = 0, w = 0;
            for (const m of this.manifolds) {
                for (const p of m.contacts) {
                    const pen = Math.max(p.penetration, 0);
                    nx += m.normal.x * pen;
                    ny += m.normal.y * pen;
                    nz += m.normal.z * pen;
                    w += pen;
                }
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

        const cache = this.contactCaches.get(body);
        cache?.match(this.manifolds);
        this.contactSolver.solveVelocity(body, this.manifolds, dt);
        cache?.save(this.manifolds);
        for (const manifold of this.manifolds) {
            for (const point of manifold.contacts) {
                const corr = (point.penetration - CONTACT_SKIN) * POS_CORRECT;
                if (corr > 0) body.position.addScaledVector(manifold.normal, corr);
            }
        }
    }

    /** 球网格接触：归约 → 冲量 → 位置修正。 */
    private solveMeshManifolds(body: DynamicBody, rawCount: number, dt: number): void {
        this.manifolds.length = 0;
        reduceContacts(this.raw, rawCount, body, this.manifolds);
        const cache = this.contactCaches.get(body);
        cache?.match(this.manifolds);
        this.contactSolver.solveVelocity(body, this.manifolds, dt);
        cache?.save(this.manifolds);

        for (const manifold of this.manifolds) {
            for (const point of manifold.contacts) {
                const corr = (point.penetration - CONTACT_SKIN) * POS_CORRECT;
                if (corr > 0) body.position.addScaledVector(manifold.normal, corr);
            }
        }
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

    /** 球 vs 车辆底盘 / 动态盒 OBB。 */
    private collideSphereBoxes(body: DynamicSphereBody): void {
        const worldCol = this.ctrl.collisionWorld.get(body.colliderId);
        if (!worldCol) return;
        const boxes = this.ctrl.collisionWorld.query(worldCol, { kinds: ["box"] });
        for (const box of boxes) {
            const vehicle = box.userData as VehicleInstance | undefined;
            const chassis = vehicle?.chassisBody;
            if (chassis) {
                this.resolveSphereVsObbBody(body, chassis);
                continue;
            }
            const other = box.userData;
            if (isBoxBody(other as DynamicBody) && other !== body) {
                this.resolveSphereVsObbBody(body, other as DynamicBoxBody);
            }
        }
    }

    /** 球 vs 车辆底盘（休眠体专用，不测其它动态盒）。 */
    private collideSphereVehicleBoxes(body: DynamicSphereBody): void {
        const worldCol = this.ctrl.collisionWorld.get(body.colliderId);
        if (!worldCol) return;
        const boxes = this.ctrl.collisionWorld.query(worldCol, { kinds: ["box"] });
        for (const box of boxes) {
            const vehicle = box.userData as VehicleInstance | undefined;
            const chassis = vehicle?.chassisBody;
            if (!chassis) continue;
            if (this.resolveSphereVsObbBody(body, chassis)) body.wakeUp();
        }
    }

    /** 球与单个 OBB 刚体：推出球并双方在接触点施冲量；有接触返回 true。 */
    private resolveSphereVsObbBody(
        body: DynamicSphereBody,
        other: {
            position: THREE.Vector3; quaternion: THREE.Quaternion; halfExtents: THREE.Vector3;
            getVelocityAtPoint(p: THREE.Vector3, o: THREE.Vector3): THREE.Vector3;
            applyImpulseAtPoint(i: THREE.Vector3, p: THREE.Vector3): void
        },
    ): boolean {
        if (!collideSphereVsObb(
            body.position, body.radius,
            other.position, other.quaternion, other.halfExtents,
            this.temps,
        )) return false;

        body.getVelocityAtPoint(this.temps.contact, this.bodyVel);
        other.getVelocityAtPoint(this.temps.contact, this.temps.boxVel);
        this.temps.offset.copy(this.bodyVel).sub(this.temps.boxVel);
        const vn = this.temps.offset.dot(this.temps.normal);
        if (vn >= 0) return true;
        const deltaVn = -vn * (1 + body.restitution);
        this.temps.impulse.copy(this.temps.normal).multiplyScalar(deltaVn * body.mass);
        body.applyImpulseAtPoint(this.temps.impulse, this.temps.contact);
        this.temps.impulse.multiplyScalar(-1);
        other.applyImpulseAtPoint(this.temps.impulse, this.temps.contact);
        return true;
    }

    /** 动态盒 vs 车辆底盘 OBB；有接触时唤醒休眠盒。 */
    private collideBoxVehicleBoxes(body: DynamicBoxBody): void {
        const worldCol = this.ctrl.collisionWorld.get(body.colliderId);
        if (!worldCol) return;
        const boxes = this.ctrl.collisionWorld.query(worldCol, { kinds: ["box"] });
        for (const box of boxes) {
            if (box.id === body.colliderId) continue;
            const vehicle = box.userData as VehicleInstance | undefined;
            const chassis = vehicle?.chassisBody;
            if (!chassis) continue;
            if (resolveObbObb(body, chassis, this.obbTemps)) body.wakeUp();
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
                if (!this.shouldSolveDynamicPair(a, b)) continue;
                resolveSphereSphere(a, b, this.temps, 0.5 * (a.restitution + b.restitution));
            }
        }
    }

    /** 盒与盒两两 OBB 求解。 */
    private collideBoxPairs(): void {
        for (let i = 0; i < this.list.length; i++) {
            const a = this.list[i];
            if (!isBoxBody(a)) continue;
            for (let j = i + 1; j < this.list.length; j++) {
                const b = this.list[j];
                if (!isBoxBody(b)) continue;
                if (!this.shouldSolveDynamicPair(a, b)) continue;
                resolveObbObb(a, b, this.obbTemps);
            }
        }
    }

    /**
     * 人物分步移动时与动态体接触。
     * 胶囊只做位置推出；对刚体施水平单向冲量（不回推人物速度）。
     */
    collideWithCapsule(): void {
        if (this.ctrl.controllerMode === 1 || this.ctrl.skipCapsuleCollision) return;
        const cap = this.ctrl.playerCapsule;
        const info = cap?.capsuleInfo;
        if (!cap || !info) return;

        const maxSep = info.radius * CHAR_SEP_MAX_RADIUS;
        const playerVel = this.ctrl.playerVelocity;
        const charMass = CHARACTER_PUSH_MASS;

        for (const body of this.list) {
            const hit = this.queryCapsuleBodyOverlap(cap, info, body);
            if (!hit || hit.depth <= 0) continue;

            // 步行法线压到水平，避免竖直分量把人弹飞
            this.temps.normal.copy(hit.normal);
            if (!this.ctrl.isFlying) {
                this.temps.normal.y = 0;
                if (this.temps.normal.lengthSq() < 1e-8) {
                    this.temps.normal.set(
                        body.position.x - cap.position.x,
                        0,
                        body.position.z - cap.position.z,
                    );
                    if (this.temps.normal.lengthSq() < 1e-8) this.temps.normal.set(1, 0, 0);
                }
                this.temps.normal.normalize();
            }

            const sep = Math.min(hit.depth, maxSep);
            cap.position.addScaledVector(this.temps.normal, -sep);
            cap.updateMatrixWorld();

            body.getVelocityAtPoint(hit.contact, this.bodyVel);
            this.temps.offset.set(playerVel.x - this.bodyVel.x, 0, playerVel.z - this.bodyVel.z);
            const deltaVel = this.temps.offset.dot(this.temps.normal);
            if (deltaVel <= 0) continue;

            const massRatio = (body.mass * charMass) / (body.mass + charMass);
            this.temps.impulse.copy(this.temps.normal).multiplyScalar(deltaVel * massRatio);
            this.temps.impulse.y = 0;
            body.applyImpulseAtPoint(this.temps.impulse, hit.contact);
        }
    }

    /** 查询胶囊与单个动态体的重叠；normal 由胶囊指向刚体。 */
    private queryCapsuleBodyOverlap(
        cap: THREE.Object3D,
        info: { segment: THREE.Line3; radius: number; dynamicsSegment?: THREE.Line3 },
        body: DynamicBody,
    ): { depth: number; normal: THREE.Vector3; contact: THREE.Vector3 } | null {
        if (isSphereBody(body)) {
            const depth = capsuleSphereOverlap(cap, info, body.position, body.radius, this.capsuleTemps);
            if (depth <= 0) return null;
            this.contactPoint.copy(this.capsuleTemps.closestSeg).addScaledVector(
                this.capsuleTemps.closestTri, info.radius,
            );
            return {
                depth,
                normal: this.capsuleTemps.closestTri,
                contact: this.contactPoint,
            };
        }
        if (isBoxBody(body)) {
            const depth = capsuleObbOverlap(
                cap, info, body.position, body.quaternion, body.halfExtents, this.capsuleTemps,
            );
            if (depth <= 0) return null;
            this.contactPoint.copy(this.capsuleTemps.closestSeg).addScaledVector(
                this.capsuleTemps.closestTri, info.radius,
            );
            return {
                depth,
                normal: this.capsuleTemps.closestTri,
                contact: this.contactPoint,
            };
        }
        return null;
    }

    /**
     * 物理子步：胶囊视为运动学障碍（无限质量），只推出刚体并去掉侵入法向速度。
     */
    private resolveBodyVsKinematicCapsule(body: DynamicBody): void {
        const cap = this.ctrl.playerCapsule;
        const info = cap?.capsuleInfo;
        if (!cap || !info || this.ctrl.controllerMode === 1) return;

        const hit = this.queryCapsuleBodyOverlap(cap, info, body);
        if (!hit || hit.depth <= 0) return;

        // 法线：胶囊→刚体；推出刚体。步行压低竖直分量，避免箱子被顶飞。
        this.temps.normal.copy(hit.normal);
        if (!this.ctrl.isFlying && Math.abs(this.temps.normal.y) > 0.35) {
            this.temps.normal.y *= 0.15;
            if (this.temps.normal.lengthSq() > 1e-8) this.temps.normal.normalize();
            else {
                this.temps.normal.set(
                    body.position.x - cap.position.x,
                    0,
                    body.position.z - cap.position.z,
                );
                if (this.temps.normal.lengthSq() < 1e-8) return;
                this.temps.normal.normalize();
            }
        }

        const sep = Math.min(hit.depth, info.radius * CHAR_SEP_MAX_RADIUS);
        body.position.addScaledVector(this.temps.normal, sep * KIN_CAPSULE_BAUMGARTE);

        body.getVelocityAtPoint(hit.contact, this.bodyVel);
        const vn = this.bodyVel.dot(this.temps.normal);
        if (vn < 0) {
            this.temps.impulse.copy(this.temps.normal).multiplyScalar(-vn * body.mass);
            body.applyImpulseAtPoint(this.temps.impulse, hit.contact);
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
        if (body.sleeping || !body.contactMesh) return;
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
