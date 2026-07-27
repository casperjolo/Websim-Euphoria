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
} from "../types";

const FOOT_IK_SIDES: readonly FootIKSide[] = ["left", "right"];

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
): string {
    const sideState = state[side];
    const clipName = state.clipName || "none";
    const dataReady = clips.has(clipName);
    if (!dataReady) return `${clipName}: no phase`;

    const phase = sideState.planted ? "plant" : "swing";
    const progress = Number.isFinite(sideState.progress)
        ? `${Math.round(sideState.progress * 100)}%`
        : "--";
    const land = Number.isFinite(sideState.timeToLand)
        ? `${sideState.timeToLand.toFixed(2)}s`
        : "--";
    return `${clipName}: ${phase} ${progress}, land ${land}`;
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
