import {
    Matrix3,
    MathUtils,
    Quaternion,
    Raycaster,
    Vector3,
    type Bone,
    type Intersection,
    type Object3D,
} from "three";
import { createTwoBoneIKScratch, solveTwoBoneIK } from "./internal/two-bone-ik";
import {
    buildFootPhaseDatabase,
    createFootPhaseOptions,
    createFootPhaseRuntimeState,
    sampleFootPhaseRuntime,
} from "./internal/foot-phase";
import {
    collectBones,
    createLeg,
    findHips,
    isReadyLeg,
    resolveConfiguredBone,
} from "./internal/skeleton";
import {
    createDebugObjects,
    createEmptyPredictiveDebug,
    createPredictiveDebugObjects,
    createSoleSampleDebugObjects,
    disposeDebugObjects,
    disposePredictiveDebugObjects,
    getFootPhaseDebugText,
    setDebugVisible,
    setPredictiveDebugVisible,
    setSoleSampleDebugVisible,
    updateFootDebug,
    updatePredictiveDebug,
    updateSoleSampleDebugObjects,
    type PredictiveDebugObjects,
} from "./internal/debug";
import {
    createPredictiveFootState,
    predictPlantWorld,
    predictiveTargetDamp,
    recordPlantOnLand,
    resetPredictiveFootState,
    tickPlantLock,
} from "./internal/predictive-plant";
import {
    buildFootPath,
    sampleFootPath,
} from "./internal/foot-path";
import { computePelvisRebuildOffset } from "./internal/pelvis-rebuild";
import type {
    FootIKBonePose,
    FootIKLeg,
    FootIKLegs,
    FootIKOptions,
    FootIKPlayer,
    FootIKProbeSample,
    FootIKSide,
    FootIKSkeletonConfig,
    FootPhaseControllerState,
    FootPhaseDatabase,
    FootPhaseOptions,
    PredictiveFootState,
    ReadyFootIKLeg,
} from "./types";
import type { TwoBoneIKScratch } from "./internal/two-bone-ik";

/** 根据角色动画和地面高度修正脚部姿态的控制器插件。 */
export class FootIK {
    /** 插件名称。 */
    readonly name = "foot-ik";

    // 当前挂载的玩家控制器。
    private player: FootIKPlayer | null = null;

    // 生命周期与调试开关。
    private enabled: boolean;
    private disposed = false;
    private debug: boolean;
    private soleSampleDebug: boolean;
    /** 预测脚步 IK 开关；默认关闭，关闭时走现有反应式路径。 */
    private predictive: boolean;

    // IK 距离、角度和脚掌贴合配置。
    private maxPelvisDrop = 20;
    private soleHalfWidth = 7;
    private soleToeExtend = 7;
    private soleHeelExtend = 3;
    private soleSkinThickness = 3;
    private moveLiftThreshold = 0.1;
    private maxMeshStepDrop = 36;
    private maxMeshStepRaise = 36;
    private meshStepCoplanarThreshold = 8;
    private footPhaseGroundThreshold = 5;
    private pelvisMaxRaise = 7;
    private fakeToeExtend = 24;
    private meshStepEpsilon = 4;
    private sampleRayOriginY = 90;
    private raycastFar = 440;
    private snapEpsilon = 0.02;
    private plantSnapEpsilon = 6;
    private plantLockDuration = 0.1;
    private plantUnlockLift = 4;
    private plantUnlockHoriz = 10;
    private footPathIterations = 5;
    private predictiveLandingGrace = 0.35;
    private pelvisSpring = 12;
    private pathMidLift = 28;
    private animLiftScaleOnSlope = 0.35;
    private stairPelvisDropUp = 5;
    private stairPelvisDropDown = 8;
    private meshStepPredictiveScale = 0.25;
    private pathBumpEpsilon = 0.5;
    // 当前距离字段已烘焙进去的 scale；改 scale 时按 ratio 连乘。
    private appliedScale = 1;

    private footAlignWeight: number;
    private maxFootTilt: number;
    private minKneeBend: number;
    private maxKneeBend: number;

    // 模型根节点基准高度，以及平滑保留的台阶和骨盆垂直补偿。
    private meshBaseY = 0;
    private meshStepOffsetY = 0;
    private pelvisOffset = 0;

    // 地面检测与每帧复用的临时对象。
    private readonly raycaster: Raycaster;
    private readonly up = new Vector3(0, 1, 0);
    private readonly tmpV1 = new Vector3();
    private readonly tmpV2 = new Vector3();
    private readonly tmpV3 = new Vector3();
    private readonly tmpV4 = new Vector3();
    private readonly tmpV5 = new Vector3();
    private readonly tmpQ1 = new Quaternion();
    private readonly tmpQ2 = new Quaternion();
    private readonly tmpQ3 = new Quaternion();
    // IK 前的动画脚旋转，用于抵消腿链求解对子骨骼产生的被动旋转。
    private readonly savedFootWorldQ = new Quaternion();
    // 脚掌贴坡后的旋转，用于二次接触校正时保持已完成的倾斜结果。
    private readonly savedAlignedFootWorldQ = new Quaternion();
    // 四元数球面插值使用的单位旋转终点。
    private readonly identityQ = new Quaternion();
    // 把碰撞面局部法线转换到世界空间。
    private readonly normalMatrix = new Matrix3();
    // 双骨骼 IK 解算器跨帧复用的临时对象。
    private readonly twoBoneIKScratch: TwoBoneIKScratch;

    // 胶囊与脚底高度差检测使用的复用采样点。
    private readonly meshStepProbeSamples: FootIKProbeSample[];

    // 下一帧动画更新前需要恢复的骨骼及其动画原始姿态。
    private readonly adjusted = new Set<Object3D>();
    private readonly poseCache = new Map<Object3D, FootIKBonePose>();

    // 骨骼绑定和脚步相位配置。
    private readonly skeletonConfig: FootIKSkeletonConfig | null;
    private footPhaseOptions: FootPhaseOptions;

    // 当前模型生成的脚步相位数据库和运行时状态。
    private footPhaseClips: FootPhaseDatabase = new Map();
    private footPhaseState: FootPhaseControllerState;

    // 当前模型解析出的骨盆与左右腿链。
    private hips: Bone | null = null;
    private legs: FootIKLegs;

    // 预测 IK 每脚状态与落地宽限。
    private readonly predictiveFeet: Record<FootIKSide, PredictiveFootState> = {
        left: createPredictiveFootState(),
        right: createPredictiveFootState(),
    };
    private wasAirborne = false;
    private landingGraceRemaining = 0;
    private readonly animFootWorld: Record<FootIKSide, Vector3> = {
        left: new Vector3(),
        right: new Vector3(),
    };
    private readonly plantAnchorWorld = new Vector3();
    private readonly predictiveDebug: PredictiveDebugObjects = createEmptyPredictiveDebug();

