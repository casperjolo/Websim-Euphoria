import * as THREE from "three";
import type { RigidBody } from "@dimforge/rapier3d-compat";
import type { PathPlanner } from "../utils/pathPlanner";

// ==================== 玩家配置 ====================

/** 已加载的玩家模型来源。 */
export type LoadedPlayerModelSource = {
    /** 已加载的模型根节点。 */
    model: THREE.Object3D;
    /** 模型使用的动画片段。 */
    animations: THREE.AnimationClip[];
    /** 已加载模型与旧模型路径不能同时使用。 */
    url?: never;
};

/** 旧版 glTF 玩家模型来源。 */
export type LegacyPlayerModelSource = {
    /**
     * 模型路径（GLB/GLTF）。
     * @deprecated 请在外部加载模型，并传入 model 和 animations。
     */
    url: string;
    /** 模型路径与已加载模型不能同时使用。 */
    model?: never;
    /** 模型路径与外部动画片段不能同时使用。 */
    animations?: never;
};

/** 玩家模型来源。 */
export type PlayerModelSource = LoadedPlayerModelSource | LegacyPlayerModelSource;

/** 玩家模型、动画和移动参数。 */
export type PlayerModelOptions = PlayerModelSource & {
    /** 模型缩放。 */
    scale: number;
    /** 静止动画名。 */
    idleAnim: string;
    /** 行走动画名。 */
    walkAnim: string;
    /** 跑步动画名。 */
    runAnim: string;
    /** 跳跃动画名；或 [起跳, 循环, 落地] 三段动画名。 */
    jumpAnim: string | [startAnim: string, loopAnim: string, endAnim: string];
    /** 左移动画，默认复用 walkAnim。 */
    leftWalkAnim?: string;
    /** 右移动画，默认复用 walkAnim。 */
    rightWalkAnim?: string;
    /** 后退动画，默认复用 walkAnim。 */
    backwardAnim?: string;
    /** 飞行动画，默认复用 idleAnim。 */
    flyAnim?: string;
    /** 飞行待机动画，默认复用 idleAnim。 */
    flyIdleAnim?: string;
    /** 飞行前进悬停动画，默认复用 flyAnim。 */
    flyHoverForwardAnim?: string;
    /** 飞行后退悬停动画，默认复用 flyIdleAnim。 */
    flyHoverBackAnim?: string;
    /** 飞行左移悬停动画，默认复用 flyIdleAnim。 */
    flyHoverLeftAnim?: string;
    /** 飞行右移悬停动画，默认复用 flyIdleAnim。 */
    flyHoverRightAnim?: string;
    /** 飞行上升悬停动画，默认复用 flyIdleAnim。 */
    flyHoverUpAnim?: string;
    /** 飞行下降悬停动画，默认复用 flyIdleAnim。 */
    flyHoverDownAnim?: string;
    /** 上车动画名。 */
    enterCarAnim?: string;
    /** 下车动画名。 */
    exitCarAnim?: string;
    /** 重力基准值（按 scale 缩放），默认 -2400。 */
    gravity?: number;
    /** 跳跃高度基准值（按 scale 缩放），默认 600。 */
    jumpHeight?: number;
    /** 移动速度基准值（按 scale 缩放），默认 200。 */
    speed?: number;
    /** 跑步速度基准值（按 scale 缩放），默认 600。 */
    runSpeed?: number;
    /** 飞行速度基准值（按 scale 缩放），默认 2100。 */
    flySpeed?: number;
    /** 人物初始朝向，单位为弧度，默认 0。 */
    rotateY?: number;
    /** 头部骨骼名，用于第一人称相机挂载。 */
    headBoneName?: string;
    /** 第一人称相机局部偏移。 */
    firstPersonCameraOffset?: [number, number, number];
    /** 胶囊体半径倍率，默认 1。 */
    capsuleRadiusRatio?: number;
    /** XZ 加速响应速度，默认 30。 */
    acceleration?: number;
    /** XZ 减速响应速度，默认 30。 */
    deceleration?: number;
};

