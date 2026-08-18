import * as THREE from "three";
import { VehicleCollision } from "./VehicleCollision";
import { ContactCache } from "../../collision/contacts/ContactCache";
import { ContactImpulseSolver } from "../../collision/solver/ContactImpulseSolver";
import { effectiveMass } from "./VehicleMath";
import type { VehicleRigidBody } from "./VehicleRigidBody";
import { VehicleWheel } from "./VehicleWheel";

const SIDE_CONTACT_DAMPING = 0.2; // 侧向速度阻尼
const FWD_FACTOR = 0.5; // 摩擦椭圆纵向权重
const SIDE_FACTOR = 1.0; // 摩擦椭圆侧向权重

/** 基于 three-mesh-bvh 射线与轻量刚体的 Raycast Vehicle 求解器。 */
export class BVHVehicleController {
    readonly chassis: VehicleRigidBody; // 车身刚体
    readonly wheels: VehicleWheel[] = []; // 车轮列表

    private collider: THREE.Mesh[] = []; // 场景碰撞网格
    private collision = new VehicleCollision();
    private contactSolver = new ContactImpulseSolver();
    private contactCache = new ContactCache();
    private raycaster = new THREE.Raycaster();
    private prevPosition = new THREE.Vector3();
    private prevQuaternion = new THREE.Quaternion();
    private normalMat = new THREE.Matrix3();
    private steerAxis = new THREE.Vector3();
    private steerQuat = new THREE.Quaternion();
    private vel = new THREE.Vector3();
    private impulse = new THREE.Vector3();
    private r = new THREE.Vector3();
    private gcross = new THREE.Vector3();
    private local = new THREE.Vector3();
    private world = new THREE.Vector3();
    private invQuat = new THREE.Quaternion();
    private upWS = new THREE.Vector3();
    private sidePoint = new THREE.Vector3();

    /** 绑定车身刚体，可选传入场景碰撞网格。 */
    constructor(chassis: VehicleRigidBody, collider?: THREE.Mesh | THREE.Mesh[] | null) {
        this.chassis = chassis;
        this.collider = this.toColliderList(collider);
        (this.raycaster as any).firstHitOnly = true;
    }

    /** 设置场景碰撞网格。 */
    setCollider(collider: THREE.Mesh | THREE.Mesh[] | null | undefined): void {
        this.collider = this.toColliderList(collider);
    }

    /** 返回车轮数量。 */
    numWheels(): number {
        return this.wheels.length;
    }

    // ==================== 轮子参数 ====================

    /** 添加车轮并写入悬挂几何。 */
    addWheel(
        chassisConnectionCs: THREE.Vector3,
        directionCs: THREE.Vector3,
        axleCs: THREE.Vector3,
        suspensionRestLength: number,
        radius: number,
    ): VehicleWheel {
        const wheel = new VehicleWheel();
        wheel.connectionPoint.copy(chassisConnectionCs);
        wheel.direction.copy(directionCs);
        wheel.axle.copy(axleCs);
        wheel.restLength = suspensionRestLength;
        wheel.suspensionLength = suspensionRestLength;
        wheel.maxSuspensionTravel = suspensionRestLength;
        wheel.radius = radius;
        this.wheels.push(wheel);
        return wheel;
    }

    /** 设置悬挂与底盘的局部连接点。 */
    setWheelChassisConnectionPointCs(i: number, value: THREE.Vector3): void {
        this.wheelAt(i)?.connectionPoint.copy(value);
    }

    /** 设置悬挂方向（底盘局部）。 */
    setWheelDirectionCs(i: number, value: THREE.Vector3): void {
        this.wheelAt(i)?.direction.copy(value);
    }

    /** 设置轮轴方向（底盘局部）。 */
    setWheelAxleCs(i: number, value: THREE.Vector3): void {
        this.wheelAt(i)?.axle.copy(value);
    }