    /** 创建 FootIK 插件。 */
    constructor(options: FootIKOptions = {}) {
        this.enabled = options.enabled ?? true;
        this.debug = options.debug ?? false; // 是否显示脚底 IK 调试对象，默认 false
        this.soleSampleDebug = options.soleSampleDebug ?? false; // 是否显示始终跟随 foot 骨骼的脚底采样点
        this.predictive = options.predictive ?? false;

        // 距离类参数先写入 scale=1 基准值，挂载后按 playerModelConfig.scale 连乘。
        this.maxPelvisDrop = Math.max(0, options.maxPelvisDrop ?? this.maxPelvisDrop);
        this.soleHalfWidth = Math.max(0, options.soleHalfWidth ?? this.soleHalfWidth);
        this.soleToeExtend = Math.max(0, options.soleToeExtend ?? this.soleToeExtend);
        this.soleHeelExtend = Math.max(0, options.soleHeelExtend ?? this.soleHeelExtend);
        this.soleSkinThickness = Math.max(0, options.soleSkinThickness ?? this.soleSkinThickness);
        this.moveLiftThreshold = Math.max(0, options.moveLiftThreshold ?? this.moveLiftThreshold);
        this.maxMeshStepDrop = Math.max(0, options.maxMeshStepDrop ?? this.maxMeshStepDrop);
        this.maxMeshStepRaise = Math.max(0, options.maxMeshStepRaise ?? this.maxMeshStepRaise);
        this.meshStepCoplanarThreshold = Math.max(0, options.meshStepCoplanarThreshold ?? this.meshStepCoplanarThreshold);
        this.footPhaseGroundThreshold = Math.max(0, options.footPhaseGroundThreshold ?? this.footPhaseGroundThreshold);
        this.plantSnapEpsilon = Math.max(0, options.plantSnapEpsilon ?? this.plantSnapEpsilon);
        this.plantLockDuration = Math.max(0, options.plantLockDuration ?? this.plantLockDuration);
        this.plantUnlockLift = Math.max(0, options.plantUnlockLift ?? this.plantUnlockLift);
        this.plantUnlockHoriz = Math.max(0, options.plantUnlockHoriz ?? this.plantUnlockHoriz);
        this.pathMidLift = Math.max(0, options.pathMidLift ?? this.pathMidLift);
        this.stairPelvisDropUp = Math.max(0, options.stairPelvisDropUp ?? this.stairPelvisDropUp);
        this.stairPelvisDropDown = Math.max(0, options.stairPelvisDropDown ?? this.stairPelvisDropDown);

        this.footPathIterations = Math.max(1, Math.floor(options.footPathIterations ?? this.footPathIterations));
        this.predictiveLandingGrace = Math.max(0, options.predictiveLandingGrace ?? this.predictiveLandingGrace);
        this.pelvisSpring = Math.max(0.1, options.pelvisSpring ?? this.pelvisSpring);
        this.animLiftScaleOnSlope = MathUtils.clamp(options.animLiftScaleOnSlope ?? this.animLiftScaleOnSlope, 0, 1);
        this.meshStepPredictiveScale = MathUtils.clamp(
            options.meshStepPredictiveScale ?? this.meshStepPredictiveScale,
            0,
            1,
        );

        this.footAlignWeight = MathUtils.clamp(options.footAlignWeight ?? 1, 0, 1); // 脚掌贴合地面法线的强度
        this.maxFootTilt = MathUtils.clamp(options.maxFootTilt ?? Math.PI / 2, 0, Math.PI); // 脚掌贴坡最大旋转角
        const configuredMinBend = MathUtils.clamp(options.minKneeBend ?? MathUtils.degToRad(2), 0, Math.PI);
        const configuredMaxBend = MathUtils.clamp(options.maxKneeBend ?? MathUtils.degToRad(145), 0, Math.PI);
        this.minKneeBend = Math.min(configuredMinBend, configuredMaxBend);
        this.maxKneeBend = Math.max(configuredMinBend, configuredMaxBend);

        // 脚底检测射线；far 会在 rescaleDistances 中随 scale 更新。
        this.raycaster = new Raycaster(new Vector3(), new Vector3(0, -1, 0), 0, this.raycastFar);
        (this.raycaster as Raycaster & { firstHitOnly?: boolean }).firstHitOnly = true;

        // 从动画中自动采样脚步相位，用于判断移动动画中的支撑脚。
        this.footPhaseOptions = createFootPhaseOptions({
            ...options,
            footPhaseGroundThreshold: this.footPhaseGroundThreshold,
        });
        this.footPhaseState = {
            clipName: "",
            normalizedTime: 0,
            left: createFootPhaseRuntimeState(),
            right: createFootPhaseRuntimeState(),
        };

        this.twoBoneIKScratch = createTwoBoneIKScratch();
        this.meshStepProbeSamples = ["heelL", "heelR", "toeL", "toeR"].map(name => ({
            name,
            point: new Vector3(),
            hitPoint: new Vector3(),
            hasHit: false,
        }));

        // 未传配置时才回退到启发式匹配。
        this.skeletonConfig = options.skeleton ?? null; // 骨骼绑定配置，支持骨骼名或 Bone 对象
        this.legs = this.createEmptyLegs();
    }

    /** 挂载到玩家控制器并绑定当前模型骨骼。 */
    onAttach(player: FootIKPlayer): void {
        if (this.disposed) {
            throw new Error("[FootIK] 已销毁的插件不能再次挂载。");
        }
        if (this.player && this.player !== player) this.detachPlayer();
        this.attachPlayer(player);
    }

    /** 从玩家控制器卸载并恢复插件修改。 */
    onDetach(): void {
        this.detachPlayer();
    }

    /** 在动画更新前恢复上一帧被 IK 修改的骨骼姿态。 */
    onBeforeAnimationUpdate(_delta: number): void {
        if (!this.enabled || this.disposed) return;
        this.restore();
    }

    /** 在动画更新后应用当前帧 Foot IK。 */
    onAfterAnimationUpdate(delta: number): void {
        if (!this.enabled || this.disposed) return;
        this.syncDistanceScale();
        this.update(delta);
        this.updateSoleSampleDebug();
    }

    /** 玩家模型切换后重新绑定骨骼和脚步相位数据。 */
    onPlayerModelChange(): void {
        if (this.disposed) return;
        this.rebind();
    }

    /** 终止使用插件并释放调试资源。 */
    dispose(): void {
        if (this.disposed) return;
        this.detachPlayer();
        this.disposed = true;
        this.footPhaseClips.clear();
        this.adjusted.clear();
        this.poseCache.clear();
        disposePredictiveDebugObjects(this.predictiveDebug);
    }

    // 模型切换后释放旧调试对象，并基于新模型重新绑定全部运行时数据。
    private rebind(): void {
        if (!this.player?.playerModel) return;
        this.restore();
        disposeDebugObjects(this.legs);
        disposePredictiveDebugObjects(this.predictiveDebug);
        this.clearPredictiveState();
        this.syncDistanceScale();
        this.bindSkeleton();
    }

    /** 读取当前角色 scale，未挂载时按 1 处理。 */
    private getPlayerScale(): number {
        const scale = this.player?.playerModelConfig?.scale;
        return typeof scale === "number" && scale > 0 ? scale : 1;
    }

    /** 把 scale=1 基准距离写成当前世界值。 */
    private scaleDistance(value: number): number {
        return Math.max(0, value) * this.getPlayerScale();
    }

    /** 把已缩放的世界距离还原为 scale=1 基准值（供 getOptions 使用）。 */
    private toBaseDistance(world: number): number {
        return this.appliedScale > 0 ? world / this.appliedScale : world;
    }

    /** 若角色 scale 变化，对距离字段做 ratio 连乘。 */
    private syncDistanceScale(): void {
        const scale = this.getPlayerScale();
        if (scale === this.appliedScale) return;
        this.rescaleDistances(scale);
        this.initSoleLocalSamples(this.legs.left);
        this.initSoleLocalSamples(this.legs.right);
        this.buildFootPhaseDatabase();
    }

    /** 将距离字段从 appliedScale 换算到 newScale。 */
    private rescaleDistances(newScale: number): void {
        const next = newScale > 0 ? newScale : 1;
        const ratio = next / this.appliedScale;
        if (ratio === 1) {
            this.appliedScale = next;
            return;
        }

        this.maxPelvisDrop *= ratio;
        this.soleHalfWidth *= ratio;
        this.soleToeExtend *= ratio;
        this.soleHeelExtend *= ratio;
        this.soleSkinThickness *= ratio;
        this.moveLiftThreshold *= ratio;
        this.maxMeshStepDrop *= ratio;
        this.maxMeshStepRaise *= ratio;
        this.meshStepCoplanarThreshold *= ratio;
        this.footPhaseGroundThreshold *= ratio;
        this.pelvisMaxRaise *= ratio;
        this.fakeToeExtend *= ratio;
        this.meshStepEpsilon *= ratio;
        this.sampleRayOriginY *= ratio;
        this.raycastFar *= ratio;
        this.snapEpsilon *= ratio;
        this.plantSnapEpsilon *= ratio;
        this.plantUnlockLift *= ratio;
        this.plantUnlockHoriz *= ratio;
        this.pathMidLift *= ratio;
        this.stairPelvisDropUp *= ratio;
        this.stairPelvisDropDown *= ratio;
        this.pathBumpEpsilon *= ratio;
        this.raycaster.far = this.raycastFar;
        this.footPhaseOptions.groundThreshold = this.footPhaseGroundThreshold;
        this.appliedScale = next;
    }

    /** 启用或停用 Foot IK；停用时立即恢复插件修改。 */
    setEnabled(enabled: boolean): void {
        if (this.disposed) return;
        this.enabled = enabled;
        if (!enabled) {
            this.restore();
            this.resetMeshStepOffsetImmediately();
            this.pelvisOffset = 0;
            this.clearPredictiveState();
            this.setDebugVisible(false);
            this.setSoleSampleDebugVisible(false);
        } else if (this.debug) {
            this.setDebugEnabled(true);
        }
    }

    /** 启用或关闭预测脚步 IK；关闭时清空预测缓存并回退反应式。 */
    setPredictiveEnabled(enabled: boolean): void {
        if (this.disposed) return;
        if (this.predictive === enabled) return;
        this.predictive = enabled;
        this.clearPredictiveState();
        this.landingGraceRemaining = 0;
        this.wasAirborne = false;
        if (this.debug) {
            this.createPredictiveDebugObjects();
            this.setPredictiveDebugVisible(enabled);
        }
    }

