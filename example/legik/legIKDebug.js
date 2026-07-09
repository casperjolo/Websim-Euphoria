import {
    BufferGeometry,
    Line,
    LineBasicMaterial,
    Mesh,
    MeshBasicMaterial,
    MeshStandardMaterial,
    SphereGeometry,
    Vector3,
} from "three";

// 按需创建脚部 IK 调试用的目标球和采样射线。
export function createDebugObjects(controller) {
    // 彩色球显示 IK 目标，线段显示脚底采样射线。
    if (!controller.debug || !controller.scene) return;

    const sphere = new SphereGeometry(0.035, 10, 8);
    const toeSphere = new SphereGeometry(0.022, 10, 8);
    for (const side of ["left", "right"]) {
        const leg = controller.legs[side];
        if (leg.marker && leg.rayLine) continue;

        leg.marker = new Mesh(sphere, new MeshStandardMaterial({ color: leg.color, roughness: 0.5 }));
        leg.rayLine = new Line(new BufferGeometry().setFromPoints([new Vector3(), new Vector3()]), new LineBasicMaterial({ color: leg.color }));
        controller.scene.add(leg.marker, leg.rayLine);

        for (const sample of leg.soleSamples) {
            if (sample.marker && sample.rayLine) continue;
            sample.marker = new Mesh(toeSphere, new MeshStandardMaterial({ color: leg.color, emissive: leg.color, emissiveIntensity: 0.18, roughness: 0.5 }));
            sample.rayLine = new Line(new BufferGeometry().setFromPoints([new Vector3(), new Vector3()]), new LineBasicMaterial({ color: leg.color, transparent: true, opacity: 0.45 }));
            controller.scene.add(sample.marker, sample.rayLine);
        }
    }
}

// 更新单只脚的 IK 目标、主射线和脚底采样点显示。
export function updateFootDebug(controller, leg, footWorld, hitPoint) {
    if (!controller.debug || !leg.marker || !leg.rayLine) return;

    leg.marker.visible = true;
    leg.rayLine.visible = true;
    leg.marker.position.copy(leg.smoothedTarget);
    leg.rayLine.geometry.setFromPoints([footWorld.clone(), hitPoint.clone()]);

    // 四个虚拟脚底采样点：脚跟左右、脚尖左右。
    for (const sample of leg.soleSamples) {
        if (!sample.marker || !sample.rayLine) continue;
        sample.marker.visible = sample.hasHit;
        sample.rayLine.visible = sample.hasHit;
        if (sample.hasHit) {
            sample.marker.position.copy(sample.hitPoint);
            sample.rayLine.geometry.setFromPoints([sample.point.clone(), sample.hitPoint.clone()]);
        }
    }
}

// 统一切换所有腿部 IK 调试对象的显隐。
export function setDebugVisible(controller, visible) {
    for (const side of ["left", "right"]) {
        const leg = controller.legs[side];
        if (leg.marker) leg.marker.visible = visible;
        if (leg.rayLine) leg.rayLine.visible = visible;
        for (const sample of leg.soleSamples) {
            if (sample.marker) sample.marker.visible = visible && sample.hasHit;
            if (sample.rayLine) sample.rayLine.visible = visible && sample.hasHit;
        }
    }
}

// 返回当前动画相位的简短调试文本。
export function createSoleSampleDebugObjects(controller) {
    if (!controller.soleSampleDebug || !controller.scene) return;

    const geometry = new SphereGeometry(0.018, 10, 8);
    for (const side of ["left", "right"]) {
        const leg = controller.legs[side];
        for (const sample of leg.soleSamples) {
            if (sample.footMarker) continue;
            sample.footMarker = new Mesh(geometry, new MeshBasicMaterial({ color: leg.color, depthTest: false }));
            sample.footMarker.renderOrder = 20;
            controller.scene.add(sample.footMarker);
        }
    }
}

// 更新脚底本地采样点调试标记的位置，用于观察采样点是否贴合 foot/toe 骨骼。
export function updateSoleSampleDebugObjects(controller) {
    if (!controller.soleSampleDebug) return;
    createSoleSampleDebugObjects(controller);

    for (const side of ["left", "right"]) {
        const leg = controller.legs[side];
        if (!leg.ready) continue;

        controller.updateSoleSamples(leg, leg.foot.getWorldPosition(controller.tmpV1), leg.soleSamples, null);
        for (const sample of leg.soleSamples) {
            if (!sample.footMarker) continue;
            sample.footMarker.visible = true;
            sample.footMarker.position.copy(sample.point);
        }
    }
}

// 统一切换脚底本地采样点调试标记的显隐。
export function setSoleSampleDebugVisible(controller, visible) {
    for (const side of ["left", "right"]) {
        const leg = controller.legs[side];
        for (const sample of leg.soleSamples) {
            if (sample.footMarker) sample.footMarker.visible = visible;
        }
    }
}

// 返回当前动画脚步相位的简短调试文本。
export function getFootPhaseDebugText(controller, side) {
    const state = controller.footPhaseState?.[side];
    const clipName = controller.footPhaseState?.clipName || "none";
    const dataReady = controller.footPhaseClips.has(clipName);
    if (!state || !dataReady) return `${clipName}: no phase`;

    const phase = state.planted ? "plant" : "swing";
    const progress = Number.isFinite(state.progress) ? `${Math.round(state.progress * 100)}%` : "--";
    const land = Number.isFinite(state.timeToLand) ? `${state.timeToLand.toFixed(2)}s` : "--";
    return `${clipName}: ${phase} ${progress}, land ${land}`;
}
