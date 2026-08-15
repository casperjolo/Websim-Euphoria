import {
    BufferGeometry,
    Line,
    LineBasicMaterial,
    Mesh,
    MeshBasicMaterial,
    MeshStandardMaterial,
    SphereGeometry,
    Vector3,
    type Material,
    type Scene,
} from "three";
import { isReadyLeg } from "./skeleton";
import type {
    FootIKLeg,
    FootIKLegs,
    FootIKSide,
    FootPhaseControllerState,
    FootPhaseDatabase,
    FootIKProbeSample,
    PredictiveFootState,
} from "../types";

const FOOT_IK_SIDES: readonly FootIKSide[] = ["left", "right"];

/** 预测 IK 调试对象（落点 / 预测点 / Path / 采样点 / 连线）。 */
export type PredictiveDebugSide = {
    plantMarker: Mesh | null;
    predictMarker: Mesh | null;
    sampleMarker: Mesh | null;
    /** FootPath 弧线（蓝）。 */
    pathLine: Line | null;
    /** 落点→预测点地面连线（灰）。 */
    baseLine: Line | null;
    /** 当前采样点→IK 目标（黄）。 */
    sampleToTargetLine: Line | null;
    /** 落点→预测点（红，含高度时的示意）。 */
    plantToPredictLine: Line | null;
};

export type PredictiveDebugObjects = Record<FootIKSide, PredictiveDebugSide>;

export function createEmptyPredictiveDebug(): PredictiveDebugObjects {
    return {
        left: {
            plantMarker: null,
            predictMarker: null,
            sampleMarker: null,
            pathLine: null,
            baseLine: null,
            sampleToTargetLine: null,
            plantToPredictLine: null,
        },
        right: {
            plantMarker: null,
            predictMarker: null,
            sampleMarker: null,
            pathLine: null,
            baseLine: null,
            sampleToTargetLine: null,
            plantToPredictLine: null,
        },
    };
}

// 按需创建脚部 IK 调试用的目标球和采样射线。
export function createDebugObjects(
    scene: Scene | null,
    legs: FootIKLegs,
    enabled: boolean,
): void {
    if (!enabled || !scene) return;

    let markerGeometry: SphereGeometry | null = null;
    let sampleGeometry: SphereGeometry | null = null;
    for (const side of FOOT_IK_SIDES) {
        const leg = legs[side];

        if (!leg.marker) {
            markerGeometry ??= new SphereGeometry(0.035, 10, 8);
            leg.marker = new Mesh(
                markerGeometry,
                new MeshStandardMaterial({ color: leg.color, roughness: 0.5 }),
            );
            scene.add(leg.marker);
        }
        if (!leg.rayLine) {
            leg.rayLine = new Line(
                new BufferGeometry().setFromPoints([new Vector3(), new Vector3()]),
                new LineBasicMaterial({ color: leg.color }),
            );
            scene.add(leg.rayLine);
        }

        for (const sample of leg.soleSamples) {
            if (!sample.marker) {
                sampleGeometry ??= new SphereGeometry(0.022, 10, 8);
                sample.marker = new Mesh(
                    sampleGeometry,
                    new MeshStandardMaterial({
                        color: leg.color,
                        emissive: leg.color,
                        emissiveIntensity: 0.18,
                        roughness: 0.5,
                    }),
                );
                scene.add(sample.marker);
            }
            if (!sample.rayLine) {
                sample.rayLine = new Line(
                    new BufferGeometry().setFromPoints([new Vector3(), new Vector3()]),
                    new LineBasicMaterial({
                        color: leg.color,
                        transparent: true,
                        opacity: 0.45,
                    }),
                );
                scene.add(sample.rayLine);
            }
        }
    }
}

