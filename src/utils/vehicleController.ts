import * as THREE from "three";
import { BVHVehicleController } from "./vehiclePhysics/BVHVehicleController";
import type { VehicleRigidBody } from "./vehiclePhysics/VehicleRigidBody";

export type WheelInfo = {
    axleCs: THREE.Vector3;
    suspensionRestLength: number;
    position: THREE.Vector3;
    radius: number;
};

/** 创建 BVH 车辆控制器并同步轮子视觉。 */
export function createVehicleController(
    chassisBody: VehicleRigidBody,
    wheels: (THREE.Object3D | null)[],
    wheelsInfo: WheelInfo[],
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
        vehicle.setWheelMaxSuspensionTravel(index, wheel.suspensionRestLength); // 最大行程
        vehicle.setWheelSuspensionStiffness(index, 250); // 悬挂刚度
        vehicle.setWheelSuspensionCompression(index, 6); // 压缩阻尼
        vehicle.setWheelSuspensionRelaxation(index, 6); // 回弹阻尼
        vehicle.setWheelMaxSuspensionForce(index, 10000); // 最大作用力
        vehicle.setWheelBrake(index, 0); // 制动
        vehicle.setWheelSteering(index, 0); // 转向角
        vehicle.setWheelEngineForce(index, 0); // 驱动力
        vehicle.setWheelFrictionSlip(index, 20); // 纵向抓地
        vehicle.setWheelSideFrictionStiffness(index, 2); // 侧向摩擦
    });

    const up = new THREE.Vector3(0, 1, 0);
    const wheelSteeringQuat = new THREE.Quaternion();
    const wheelRotationQuat = new THREE.Quaternion();

    // 同步轮子视觉旋转
    function updateWheelVisuals() {
        for (const [index, wheelObj] of wheels.entries()) {
            if (!wheelObj) continue;
            const wheelAxleCs = vehicle.wheelAxleCs(index) ?? new THREE.Vector3(1, 0, 0);
            const connection = vehicle.wheelChassisConnectionPointCs(index)?.y ?? 0;
            const suspension = vehicle.wheelSuspensionLength(index) ?? 0;
            const steering = vehicle.wheelSteering(index) ?? 0;
            const rotationRad = vehicle.wheelRotation(index) ?? 0;

            // 悬挂压缩偏移
            wheelObj.position.y = connection - suspension;
            // 转向 * 自转
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