    /** 当前是否启用预测脚步 IK。 */
    isPredictiveEnabled(): boolean {
        return this.predictive;
    }

    /** 清空落点 / FootPath 缓存，避免模式切换串数据。 */
    private clearPredictiveState(): void {
        resetPredictiveFootState(this.predictiveFeet.left);
        resetPredictiveFootState(this.predictiveFeet.right);
        this.setPredictiveDebugVisible(false);
    }

    // 保存玩家控制器引用并初始化模型相关状态。
    private attachPlayer(player: FootIKPlayer): void {
        if (this.player === player && this.legs.left.ready) return;
        this.player = player;
        this.syncDistanceScale();
        this.meshBaseY = player.playerModel?.position.y ?? 0;
        this.meshStepOffsetY = 0;
        this.pelvisOffset = 0;
        this.bindSkeleton();
    }

    // 恢复骨骼和模型偏移，释放调试资源并清空所有控制器相关引用。
    private detachPlayer(): void {
        this.restore();
        this.resetMeshStepOffsetImmediately();
        disposeDebugObjects(this.legs);
        disposePredictiveDebugObjects(this.predictiveDebug);
        this.footPhaseClips.clear();
        this.adjusted.clear();
        this.poseCache.clear();
        this.hips = null;
        this.legs = this.createEmptyLegs();
        // 还原到 scale=1 基准值，便于卸载后再挂载或单独 configure。
        this.rescaleDistances(1);
        this.player = null;
        this.meshStepOffsetY = 0;
        this.pelvisOffset = 0;
        this.clearPredictiveState();
        this.landingGraceRemaining = 0;
        this.wasAirborne = false;
    }

    // 创建尚未绑定骨骼的左右腿占位状态。
    private createEmptyLegs(): FootIKLegs {
        return {
            left: createLeg("left", [], 0x2dd4bf),
            right: createLeg("right", [], 0xf97316),
        };
    }

    // 解析骨骼后初始化脚底采样、脚步相位数据库和调试对象。
    private bindSkeleton(): void {
        const bones = collectBones(this.player?.playerModel);
        this.hips = resolveConfiguredBone(this.skeletonConfig?.hips, bones, "hips")
            ?? findHips(bones);
        this.legs = {
            left: createLeg("left", bones, 0x2dd4bf, this.skeletonConfig),
            right: createLeg("right", bones, 0xf97316, this.skeletonConfig),
        };

        if (!this.hips || !isReadyLeg(this.legs.left) || !isReadyLeg(this.legs.right)) {
            console.warn("[FootIK] 骨骼识别不完整，当前模型骨骼名：", bones.map(b => b.name));
        }
        this.player?.playerModel?.updateMatrixWorld(true);
        this.meshBaseY = this.player?.playerModel?.position.y ?? this.meshBaseY;
        this.initSoleLocalSamples(this.legs.left);
        this.initSoleLocalSamples(this.legs.right);
        this.buildFootPhaseDatabase();
        this.createDebugObjects();
        this.createSoleSampleDebugObjects();
    }

    // 恢复上一帧 IK 修改前的骨骼姿态
    private restore(): void {
        // 先恢复上一帧的动画原始姿态，再让 mixer 推进当前帧
        // 调用顺序：footIK.restore() -> player.update() -> footIK.update()
        for (const bone of this.adjusted) {
            const pose = this.poseCache.get(bone);
            if (!pose) continue;
            bone.position.copy(pose.position);
            bone.quaternion.copy(pose.quaternion);
        }
        this.adjusted.clear();
    }

    // 在动画更新后执行每帧腿部 IK 修正。
    private update(delta = 1 / 60): void {
        if (!this.enabled || this.disposed) return;
        this.updateFootPhaseRuntime();

        // 不在地面或飞行时不做腿部贴地
        if (
            !this.player?.collider
            || !this.player.playerCapsule
            || !this.player.playerIsOnGround
            || this.player.isFlying
        ) {
            this.wasAirborne = true;
            this.resetMeshStepOffset(delta);
            this.clearPredictiveState();
            this.setDebugVisible(false);
            return;
        }

        // 离地再落地：宽限期内强制反应式，并重置预测参数。
        if (this.wasAirborne) {
            this.wasAirborne = false;
            this.clearPredictiveState();
            this.landingGraceRemaining = this.predictive ? this.predictiveLandingGrace : 0;
        }
        if (this.landingGraceRemaining > 0) {
            this.landingGraceRemaining = Math.max(0, this.landingGraceRemaining - delta);
        }

        const model = this.player.playerModel;
        model?.updateMatrixWorld(true);

        // moving 决定移动与静止 IK 策略：移动使用脚步相位和稳定直弯 pole，静止保留动画 pole。
        const moving = this.isLocomotion();
        const usePredictive = this.shouldUsePredictive(moving);

        if (usePredictive) {
            this.applyMeshStepOffset(delta, this.meshStepPredictiveScale);
            model?.updateMatrixWorld(true);
            this.updatePredictiveFeet(delta);
            this.applyPelvisRebuild(delta);
            this.applyLeg("left", moving);
            this.applyLeg("right", moving);
            this.syncFootBoneDebugMarkers();
            this.updatePredictiveDebugObjects();
            return;
        }

        // 先处理胶囊上台阶带来的视觉高度差，再算脚目标。
        this.applyMeshStepOffset(delta);
        model?.updateMatrixWorld(true);

        // 先算左右脚目标，再根据两只脚目标调整骨盆，最后解腿部 IK。
        this.updateFoot("left", delta, moving);
        this.updateFoot("right", delta, moving);
        this.applyPelvis(delta);
        this.applyLeg("left", moving);
        this.applyLeg("right", moving);
        this.setPredictiveDebugVisible(false);
    }

    /** 预测分支门控：开关开、循环 locomotion、宽限结束、双脚相位可用。 */
    private shouldUsePredictive(moving: boolean): boolean {
        if (!this.predictive || !moving) return false;
        if (this.landingGraceRemaining > 0) return false;
        const clipName = this.footPhaseState.clipName;
        if (!clipName || !this.footPhaseClips.has(clipName)) return false;
        return true;
    }

    // 构建脚步相位库。具体采样和过滤逻辑在 foot-phase.ts 中。
    private buildFootPhaseDatabase(): void {
        const model = this.player?.playerModel;
        const clips = this.player?.animation?.clips ?? [];
        this.footPhaseClips = buildFootPhaseDatabase(
            model,
            clips,
            this.legs,
            this.footPhaseOptions,
            name => this.isLocomotionClipName(name),
        );

        if (this.debug && this.footPhaseClips.size === 0) {
            console.warn("[FootIK] 没有生成脚步相位数据，请确认移动动画和脚骨骼配置。");
        }
    }

    // 根据当前动画播放时间更新左右脚相位。这里只同步状态，不直接驱动 IK。
    private updateFootPhaseRuntime(): void {
        const action = this.player?.animation?.state;
        if (!action) {
            this.footPhaseState.clipName = "";
            return;
        }
        const clip = action.getClip();
        if (clip.duration <= 0) return;

        const data = this.footPhaseClips.get(clip.name);
        this.footPhaseState.clipName = clip.name;
        this.footPhaseState.normalizedTime = ((action.time / clip.duration) % 1 + 1) % 1;

        if (!data) {
            this.footPhaseState.left = createFootPhaseRuntimeState();
            this.footPhaseState.right = createFootPhaseRuntimeState();
            return;
        }

        const runtime = sampleFootPhaseRuntime(data, this.footPhaseState.normalizedTime, clip.duration);
        this.footPhaseState.left = runtime.left;
        this.footPhaseState.right = runtime.right;
    }

