import * as THREE from "three";
import type { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { createVehicleController } from "./vehicleController";
import { getBbox } from "./bbox";
import type { VehicleOptions, VehicleInstance } from "../types";

export type VehicleLoaderContext = {
    loader: GLTFLoader;
    scene: THREE.Scene;
    world: any;
    RAPIER: any;
    vehicleParams: {
        debug: { showPhysicsBox: boolean };
        chassis: { mass: number; linearDamping: number; angularDamping: number };
        model: { rotation: number };
        power: { acceleration: number; deceleration: number; maxSpeed: number };
        steering: { maxSteerAngle: number; steerSpeed: number; steerReturnTimeSlow: number; steerReturnTimeFast: number };
        followVehicleDirection: boolean;
    };
    vehicleLength: number;
};

// ==================== 主函数 ====================

// 加载车辆模型
export async function loadVehicleModel(
    opts: VehicleOptions,
    ctx: VehicleLoaderContext,
): Promise<VehicleInstance> {
    const { loader, scene, world, RAPIER, vehicleParams, vehicleLength } = ctx;

    const scale = opts.scale ?? 1;
    const chassisRatio = opts.chassisRatio ?? 0.2;
    const suspensionRestLengthRatio = opts.suspensionRestLengthRatio ?? 0.2;
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
    const { size, center } = getBbox(model);
    model.position.set(-center.x, -center.y, -center.z);
    tempGroup.add(model);
    tempGroup.updateMatrixWorld(true);

    // 收集轮子世界变换信息
    let wheelRadius = 0, suspensionRestLength = 0, chassisHeight = 0, wheelSizeInit = false;
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
            chassisHeight = wheelRadius * 2 * chassisRatio;
            wheelSizeInit = true;
        }

        wheelsInfo.push({ axleCs: new THREE.Vector3(0, 0, -1), position: worldPos, quaternion: worldQuat, scale: worldScale, radius: wheelRadius, suspensionRestLength, object: wheel });
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

    // 按左前、右前、左后、右后轮中心推算车辆前向
    const frontCenter = wheelWrappers[0].position.clone().add(wheelWrappers[1].position).multiplyScalar(0.5);
    const rearCenter = wheelWrappers[2].position.clone().add(wheelWrappers[3].position).multiplyScalar(0.5);
    const forwardLocal = frontCenter.sub(rearCenter);
    forwardLocal.y = 0;
    if (forwardLocal.lengthSq() < 1e-8) forwardLocal.set(1, 0, 0);
    else forwardLocal.normalize();

    // 创建车身物理碰撞体
    const halfExtents = size.clone().multiplyScalar(0.5);
    halfExtents.y = halfExtents.y - chassisHeight / 2;
    model.position.y -= chassisHeight / 2;
    halfExtents.x *= 0.95;
    halfExtents.z *= 0.95;

    const chassisBody = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(opts.position.x, opts.position.y, opts.position.z)
            .setLinearDamping(vehicleParams.chassis.linearDamping)
            .setAngularDamping(vehicleParams.chassis.angularDamping)
            .setCanSleep(true),
    );
    chassisBody.setGravityScale(scale, true);
    world.createCollider(
        RAPIER.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z).setMass(mass),
        chassisBody,
    );

    // 物理调试盒
    const physicsBoxMesh = new THREE.Mesh(
        new THREE.BoxGeometry(halfExtents.x * 2, halfExtents.y * 2, halfExtents.z * 2),
        new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.3 }),
    );
    if (vehicleParams.debug.showPhysicsBox) vehicleGroup.add(physicsBoxMesh);

    vehicleGroup.position.copy(opts.position);
    vehicleGroup.updateMatrixWorld(true);

    const { vehicle, updateWheelVisuals, destroy } = createVehicleController(world, chassisBody, wheelWrappers, wheelsInfo);

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
        chassisRatio,
        suspensionRestLengthRatio,
        size: { l: Math.max(size.x, size.z), w: Math.min(size.x, size.z), h: size.y },
        halfExtents,
        mass,
        maxSpeed,
        acceleration,
        deceleration,
        followVehicleDirection: opts.followVehicleDirection ?? true,
        physicsBoxMesh,
    };
}