// 更新单只脚的 IK 目标、主射线和脚底采样点显示。
export function updateFootDebug(
    enabled: boolean,
    leg: FootIKLeg,
    footWorld: Vector3,
    hitPoint: Vector3,
): void {
    if (!enabled || !leg.marker || !leg.rayLine) return;

    leg.marker.visible = true;
    leg.rayLine.visible = true;
    leg.marker.position.copy(leg.smoothedTarget);
    leg.rayLine.geometry.setFromPoints([footWorld, hitPoint]);

    for (const sample of leg.soleSamples) {
        if (!sample.marker || !sample.rayLine) continue;
        sample.marker.visible = sample.hasHit;
        sample.rayLine.visible = sample.hasHit;
        if (sample.hasHit) {
            sample.marker.position.copy(sample.hitPoint);
            sample.rayLine.geometry.setFromPoints([sample.point, sample.hitPoint]);
        }
    }
}

// 统一切换所有腿部 IK 调试对象的显隐。
export function setDebugVisible(legs: FootIKLegs, visible: boolean): void {
    for (const side of FOOT_IK_SIDES) {
        const leg = legs[side];
        if (leg.marker) leg.marker.visible = visible;
        if (leg.rayLine) leg.rayLine.visible = visible;
        for (const sample of leg.soleSamples) {
            if (sample.marker) sample.marker.visible = visible && sample.hasHit;
            if (sample.rayLine) sample.rayLine.visible = visible && sample.hasHit;
        }
    }
}

// 按需创建始终跟随 foot 骨骼的脚底采样点。
export function createSoleSampleDebugObjects(
    scene: Scene | null,
    legs: FootIKLegs,
    enabled: boolean,
): void {
    if (!enabled || !scene) return;

    let geometry: SphereGeometry | null = null;
    for (const side of FOOT_IK_SIDES) {
        const leg = legs[side];
        for (const sample of leg.soleSamples) {
            if (sample.footMarker) continue;
            geometry ??= new SphereGeometry(0.018, 10, 8);
            sample.footMarker = new Mesh(
                geometry,
                new MeshBasicMaterial({ color: leg.color, depthTest: false }),
            );
            sample.footMarker.renderOrder = 20;
            scene.add(sample.footMarker);
        }
    }
}

// 更新脚底本地采样点调试标记的位置。
export function updateSoleSampleDebugObjects(
    enabled: boolean,
    scene: Scene | null,
    legs: FootIKLegs,
    updateSamples: (
        leg: FootIKLeg,
        footWorld: Vector3,
        samples: FootIKProbeSample[],
        footSamplePoint: Vector3 | null,
    ) => void,
    target: Vector3,
): void {
    if (!enabled) return;
    createSoleSampleDebugObjects(scene, legs, enabled);

    for (const side of FOOT_IK_SIDES) {
        const leg = legs[side];
        if (!isReadyLeg(leg)) continue;

        updateSamples(leg, leg.foot.getWorldPosition(target), leg.soleSamples, null);
        for (const sample of leg.soleSamples) {
            if (!sample.footMarker) continue;
            sample.footMarker.visible = true;
            sample.footMarker.position.copy(sample.point);
        }
    }
}

// 统一切换脚底本地采样点调试标记的显隐。
export function setSoleSampleDebugVisible(legs: FootIKLegs, visible: boolean): void {
    for (const side of FOOT_IK_SIDES) {
        for (const sample of legs[side].soleSamples) {
            if (sample.footMarker) sample.footMarker.visible = visible;
        }
    }
}

// 返回当前动画脚步相位的简短调试文本。
export function getFootPhaseDebugText(
    state: FootPhaseControllerState,
    clips: FootPhaseDatabase,
    side: FootIKSide,
    predictiveEnabled = false,
    predictiveActive = false,
): string {
    const sideState = state[side];
    const clipName = state.clipName || "none";
    const dataReady = clips.has(clipName);
    const mode = predictiveEnabled
        ? (predictiveActive ? "pred" : "react")
        : "react";
    if (!dataReady) return `${clipName} [${mode}]: no phase`;

    const phase = sideState.planted ? "plant" : "swing";
    const progress = Number.isFinite(sideState.progress)
        ? `${Math.round(sideState.progress * 100)}%`
        : "--";
    const land = Number.isFinite(sideState.timeToLand)
        ? `${sideState.timeToLand.toFixed(2)}s`
        : "--";
    return `${clipName} [${mode}]: ${phase} ${progress}, land ${land}`;
}

