import * as THREE from "three";
import { BVHVehicleController } from "./vehiclePhysics/BVHVehicleController";
import type { VehicleRigidBody } from "./vehiclePhysics/VehicleRigidBody";

/** 单个车轮的悬挂几何（底盘局部）。 */
export type WheelInfo = {
    axleCs: THREE.Vector3;
    suspensionRestLength: number;
    maxSuspensionTravel: number;
    position: THREE.Vector3;
    radius: number;
};

/**
 * 车轮悬挂与抓地参数（质量归一化刚度/阻尼）。
 * stiffness / damping / friction 不随 scale 缩放。
 */
export type WheelPhysicsParams = {
    suspensionStiffness: number;
    suspensionCompression: number;
    suspensionRelaxation: number;
    maxSuspensionForce: number;
    frictionSlip: number;
    sideFrictionStiffness: number;
    rollInfluence: number;
};

/** 悬挂与抓地默认值。静止长度不传时按轮直径 × 0.2。 */
export const DEFAULT_WHEEL_PHYSICS: WheelPhysicsParams = {
    suspensionStiffness: 18,
    suspensionCompression: 2.1,
    suspensionRelaxation: 2.5,
    maxSuspensionForce: 6000,
    frictionSlip: 8,
    sideFrictionStiffness: 1,
    rollInfluence: 0.12,
};

/** 悬挂最大行程默认值（米，scale 1）。 */
export const DEFAULT_MAX_SUSPENSION_TRAVEL = 0.35;

/** 视觉悬挂跟随速度（越大越贴射线）。 */
const VISUAL_FOLLOW = 14;
/** 接地标记球半径。 */
const DEBUG_HIT_RADIUS = 0.04;
/** 行程刻度线半宽。 */
const DEBUG_TICK = 0.08;

/** 创建调试线段网格。 */
function makeDebugLine(material: THREE.LineBasicMaterial, segments: number): THREE.LineSegments {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(segments * 6), 3));
    const line = new THREE.LineSegments(geo, material);
    line.frustumCulled = false;
    line.renderOrder = 20;
    return line;
}

/** 写入第 i 段线段的两端点。 */
function setSegment(attr: THREE.BufferAttribute, i: number, a: THREE.Vector3, b: THREE.Vector3): void {
    const o = i * 6;
    attr.array[o] = a.x;
    attr.array[o + 1] = a.y;
    attr.array[o + 2] = a.z;
    attr.array[o + 3] = b.x;
    attr.array[o + 4] = b.y;
    attr.array[o + 5] = b.z;
}