    // 计算单脚 IK 目标、权重和骨盆偏移。
    private updateFoot(side: FootIKSide, delta: number, moving: boolean): void {
        const leg = this.legs[side];
        if (!isReadyLeg(leg)) return;

        const footWorld = leg.foot.getWorldPosition(this.tmpV1);
        const phase = this.footPhaseState?.[side];
        const phasePlanted = moving && !!phase?.planted;
        leg.planted = !moving || phasePlanted;
        const hit = this.castBestFootGround(leg, footWorld);

        // 脚底没有命中地面时，本帧完全交还给原动画。
        if (!hit) {
            leg.plantedWeight = 0;
            leg.movePenetrating = false;
            leg.weight = 0;
            leg.offsetY = 0;
            return;
        }

        this.getWorldHitNormal(hit, leg.hitNormal);
        leg.hitPoint.copy(hit.point);

        // 命中点高过胶囊底部时，说明角色碰撞体已经把台阶/斜坡吃掉了。
        // 此时不再把脚吸向上方地面，避免 IK 和胶囊位移互相抢高度。
        if (this.hasFootHitAboveCapsuleBottom(leg)) {
            leg.weight = 0;
            leg.plantedWeight = 0;
            leg.offsetY = 0;
            leg.movePenetrating = false;
            leg.smoothedTarget.copy(footWorld);
            this.updateFootDebug(leg, leg.footSamplePoint, hit.point);
            return;
        }

        const liftAmount = this.getMovePenetrationLift(leg);
        // 支撑脚允许渐进应用脚掌贴坡；摆动脚默认只在穿透时上抬。
        // 支撑状态和防穿透独立触发：任意相位陷入地面都会立即抬起。
        const liftTargetY = footWorld.y + liftAmount;
        const targetY = liftTargetY;

        const target = this.tmpV2.copy(footWorld);
        target.y = targetY;

        // 防穿透只负责上抬，不参与脚步锁定状态。
        leg.movePenetrating = liftAmount > this.moveLiftThreshold;

        const wantedPlantedWeight = leg.planted ? 1 : 0;
        leg.plantedWeight = MathUtils.damp(leg.plantedWeight ?? 0, wantedPlantedWeight, 10, delta);

        // 支撑状态短时间渐入/渐出；穿透修正仍然立即介入，避免脚陷入地面。
        if (leg.movePenetrating) {
            leg.weight = 1;
        } else if (leg.plantedWeight > 0.001) {
            leg.weight = leg.plantedWeight;
        } else {
            // 移动 swing 脚听原动画，IK 不生效。
            leg.weight = 0;
        }

        // 骨盆只跟随实际垂直修正，避免摆腿时骨盆抖动。
        leg.offsetY = (leg.planted || leg.movePenetrating) ? (targetY - footWorld.y) * leg.weight : 0;

        // 摆动脚且没有穿透时，目标回到动画脚位，避免移动中被地面锁脚。
        leg.smoothedTarget.copy((leg.planted || leg.movePenetrating) ? target : footWorld);

        this.updateFootDebug(leg, leg.footSamplePoint, hit.point);
    }

    /**
     * 预测 IK：记录落点 → 速度×timeToLand 预测 → FootPath 采样增量 → 踩下锁定。
     * 首步尚无落点记录时，单脚回退反应式 updateFoot。
     */
    private updatePredictiveFeet(delta: number): void {
        const velocity = this.player?.playerVelocity;
        const vx = velocity?.x ?? 0;
        const vz = velocity?.z ?? 0;

        for (const side of ["left", "right"] as const) {
            const leg = this.legs[side];
            if (!isReadyLeg(leg)) continue;
            this.animFootWorld[side].copy(leg.foot.getWorldPosition(this.tmpV1));
        }

        // 先处理落地边沿与预测刷新，再算目标（对侧预测依赖本帧新落点）。
        for (const side of ["left", "right"] as const) {
            this.syncPredictivePlant(side, vx, vz, delta);
        }

        for (const side of ["left", "right"] as const) {
            this.applyPredictiveFootTarget(side, delta);
        }
    }

    /** 落地边沿记落点，短时硬锁，并刷新该脚下一步预测位置。 */
    private syncPredictivePlant(side: FootIKSide, velocityX: number, velocityZ: number, delta: number): void {
        const leg = this.legs[side];
        if (!isReadyLeg(leg)) return;

        const capsule = this.player?.playerCapsule;
        if (!capsule) return;

        const state = this.predictiveFeet[side];
        const phase = this.footPhaseState[side];
        const planted = !!phase?.planted;
        const animFoot = this.animFootWorld[side];

        if (planted && !state.wasPlanted) {
            const hit = this.castGroundAtSample(animFoot);
            const actual = this.tmpV2.copy(animFoot);
            if (hit) {
                actual.copy(hit.point);
                actual.y += this.soleSkinThickness;
            }
            recordPlantOnLand(
                state,
                actual,
                capsule.position,
                this.plantSnapEpsilon,
                this.plantLockDuration,
                this.tmpV3,
            );
            state.pathPoints.length = 0;
        }

        state.wasPlanted = planted;
        tickPlantLock(state, {
            planted,
            animFootWorld: animFoot,
            delta,
            unlockLift: this.plantUnlockLift,
            unlockHoriz: this.plantUnlockHoriz,
        });

        if (!state.hasPlant) return;

        // 硬锁期间预测点钉在落点；其余时间用 Actor 局部锚点 + 剩余时间外推
        const timeToLand = state.locked ? 0 : (phase?.timeToLand ?? 0);
        predictPlantWorld(
            state,
            capsule.position,
            velocityX,
            velocityZ,
            timeToLand,
            (x, y, z) => this.castGroundFrom(x, y, z),
            this.sampleRayOriginY,
            this.soleSkinThickness,
            this.plantAnchorWorld,
            state.predictedWorld,
        );

        if (state.locked) {
            state.predictedWorld.copy(state.lockedPlantWorld);
        }
    }

    /** 根据相位采样 FootPath 或锁定落点，写出 leg.smoothedTarget。 */
    /** 根据相位采样 FootPath 或锁定落点，写出 leg.smoothedTarget。 */
    private applyPredictiveFootTarget(side: FootIKSide, delta: number): void {
        const leg = this.legs[side];
        if (!isReadyLeg(leg)) return;

        const state = this.predictiveFeet[side];
        const phase = this.footPhaseState[side];
        const animFoot = this.animFootWorld[side];

        // 尚无落点：回退反应式单脚逻辑
        if (!state.hasPlant) {
            this.updateFoot(side, delta, true);
            return;
        }

        const planted = !!phase?.planted;
        leg.planted = planted;

        // 穿透兜底：始终检测
        const hit = this.castBestFootGround(leg, animFoot);
        if (hit) {
            this.getWorldHitNormal(hit, leg.hitNormal);
            leg.hitPoint.copy(hit.point);
        }

        if (this.hasFootHitAboveCapsuleBottom(leg)) {
            leg.weight = 0;
            leg.plantedWeight = 0;
            leg.offsetY = 0;
            leg.movePenetrating = false;
            leg.smoothedTarget.copy(animFoot);
            this.updateFootDebug(leg, leg.footSamplePoint, hit?.point ?? animFoot);
            return;
        }

        const liftAmount = this.getMovePenetrationLift(leg);
        leg.movePenetrating = liftAmount > this.moveLiftThreshold;

        const wantedPlantedWeight = planted || state.locked ? 1 : 0;
        leg.plantedWeight = MathUtils.damp(leg.plantedWeight ?? 0, wantedPlantedWeight, 18, delta);

        // 预测模式：只要有落点记录就全力解 IK，否则脚跟不上橙球目标
        leg.weight = 1;

        const target = this.tmpV2.copy(animFoot);

        if (state.locked) {
            // 落地短窗口：钉在世界落点
            target.copy(state.lockedPlantWorld);
            target.y += liftAmount;
            this.followPredictiveTarget(leg, target, predictiveTargetDamp(1, true, true), delta);
            state.pathSample.copy(leg.smoothedTarget);
        } else if (planted) {
            // 支撑：水平/高度跟动画，仅防穿地抬升——保留原动画抬脚，不被落点压扁
            target.copy(animFoot);
            if (hit) {
                const groundY = hit.point.y + this.soleSkinThickness;
                if (target.y < groundY) target.y = groundY;
            }
            target.y += liftAmount;
            this.followPredictiveTarget(leg, target, predictiveTargetDamp(1, true, false), delta);
            state.pathSample.copy(leg.smoothedTarget);
        } else {
            const progress = MathUtils.clamp(phase?.progress ?? 0, 0, 1);
            const plant = state.lastPlantWorld;
            const predict = state.predictedWorld;

            buildFootPath(
                plant,
                predict,
                {
                    iterations: this.footPathIterations,
                    castGround: (x, y, z) => this.castGroundFrom(x, y, z),
                    probeHeight: this.sampleRayOriginY * 0.35,
                    soleOffset: this.soleSkinThickness,
                    midLift: this.pathMidLift,
                    bumpEpsilon: this.pathBumpEpsilon,
                    arcSegments: Math.max(8, this.footPathIterations + 4),
                },
                state.pathPoints,
            );

            sampleFootPath(state.pathPoints, progress, state.pathSample);

            // 严格跟 FootPath 采样点；仅落地末段收束到预测落点
            const landPull = MathUtils.smoothstep(0.85, 1, progress);
            target.copy(state.pathSample);
            target.lerp(predict, landPull);
            target.y += liftAmount;
            // 无阻尼：IK 目标每帧等于线路点，避免脚在蓝线下方拖行
            leg.smoothedTarget.copy(target);
        }

        leg.offsetY = (leg.smoothedTarget.y - animFoot.y) * leg.weight;
        // 橙/青球改在 applyLeg 之后贴脚骨；这里只更新射线参考
        if (this.debug) {
            const hitPt = hit?.point ?? leg.smoothedTarget;
            if (leg.rayLine) {
                leg.rayLine.visible = true;
                leg.rayLine.geometry.setFromPoints([animFoot, hitPt]);
            }
        }
    }