/** 创建预测落点 / Path 调试对象。 */
export function createPredictiveDebugObjects(
    scene: Scene | null,
    debug: PredictiveDebugObjects,
    enabled: boolean,
): void {
    if (!enabled || !scene) return;

    let plantGeo: SphereGeometry | null = null;
    let predictGeo: SphereGeometry | null = null;

    for (const side of FOOT_IK_SIDES) {
        const bundle = debug[side];
        if (!bundle.plantMarker) {
            plantGeo ??= new SphereGeometry(0.04, 10, 8);
            bundle.plantMarker = new Mesh(
                plantGeo,
                new MeshStandardMaterial({ color: 0x22c55e, roughness: 0.45 }),
            );
            scene.add(bundle.plantMarker);
        }
        if (!bundle.predictMarker) {
            predictGeo ??= new SphereGeometry(0.04, 10, 8);
            bundle.predictMarker = new Mesh(
                predictGeo,
                new MeshStandardMaterial({ color: 0xef4444, roughness: 0.45 }),
            );
            scene.add(bundle.predictMarker);
        }
        // 黄球/采样点不再显示：蓝线 FootPath 已覆盖当前采样信息
        if (bundle.sampleMarker) {
            bundle.sampleMarker.visible = false;
        }
        if (!bundle.pathLine) {
            bundle.pathLine = new Line(
                new BufferGeometry().setFromPoints([new Vector3(), new Vector3()]),
                new LineBasicMaterial({ color: 0x3b82f6, linewidth: 2 }),
            );
            scene.add(bundle.pathLine);
        }
        if (!bundle.baseLine) {
            bundle.baseLine = new Line(
                new BufferGeometry().setFromPoints([new Vector3(), new Vector3()]),
                new LineBasicMaterial({
                    color: 0x94a3b8,
                    transparent: true,
                    opacity: 0.55,
                }),
            );
            scene.add(bundle.baseLine);
        }
        if (!bundle.plantToPredictLine) {
            bundle.plantToPredictLine = new Line(
                new BufferGeometry().setFromPoints([new Vector3(), new Vector3()]),
                new LineBasicMaterial({
                    color: 0xf97316,
                    transparent: true,
                    opacity: 0.85,
                }),
            );
            scene.add(bundle.plantToPredictLine);
        }
        if (bundle.sampleToTargetLine) {
            bundle.sampleToTargetLine.visible = false;
        }
    }
}

/** 更新预测 IK 调试标记与连线。 */
export function updatePredictiveDebug(
    enabled: boolean,
    visible: boolean,
    debug: PredictiveDebugObjects,
    feet: Record<FootIKSide, PredictiveFootState>,
    _ikTargets?: Record<FootIKSide, Vector3>,
): void {
    for (const side of FOOT_IK_SIDES) {
        const bundle = debug[side];
        const state = feet[side];
        const show = enabled && visible && state.hasPlant;
        const showSwing = show && !state.locked;

        if (bundle.plantMarker) {
            bundle.plantMarker.visible = show;
            if (show) bundle.plantMarker.position.copy(state.lastPlantWorld);
        }
        if (bundle.predictMarker) {
            bundle.predictMarker.visible = show;
            if (show) bundle.predictMarker.position.copy(state.predictedWorld);
        }
        if (bundle.sampleMarker) {
            bundle.sampleMarker.visible = false;
        }

        // 蓝线：FootPath 空中弧线
        if (bundle.pathLine) {
            const pts = state.pathPoints;
            const showPath = showSwing && pts.length >= 2;
            bundle.pathLine.visible = showPath;
            if (showPath) {
                bundle.pathLine.geometry.dispose();
                bundle.pathLine.geometry = new BufferGeometry().setFromPoints(pts);
            }
        }

        // 灰线：落点→预测点贴地基准线（BasePath）
        if (bundle.baseLine) {
            bundle.baseLine.visible = show;
            if (show) {
                bundle.baseLine.geometry.setFromPoints([
                    state.lastPlantWorld,
                    state.predictedWorld,
                ]);
            }
        }

        // 橙线：落点 → 预测点（摆腿跨度）
        if (bundle.plantToPredictLine) {
            bundle.plantToPredictLine.visible = showSwing;
            if (showSwing) {
                bundle.plantToPredictLine.geometry.setFromPoints([
                    state.lastPlantWorld,
                    state.predictedWorld,
                ]);
            }
        }

        if (bundle.sampleToTargetLine) {
            bundle.sampleToTargetLine.visible = false;
        }
    }
}