    /** 设置悬挂静止长度。 */
    setWheelSuspensionRestLength(i: number, value: number): void {
        const wheel = this.wheelAt(i);
        if (wheel) wheel.restLength = value;
    }

    /** 设置轮胎半径。 */
    setWheelRadius(i: number, value: number): void {
        const wheel = this.wheelAt(i);
        if (wheel) wheel.radius = value;
    }

    /** 设置悬挂最大行程。 */
    setWheelMaxSuspensionTravel(i: number, value: number): void {
        const wheel = this.wheelAt(i);
        if (wheel) wheel.maxSuspensionTravel = value;
    }

    /** 设置悬挂刚度。 */
    setWheelSuspensionStiffness(i: number, value: number): void {
        const wheel = this.wheelAt(i);
        if (wheel) wheel.stiffness = value;
    }

    /** 设置压缩阻尼。 */
    setWheelSuspensionCompression(i: number, value: number): void {
        const wheel = this.wheelAt(i);
        if (wheel) wheel.dampingCompression = value;
    }

    /** 设置回弹阻尼。 */
    setWheelSuspensionRelaxation(i: number, value: number): void {
        const wheel = this.wheelAt(i);
        if (wheel) wheel.dampingRelaxation = value;
    }

    /** 设置最大悬挂力。 */
    setWheelMaxSuspensionForce(i: number, value: number): void {
        const wheel = this.wheelAt(i);
        if (wheel) wheel.maxSuspensionForce = value;
    }

    /** 设置制动力。 */
    setWheelBrake(i: number, value: number): void {
        const wheel = this.wheelAt(i);
        if (wheel) wheel.brake = value;
    }

    /** 设置转向角。 */
    setWheelSteering(i: number, value: number): void {
        const wheel = this.wheelAt(i);
        if (wheel) wheel.steering = value;
    }

    /** 设置驱动力。 */
    setWheelEngineForce(i: number, value: number): void {
        const wheel = this.wheelAt(i);
        if (wheel) wheel.engineForce = value;
    }

    /** 设置纵向抓地。 */
    setWheelFrictionSlip(i: number, value: number): void {
        const wheel = this.wheelAt(i);
        if (wheel) wheel.frictionSlip = value;
    }

    /** 设置侧向摩擦。 */
    setWheelSideFrictionStiffness(i: number, value: number): void {
        const wheel = this.wheelAt(i);
        if (wheel) wheel.sideFrictionStiffness = value;
    }

    /** 读取转向角。 */
    wheelSteering(i: number): number | null {
        return this.wheelAt(i)?.steering ?? null;
    }

    /** 读取是否接地。 */
    wheelIsInContact(i: number): boolean {
        return this.wheelAt(i)?.isInContact ?? false;
    }

    /** 读取轮轴方向（底盘局部）。 */
    wheelAxleCs(i: number): THREE.Vector3 | null {
        return this.wheelAt(i)?.axle ?? null;
    }

    /** 读取悬挂与底盘的局部连接点。 */
    wheelChassisConnectionPointCs(i: number): THREE.Vector3 | null {
        return this.wheelAt(i)?.connectionPoint ?? null;
    }

    /** 读取当前悬挂长度。 */
    wheelSuspensionLength(i: number): number | null {
        return this.wheelAt(i)?.suspensionLength ?? null;
    }

    /** 读取车轮自转角。 */
    wheelRotation(i: number): number | null {
        return this.wheelAt(i)?.rotation ?? null;
    }

    /** 读取接地网格。 */
    wheelContactMesh(i: number): THREE.Mesh | null {
        return this.wheelAt(i)?.contactMesh ?? null;
    }

    // ==================== 仿真步进 ====================