    /** 让 smoothedTarget 快速跟上预测目标，减少脚与调试橙球脱节。 */
    private followPredictiveTarget(
        leg: FootIKLeg,
        target: Vector3,
        damp: number,
        delta: number,
    ): void {
        leg.smoothedTarget.x = MathUtils.damp(leg.smoothedTarget.x, target.x, damp, delta);
        leg.smoothedTarget.y = MathUtils.damp(leg.smoothedTarget.y, target.y, damp, delta);
        leg.smoothedTarget.z = MathUtils.damp(leg.smoothedTarget.z, target.z, damp, delta);
        // 若仍落后较多则直接拉近，避免高速奔跑时目标甩在身前
        const lagSq = leg.smoothedTarget.distanceToSquared(target);
        const snapDist = this.plantUnlockHoriz * 0.35;
        if (lagSq > snapDist * snapDist) {
            leg.smoothedTarget.lerp(target, 0.65);
        }
    }

    /** 预测模式：由较低脚反推骨盆高度，弹簧平滑。 */
    private applyPelvisRebuild(delta: number): void {
        if (!this.hips) return;

        const leftLeg = this.legs.left;
        const rightLeg = this.legs.right;
        if (!isReadyLeg(leftLeg) || !isReadyLeg(rightLeg)) return;

        const hipsWorldY = this.hips.getWorldPosition(this.tmpV1).y;
        const wantedWorldOffset = computePelvisRebuildOffset({
            leftFootY: leftLeg.smoothedTarget.y,
            rightFootY: rightLeg.smoothedTarget.y,
            animLeftFootY: this.animFootWorld.left.y,
            animRightFootY: this.animFootWorld.right.y,
            hipsWorldY,
            stairDropUp: this.stairPelvisDropUp,
            stairDropDown: this.stairPelvisDropDown,
            stairThreshold: this.meshStepCoplanarThreshold,
            maxDrop: this.maxPelvisDrop,
            maxRaise: this.pelvisMaxRaise * 2,
        });

        this.pelvisOffset = MathUtils.damp(this.pelvisOffset, wantedWorldOffset, this.pelvisSpring, delta);
        if (Math.abs(this.pelvisOffset) < this.snapEpsilon) return;

        this.capture(this.hips);
        const parentScale = this.hips.parent?.getWorldScale(this.tmpV1).y || 1;
        this.hips.position.y += this.pelvisOffset / parentScale;
        this.hips.updateMatrixWorld(true);
    }

    // 对一只脚的四个虚拟脚底点分别向下射线，选择命中高度最高的点作为本帧调试/法线参考。
    private castBestFootGround(
        leg: ReadyFootIKLeg,
        footWorld: Vector3,
        samples: FootIKProbeSample[] = leg.soleSamples,
        footSamplePoint: Vector3 | null = leg.footSamplePoint,
    ): Intersection<Object3D> | null {
        this.updateSoleSamples(leg, footWorld, samples, footSamplePoint);

        let bestHit: Intersection<Object3D> | null = null;
        for (const sample of samples) {
            sample.hasHit = false;
            const hit = this.castGroundAtSample(sample.point);
            if (!hit) continue;
            sample.hasHit = true;
            sample.hitPoint.copy(hit.point);
            if (!bestHit || hit.point.y > bestHit.point.y) {
                bestHit = hit;
                footSamplePoint?.copy(sample.point);
            }
        }

        return bestHit;
    }

    // 基于初始化姿态，把脚底四个采样点固定到 foot 骨骼本地空间。
    private initSoleLocalSamples(leg: FootIKLeg): void {
        if (!isReadyLeg(leg)) return;

        const footWorld = leg.foot.getWorldPosition(this.tmpV1);
        const toeWorld = leg.toe
            ? leg.toe.getWorldPosition(this.tmpV2)
            : this.tmpV2.copy(footWorld).add(this.tmpV3.set(0, 0, 1).applyQuaternion(leg.foot.getWorldQuaternion(this.tmpQ1)).setY(0).normalize().multiplyScalar(this.fakeToeExtend));

        const forward = this.tmpV3.copy(toeWorld).sub(footWorld).setY(0);
        if (forward.lengthSq() < 0.0001) {
            forward.set(0, 0, 1).applyQuaternion(leg.foot.getWorldQuaternion(this.tmpQ1)).setY(0);
        }
        forward.normalize();

        const side = this.tmpV4.crossVectors(forward, this.up).normalize();
        const heelCenter = this.tmpV5.copy(footWorld).addScaledVector(forward, -this.soleHeelExtend);
        const toeCenter = this.tmpV2.copy(toeWorld).addScaledVector(forward, this.soleToeExtend);

        heelCenter.y = toeCenter.y;

        leg.foot.updateMatrixWorld(true);
        const samples = leg.soleSamples;
        samples[0].point.copy(heelCenter).addScaledVector(side, this.soleHalfWidth);
        samples[1].point.copy(heelCenter).addScaledVector(side, -this.soleHalfWidth);
        samples[2].point.copy(toeCenter).addScaledVector(side, this.soleHalfWidth);
        samples[3].point.copy(toeCenter).addScaledVector(side, -this.soleHalfWidth);

        for (const sample of samples) {
            sample.local.copy(sample.point);
            leg.foot.worldToLocal(sample.local);
        }
        leg.footSamplePoint.copy(heelCenter);
    }

    // 把 foot-local 脚底四点转换到世界空间，供射线、穿透检测和调试使用。
    private updateSoleSamples(
        leg: FootIKLeg,
        _footWorld: Vector3,
        samples: FootIKProbeSample[] = leg.soleSamples,
        footSamplePoint: Vector3 | null = leg.footSamplePoint,
    ): void {
        if (!isReadyLeg(leg)) return;

        leg.foot.updateMatrixWorld(true);
        const sourceSamples = leg.soleSamples;
        const count = Math.min(samples.length, sourceSamples.length);
        for (let i = 0; i < count; i++) {
            samples[i].point.copy(sourceSamples[i].local).applyMatrix4(leg.foot.matrixWorld);
        }

        if (footSamplePoint && samples.length >= 2) {
            footSamplePoint.copy(samples[0].point).add(samples[1].point).multiplyScalar(0.5);
        }
    }

    // 统一穿透检测：四个脚底采样点中，只要 sample.y 低于对应地面 y，就取最大上抬量。
    private getMovePenetrationLift(leg: ReadyFootIKLeg): number {
        let lift = 0;
        for (const sample of leg.soleSamples) {
            if (!sample.hasHit) continue;

            const penetration = sample.hitPoint.y - sample.point.y;
            if (penetration > this.moveLiftThreshold) {
                lift = Math.max(lift, penetration);
            }
        }

        return lift;
    }

    // 计算胶囊下端球心的世界高度，用于判断碰撞体是否已越过台阶。
    private getCapsuleSupportY(): number {
        const capsule = this.player?.playerCapsule;
        const info = capsule?.capsuleInfo;
        if (!capsule || !info?.segment) return NaN;

        capsule.updateMatrixWorld();
        const start = this.tmpV2.copy(info.segment.start).applyMatrix4(capsule.matrixWorld);
        const end = this.tmpV3.copy(info.segment.end).applyMatrix4(capsule.matrixWorld);
        return Math.min(start.y, end.y);
    }

    // 任意脚底采样交点高过胶囊支撑高度时，本帧这条腿不做脚 IK。
    private hasFootHitAboveCapsuleBottom(leg: ReadyFootIKLeg): boolean {
        const capsuleSupportY = this.getCapsuleSupportY();
        if (!Number.isFinite(capsuleSupportY)) return false;

        for (const sample of leg.soleSamples) {
            if (sample.hasHit && sample.hitPoint.y > capsuleSupportY) return true;
        }
        return false;
    }