export function setPredictiveDebugVisible(debug: PredictiveDebugObjects, visible: boolean): void {
    for (const side of FOOT_IK_SIDES) {
        const bundle = debug[side];
        if (bundle.plantMarker) bundle.plantMarker.visible = visible;
        if (bundle.predictMarker) bundle.predictMarker.visible = visible;
        if (bundle.sampleMarker) bundle.sampleMarker.visible = false;
        if (bundle.pathLine) bundle.pathLine.visible = visible;
        if (bundle.baseLine) bundle.baseLine.visible = visible;
        if (bundle.plantToPredictLine) bundle.plantToPredictLine.visible = visible;
        if (bundle.sampleToTargetLine) bundle.sampleToTargetLine.visible = false;
    }
}

export function disposePredictiveDebugObjects(debug: PredictiveDebugObjects): void {
    const geometries = new Set<BufferGeometry>();
    const materials = new Set<Material>();

    for (const side of FOOT_IK_SIDES) {
        const bundle = debug[side];
        collectDebugObject(bundle.plantMarker, geometries, materials);
        collectDebugObject(bundle.predictMarker, geometries, materials);
        collectDebugObject(bundle.sampleMarker, geometries, materials);
        collectDebugObject(bundle.pathLine, geometries, materials);
        collectDebugObject(bundle.baseLine, geometries, materials);
        collectDebugObject(bundle.plantToPredictLine, geometries, materials);
        collectDebugObject(bundle.sampleToTargetLine, geometries, materials);
        bundle.plantMarker = null;
        bundle.predictMarker = null;
        bundle.sampleMarker = null;
        bundle.pathLine = null;
        bundle.baseLine = null;
        bundle.plantToPredictLine = null;
        bundle.sampleToTargetLine = null;
    }

    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
}

// 移除调试对象并释放对应的 GPU 资源。
export function disposeDebugObjects(legs: FootIKLegs): void {
    const geometries = new Set<BufferGeometry>();
    const materials = new Set<Material>();

    for (const side of FOOT_IK_SIDES) {
        const leg = legs[side];
        collectDebugObject(leg.marker, geometries, materials);
        collectDebugObject(leg.rayLine, geometries, materials);
        leg.marker = null;
        leg.rayLine = null;

        for (const sample of leg.soleSamples) {
            collectDebugObject(sample.marker, geometries, materials);
            collectDebugObject(sample.rayLine, geometries, materials);
            collectDebugObject(sample.footMarker, geometries, materials);
            sample.marker = null;
            sample.rayLine = null;
            sample.footMarker = null;
        }
    }

    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
}

function collectDebugObject(
    object: Mesh | Line | null,
    geometries: Set<BufferGeometry>,
    materials: Set<Material>,
): void {
    if (!object) return;
    object.parent?.remove(object);
    geometries.add(object.geometry);
    const objectMaterials = Array.isArray(object.material)
        ? object.material
        : [object.material];
    for (const material of objectMaterials) materials.add(material);
}