/** 移动端按钮的布局和图标配置。 */
export type MobileButtonOptions = {
    /** 左侧位置，单位为 px。 */
    left?: number;
    /** 右侧位置，单位为 px。 */
    right?: number;
    /** 顶部位置，单位为 px。 */
    top?: number;
    /** 底部位置，单位为 px。 */
    bottom?: number;
    /** 按钮直径，单位为 px，默认 56。 */
    size?: number;
    /** 自定义图片 URL。 */
    icon?: string;
};

/** 跳跃按钮配置。 */
export type JumpButtonOptions = MobileButtonOptions & {
    /** 车辆模式下的刹车图片 URL。 */
    brakeIcon?: string;
};

/** 移动端虚拟控制 UI 配置。 */
export type MobileControlsOptions = {
    /** 是否显示摇杆，默认 true。 */
    joystick?: boolean;
    /** 跳跃/刹车按钮；false 隐藏，对象可自定义图片和布局。 */
    jump?: boolean | JumpButtonOptions;
    /** 飞行按钮；false 隐藏，对象可自定义图片和布局。 */
    fly?: boolean | MobileButtonOptions;
    /** 视角切换按钮；false 隐藏，对象可自定义图片和布局。 */
    view?: boolean | MobileButtonOptions;
    /** 上下车按钮；false 隐藏，对象可自定义图片和布局。 */
    vehicle?: boolean | MobileButtonOptions;
};

/** 可重映射的输入动作。 */
export type KeyAction =
    | "forward" | "backward" | "left" | "right"
    | "sprint" | "jump" | "toggleView" | "toggleFly" | "toggleVehicle";

/** 自定义键位映射；未填使用默认键，传入 code 或数组覆盖，传入 null 禁用。 */
export type KeyMap = Partial<Record<KeyAction, string | string[] | null>>;

/** 玩家控制器初始化配置。 */
export type PlayerControllerOptions = {
    /** three.js 场景实例。 */
    scene: THREE.Scene;
    /** three.js 相机实例。 */
    camera: THREE.PerspectiveCamera;
    /** 外部相机控制器，通常为 OrbitControls。 */
    controls: any;
    /** 角色模型与参数配置。 */
    playerModelConfig: PlayerModelOptions;
    /** 初始出生点，默认 (0, 0, 0)。 */
    initPos?: THREE.Vector3;
    /** 鼠标灵敏度，默认 5。 */
    mouseSensitivity?: number;
    /** 第三人称最小镜头距离，默认 100。 */
    minCamDistance?: number;
    /** 第三人称最大镜头距离，默认 440。 */
    maxCamDistance?: number;
    /** 相机看向点高度比例（0 为底部，1 为顶部），默认 0.8。 */
    camLookAtHeightRatio?: number;
    /** 静态碰撞体来源；未传时遍历整个场景。 */
    staticCollider?: THREE.Object3D | THREE.Object3D[];
    /** 初始化时注册的动态碰撞体。 */
    dynamicCollider?: THREE.Object3D | THREE.Object3D[];
    /** 移动端是否显示虚拟控制 UI，默认 true。 */
    isShowMobileControls?: boolean;
    /** 移动端按钮显隐配置。 */
    mobileControls?: MobileControlsOptions;
    /** 第三人称鼠标控制模式，默认 1。 */
    thirdMouseMode?: 0 | 1 | 2 | 3 | 4 | 5;
    /** 是否允许滚轮缩放，默认 false。 */
    enableZoom?: boolean;
    /** 是否启用过肩视角，默认 false。 */
    enableOverShoulderView?: boolean;
    /** 第三人称相机过肩视角横向偏移比例，默认 0.2。 */
    camOverShoulderOffsetRatio?: number;
    /** 初始是否进入第一人称，默认 false。 */
    isFirstPerson?: boolean;
    /** 是否启用弹簧相机，默认 false。 */
    enableSpringCamera?: boolean;
    /** 弹簧相机平滑时间，单位为秒，默认 0.05。 */
    springCameraTime?: number;
    /** 时间缩放系数；小于 1 为慢动作，大于 1 为快进，默认 1。 */
    timeScale?: number;
    /** 自定义键位映射。 */
    keyMap?: KeyMap;
};