    // 当胶囊支撑高度与双脚地面不一致时，用 mesh 做视觉台阶补偿：
    // - 双脚同平面且高于胶囊 → 上抬 mesh，避免只抬脚导致深蹲
    // - 脚地面低于胶囊 → 下拽 mesh（胶囊已上台阶、脚还在低处）
    // strength：预测模式下缩小限幅，避免与盆骨重建抢高度。
    private applyMeshStepOffset(delta: number, strength = 1): void {
        const model = this.player?.playerModel;
        const capsule = this.player?.playerCapsule;
        if (!model || !capsule) return;

        // 胶囊中心向下射线代表 碰撞体站在哪个高度。
        const capsuleHit = this.castCapsuleGround();
        if (!capsuleHit) {
            this.resetMeshStepOffset(delta);
            return;
        }

        // 左右脚各自向下射线，得到各自支撑高度。
        let leftGroundY = NaN;
        let rightGroundY = NaN;
        for (const side of ["left", "right"] as const) {
            const leg = this.legs[side];
            if (!isReadyLeg(leg)) continue;

            const footWorld = leg.foot.getWorldPosition(this.tmpV1);
            const footHit = this.castBestFootGround(
                leg,
                footWorld,
                this.meshStepProbeSamples,
                null,
            );
            if (!footHit) continue;
            if (side === "left") leftGroundY = footHit.point.y;
            else rightGroundY = footHit.point.y;
        }

        if (!Number.isFinite(leftGroundY) || !Number.isFinite(rightGroundY)) {
            // 单帧射线偶发未命中时保持上一帧偏移，避免呼吸微动把 mesh 拽来拽去。
            return;
        }

        const capsuleGroundY = capsuleHit.point.y;
        const supportY = Math.min(leftGroundY, rightGroundY);
        const planeDelta = Math.abs(leftGroundY - rightGroundY);
        const heightDelta = supportY - capsuleGroundY;
        const scale = MathUtils.clamp(strength, 0, 1);

        let wantedOffset = 0;
        if (
            planeDelta <= this.meshStepCoplanarThreshold
            && heightDelta > this.meshStepEpsilon
        ) {
            // 双脚近似同平面且明显高于胶囊地面：抬 mesh 对齐支撑面，站直。
            wantedOffset = MathUtils.clamp(heightDelta, 0, this.maxMeshStepRaise) * scale;
        } else if (heightDelta < -this.meshStepEpsilon) {
            // 有脚还在更低地面：下拽 mesh（分平面时也按较低脚处理）。
            wantedOffset = MathUtils.clamp(heightDelta, -this.maxMeshStepDrop, 0) * scale;
        }

        this.setMeshStepOffset(wantedOffset, delta);
    }

    // 平滑设置人物 mesh 相对胶囊的台阶视觉偏移。
    private setMeshStepOffset(wantedOffset: number, delta: number): void {
        const model = this.player?.playerModel;
        if (!model) return;

        const speed = 10;

        this.meshStepOffsetY = MathUtils.damp(this.meshStepOffsetY, wantedOffset, speed, delta);
        if (Math.abs(this.meshStepOffsetY) < this.snapEpsilon) this.meshStepOffsetY = 0;

        model.position.y = this.meshBaseY + this.meshStepOffsetY;
        model.updateMatrixWorld(true);
    }

    // 离地、没有命中地面，或不需要台阶补偿时，让 mesh 回到胶囊下的基准位置。
    private resetMeshStepOffset(delta: number): void {
        this.setMeshStepOffset(0, delta);
    }

    // 立即恢复人物 mesh 的基准高度，用于停用和卸载。
    private resetMeshStepOffsetImmediately(): void {
        const model = this.player?.playerModel;
        this.meshStepOffsetY = 0;
        if (!model) return;
        model.position.y = this.meshBaseY;
        model.updateMatrixWorld(true);
    }

    // 判断当前动画是否属于移动类动画。
    private isLocomotion(): boolean {
        const name = this.player?.animation.state?.getClip().name ?? "";
        return this.isLocomotionClipName(name);
    }

    // 统一判断脚步相位采样和运行时移动状态：直接使用 playerModelConfig 中的移动动画名。
    private isLocomotionClipName(name: string): boolean {
        if (!name) return false;
        const config = this.player?.playerModelConfig;
        if (!config) return false;
        return [
            config.walkAnim,
            config.runAnim,
            config.leftWalkAnim,
            config.rightWalkAnim,
            config.backwardAnim,
        ].filter((value): value is string => !!value).includes(name);
    }

    // 从骨骼采样点上方发射射线。
    private castGroundAtSample(sampleWorld: Vector3): Intersection<Object3D> | null {
        return this.castGroundFrom(sampleWorld.x, sampleWorld.y + this.sampleRayOriginY, sampleWorld.z);
    }

    // 从胶囊中心向下检测当前碰撞体真正支撑在哪个地面高度。
    private castCapsuleGround(): Intersection<Object3D> | null {
        const capsule = this.player?.playerCapsule;
        if (!capsule) return null;
        return this.castGroundFrom(capsule.position.x, capsule.position.y, capsule.position.z);
    }

    // 从指定世界坐标向下射线检测可踩踏地面。
    private castGroundFrom(x: number, y: number, z: number): Intersection<Object3D> | null {
        const collider = this.player?.collider;
        if (!collider) return null;
        this.raycaster.ray.origin.set(x, y, z);
        const hits = this.raycaster.intersectObject(collider, false);
        return hits.find(hit => this.getWorldHitNormal(hit, this.tmpV3).y > 0.18) ?? null;
    }

    // 将射线命中的局部法线转换为世界空间法线。
    private getWorldHitNormal(hit: Intersection<Object3D>, target: Vector3): Vector3 {
        target.copy(hit.face?.normal ?? this.up);
        this.normalMatrix.getNormalMatrix(hit.object.matrixWorld);
        target.applyMatrix3(this.normalMatrix).normalize();
        return target;
    }

    // 根据双脚高度差对骨盆做平滑补偿。
    private applyPelvis(delta: number): void {
        if (!this.hips) return;

        // 如果某只脚目标比动画脚低很多，只拉脚会导致腿被过度拉长。
        // 骨盆向下补偿一部分，让两条腿都有空间够到目标。
        const left = this.legs.left.offsetY;
        const right = this.legs.right.offsetY;
        const leftW = this.legs.left.weight;
        const rightW = this.legs.right.weight;
        const wantedWorldOffset = MathUtils.clamp(
            Math.min(left * leftW, right * rightW),
            -this.maxPelvisDrop,
            this.pelvisMaxRaise,
        );

        this.pelvisOffset = MathUtils.damp(this.pelvisOffset, wantedWorldOffset, 12, delta);
        if (Math.abs(this.pelvisOffset) < this.snapEpsilon) return;

        this.capture(this.hips);
        const parentScale = this.hips.parent?.getWorldScale(this.tmpV1).y || 1;
        this.hips.position.y += this.pelvisOffset / parentScale;
        this.hips.updateMatrixWorld(true);
    }

    // 对指定腿执行 IK 求解并贴合脚掌。
    private applyLeg(side: FootIKSide, useStraightPole: boolean): void {
        const leg = this.legs[side];
        if (!isReadyLeg(leg) || leg.weight <= 0.001) return;

        // 保存动画给出的 foot 世界旋转，解腿后再按权重恢复，最后只叠加少量贴地旋转。
        this.savedFootWorldQ.copy(leg.foot.getWorldQuaternion(this.tmpQ1));

        // 穿透修正
        this.solveLeg(leg, leg.smoothedTarget, leg.weight, useStraightPole);
        this.preserveFootWorldRotation(leg, this.savedFootWorldQ, leg.weight);
        this.alignFootToGround(leg);
        this.correctPostAlignSoleContact(leg, useStraightPole);

        // 腿色球贴在解算后的脚骨上（不是 IK 目标）；目标用预测黄线表示
        if (this.debug && leg.marker) {
            leg.marker.visible = true;
            leg.foot.getWorldPosition(leg.marker.position);
        }
    }

    /** 预测模式下腿色球始终对齐脚骨世界位置。 */
    private syncFootBoneDebugMarkers(): void {
        if (!this.debug) return;
        for (const side of ["left", "right"] as const) {
            const leg = this.legs[side];
            if (!leg.marker || !isReadyLeg(leg)) continue;
            leg.marker.visible = true;
            leg.foot.getWorldPosition(leg.marker.position);
        }
    }

