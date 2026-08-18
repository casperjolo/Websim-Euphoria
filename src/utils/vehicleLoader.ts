import * as THREE from "three";
import type { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { createVehicleController } from "./vehicleController";
import { VehicleRigidBody } from "./vehiclePhysics/VehicleRigidBody";
import { getBbox } from "./bbox";
import type { VehicleOptions, VehicleInstance } from "../types";

export type VehicleLoaderContext = {
    loader: GLTFLoader;
    scene: THREE.Scene;
    vehicleParams: {
        debug: { showPhysicsBox: boolean };
        chassis: { mass: number; linearDamping: number; angularDamping: number };
        model: { rotation: number };
        power: { acceleration: number; deceleration: number; maxSpeed: number };
        steering: { maxSteerAngle: number; steerTime: number; steerReturnTimeSlow: number; steerReturnTimeFast: number };
        suspension: {
            stiffness: number;
            compression: number;
            relaxation: number;
            maxForce: number;
            frictionSlip: number;
            sideFrictionStiffness: number;
            travelRatio: number;
        };
        followVehicleDirection: boolean;
    };
    vehicleLength: number;
};

const MIN_BOX_HEIGHT = 1e-3;

// ==================== 主函数 ====================

// 加载车辆模型
export async function loadVehicleModel(
    opts: VehicleOptions,
    ctx: VehicleLoaderContext,
): Promise<VehicleInstance> {
    const { loader, scene, vehicleParams, vehicleLength } = ctx;

    const scale = opts.scale ?? 1;
    const suspensionRestLengthRatio = opts.suspensionRestLengthRatio ?? 0.2;
    const suspensionTravelRatio = opts.suspensionTravelRatio ?? vehicleParams.suspension.travelRatio ?? 0.3;
    const mass = (opts.mass ?? vehicleParams.chassis.mass) * scale;
    const maxSpeed = (opts.maxSpeed ?? vehicleParams.power.maxSpeed) * scale;
    const acceleration = (opts.acceleration ?? vehicleParams.power.acceleration) * scale;
    const deceleration = (opts.deceleration ?? vehicleParams.power.deceleration) * scale;

    vehicleParams.followVehicleDirection = opts.followVehicleDirection ?? true;

    let model: THREE.Object3D;
    if (opts.model) {
        model = opts.model;
    } else {
        const gltf = await loader.loadAsync(opts.url);
        model = gltf.scene;
    }

    // 计算模型缩放比
    const { size: originalSize } = getBbox(model);
    const modelScale = vehicleLength / Math.max(originalSize.x, originalSize.y, originalSize.z);

    // 查找轮子节点
    const wheelObjects: THREE.Object3D[] = [];
    for (const name of opts.wheelsNames) {
        let found = false;
        model.traverse(child => {
            if (child.name === name && !found) { wheelObjects.push(child); found = true; }
        });
        if (!found) console.warn(`未找到轮子: ${name}`);
    }

    // 临时挂载获取世界坐标
    const tempGroup = new THREE.Group();
    scene.add(tempGroup);
    model.scale.multiplyScalar(modelScale * scale);
    model.rotateY(vehicleParams.model.rotation);
    const { center } = getBbox(model);
    model.position.set(-center.x, -center.y, -center.z);
    tempGroup.add(model);
    tempGroup.updateMatrixWorld(true);

    // 收集轮子世界变换信息
    let wheelRadius = 0, suspensionRestLength = 0, maxSuspensionTravel = 0, wheelSizeInit = false;
    const wheelsInfo: any[] = [];

    for (const wheel of wheelObjects) {
        const worldPos = new THREE.Vector3();
        const worldQuat = new THREE.Quaternion();
        const worldScale = new THREE.Vector3();
        wheel.getWorldPosition(worldPos);
        wheel.getWorldQuaternion(worldQuat);
        wheel.getWorldScale(worldScale);

        // 只计算一次轮子尺寸
        if (!wheelSizeInit) {
            const { size: ws } = getBbox(wheel);
            wheelRadius = Math.max(ws.x, ws.y, ws.z) / 2;
            suspensionRestLength = wheelRadius * 2 * suspensionRestLengthRatio;
            maxSuspensionTravel = wheelRadius * 2 * suspensionTravelRatio;
            wheelSizeInit = true;
        }

        wheelsInfo.push({
            axleCs: new THREE.Vector3(0, 0, -1),
            position: worldPos,
            quaternion: worldQuat,
            scale: worldScale,
            radius: wheelRadius,
            suspensionRestLength,
            maxSuspensionTravel,
            object: wheel,
        });
    }

    tempGroup.remove(model);
    scene.remove(tempGroup);

    if (wheelsInfo.length !== 4) {
        throw new Error(`车辆需要 4 个有效车轮节点,当前找到 ${wheelsInfo.length} 个`);
    }

    // 创建车辆根节点
    const vehicleGroup = new THREE.Group();
    scene.add(vehicleGroup);
    vehicleGroup.add(model);
    vehicleGroup.updateMatrixWorld(true);

    // 轮子包装组（独立旋转）
    const wheelWrappers: THREE.Group[] = [];
    for (let i = 0; i < wheelsInfo.length; i++) {
        const wheel = wheelsInfo[i];
        const wheelWrapper = new THREE.Group();
        wheelWrapper.position.copy(vehicleGroup.worldToLocal(wheel.position.clone()));

        const wheelObj = wheel.object;
        wheelObj.parent?.remove(wheelObj);
        wheelObj.position.set(0, 0, 0);
        wheelObj.quaternion.copy(wheel.quaternion);
        wheelObj.scale.copy(wheel.scale);
        wheelObj.updateMatrixWorld();

        wheelWrapper.add(wheelObj);
        vehicleGroup.add(wheelWrapper);
        wheelWrappers.push(wheelWrapper);
    }

    const shiftContent = (offset: THREE.Vector3) => {
        model.position.sub(offset);
        for (const wrapper of wheelWrappers) wrapper.position.sub(offset);
    };

    // 拆轮后按车身包围盒重定原点，物理盒不含轮胎
    vehicleGroup.updateMatrixWorld(true);
    const { center: bodyCenter, size: bodySize } = getBbox(model);
    shiftContent(vehicleGroup.worldToLocal(bodyCenter.clone()));
    vehicleGroup.updateMatrixWorld(true);

    const { bbox: bodyBbox } = getBbox(model);
    const localMin = vehicleGroup.worldToLocal(bodyBbox.min.clone());
    const localMax = vehicleGroup.worldToLocal(bodyBbox.max.clone());

    let minTireBottom = Infinity;
    for (const wrapper of wheelWrappers) {
        minTireBottom = Math.min(minTireBottom, wrapper.position.y - wheelRadius);
    }

    const boxTop = localMax.y;
    let boxBottom = localMin.y;
    if (opts.chassisClearance != null) {
        boxBottom = minTireBottom + opts.chassisClearance * scale;
        boxBottom = Math.max(boxBottom, minTireBottom);
    }
    if (boxBottom > boxTop - MIN_BOX_HEIGHT) boxBottom = boxTop - MIN_BOX_HEIGHT;

    const boxCenterY = (boxTop + boxBottom) * 0.5;
    if (Math.abs(boxCenterY) > 1e-8) {
        shiftContent(new THREE.Vector3(0, boxCenterY, 0));
        vehicleGroup.updateMatrixWorld(true);
    }

    // 硬点用模型轮心，接地时悬挂长度≈0，由弹簧预载撑车
    for (let i = 0; i < wheelsInfo.length; i++) {
        wheelsInfo[i].position = wheelWrappers[i].position.clone();
        wheelsInfo[i].suspensionRestLength = suspensionRestLength;
        wheelsInfo[i].maxSuspensionTravel = maxSuspensionTravel;
        wheelsInfo[i].radius = wheelRadius;
    }

    // 按左前、右前、左后、右后轮中心推算车辆前向
    const frontCenter = wheelWrappers[0].position.clone().add(wheelWrappers[1].position).multiplyScalar(0.5);
    const rearCenter = wheelWrappers[2].position.clone().add(wheelWrappers[3].position).multiplyScalar(0.5);
    const forwardLocal = frontCenter.sub(rearCenter);
    forwardLocal.y = 0;
    if (forwardLocal.lengthSq() < 1e-8) forwardLocal.set(1, 0, 0);
    else forwardLocal.normalize();

    const halfExtents = new THREE.Vector3(
        bodySize.x * 0.5 * 0.95,
        (boxTop - boxBottom) * 0.5,
        bodySize.z * 0.5 * 0.95,
    );

    // position.y 对齐最低轮底
    minTireBottom = Infinity;
    for (const wrapper of wheelWrappers) {
        minTireBottom = Math.min(minTireBottom, wrapper.position.y - wheelRadius);
    }
    const spawnPosition = opts.position.clone();
    spawnPosition.y -= minTireBottom;

    const chassisBody = new VehicleRigidBody({
        position: spawnPosition,
        mass,
        halfExtents,
        linearDamping: vehicleParams.chassis.linearDamping,
        angularDamping: vehicleParams.chassis.angularDamping,
        gravityScale: scale,
    });

    // 物理调试盒
    const physicsBoxMesh = new THREE.Mesh(
        new THREE.BoxGeometry(halfExtents.x * 2, halfExtents.y * 2, halfExtents.z * 2),
        new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.3 }),
    );
    if (vehicleParams.debug.showPhysicsBox) vehicleGroup.add(physicsBoxMesh);

    vehicleGroup.position.copy(spawnPosition);
    vehicleGroup.updateMatrixWorld(true);

    const sus = vehicleParams.suspension;
    const wheelPhysics = {
        suspensionStiffness: opts.suspensionStiffness ?? sus.stiffness,
        suspensionCompression: opts.suspensionCompression ?? sus.compression,
        suspensionRelaxation: opts.suspensionRelaxation ?? sus.relaxation,
        maxSuspensionForce: opts.maxSuspensionForce ?? sus.maxForce,
        frictionSlip: opts.frictionSlip ?? sus.frictionSlip,
        sideFrictionStiffness: opts.sideFrictionStiffness ?? sus.sideFrictionStiffness,
    };

    const { vehicle, updateWheelVisuals, destroy } = createVehicleController(
        chassisBody,
        wheelWrappers,
        wheelsInfo,
        wheelPhysics,
    );

    return {
        vehicleGroup,
        chassisBody,
        vehicleController: vehicle,
        updateWheelVisuals,
        destroyVehicleController: destroy,
        scale,
        modelScale,
        driverSeatPosition: opts.driverSeatPosition.clone(),
        driverSeatRotation: opts.driverSeatRotation ?? 0,
        forwardLocal,
        chassisClearance: opts.chassisClearance,
        suspensionRestLengthRatio,
        suspensionTravelRatio,
        size: { l: Math.max(bodySize.x, bodySize.z), w: Math.min(bodySize.x, bodySize.z), h: bodySize.y },
        halfExtents,
        mass,
        maxSpeed,
        acceleration,
        deceleration,
        followVehicleDirection: opts.followVehicleDirection ?? true,
        physicsBoxMesh,
    };
}
