import { MathUtils, Quaternion, Vector3 } from "three";

// 创建 CCD 解算复用对象。LegIKController 每帧会反复调用 IK，复用向量/四元数可以避免频繁 GC。
export function createCCDIKScratch() {
    return {
        v1: new Vector3(),
        v2: new Vector3(),
        v3: new Vector3(),
        v4: new Vector3(),
        v5: new Vector3(),
        v6: new Vector3(),
        v7: new Vector3(),
        v8: new Vector3(),
        v9: new Vector3(),
        v10: new Vector3(),
        v11: new Vector3(),
        v12: new Vector3(),
        v13: new Vector3(),
        q1: new Quaternion(),
        q2: new Quaternion(),
        q3: new Quaternion(),
        identityQ: new Quaternion(),
    };
}

// 受膝盖角度约束的双骨骼 IK。
// leg.upper / leg.lower / leg.foot 分别对应大腿、小腿、脚；target 是 foot 希望靠近的世界坐标。
export function solveConstrainedCCD(leg, target, weight, iterations = 3, options = {}) {
    if (!leg?.upper || !leg?.lower || !leg?.foot || weight <= 0.001) return;

    const scratch = options.scratch ?? createCCDIKScratch();
    const capture = options.capture ?? (() => { }); // 修改骨骼前通知外部保存动画原姿态，下一帧 restore 会用到。
    const minBend = options.minKneeBend ?? MathUtils.degToRad(2); // 最小膝盖弯曲角，避免腿完全锁死伸直。
    const maxBend = options.maxKneeBend ?? MathUtils.degToRad(145); // 最大膝盖弯曲角，避免过度折叠。

    // restPole 是动画当前姿态给出的膝盖弯曲方向。后面会把它投影到目标链平面里，
    // 这样 IK 会尽量保留动画的膝盖朝向，而不是随机翻到另一侧。
    const restPole = getRestPole(leg, scratch);

    for (let i = 0; i < iterations; i++) {
        // 每轮都重新读世界坐标，因为上一轮旋转已经改变了骨骼矩阵。
        const hip = leg.upper.getWorldPosition(scratch.v1);
        const knee = leg.lower.getWorldPosition(scratch.v2);
        const foot = leg.foot.getWorldPosition(scratch.v3);
        const upperLen = Math.max(0.0001, hip.distanceTo(knee));
        const lowerLen = Math.max(0.0001, knee.distanceTo(foot));

        const hipToTarget = scratch.v4.copy(target).sub(hip);
        const targetDistance = hipToTarget.length();
        if (targetDistance < 0.0001) return;

        // 用膝盖最小/最大弯曲角反推 foot 能到达的距离范围。
        // target 太远会被夹到最大伸展距离，太近会被夹到最大弯曲距离，避免产生不合法膝盖角。
        const maxReach = reachFromBend(upperLen, lowerLen, minBend);
        const minReach = reachFromBend(upperLen, lowerLen, maxBend);
        const clampedDistance = MathUtils.clamp(targetDistance, minReach, maxReach);
        const clampedTarget = scratch.v5.copy(hip).addScaledVector(hipToTarget, clampedDistance / targetDistance);

        // 在 hip -> target 的链方向上，用两段骨骼长度求出 knee 所在圆的中心和半径。
        // pole 决定 knee 落在圆的哪一侧，也就是膝盖朝向。
        const chainDir = scratch.v6.copy(clampedTarget).sub(hip).normalize();
        const pole = projectPoleToChainPlane(restPole, chainDir, scratch.v7);
        const along = (upperLen * upperLen - lowerLen * lowerLen + clampedDistance * clampedDistance) / (2 * clampedDistance);
        const height = Math.sqrt(Math.max(0, upperLen * upperLen - along * along));
        const desiredKnee = scratch.v8.copy(hip).addScaledVector(chainDir, along).addScaledVector(pole, height);

        // 第一步旋转大腿，让当前 knee 靠近解析出的 desiredKnee。
        rotateBoneToward(leg.upper, leg.lower.getWorldPosition(scratch.v9), desiredKnee, weight, capture, scratch);
        leg.upper.updateMatrixWorld(true);
        leg.lower.updateMatrixWorld(true);

        // 第二步旋转小腿，让 foot 靠近被夹距后的目标点。
        rotateBoneToward(leg.lower, leg.foot.getWorldPosition(scratch.v9), clampedTarget, weight, capture, scratch);
        leg.lower.updateMatrixWorld(true);
    }
}

// 两段骨骼夹角为 bend 时，hip 到 foot 的理论距离。
function reachFromBend(upperLen, lowerLen, bend) {
    return Math.sqrt(upperLen * upperLen + lowerLen * lowerLen + 2 * upperLen * lowerLen * Math.cos(bend));
}

// 从当前动画姿态提取膝盖弯曲方向。
// 做法是把 hip->knee 投影到 hip->foot 的垂直平面上，得到“膝盖偏离腿链”的方向。
function getRestPole(leg, scratch) {
    const hip = leg.upper.getWorldPosition(scratch.v9);
    const knee = leg.lower.getWorldPosition(scratch.v10);
    const foot = leg.foot.getWorldPosition(scratch.v11);
    const restChain = scratch.v12.copy(foot).sub(hip).normalize();
    const restPole = scratch.v13.copy(knee).sub(hip).addScaledVector(restChain, -scratch.v10.copy(knee).sub(hip).dot(restChain));
    if (restPole.lengthSq() < 0.000001) restPole.set(0, 0, 1);
    return scratch.v13.normalize();
}

// 将 restPole 投影到当前目标链的垂直平面，保证 pole 与 chainDir 正交。
// 如果动画姿态接近完全伸直导致投影退化，就用世界 X/Z 轴生成一个稳定兜底方向。
function projectPoleToChainPlane(restPole, chainDir, target) {
    target.copy(restPole).addScaledVector(chainDir, -restPole.dot(chainDir));
    if (target.lengthSq() < 0.000001) {
        target.crossVectors(chainDir, new Vector3(1, 0, 0));
        if (target.lengthSq() < 0.000001) target.crossVectors(chainDir, new Vector3(0, 0, 1));
    }
    return target.normalize();
}

// 把 bone 旋转到“当前 effector 方向”对齐“目标方向”。
// deltaWorldQ 在世界空间计算，最后转换回 bone 的本地 quaternion 写入骨骼。
function rotateBoneToward(bone, effectorWorld, targetWorld, weight, capture, scratch) {
    capture(bone);

    const jointWorld = bone.getWorldPosition(scratch.v10);
    const from = scratch.v11.copy(effectorWorld).sub(jointWorld).normalize();
    const to = scratch.v12.copy(targetWorld).sub(jointWorld).normalize();
    if (from.lengthSq() < 0.0001 || to.lengthSq() < 0.0001) return;

    const deltaWorldQ = scratch.q1.setFromUnitVectors(from, to);
    // weight < 1 时只应用部分旋转，保留一部分原动画姿态。
    deltaWorldQ.slerp(scratch.identityQ, 1 - weight);

    const jointWorldQ = bone.getWorldQuaternion(scratch.q2);
    const targetWorldQ = deltaWorldQ.multiply(jointWorldQ);
    const parentWorldQ = bone.parent.getWorldQuaternion(scratch.q3);
    bone.quaternion.copy(parentWorldQ.invert().multiply(targetWorldQ));
    bone.updateMatrixWorld(true);
}