    /** 推进一帧：悬挂与轮胎力 → 车身接触 → 积分 → CCD。 */
    updateVehicle(dt: number, collider?: THREE.Mesh | THREE.Mesh[] | null): void {
        if (collider !== undefined) this.collider = this.toColliderList(collider);
        const clampedDt = Math.max(0, dt);
        if (clampedDt === 0) return;

        this.prevPosition.copy(this.chassis.position);
        this.prevQuaternion.copy(this.chassis.quaternion);
        this.updateWheelTransforms();
        this.chassis.applyGravity(clampedDt); // 重力
        this.raycastWheels(); // 轮子向下射线
        this.solveSuspension(); // 悬挂弹簧阻尼
        this.applySuspensionImpulses(clampedDt);
        this.solveFriction(clampedDt); // 纵向驱动 / 侧向抓地

        // 积分前解一次车身接触速度
        const manifolds = this.collision.detect(this.chassis, this.collider);
        this.contactCache.match(manifolds);
        this.contactSolver.solveVelocity(this.chassis, manifolds, clampedDt);
        this.contactCache.save(manifolds);

        this.chassis.applyDamping(clampedDt);
        this.chassis.integrate(clampedDt); // 积分位置和朝向

        // 积分后再解一次，消化穿透
        const positionManifolds = this.collision.detect(this.chassis, this.collider);
        this.contactCache.match(positionManifolds);
        this.contactSolver.solveVelocity(this.chassis, positionManifolds, clampedDt);
        this.contactCache.save(positionManifolds);

        // 高速时扫掠回退，避免穿模
        if (this.collision.needsSwept(this.chassis, clampedDt)) {
            this.collision.solveSwept(
                this.chassis, this.collider,
                this.prevPosition, this.prevQuaternion,
            );
        }
        this.updateWheelRotation(clampedDt);
    }

    /** 把单个网格或列表收成可遍历数组。 */
    private toColliderList(collider?: THREE.Mesh | THREE.Mesh[] | null): THREE.Mesh[] {
        if (!collider) return [];
        return Array.isArray(collider) ? collider : [collider];
    }

    /** 按索引取车轮，越界返回 undefined。 */
    private wheelAt(i: number): VehicleWheel | undefined {
        return this.wheels[i];
    }

    // 把悬挂连接点、方向和转向后的轮轴变到世界空间
    private updateWheelTransforms(): void {
        const q = this.chassis.quaternion;
        for (const wheel of this.wheels) {
            wheel.hardPointWS.copy(wheel.connectionPoint).applyQuaternion(q).add(this.chassis.position);
            wheel.directionWS.copy(wheel.direction).applyQuaternion(q);
            this.steerAxis.copy(wheel.directionWS).negate();
            this.steerQuat.setFromAxisAngle(this.steerAxis, wheel.steering);
            wheel.axleWS.copy(wheel.axle).applyQuaternion(q).applyQuaternion(this.steerQuat);
        }
    }

    // ==================== 悬挂与摩擦 ====================

    // 沿悬挂方向射线检测接地
    private raycastWheels(): void {
        const colliders = this.collider;
        for (const wheel of this.wheels) {
            wheel.isInContact = false;
            wheel.contactMesh = null;
            const rayLen = wheel.restLength + wheel.maxSuspensionTravel + wheel.radius;
            if (!colliders.length || rayLen <= 1e-6) {
                this.setWheelAirborne(wheel);
                continue;
            }

            const dirLen = wheel.directionWS.length();
            if (dirLen < 1e-8) {
                this.setWheelAirborne(wheel);
                continue;
            }
            this.impulse.copy(wheel.directionWS).multiplyScalar(1 / dirLen);
            this.raycaster.set(wheel.hardPointWS, this.impulse);
            this.raycaster.near = 0;
            this.raycaster.far = rayLen;
            const hits = this.raycaster.intersectObjects(colliders, false);
            const hit = hits[0];
            if (!hit) {
                this.setWheelAirborne(wheel);
                continue;
            }

            wheel.isInContact = true;
            wheel.contactMesh = (hit.object as THREE.Mesh).isMesh ? hit.object as THREE.Mesh : null;
            wheel.contactPoint.copy(hit.point);
            if (hit.face) {
                this.normalMat.getNormalMatrix(hit.object.matrixWorld);
                wheel.contactNormal.copy(hit.face.normal).applyMatrix3(this.normalMat).normalize();
            } else {
                wheel.contactNormal.copy(wheel.directionWS).negate().normalize();
            }
            if (wheel.contactNormal.dot(wheel.directionWS) > 0) wheel.contactNormal.negate();

            // 夹紧悬挂长度，并投影相对速度
            let suspensionLength = hit.distance - wheel.radius;
            const minLen = Math.max(0, wheel.restLength - wheel.maxSuspensionTravel);
            const maxLen = wheel.restLength + wheel.maxSuspensionTravel;
            wheel.suspensionLength = Math.min(maxLen, Math.max(minLen, suspensionLength));

            const denom = wheel.contactNormal.dot(wheel.directionWS);
            this.chassis.getVelocityAtPoint(wheel.contactPoint, this.vel);
            const projVel = wheel.contactNormal.dot(this.vel);
            if (denom >= -0.1) {
                // 法线几乎与悬挂平行或反向，避免除零
                wheel.suspensionRelativeVelocity = 0;
                wheel.clippedInvContactDotSuspension = 10;
            } else {
                const inv = -1 / denom;
                wheel.suspensionRelativeVelocity = projVel * inv;
                wheel.clippedInvContactDotSuspension = inv;
            }
        }
    }