    // 抵消腿部 IK 对 foot 子骨骼造成的被动旋转，保留动画本来的脚掌朝向。
    private preserveFootWorldRotation(
        leg: ReadyFootIKLeg,
        animatedWorldQ: Quaternion,
        weight: number,
    ): void {
        this.capture(leg.foot);

        const currentWorldQ = leg.foot.getWorldQuaternion(this.tmpQ1);
        currentWorldQ.slerp(animatedWorldQ, MathUtils.clamp(weight, 0, 1));

        const parentWorldQ = leg.foot.parent?.getWorldQuaternion(this.tmpQ2);
        if (!parentWorldQ) return;
        leg.foot.quaternion.copy(parentWorldQ.invert().multiply(currentWorldQ));
        leg.foot.updateMatrixWorld(true);
    }

    // 使用受约束的双骨骼 IK，让脚靠近目标点。
    private solveLeg(
        leg: ReadyFootIKLeg,
        target: Vector3,
        weight: number,
        useStraightPole = false,
    ): void {
        let kneePlaneNormal: Vector3 | undefined;
        if (useStraightPole) {
            // 移动时用胶囊局部 +X 作为角色前后平面的法线。
            // 静止时不传此约束，让 IK 保留 idle 动画本身的膝盖 pole。
            const capsule = this.player?.playerCapsule;
            if (!capsule) return;
            kneePlaneNormal = this.tmpV4
                .set(1, 0, 0)
                .applyQuaternion(capsule.getWorldQuaternion(this.tmpQ3))
                .normalize();
        }

        solveTwoBoneIK(leg, target, weight, {
            capture: bone => this.capture(bone),
            minKneeBend: this.minKneeBend,
            maxKneeBend: this.maxKneeBend,
            kneePlaneNormal,
            scratch: this.twoBoneIKScratch,
        });
    }

    // 脚掌贴坡会绕 foot 骨骼旋转，旋转后重新校正脚底接触。
    private correctPostAlignSoleContact(
        leg: ReadyFootIKLeg,
        useStraightPole: boolean,
    ): void {
        if (leg.weight <= 0.001) return;

        const footWorld = leg.foot.getWorldPosition(this.tmpV1);
        this.updateSoleSamples(leg, footWorld);

        let contactOffset = -Infinity;
        let anyHit = false;
        for (const sample of leg.soleSamples) {
            sample.hasHit = false;
            const hit = this.castGroundAtSample(sample.point);
            if (!hit) continue;

            sample.hasHit = true;
            sample.hitPoint.copy(hit.point);
            anyHit = true;
            const offset = hit.point.y - sample.point.y;
            contactOffset = Math.max(contactOffset, offset);
        }

        if (!anyHit) return;

        // 补偿脚骨到鞋底蒙皮的厚度；平地接近满值，斜坡按法线衰减以免抬得过高。
        const slopeContactWeight = MathUtils.clamp(leg.hitNormal.y, 0, 1);
        contactOffset += this.soleSkinThickness * slopeContactWeight;
        if (Math.abs(contactOffset) <= this.snapEpsilon) return;

        this.savedAlignedFootWorldQ.copy(leg.foot.getWorldQuaternion(this.tmpQ1));
        const correctedTarget = this.tmpV2.copy(footWorld).addScaledVector(this.up, contactOffset);

        this.solveLeg(leg, correctedTarget, leg.weight, useStraightPole);
        this.preserveFootWorldRotation(leg, this.savedAlignedFootWorldQ, 1);
    }

    // 根据地面法线轻微调整脚掌朝向。
    private alignFootToGround(leg: ReadyFootIKLeg): void {
        // 脚掌贴坡：把脚的 up 方向部分旋到地面法线。
        // 用最大角度限制避免台阶边缘的法线让脚踝扭得过夸张。
        if (leg.hitNormal.y < 0.35 || leg.weight <= 0.001) return;
        this.capture(leg.foot);

        const footWorldQ = leg.foot.getWorldQuaternion(this.tmpQ1);
        const alignQ = this.tmpQ2.setFromUnitVectors(this.up, leg.hitNormal);

        const maxTilt = this.maxFootTilt;
        const realAngle = 2 * Math.acos(MathUtils.clamp(alignQ.w, -1, 1));
        if (realAngle > maxTilt) {
            alignQ.slerp(this.identityQ, 1 - maxTilt / realAngle);
        }
        alignQ.slerp(this.identityQ, 1 - leg.weight * this.footAlignWeight);

        const targetWorldQ = alignQ.multiply(footWorldQ);
        const parentWorldQ = leg.foot.parent?.getWorldQuaternion(this.tmpQ3);
        if (!parentWorldQ) return;
        leg.foot.quaternion.copy(parentWorldQ.invert().multiply(targetWorldQ));
        leg.foot.updateMatrixWorld(true);
    }

    // 保存骨骼原始姿态，便于下一帧恢复。
    private capture(bone: Object3D): void {
        // 第一次修改骨骼前保存原姿态，下一帧 restore 会用它恢复。
        if (this.adjusted.has(bone)) return;
        let pose = this.poseCache.get(bone);
        if (!pose) {
            pose = {
                position: new Vector3(),
                quaternion: new Quaternion(),
            };
            this.poseCache.set(bone, pose);
        }
        pose.position.copy(bone.position);
        pose.quaternion.copy(bone.quaternion);
        this.adjusted.add(bone);
    }

    // 创建调试用的脚目标标记和射线线段。
    private createDebugObjects(): void {
        createDebugObjects(this.player?.scene ?? null, this.legs, this.debug);
        this.createPredictiveDebugObjects();
    }

    private createPredictiveDebugObjects(): void {
        createPredictiveDebugObjects(
            this.player?.scene ?? null,
            this.predictiveDebug,
            this.debug && this.predictive,
        );
    }

    private updatePredictiveDebugObjects(): void {
        if (!this.debug || !this.predictive) {
            setPredictiveDebugVisible(this.predictiveDebug, false);
            return;
        }
        this.createPredictiveDebugObjects();
        updatePredictiveDebug(
            this.debug,
            true,
            this.predictiveDebug,
            this.predictiveFeet,
            {
                left: this.legs.left.smoothedTarget,
                right: this.legs.right.smoothedTarget,
            },
        );
    }

    private setPredictiveDebugVisible(visible: boolean): void {
        setPredictiveDebugVisible(this.predictiveDebug, visible);
    }

    // 更新单只脚的调试标记和检测线位置。
    private updateFootDebug(leg: FootIKLeg, footWorld: Vector3, hitPoint: Vector3): void {
        updateFootDebug(this.debug, leg, footWorld, hitPoint);
    }

    // 统一切换腿部 IK 调试对象的显示状态。
    private setDebugVisible(visible: boolean): void {
        setDebugVisible(this.legs, visible);
        if (!visible) this.setPredictiveDebugVisible(false);
    }

    // 按需创建跟随 foot 骨骼的脚底本地采样点调试对象。
    private createSoleSampleDebugObjects(): void {
        createSoleSampleDebugObjects(this.player?.scene ?? null, this.legs, this.soleSampleDebug);
    }

    // 更新左右脚采样点和对应射线的调试显示。
    private updateSoleSampleDebug(): void {
        updateSoleSampleDebugObjects(
            this.soleSampleDebug,
            this.player?.scene ?? null,
            this.legs,
            (leg, footWorld, samples, footSamplePoint) => {
                this.updateSoleSamples(leg, footWorld, samples, footSamplePoint);
            },
            this.tmpV1,
        );
    }

    // 统一切换脚底本地采样调试对象的显示状态。
    private setSoleSampleDebugVisible(visible: boolean): void {
        setSoleSampleDebugVisible(this.legs, visible);
    }

    /** 控制脚部 IK 目标和检测射线等调试对象的显隐。 */
    setDebugEnabled(enabled: boolean): void {
        if (this.disposed) return;
        this.debug = enabled;
        if (enabled) {
            this.createDebugObjects();
            this.createPredictiveDebugObjects();
        }
        this.setDebugVisible(enabled);
        if (enabled && this.predictive) {
            this.setPredictiveDebugVisible(true);
        } else {
            this.setPredictiveDebugVisible(false);
        }
    }

    /** 控制四个 foot-local 脚底采样点调试对象的显隐。 */
    setSoleSampleDebugEnabled(enabled: boolean): void {
        if (this.disposed) return;
        this.soleSampleDebug = enabled;
        if (enabled) {
            this.createSoleSampleDebugObjects();
        }
        this.setSoleSampleDebugVisible(enabled);
    }

