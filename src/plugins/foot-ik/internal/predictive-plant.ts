import { MathUtils, Vector3 } from "three";
import type { PredictiveFootState } from "../types";

/** 创建单脚预测落点运行时状态。 */
export function createPredictiveFootState(): PredictiveFootState {
    return {
        lastPlantWorld: new Vector3(),
        lastPlantLocal: new Vector3(),
        predictedWorld: new Vector3(),
        lockedPlantWorld: new Vector3(),
        pathPoints: [],
        hasPlant: false,
        locked: false,
        lockRemaining: 0,
        wasPlanted: false,
        pathSample: new Vector3(),
    };
}

/** 清空预测缓存，避免模式切换或落地宽限残留脏数据。 */
export function resetPredictiveFootState(state: PredictiveFootState): void {
    state.lastPlantWorld.set(0, 0, 0);
    state.lastPlantLocal.set(0, 0, 0);
    state.predictedWorld.set(0, 0, 0);
    state.lockedPlantWorld.set(0, 0, 0);
    state.pathPoints.length = 0;
    state.hasPlant = false;
    state.locked = false;
    state.lockRemaining = 0;
    state.wasPlanted = false;
    state.pathSample.set(0, 0, 0);
}

/**
 * 在落地边沿记录落点并开启短时硬锁。
 * 同时记下相对胶囊的水平局部位移，供后续按 Actor 空间还原锚点。
 * 若实际落点与上一预测水平距离小于 snapEpsilon，则采用预测点，减少高度跳变。
 */
export function recordPlantOnLand(
    state: PredictiveFootState,
    actualPlantWorld: Vector3,
    capsuleWorld: Vector3,
    snapEpsilon: number,
    lockDuration: number,
    outPlant: Vector3,
): Vector3 {
    outPlant.copy(actualPlantWorld);
    if (state.hasPlant) {
        const dx = actualPlantWorld.x - state.predictedWorld.x;
        const dz = actualPlantWorld.z - state.predictedWorld.z;
        if (dx * dx + dz * dz <= snapEpsilon * snapEpsilon) {
            outPlant.copy(state.predictedWorld);
        }
    }
    state.lastPlantWorld.copy(outPlant);
    state.lockedPlantWorld.copy(outPlant);
    // 只存水平局部位移；高度仍以世界落点为准，预测时再向下打地
    state.lastPlantLocal.set(
        outPlant.x - capsuleWorld.x,
        0,
        outPlant.z - capsuleWorld.z,
    );
    state.hasPlant = true;
    state.locked = true;
    state.lockRemaining = Math.max(0, lockDuration);
    return outPlant;
}

export type PlantLockTickInput = {
    planted: boolean;
    animFootWorld: Vector3;
    delta: number;
    unlockLift: number;
    unlockHoriz: number;
};

/**
 * 推进短时踩下锁定：计时结束、离开 contact、或动画脚抬起/滑出则解锁。
 * 返回本帧是否仍处于硬锁。
 */
export function tickPlantLock(state: PredictiveFootState, input: PlantLockTickInput): boolean {
    if (!state.locked) return false;

    state.lockRemaining = Math.max(0, state.lockRemaining - input.delta);

    const lift = input.animFootWorld.y - state.lockedPlantWorld.y;
    const horizSq = horizontalDistanceSq(input.animFootWorld, state.lockedPlantWorld);
    const unlockHorizSq = input.unlockHoriz * input.unlockHoriz;

    if (
        !input.planted
        || state.lockRemaining <= 0
        || lift > input.unlockLift
        || horizSq > unlockHorizSq
    ) {
        state.locked = false;
        state.lockRemaining = 0;
        return false;
    }
    return true;
}

/**
 * 将落点从胶囊局部还原到当前世界锚点（随角色平移），再按剩余时间 × 水平速度外推。
 * 这样 timeToLand→0 时预测落在「当前锚点附近/脚将落地处」，而不会塌回身后的旧世界落点。
 */
export function predictPlantWorld(
    state: PredictiveFootState,
    capsuleWorld: Vector3,
    velocityX: number,
    velocityZ: number,
    timeToLand: number,
    castGround: (x: number, y: number, z: number) => { point: Vector3 } | null,
    probeOriginY: number,
    soleOffset: number,
    plantAnchorOut: Vector3,
    target: Vector3,
): Vector3 {
    // Actor 本地落点 → 当前世界锚点（跟着胶囊走）
    plantAnchorOut.set(
        capsuleWorld.x + state.lastPlantLocal.x,
        state.lastPlantWorld.y,
        capsuleWorld.z + state.lastPlantLocal.z,
    );

    const t = Number.isFinite(timeToLand) ? Math.max(0, timeToLand) : 0;
    const x = plantAnchorOut.x + velocityX * t;
    const z = plantAnchorOut.z + velocityZ * t;
    const probeY = Math.max(plantAnchorOut.y, capsuleWorld.y) + probeOriginY;
    const hit = castGround(x, probeY, z);
    if (hit) {
        target.copy(hit.point);
        target.y += soleOffset;
    } else {
        target.set(x, plantAnchorOut.y, z);
    }
    return target;
}

/** 摆腿水平：随 progress 从动画脚位混到 Path/预测落点，末段对准落点。 */
export function swingHorizontalBlend(progress: number): number {
    // 前段多保留动画水平，中后段跟 Path，落地对准预测点
    return MathUtils.smoothstep(0.2, 0.85, MathUtils.clamp(progress, 0, 1));
}

/** 预测目标跟随速度：接近落地时更快，减少脚与橙球目标脱节。 */
export function predictiveTargetDamp(progress: number, planted: boolean, locked: boolean): number {
    if (locked) return 40;
    if (planted) return 30;
    return MathUtils.lerp(22, 40, MathUtils.clamp(progress, 0, 1));
}

/** 水平距离平方。 */
export function horizontalDistanceSq(a: Vector3, b: Vector3): number {
    const dx = a.x - b.x;
    const dz = a.z - b.z;
    return dx * dx + dz * dz;
}

/** 判断双脚高度差是否达到上下坡/楼梯阈值。 */
export function isSlopeOrStair(leftY: number, rightY: number, threshold: number): boolean {
    return Math.abs(leftY - rightY) > threshold;
}

/** 平滑插值系数：下落段更快。 */
export function footPathDampSpeed(progress: number, rising: boolean): number {
    if (rising) return 14;
    return MathUtils.lerp(18, 28, MathUtils.clamp((progress - 0.45) / 0.55, 0, 1));
}