    // 离地时回到静止长度
    private setWheelAirborne(wheel: VehicleWheel): void {
        wheel.isInContact = false;
        wheel.contactMesh = null;
        wheel.suspensionLength = wheel.restLength;
        wheel.suspensionRelativeVelocity = 0;
        wheel.contactNormal.copy(wheel.directionWS).negate().normalize();
        wheel.clippedInvContactDotSuspension = 1;
        wheel.suspensionForce = 0;
    }

    // 弹簧 + 压缩/回弹阻尼
    private solveSuspension(): void {
        const chassisMass = this.chassis.mass();
        for (const wheel of this.wheels) {
            if (!wheel.isInContact) {
                wheel.suspensionForce = 0;
                continue;
            }
            const lengthDiff = wheel.restLength - wheel.suspensionLength;
            let force = wheel.stiffness * lengthDiff * wheel.clippedInvContactDotSuspension;
            const damping = wheel.suspensionRelativeVelocity < 0
                ? wheel.dampingCompression
                : wheel.dampingRelaxation;
            force -= damping * wheel.suspensionRelativeVelocity;
            wheel.suspensionForce = Math.max(0, force * chassisMass); // 悬挂只推不拉
        }
    }

    // 沿接触法线施加悬挂冲量
    private applySuspensionImpulses(dt: number): void {
        for (const wheel of this.wheels) {
            if (!wheel.isInContact) continue;
            const force = Math.min(wheel.suspensionForce, wheel.maxSuspensionForce);
            this.impulse.copy(wheel.contactNormal).multiplyScalar(force * dt);
            this.chassis.applyImpulseAtPoint(this.impulse, wheel.contactPoint);
        }
    }

