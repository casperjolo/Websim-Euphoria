import type {
    AnimationAction,
    AnimationClip,
    Bone,
    Line3,
    Line,
    Mesh,
    Object3D,
    Quaternion,
    Scene,
    Vector3,
} from "three";

/** 骨骼对象或用于查找骨骼的名称。 */
export type BoneRef = Bone | string;

/** 左右脚标识。 */
export type FootIKSide = "left" | "right";

/** FootIK 使用的控制器字段；实际传入对象仍是 playerController。 */
export type FootIKPlayer = {
    scene: Scene;
    collider: Object3D | null;
    playerCapsule: Mesh & {
        capsuleInfo?: {
            radius: number;
            segment: Line3;
        };
    };
    playerModel: Object3D | null;
    playerIsOnGround: boolean;
    isFlying?: boolean;
    /** 角色世界速度；预测落点用水平分量。 */
    playerVelocity: Vector3;
    playerModelConfig: {
        scale: number;
        walkAnim: string;
        runAnim: string;
        leftWalkAnim?: string;
        rightWalkAnim?: string;
        backwardAnim?: string;
    };
    animation: {
        clips: AnimationClip[];
        state?: AnimationAction;
    };
};

/** 单条腿参与 IK 的骨骼配置。 */
export type FootIKLegBoneConfig = {
    /** 大腿骨骼。 */
    upper?: BoneRef;
    /** 小腿骨骼。 */
    lower?: BoneRef;
    /** 脚部骨骼。 */
    foot?: BoneRef;
    /** 脚趾骨骼。 */
    toe?: BoneRef;
};

/** FootIK 使用的骨盆和左右腿骨骼配置。 */
export type FootIKSkeletonConfig = {
    /** 骨盆骨骼。 */
    hips?: BoneRef;
    /** 左右腿骨骼配置。 */
    legs?: {
        /** 左腿骨骼配置。 */
        left?: FootIKLegBoneConfig;
        /** 右腿骨骼配置。 */
        right?: FootIKLegBoneConfig;
    };
};

/** FootIK 插件初始化配置。 */
export type FootIKOptions = {
    /** 腿部骨骼绑定；未传时根据骨骼名自动匹配。 */
    skeleton?: FootIKSkeletonConfig;
    /** 是否显示 IK 目标和射线，默认 false。 */
    debug?: boolean;
    /** 是否显示 foot-local 脚底采样点，默认 false。 */
    soleSampleDebug?: boolean;
    /** 是否启用插件，默认 true。 */
    enabled?: boolean;
    /** 骨盆最大下沉距离基准值（按 scale 缩放），默认 20。 */
    maxPelvisDrop?: number;
    /** 虚拟脚底左右半宽基准值（按 scale 缩放），默认 7。 */
    soleHalfWidth?: number;
    /** 脚尖采样点向前延伸距离基准值（按 scale 缩放），默认 7。 */
    soleToeExtend?: number;
    /** 脚跟采样点向后延伸距离基准值（按 scale 缩放），默认 3。 */
    soleHeelExtend?: number;
    /**
     * 脚骨到脚底蒙皮的厚度补偿基准值（按 scale 缩放），默认 3。
     * 贴地校正时额外上抬，避免按骨骼贴地导致鞋底陷入地面；平地接近满值，斜坡按法线衰减。
     */
    soleSkinThickness?: number;
    /** 脚掌贴合地面法线的权重，范围 0 到 1，默认 1。 */
    footAlignWeight?: number;
    /** 脚掌最大倾斜角，单位为弧度，默认 Math.PI / 2。 */
    maxFootTilt?: number;
    /** 膝盖最小弯曲角，单位为弧度，默认 2°。 */
    minKneeBend?: number;
    /** 膝盖最大弯曲角，单位为弧度，默认 145°。 */
    maxKneeBend?: number;
    /** 移动时脚底穿透触发阈值基准值（按 scale 缩放），默认 0.1。 */
    moveLiftThreshold?: number;
    /** mesh 台阶视觉补偿最大下移距离基准值（按 scale 缩放），默认 36。 */
    maxMeshStepDrop?: number;
    /** mesh 台阶视觉补偿最大上抬距离基准值（双脚同平面高于胶囊时，按 scale 缩放），默认 36。 */
    maxMeshStepRaise?: number;
    /** 判定双脚处于同一支撑平面的最大高度差基准值（按 scale 缩放），默认 8。 */
    meshStepCoplanarThreshold?: number;
    /** 单个移动动画的脚步相位采样数，默认 96。 */
    footPhaseSampleCount?: number;
    /** 脚步相位接地高度阈值基准值（按 scale 缩放），默认 5。 */
    footPhaseGroundThreshold?: number;
    /** 最短接触段占动画周期的比例，默认 0.04。 */
    footPhaseMinContactRatio?: number;
    /** 支撑脚水平速度过滤倍率，默认 1.35。 */
    footPhaseSpeedSlack?: number;
    /**
     * 是否启用预测脚步 IK。默认 false（保持反应式贴地）。
     * 开启后仅在循环 locomotion 中预测落点并采样 FootPath；Idle / 落地缓冲仍用反应式。
     */
    predictive?: boolean;
    /** 实际落点与预测点水平距离小于该值时，用预测点作为新落点（scale=1 基准），默认 6。 */
    plantSnapEpsilon?: number;
    /**
     * 落地边沿后硬锁定落点的时长（秒），默认 0.1。
     * 超时或抬脚/水平滑出阈值后立即解锁，避免 toe-off 仍钉在旧世界落点。
     */
    plantLockDuration?: number;
    /** 动画脚相对落点上抬超过该值则提前解锁（scale=1 基准），默认 4。 */
    plantUnlockLift?: number;
    /** 动画脚相对落点水平偏离超过该值则提前解锁（scale=1 基准），默认 10。 */
    plantUnlockHoriz?: number;
    /** FootPath 两端对向迭代细分次数，默认 5。 */
    footPathIterations?: number;
    /** 离地再落地后强制使用反应式 IK 的宽限时间（秒），默认 0.35。 */
    predictiveLandingGrace?: number;
    /** 预测模式下盆骨重建弹簧阻尼速度，默认 12。 */
    pelvisSpring?: number;
    /** FootPath 中段相对端点的额外抬高（scale=1 基准），默认 28。平地也会形成摆腿弧；走路步幅短时还会按步长比例加高。 */
    pathMidLift?: number;
    /** 上下坡时叠加到 FootPath 上的动画抬脚高度缩放，默认 0.35。 */
    animLiftScaleOnSlope?: number;
    /** 预测模式下上楼时盆骨额外下压（scale=1 基准），默认 5。 */
    stairPelvisDropUp?: number;
    /** 预测模式下下楼时盆骨额外下压（scale=1 基准），默认 8。 */
    stairPelvisDropDown?: number;
    /** 预测模式下 mesh 台阶补偿限幅缩放（0~1），默认 0.25。 */
    meshStepPredictiveScale?: number;
};