// ==================== 车辆配置 ====================

/** 已加载的车辆模型来源。 */
export type LoadedVehicleModelSource = {
    /** 已加载的模型根节点。 */
    model: THREE.Object3D;
    /** 模型使用的动画片段。 */
    animations: THREE.AnimationClip[];
    /** 已加载模型与旧模型路径不能同时使用。 */
    url?: never;
};

/** 旧版 glTF 车辆模型来源。 */
export type LegacyVehicleModelSource = {
    /**
     * 模型路径（GLB/GLTF）。
     * @deprecated 请在外部加载模型，并传入 model 和 animations。
     */
    url: string;
    /** 模型路径与已加载模型不能同时使用。 */
    model?: never;
    /** 模型路径与外部动画片段不能同时使用。 */
    animations?: never;
};

/** 车辆模型来源。 */
export type VehicleModelSource = LoadedVehicleModelSource | LegacyVehicleModelSource;

/** 车辆模型、物理和驾驶参数。 */
export type VehicleOptions = VehicleModelSource & {
    /** 车辆初始世界坐标。 */
    position: THREE.Vector3;
    /** 车轮节点名，顺序为左前、右前、左后、右后。 */
    wheelsNames: string[];
    /** 车辆模型缩放，默认 1。 */
    scale?: number;
    /** 车门开关动画名。 */
    openDoorAnim?: string;
    /** 上车点，使用车辆局部坐标。 */
    boardingPoint: THREE.Vector3;
    /** 角色上车后的座位偏移，默认 (0, 0, 0)。 */
    seatOffset?: THREE.Vector3;
    /** 底盘高度比例，默认 0.2。 */
    chassisRatio?: number;
    /** 悬挂静止长度比例，默认 0.2。 */
    suspensionRestLengthRatio?: number;
    /** 驾驶时镜头是否跟随车辆朝向，默认 true。 */
    followVehicleDirection?: boolean;
    /** 单车速度倍率，默认 1。 */
    speedMultiplier?: number;
};

/** 已加载车辆的运行时对象。 */
export type VehicleInstance = {
    /** 车辆模型组。 */
    vehicleGroup: THREE.Group;
    /** 底盘刚体。 */
    chassisBody: RigidBody;
    /** Rapier 车辆控制器。 */
    vehicleController: any;
    /** 同步车轮视觉的回调。 */
    updateWheelVisuals: () => void;
    /** 车辆动画混合器。 */
    vehicleMixer?: THREE.AnimationMixer;
    /** 车辆动画动作表。 */
    vehicleActions?: Map<string, THREE.AnimationAction>;
    /** 车门是否打开。 */
    vehiclIsOpenDoor: boolean;
    /** 车辆包围盒。 */
    vehicleBBox: THREE.Box3;
    /** 上车路径规划器。 */
    pathPlanner: PathPlanner;
    /** 车辆缩放。 */
    scale: number;
    /** 上车点，使用车辆局部坐标。 */
    boardingPoint: THREE.Vector3;
    /** 座位偏移。 */
    seatOffset: THREE.Vector3;
    /** 上车动画时长。 */
    enterVehicleTime: number;
    /** 底盘高度比例。 */
    chassisRatio: number;
    /** 悬挂静止长度比例。 */
    suspensionRestLengthRatio: number;
    /** 车辆尺寸（长、宽、高）。 */
    size: {
        l: number;
        w: number;
        h: number;
    };
    /** 单车速度倍率。 */
    speedMultiplier: number;
    /** 物理盒体调试网格。 */
    physicsBoxMesh?: THREE.Mesh;
};

/** 动态碰撞体的 BVH 与帧间变换数据。 */
export type DynamicColliderEntry = {
    /** 原始物体。 */
    source: THREE.Object3D;
    /** BVH 网格，使用本地空间几何。 */
    mesh: THREE.Mesh;
    /** 上一帧世界矩阵。 */
    prevWorldMatrix: THREE.Matrix4;
    /** 本帧位移增量。 */
    deltaPos: THREE.Vector3;
    /** 本帧 Y 轴旋转增量，单位为弧度。 */
    deltaRotY: number;
};