    /** 读取当前可调配置（不含 skeleton）。距离类参数返回 scale=1 基准值。 */
    getOptions(): Required<Omit<FootIKOptions, "skeleton">> {
        return {
            enabled: this.enabled,
            debug: this.debug,
            soleSampleDebug: this.soleSampleDebug,
            predictive: this.predictive,
            maxPelvisDrop: this.toBaseDistance(this.maxPelvisDrop),
            soleHalfWidth: this.toBaseDistance(this.soleHalfWidth),
            soleToeExtend: this.toBaseDistance(this.soleToeExtend),
            soleHeelExtend: this.toBaseDistance(this.soleHeelExtend),
            soleSkinThickness: this.toBaseDistance(this.soleSkinThickness),
            footAlignWeight: this.footAlignWeight,
            maxFootTilt: this.maxFootTilt,
            minKneeBend: this.minKneeBend,
            maxKneeBend: this.maxKneeBend,
            moveLiftThreshold: this.toBaseDistance(this.moveLiftThreshold),
            maxMeshStepDrop: this.toBaseDistance(this.maxMeshStepDrop),
            maxMeshStepRaise: this.toBaseDistance(this.maxMeshStepRaise),
            meshStepCoplanarThreshold: this.toBaseDistance(this.meshStepCoplanarThreshold),
            footPhaseSampleCount: this.footPhaseOptions.sampleCount,
            footPhaseGroundThreshold: this.toBaseDistance(this.footPhaseGroundThreshold),
            footPhaseMinContactRatio: this.footPhaseOptions.minContactRatio,
            footPhaseSpeedSlack: this.footPhaseOptions.speedSlack,
            plantSnapEpsilon: this.toBaseDistance(this.plantSnapEpsilon),
            plantLockDuration: this.plantLockDuration,
            plantUnlockLift: this.toBaseDistance(this.plantUnlockLift),
            plantUnlockHoriz: this.toBaseDistance(this.plantUnlockHoriz),
            footPathIterations: this.footPathIterations,
            predictiveLandingGrace: this.predictiveLandingGrace,
            pelvisSpring: this.pelvisSpring,
            pathMidLift: this.toBaseDistance(this.pathMidLift),
            animLiftScaleOnSlope: this.animLiftScaleOnSlope,
            stairPelvisDropUp: this.toBaseDistance(this.stairPelvisDropUp),
            stairPelvisDropDown: this.toBaseDistance(this.stairPelvisDropDown),
            meshStepPredictiveScale: this.meshStepPredictiveScale,
        };
    }

    /**
     * 运行时更新部分配置。
     * 距离类参数传入 scale=1 基准值，内部会乘以当前 playerModelConfig.scale。
     * sole 尺寸变化会重建本地采样点，脚步相位相关参数变化会重建相位库。
     */
    configure(options: Partial<FootIKOptions>): void {
        if (this.disposed) return;

        if (options.enabled !== undefined) this.setEnabled(options.enabled);
        if (options.debug !== undefined) this.setDebugEnabled(options.debug);
        if (options.soleSampleDebug !== undefined) this.setSoleSampleDebugEnabled(options.soleSampleDebug);
        if (options.predictive !== undefined) this.setPredictiveEnabled(options.predictive);

        let soleDirty = false;
        let phaseDirty = false;

        if (options.maxPelvisDrop !== undefined) {
            this.maxPelvisDrop = this.scaleDistance(options.maxPelvisDrop);
        }
        if (options.soleHalfWidth !== undefined) {
            this.soleHalfWidth = this.scaleDistance(options.soleHalfWidth);
            soleDirty = true;
        }
        if (options.soleToeExtend !== undefined) {
            this.soleToeExtend = this.scaleDistance(options.soleToeExtend);
            soleDirty = true;
        }
        if (options.soleHeelExtend !== undefined) {
            this.soleHeelExtend = this.scaleDistance(options.soleHeelExtend);
            soleDirty = true;
        }
        if (options.soleSkinThickness !== undefined) {
            this.soleSkinThickness = this.scaleDistance(options.soleSkinThickness);
        }
        if (options.footAlignWeight !== undefined) {
            this.footAlignWeight = MathUtils.clamp(options.footAlignWeight, 0, 1);
        }
        if (options.maxFootTilt !== undefined) {
            this.maxFootTilt = MathUtils.clamp(options.maxFootTilt, 0, Math.PI);
        }
        if (options.minKneeBend !== undefined || options.maxKneeBend !== undefined) {
            const minBend = MathUtils.clamp(options.minKneeBend ?? this.minKneeBend, 0, Math.PI);
            const maxBend = MathUtils.clamp(options.maxKneeBend ?? this.maxKneeBend, 0, Math.PI);
            this.minKneeBend = Math.min(minBend, maxBend);
            this.maxKneeBend = Math.max(minBend, maxBend);
        }
        if (options.moveLiftThreshold !== undefined) {
            this.moveLiftThreshold = this.scaleDistance(options.moveLiftThreshold);
        }
        if (options.maxMeshStepDrop !== undefined) {
            this.maxMeshStepDrop = this.scaleDistance(options.maxMeshStepDrop);
        }
        if (options.maxMeshStepRaise !== undefined) {
            this.maxMeshStepRaise = this.scaleDistance(options.maxMeshStepRaise);
        }
        if (options.meshStepCoplanarThreshold !== undefined) {
            this.meshStepCoplanarThreshold = this.scaleDistance(options.meshStepCoplanarThreshold);
        }
        if (options.footPhaseGroundThreshold !== undefined) {
            this.footPhaseGroundThreshold = this.scaleDistance(options.footPhaseGroundThreshold);
            this.footPhaseOptions.groundThreshold = this.footPhaseGroundThreshold;
            phaseDirty = true;
        }
        if (options.plantSnapEpsilon !== undefined) {
            this.plantSnapEpsilon = this.scaleDistance(options.plantSnapEpsilon);
        }
        if (options.plantLockDuration !== undefined) {
            this.plantLockDuration = Math.max(0, options.plantLockDuration);
        }
        if (options.plantUnlockLift !== undefined) {
            this.plantUnlockLift = this.scaleDistance(options.plantUnlockLift);
        }
        if (options.plantUnlockHoriz !== undefined) {
            this.plantUnlockHoriz = this.scaleDistance(options.plantUnlockHoriz);
        }
        if (options.footPathIterations !== undefined) {
            this.footPathIterations = Math.max(1, Math.floor(options.footPathIterations));
        }
        if (options.predictiveLandingGrace !== undefined) {
            this.predictiveLandingGrace = Math.max(0, options.predictiveLandingGrace);
        }
        if (options.pelvisSpring !== undefined) {
            this.pelvisSpring = Math.max(0.1, options.pelvisSpring);
        }
        if (options.pathMidLift !== undefined) {
            this.pathMidLift = this.scaleDistance(options.pathMidLift);
        }
        if (options.animLiftScaleOnSlope !== undefined) {
            this.animLiftScaleOnSlope = MathUtils.clamp(options.animLiftScaleOnSlope, 0, 1);
        }
        if (options.stairPelvisDropUp !== undefined) {
            this.stairPelvisDropUp = this.scaleDistance(options.stairPelvisDropUp);
        }
        if (options.stairPelvisDropDown !== undefined) {
            this.stairPelvisDropDown = this.scaleDistance(options.stairPelvisDropDown);
        }
        if (options.meshStepPredictiveScale !== undefined) {
            this.meshStepPredictiveScale = MathUtils.clamp(options.meshStepPredictiveScale, 0, 1);
        }

        if (
            options.footPhaseSampleCount !== undefined
            || options.footPhaseMinContactRatio !== undefined
            || options.footPhaseSpeedSlack !== undefined
        ) {
            this.footPhaseOptions = createFootPhaseOptions({
                footPhaseSampleCount: options.footPhaseSampleCount ?? this.footPhaseOptions.sampleCount,
                footPhaseGroundThreshold: this.footPhaseGroundThreshold,
                footPhaseMinContactRatio: options.footPhaseMinContactRatio ?? this.footPhaseOptions.minContactRatio,
                footPhaseSpeedSlack: options.footPhaseSpeedSlack ?? this.footPhaseOptions.speedSlack,
            });
            phaseDirty = true;
        }

        if (soleDirty) {
            this.initSoleLocalSamples(this.legs.left);
            this.initSoleLocalSamples(this.legs.right);
        }
        if (phaseDirty) {
            this.buildFootPhaseDatabase();
        }
    }

    /** 返回指定脚当前动画相位的调试文本。 */
    getFootPhaseDebugText(side: FootIKSide): string {
        const moving = this.isLocomotion();
        return getFootPhaseDebugText(
            this.footPhaseState,
            this.footPhaseClips,
            side,
            this.predictive,
            this.shouldUsePredictive(moving),
        );
    }

}