/** 单只脚的预测落点 / FootPath 运行时状态。 */
export type PredictiveFootState = {
    /** 上一次落脚世界坐标（踩下瞬间固定，用于 FootPath 起点 / Debug）。 */
    lastPlantWorld: Vector3;
    /**
     * 落点相对胶囊的水平偏移（踩下时记录）。
     * 每帧用当前胶囊还原锚点后再 × 剩余时间外推，避免 timeToLand→0 时预测塌回旧世界落点。
     */
    lastPlantLocal: Vector3;
    /** 当前预测的下一步落脚世界坐标。 */
    predictedWorld: Vector3;
    /** 踩下锁定的世界坐标。 */
    lockedPlantWorld: Vector3;
    /** 当前步伐 FootPath 采样点。 */
    pathPoints: Vector3[];
    /** 是否已记录过至少一次落点。 */
    hasPlant: boolean;
    /** 是否处于踩下短时锁定（刚落地窗口，非整个 contact）。 */
    locked: boolean;
    /** 短时锁定剩余时间（秒）。 */
    lockRemaining: number;
    /** 上一帧相位是否 planted，用于边沿检测。 */
    wasPlanted: boolean;
    /** 本帧 Path 采样得到的世界高度增量目标。 */
    pathSample: Vector3;
};

// 单个地面探测采样点的运行时数据。
export type FootIKProbeSample = {
    name: string;
    point: Vector3;
    hitPoint: Vector3;
    hasHit: boolean;
};

// 固定在 foot 本地空间中的脚底采样点。
export type FootIKSoleSample = FootIKProbeSample & {
    local: Vector3;
    marker: Mesh | null;
    rayLine: Line | null;
    footMarker: Mesh | null;
};

// 单条腿的骨骼引用、IK 状态和调试对象。
export type FootIKLeg = {
    side: FootIKSide;
    upper: Bone | null;
    lower: Bone | null;
    foot: Bone | null;
    toe: Bone | null;
    color: number;
    ready: boolean;
    smoothedTarget: Vector3;
    hitPoint: Vector3;
    hitNormal: Vector3;
    footSamplePoint: Vector3;
    soleSamples: FootIKSoleSample[];
    offsetY: number;
    movePenetrating: boolean;
    weight: number;
    plantedWeight: number;
    planted: boolean;
    lastPole: Vector3;
    hasLastPole: boolean;
    marker: Mesh | null;
    rayLine: Line | null;
};

// 已完成必要骨骼绑定的腿链。
export type ReadyFootIKLeg = FootIKLeg & {
    upper: Bone;
    lower: Bone;
    foot: Bone;
    ready: true;
};

// 左右腿运行时数据集合。
export type FootIKLegs = Record<FootIKSide, FootIKLeg>;

// IK 修改前保存的单个骨骼姿态。
export type FootIKBonePose = {
    position: Vector3;
    quaternion: Quaternion;
};

// 脚步相位离线采样配置。
export type FootPhaseOptions = {
    sampleCount: number;
    groundThreshold: number;
    minContactRatio: number;
    speedSlack: number;
};

// 单只脚在当前动画帧的相位状态。
export type FootPhaseRuntimeState = {
    planted: boolean;
    progress: number;
    timeToLand: number;
};

// 左右脚在当前动画帧的相位状态。
export type FootPhaseRuntime = Record<FootIKSide, FootPhaseRuntimeState>;

// 当前动画及其左右脚相位状态。
export type FootPhaseControllerState = FootPhaseRuntime & {
    clipName: string;
    normalizedTime: number;
};

// 单只脚在一个动画周期内的接触区间数据。
export type FootPhaseSideData = {
    contacts: boolean[];
    land: number[];
    lift: number[];
};

// 单个移动动画的左右脚相位数据。
export type FootPhaseClipData = {
    name: string;
    duration: number;
    left: FootPhaseSideData;
    right: FootPhaseSideData;
};

// 以动画名称索引的脚步相位数据库。
export type FootPhaseDatabase = Map<string, FootPhaseClipData>;

// 单只脚在某个采样帧的世界空间位置。
export type FootPhaseSamplePoint = {
    y: number;
    x: number;
    z: number;
};

// 左右脚在动画采样时刻的位置数据。
export type FootPhaseFrameSample = {
    time: number;
    left: FootPhaseSamplePoint;
    right: FootPhaseSamplePoint;
};

// 一个连续脚底接触区间包含的采样索引。
export type FootPhaseContactRun = {
    indices: number[];
};