    // 侧向抓地、驱动/制动，超出摩擦椭圆则打滑缩放
    private solveFriction(dt: number): void {
        let wheelsOnGround = 0;
        for (const wheel of this.wheels) {
            wheel.sideImpulse = 0;
            wheel.forwardImpulse = 0;
            wheel.skidInfo = 1;
            if (!wheel.isInContact) continue;
            wheelsOnGround += 1;

            wheel.sideWS.copy(wheel.axleWS);
            const proj = wheel.sideWS.dot(wheel.contactNormal);
            wheel.sideWS.addScaledVector(wheel.contactNormal, -proj);
            if (wheel.sideWS.lengthSq() < 1e-8) continue;
            wheel.sideWS.normalize();
            wheel.forwardWS.copy(wheel.contactNormal).cross(wheel.sideWS);
            if (wheel.forwardWS.lengthSq() < 1e-8) continue;
            wheel.forwardWS.normalize();

            // 侧向速度阻尼，抓地由 sideFrictionStiffness 缩放
            this.chassis.getVelocityAtPoint(wheel.contactPoint, this.vel);
            const sideSpeed = wheel.sideWS.dot(this.vel);
            const mass = effectiveMass(
                this.chassis, wheel.contactPoint, wheel.sideWS,
                this.r, this.gcross, this.local, this.world, this.invQuat,
            );
            wheel.sideImpulse = -SIDE_CONTACT_DAMPING * sideSpeed * mass * wheel.sideFrictionStiffness;
        }

        // 驱动或制动纵向冲量，并检测摩擦椭圆
        let sliding = false;
        for (const wheel of this.wheels) {
            if (!wheel.isInContact) continue;

            if (wheel.engineForce !== 0) {
                wheel.forwardImpulse = wheel.engineForce * dt;
            } else {
                // 无驱动时用制动冲量刹住纵向滑动
                const maxImpulse = wheel.brake;
                this.chassis.getVelocityAtPoint(wheel.contactPoint, this.vel);
                const fwdSpeed = wheel.forwardWS.dot(this.vel);
                const mass = effectiveMass(
                    this.chassis, wheel.contactPoint, wheel.forwardWS,
                    this.r, this.gcross, this.local, this.world, this.invQuat,
                );
                const denom = Math.max(1, wheelsOnGround);
                wheel.forwardImpulse = Math.max(-maxImpulse, Math.min(maxImpulse, -fwdSpeed * mass / denom));
            }

            const maxImp = wheel.suspensionForce * dt * wheel.frictionSlip;
            const x = wheel.forwardImpulse * FWD_FACTOR;
            const y = wheel.sideImpulse * SIDE_FACTOR;
            const impulseSq = x * x + y * y;
            const maxImpSq = maxImp * maxImp;
            if (impulseSq > maxImpSq && impulseSq > 1e-12) {
                sliding = true;
                wheel.skidInfo *= maxImp / Math.sqrt(impulseSq);
            }
        }

        if (sliding) {
            // 超出椭圆的轮子按 skidInfo 同时缩小纵/侧向
            for (const wheel of this.wheels) {
                if (wheel.skidInfo < 1) {
                    wheel.forwardImpulse *= wheel.skidInfo;
                    wheel.sideImpulse *= wheel.skidInfo;
                }
            }
        }

        // 把轮胎冲量打到接触点；侧向力略降作用点以减弱侧倾
        this.upWS.set(0, 1, 0).applyQuaternion(this.chassis.quaternion);
        for (const wheel of this.wheels) {
            if (!wheel.isInContact) continue;
            if (wheel.forwardImpulse !== 0) {
                this.impulse.copy(wheel.forwardWS).multiplyScalar(wheel.forwardImpulse);
                this.chassis.applyImpulseAtPoint(this.impulse, wheel.contactPoint);
            }
            if (wheel.sideImpulse !== 0) {
                this.impulse.copy(wheel.sideWS).multiplyScalar(wheel.sideImpulse);
                this.sidePoint.copy(wheel.contactPoint);
                this.r.subVectors(wheel.contactPoint, this.chassis.position);
                this.sidePoint.addScaledVector(this.upWS, -this.upWS.dot(this.r) * (1 - wheel.rollInfluence));
                this.chassis.applyImpulseAtPoint(this.impulse, this.sidePoint);
            }
        }
    }

    // 按接地点前向速度更新车轮自转
    private updateWheelRotation(dt: number): void {
        for (const wheel of this.wheels) {
            if (wheel.isInContact) {
                this.chassis.getVelocityAtPoint(wheel.hardPointWS, this.vel);
                const proj = wheel.forwardWS.dot(this.vel);
                wheel.deltaRotation = wheel.radius > 1e-6 ? -(proj * dt) / wheel.radius : 0;
                wheel.rotation += wheel.deltaRotation;
            } else {
                wheel.rotation += wheel.deltaRotation;
            }
            wheel.deltaRotation *= 0.99;
        }
    }
}
