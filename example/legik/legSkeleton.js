import { Vector3 } from "three";

// 收集模型层级下的全部骨骼。
export function collectBones(root) {
    const bones = [];
    root?.traverse(obj => {
        if (obj.isBone) bones.push(obj);
    });
    return bones;
}

// 查找常见命名里的骨盆/髋部骨骼。
export function findHips(bones) {
    return bones.find(bone => /hips|pelvis/i.test(bone.name)) ?? null;
}

// 创建单条腿的骨骼引用和 IK 运行时状态。
export function createLeg(side, bones, color, skeletonConfig = null) {
    const legConfig = skeletonConfig?.legs?.[side] ?? skeletonConfig?.[side] ?? null;
    const upper = resolveConfiguredBone(legConfig?.upper, bones, `${side}.upper`)
        ?? findBone(bones, side, "upper");
    const lower = resolveConfiguredBone(legConfig?.lower, bones, `${side}.lower`)
        ?? findBone(bones, side, "lower");
    const foot = resolveConfiguredBone(legConfig?.foot, bones, `${side}.foot`)
        ?? findBone(bones, side, "foot");
    const toe = resolveConfiguredBone(legConfig?.toe, bones, `${side}.toe`)
        ?? findBone(bones, side, "toe");

    return {
        side,
        upper,
        lower,
        foot,
        toe,
        color,
        ready: !!(upper && lower && foot),

        // IK 运行时目标和地面命中信息。
        smoothedTarget: new Vector3(),
        hitPoint: new Vector3(),
        hitNormal: new Vector3(0, 1, 0),
        footSamplePoint: new Vector3(),
        soleSamples: ["heelL", "heelR", "toeL", "toeR"].map(name => ({
            name,
            local: new Vector3(),
            point: new Vector3(),
            hitPoint: new Vector3(),
            hasHit: false,
            marker: null,
            rayLine: null,
            footMarker: null,
        })),

        // 本帧脚部目标对动画脚位的修正量，骨盆补偿会读取它。
        offsetY: 0,
        movePenetrating: false,

        // weight 为最终 IK 权重，plantedWeight 只负责支撑脚渐入/渐出。
        weight: 0,
        plantedWeight: 0,
        planted: false,

        marker: null,
        rayLine: null,

    };
}

// 优先使用外部配置的骨骼引用，并在缺失时给出提示。
export function resolveConfiguredBone(ref, bones, label, warnMissing = true) {
    if (!ref) return null;
    if (ref.isBone) return ref;
    if (typeof ref === "string") {
        const bone = bones.find(item => item.name === ref) ?? null;
        if (!bone && warnMissing) {
            console.warn(`[LegIK] 配置骨骼未找到：${label} -> "${ref}"`);
        }
        return bone;
    }
    console.warn(`[LegIK] 无效骨骼配置：${label}`, ref);
    return null;
}

// 根据左右侧和骨骼类型，从模型骨骼名中启发式匹配目标骨骼。
export function findBone(bones, side, type) {
    const candidates = bones.filter(bone => matchesSide(bone.name, side));
    const score = bone => {
        const name = compactName(bone.name);
        if (type === "upper") return Number(name.includes("upleg") || name.includes("thigh"));
        if (type === "lower") return Number((name.includes("leg") || name.includes("calf") || name.includes("shin")) && !name.includes("upleg") && !name.includes("foot"));
        if (type === "foot") return Number((name.includes("foot") || name.includes("ankle")) && !name.includes("toe"));
        if (type === "toe") return Number(name.includes("toe"));
        return 0;
    };
    return candidates
        .map(bone => ({ bone, score: score(bone) }))
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score)[0]?.bone ?? null;
}

// 判断骨骼名是否属于指定左右侧。
export function matchesSide(name, side) {
    const lower = name.toLowerCase();
    const compact = compactName(name);
    if (side === "left") return compact.includes("left") || lower.includes("_l") || lower.includes(".l") || lower.includes(" l");
    return compact.includes("right") || lower.includes("_r") || lower.includes(".r") || lower.includes(" r");
}

// 把骨骼名压缩成便于规则匹配的形式。
export function compactName(name) {
    return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}
