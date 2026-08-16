import * as THREE from "three";

/** 单个车轮的悬挂、接地与轮胎力状态。 */
export class VehicleWheel {
    connectionPoint = new THREE.Vector3(); // 悬挂与底盘的局部连接点
    direction = new THREE.Vector3(0, -1, 0); // 悬挂方向（底盘局部）
    axle = new THREE.Vector3(0, 0, -1); // 轮轴方向（底盘局部）

    radius = 0.3; // 轮胎半径
    restLength = 0.1; // 悬挂静止长度
    suspensionLength = 0.1; // 当前悬挂长度
    maxSuspensionTravel = 0.1; // 最大行程

    stiffness = 250; // 悬挂刚度
    dampingCompression = 6; // 压缩阻尼
    dampingRelaxation = 6; // 回弹阻尼
    maxSuspensionForce = 10000; // 最大悬挂力

    steering = 0; // 转向角
    engineForce = 0; // 驱动力
    brake = 0; // 制动力

    frictionSlip = 20; // 纵向抓地
    sideFrictionStiffness = 2; // 侧向摩擦
    rollInfluence = 0.03; // 侧向力对侧倾的影响

    isInContact = false; // 是否接地
    contactPoint = new THREE.Vector3(); // 接地点
    contactNormal = new THREE.Vector3(0, 1, 0); // 接触法线

    suspensionForce = 0; // 本帧悬挂力
    forwardImpulse = 0; // 纵向冲量
    sideImpulse = 0; // 侧向冲量
    rotation = 0; // 车轮自转角
    deltaRotation = 0; // 本帧自转增量

    hardPointWS = new THREE.Vector3(); // 连接点世界坐标
    directionWS = new THREE.Vector3(0, -1, 0); // 悬挂方向（世界）
    axleWS = new THREE.Vector3(0, 0, -1); // 轮轴（世界）
    forwardWS = new THREE.Vector3(1, 0, 0); // 滚动前向（世界）
    sideWS = new THREE.Vector3(0, 0, 1); // 侧向（世界）

    clippedInvContactDotSuspension = 1; // 法线与悬挂方向夹角修正
    suspensionRelativeVelocity = 0; // 沿悬挂方向的相对速度
    skidInfo = 1; // 打滑系数，1 为未打滑
}
