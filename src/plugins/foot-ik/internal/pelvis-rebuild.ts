import { MathUtils } from "three";

export type PelvisRebuildInput = {
    /** 左右脚最终目标世界高度。 */
    leftFootY: number;
    rightFootY: number;
    /** 动画 Pose 中左右脚世界高度（IK 前）。 */
    animLeftFootY: number;
    animRightFootY: number;
    /** 当前骨盆世界高度。 */
    hipsWorldY: number;
    /** 上楼额外下压。 */
    stairDropUp: number;
    /** 下楼额外下压。 */
    stairDropDown: number;
    /** 判定楼梯/坡面的双脚高度差阈值。 */
    stairThreshold: number;
    maxDrop: number;
    maxRaise: number;
};

/**
 * 以较低脚为基准，用动画 Pose 中较低脚相对骨盆的偏移反推骨盆世界高度偏移。
 * 使用「简单增量」避免与 FootPath additive 形成反馈环（见预测 IK 文章 2.28 更新）。
 */
export function computePelvisRebuildOffset(input: PelvisRebuildInput): number {
    const {
        leftFootY,
        rightFootY,
        animLeftFootY,
        animRightFootY,
        hipsWorldY,
        stairDropUp,
        stairDropDown,
        stairThreshold,
        maxDrop,
        maxRaise,
    } = input;

    const lowerFootY = Math.min(leftFootY, rightFootY);
    const animLowerFootY = Math.min(animLeftFootY, animRightFootY);
    // 动画中骨盆相对较低脚的高度（通常为正）
    const animPelvisAboveFoot = hipsWorldY - animLowerFootY;
    const wantedHipsY = lowerFootY + animPelvisAboveFoot;

    let stairBias = 0;
    const footDelta = leftFootY - rightFootY;
    if (Math.abs(footDelta) > stairThreshold) {
        // 行进方向上「前方脚更高」视为上楼倾向，否则下楼
        // 无法稳定知前后脚时，按高度差符号给温和偏置：差值大则略降盆骨
        const goingUp = Math.abs(footDelta) > stairThreshold;
        if (goingUp) {
            // 较低脚是放松脚时略降，减少拉伸；下楼降更多
            const lowerIsLeft = leftFootY <= rightFootY;
            const higherY = Math.max(leftFootY, rightFootY);
            const lowerY = Math.min(leftFootY, rightFootY);
            const climb = higherY - lowerY;
            // 上坡：较高脚在前的常见情况用较小下压；下坡用较大下压
            // 用双脚中点相对「若只站低脚」的抬升比例粗分
            stairBias = climb > stairThreshold * 1.5 ? -stairDropDown : -stairDropUp;
            void lowerIsLeft;
        }
    }

    const raw = wantedHipsY - hipsWorldY + stairBias;
    return MathUtils.clamp(raw, -maxDrop, maxRaise);
}
