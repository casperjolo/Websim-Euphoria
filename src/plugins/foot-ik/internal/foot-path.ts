import { MathUtils, Vector3 } from "three";

export type FootPathBuildOptions = {
    iterations: number;
    /** 从探测高度向下打地面。 */
    castGround: (x: number, y: number, z: number) => { point: Vector3 } | null;
    /** 中点探测相对路径高度的上抬量。 */
    probeHeight: number;
    /** 脚底厚度补偿。 */
    soleOffset: number;
    /**
     * 摆腿弧线抬高（离端点越远越高）。
     * 平地也会抬起，避免 Path 整段贴地滑行。
     */
    midLift: number;
    /** 判定中点地面显著高于直线插值的阈值（保留兼容，弧线采样不再依赖插入）。 */
    bumpEpsilon: number;
    /** 弧线采样段数（端点之间的分割数），默认 8。 */
    arcSegments?: number;
};

/**
 * 以落点与预测点为端点生成 FootPath。
 * 每段水平插值后向下打地，再叠加与步幅相关的摆腿弧，避免平地 Path 贴地看不出抬脚。
 */
export function buildFootPath(
    start: Vector3,
    end: Vector3,
    options: FootPathBuildOptions,
    out: Vector3[],
): Vector3[] {
    out.length = 0;
    const segments = Math.max(2, options.arcSegments ?? Math.max(4, options.iterations + 3));
    const stride = Math.hypot(end.x - start.x, end.z - start.z);
    // 弧高：配置 midLift 与步幅比例取大；走路步幅短时比例更高，避免弧线贴地
    const strideRatio = stride < options.midLift * 4 ? 0.55 : 0.38;
    const arcHeight = Math.max(options.midLift, stride * strideRatio);

    for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const x = MathUtils.lerp(start.x, end.x, t);
        const z = MathUtils.lerp(start.z, end.z, t);
        const lineY = MathUtils.lerp(start.y, end.y, t);
        const hit = options.castGround(x, lineY + options.probeHeight, z);
        const groundY = hit ? hit.point.y + options.soleOffset : lineY;
        const arc = arcHeight * Math.sin(Math.PI * t);
        out.push(new Vector3(x, groundY + arc, z));
    }

    return out;
}

/** 沿 FootPath 按归一化进度采样（分段线性）。 */
export function sampleFootPath(points: readonly Vector3[], t: number, target: Vector3): Vector3 {
    const clamped = MathUtils.clamp(t, 0, 1);
    if (points.length === 0) return target.set(0, 0, 0);
    if (points.length === 1) return target.copy(points[0]);

    const segCount = points.length - 1;
    const f = clamped * segCount;
    const i = Math.min(Math.floor(f), segCount - 1);
    const localT = f - i;
    return target.lerpVectors(points[i], points[i + 1], localT);
}

/**
 * FootPath 相对端点直线（BasePath）的高度增量。
 * 最终脚高度 ≈ 动画脚高度 + delta（平地）。
 */
export function footPathHeightDelta(
    pathSampleY: number,
    plantY: number,
    predictY: number,
    progress: number,
): number {
    const baseY = MathUtils.lerp(plantY, predictY, MathUtils.clamp(progress, 0, 1));
    return pathSampleY - baseY;
}