/** 创建 BVH 车辆控制器并同步轮子视觉。 */
export function createVehicleController(
    chassisBody: VehicleRigidBody,
    wheels: (THREE.Object3D | null)[],
    wheelsInfo: WheelInfo[],
    physics: WheelPhysicsParams = DEFAULT_WHEEL_PHYSICS,
) {
    const vehicle = new BVHVehicleController(chassisBody);
    const suspensionDirection = new THREE.Vector3(0, -1, 0);

    // 注册每个轮子的物理参数
    wheelsInfo.forEach((wheel, index) => {
        vehicle.addWheel(wheel.position, suspensionDirection, wheel.axleCs, wheel.suspensionRestLength, wheel.radius);
        vehicle.setWheelChassisConnectionPointCs(index, wheel.position); // 连接点
        vehicle.setWheelDirectionCs(index, suspensionDirection); // 悬挂方向
        vehicle.setWheelAxleCs(index, wheel.axleCs); // 轮轴方向
        vehicle.setWheelSuspensionRestLength(index, wheel.suspensionRestLength); // 静止长度
        vehicle.setWheelRadius(index, wheel.radius); // 轮胎半径
        vehicle.setWheelMaxSuspensionTravel(index, wheel.maxSuspensionTravel); // 最大行程
        vehicle.setWheelSuspensionStiffness(index, physics.suspensionStiffness); // 悬挂刚度
        vehicle.setWheelSuspensionCompression(index, physics.suspensionCompression); // 压缩阻尼
        vehicle.setWheelSuspensionRelaxation(index, physics.suspensionRelaxation); // 回弹阻尼
        vehicle.setWheelMaxSuspensionForce(index, physics.maxSuspensionForce); // 最大作用力
        vehicle.setWheelBrake(index, 0); // 制动
        vehicle.setWheelSteering(index, 0); // 转向角
        vehicle.setWheelEngineForce(index, 0); // 驱动力
        vehicle.setWheelFrictionSlip(index, physics.frictionSlip); // 纵向抓地
        vehicle.setWheelSideFrictionStiffness(index, physics.sideFrictionStiffness); // 侧向摩擦
        vehicle.setWheelRollInfluence(index, physics.rollInfluence); // 侧倾影响
    });

    const up = new THREE.Vector3(0, 1, 0);
    const wheelSteeringQuat = new THREE.Quaternion();
    const wheelRotationQuat = new THREE.Quaternion();
    const visualLengthSmooth: number[] = new Array(wheels.length).fill(Number.NaN);
    const _from = new THREE.Vector3();
    const _to = new THREE.Vector3();
    const _dir = new THREE.Vector3();
    const _tick = new THREE.Vector3();
    const _rest = new THREE.Vector3();
    const _a = new THREE.Vector3();
    const _b = new THREE.Vector3();

    const wheelRayDebug = new THREE.Group();
    wheelRayDebug.name = "wheelRayDebug";
    const wheelTravelDebug = new THREE.Group();
    wheelTravelDebug.name = "wheelTravelDebug";
    const rayLines: THREE.LineSegments[] = [];
    const hitMarks: THREE.Mesh[] = [];
    const travelLines: THREE.LineSegments[] = [];
    const hitGeo = new THREE.SphereGeometry(DEBUG_HIT_RADIUS, 8, 6);
    const hitMat = new THREE.MeshBasicMaterial({ color: 0xffff66, depthTest: false });
    const rayMatHit = new THREE.LineBasicMaterial({ color: 0x66ff66, depthTest: false });
    const rayMatMiss = new THREE.LineBasicMaterial({ color: 0xff5555, depthTest: false });
    const travelMat = new THREE.LineBasicMaterial({ color: 0x44ccff, depthTest: false, transparent: true, opacity: 0.95 });
    for (let i = 0; i < wheels.length; i++) {
        const ray = makeDebugLine(rayMatHit, 1);
        rayLines.push(ray);
        wheelRayDebug.add(ray);
        const hit = new THREE.Mesh(hitGeo, hitMat);
        hit.frustumCulled = false;
        hit.renderOrder = 21;
        hitMarks.push(hit);
        wheelRayDebug.add(hit);
        const travel = makeDebugLine(travelMat, 4);
        travelLines.push(travel);
        wheelTravelDebug.add(travel);
    }

    /** 同步轮子视觉：高度按指数跟随射线，转向与自转直接写入。 */
    function updateWheelVisuals(delta = 1 / 60) {
        const follow = 1 - Math.exp(-VISUAL_FOLLOW * Math.max(0, delta));
        const showRays = wheelRayDebug.visible;
        const showTravel = wheelTravelDebug.visible;
        for (const [index, wheelObj] of wheels.entries()) {
            if (!wheelObj) continue;
            const wheelAxleCs = vehicle.wheelAxleCs(index) ?? new THREE.Vector3(1, 0, 0);
            const connection = vehicle.wheelChassisConnectionPointCs(index)?.y ?? 0;
            const target = vehicle.wheelVisualLength(index) ?? vehicle.wheelSuspensionLength(index) ?? 0;
            const steering = vehicle.wheelSteering(index) ?? 0;
            const rotationRad = vehicle.wheelRotation(index) ?? 0;

            let length = target;
            if (Number.isFinite(visualLengthSmooth[index])) {
                length = visualLengthSmooth[index] + (target - visualLengthSmooth[index]) * follow;
            }
            visualLengthSmooth[index] = length;
            wheelObj.position.y = connection - length;
            wheelSteeringQuat.setFromAxisAngle(up, steering);
            wheelRotationQuat.setFromAxisAngle(wheelAxleCs, rotationRad);
            wheelObj.quaternion.copy(wheelSteeringQuat).multiply(wheelRotationQuat);

            if (showRays || showTravel) {
                const wheel = vehicle.wheels[index];
                if (wheel) updateWheelDebug(index, wheel, showRays, showTravel);
            }
        }
    }

    /** 更新单轮射线与行程调试线。 */
    function updateWheelDebug(
        index: number,
        wheel: (typeof vehicle.wheels)[number],
        showRays: boolean,
        showTravel: boolean,
    ) {
        _dir.copy(wheel.direction);
        if (_dir.lengthSq() < 1e-12) _dir.set(0, -1, 0);
        else _dir.normalize();
        const rest = wheel.restLength;
        const travel = wheel.maxSuspensionTravel;
        const minLen = Math.max(0, rest - travel);
        const maxLen = rest + travel;
        const rayLen = rest + travel + wheel.radius;
        const conn = wheel.connectionPoint;

        if (showRays) {
            const ray = rayLines[index];
            _from.copy(conn);
            _to.copy(conn).addScaledVector(_dir, rayLen);
            const rayAttr = ray.geometry.getAttribute("position") as THREE.BufferAttribute;
            setSegment(rayAttr, 0, _from, _to);
            rayAttr.needsUpdate = true;
            ray.geometry.computeBoundingSphere();
            ray.material = wheel.isInContact ? rayMatHit : rayMatMiss;
            const hit = hitMarks[index];
            if (wheel.isInContact) {
                const hitDist = Math.max(0, wheel.visualLength + wheel.radius);
                hit.position.copy(conn).addScaledVector(_dir, hitDist);
                hit.visible = true;
            } else {
                hit.visible = false;
            }
        }

        if (showTravel) {
            const line = travelLines[index];
            _from.copy(conn).addScaledVector(_dir, minLen);
            _to.copy(conn).addScaledVector(_dir, maxLen);
            _tick.copy(wheel.axle);
            if (_tick.lengthSq() < 1e-12) _tick.set(1, 0, 0);
            else _tick.normalize();
            _tick.multiplyScalar(Math.max(DEBUG_TICK, wheel.radius * 0.25));
            _rest.copy(conn).addScaledVector(_dir, rest);
            const attr = line.geometry.getAttribute("position") as THREE.BufferAttribute;
            setSegment(attr, 0, _from, _to);
            setSegment(attr, 1, _a.copy(_from).sub(_tick), _b.copy(_from).add(_tick));
            setSegment(attr, 2, _a.copy(_to).sub(_tick), _b.copy(_to).add(_tick));
            setSegment(attr, 3, _a.copy(_rest).sub(_tick), _b.copy(_rest).add(_tick));
            attr.needsUpdate = true;
            line.geometry.computeBoundingSphere();
        }
    }

    /** 销毁车辆控制器与调试网格。 */
    function destroy() {
        vehicle.wheels.length = 0;
        wheelRayDebug.removeFromParent();
        wheelTravelDebug.removeFromParent();
        for (const line of rayLines) line.geometry.dispose();
        for (const line of travelLines) line.geometry.dispose();
        hitGeo.dispose();
        hitMat.dispose();
        rayMatHit.dispose();
        rayMatMiss.dispose();
        travelMat.dispose();
    }

    return { vehicle, updateWheelVisuals, destroy, wheelRayDebug, wheelTravelDebug };
}
