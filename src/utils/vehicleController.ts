import * as THREE from "three";
import { BVHVehicleController } from "./vehiclePhysics/BVHVehicleController";
import type { VehicleRigidBody } from "./vehiclePhysics/VehicleRigidBody";

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

    // 同步轮子视觉：高度按指数跟随射线，转向与自转直接写入
    function updateWheelVisuals(delta = 1 / 60) {
        const follow = 1 - Math.exp(-VISUAL_FOLLOW * Math.max(0, delta));
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
        }
    }

    // 销毁车辆控制器
    function destroy() {
        vehicle.wheels.length = 0;
    }

    return { vehicle, updateWheelVisuals, destroy };
}
