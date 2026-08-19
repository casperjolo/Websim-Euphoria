import {
    BufferGeometry,
    Line,
    LineBasicMaterial,
    Mesh,
    MeshBasicMaterial,
    SphereGeometry,
    Vector3,
    type Material,
    type Scene,
} from "three";
import type {
    FootIKLeg,
    FootIKLegs,
    FootIKSide,
    FootPhaseControllerState,
    FootPhaseDatabase,
} from "../types";

const FOOT_IK_SIDES: readonly FootIKSide[] = ["left", "right"];

/** 设计尺度下的 IK 目标球半径；与脚底四点同级，世界半径 = 该值 × appliedScale。 */
const IK_MARKER_RADIUS = 3;
/** 设计尺度下的最高地面命中球半径。 */
const HIT_MARKER_RADIUS = 2.5;
/** 设计尺度下的脚底采样原点球半径。 */
const SAMPLE_ORIGIN_RADIUS = 3;
/** 设计尺度下的脚底采样命中球半径。 */
const SAMPLE_HIT_RADIUS = 2.5;
/** 实心调试球 / 连线（左右腿共用）。 */
const DEBUG_SOLID_COLOR = 0x2dd4bf;
/** 线框命中球（左右腿共用）。 */
const DEBUG_HIT_COLOR = 0xffff66;
/** 命中高于胶囊下端球心时的线框球颜色。 */
const DEBUG_HIT_OVER_CAPSULE_COLOR = 0xff3333;

function setHitMarkerColor(mesh: Mesh, overCapsule: boolean): void {
    const material = mesh.material;
    if (Array.isArray(material)) return;
    (material as MeshBasicMaterial).color.setHex(
        overCapsule ? DEBUG_HIT_OVER_CAPSULE_COLOR : DEBUG_HIT_COLOR,
    );
}

// 创建统一 Foot IK 调试对象：IK 目标、最高命中、脚底四点（原点 + 命中 + 射线）。
export function createDebugObjects(
    scene: Scene | null,
    legs: FootIKLegs,
    enabled: boolean,
): void {
    if (!enabled || !scene) return;

    let ikGeometry: SphereGeometry | null = null;
    let hitGeometry: SphereGeometry | null = null;
    let sampleOriginGeometry: SphereGeometry | null = null;
    let sampleHitGeometry: SphereGeometry | null = null;

    for (const side of FOOT_IK_SIDES) {
        const leg = legs[side];

        if (!leg.marker) {
            ikGeometry ??= new SphereGeometry(IK_MARKER_RADIUS, 10, 8);
            leg.marker = new Mesh(
                ikGeometry,
                new MeshBasicMaterial({
                    color: DEBUG_SOLID_COLOR,
                    depthTest: false,
                    transparent: true,
                    opacity: 0.95,
                }),
            );
            leg.marker.renderOrder = 30;
            leg.marker.frustumCulled = false;
            scene.add(leg.marker);
        }

        if (!leg.hitMarker) {
            hitGeometry ??= new SphereGeometry(HIT_MARKER_RADIUS, 10, 8);
            leg.hitMarker = new Mesh(
                hitGeometry,
                new MeshBasicMaterial({
                    color: DEBUG_HIT_COLOR,
                    wireframe: true,
                    depthTest: false,
                    transparent: true,
                    opacity: 0.9,
                }),
            );
            leg.hitMarker.renderOrder = 29;
            leg.hitMarker.frustumCulled = false;
            scene.add(leg.hitMarker);
        }

        if (!leg.rayLine) {
            leg.rayLine = new Line(
                new BufferGeometry().setFromPoints([new Vector3(), new Vector3()]),
                new LineBasicMaterial({
                    color: DEBUG_SOLID_COLOR,
                    depthTest: false,
                    transparent: true,
                    opacity: 0.85,
                }),
            );
            leg.rayLine.renderOrder = 28;
            leg.rayLine.frustumCulled = false;
            scene.add(leg.rayLine);
        }

        for (const sample of leg.soleSamples) {
            // footMarker：脚底采样原点（跟骨骼）
            if (!sample.footMarker) {
                sampleOriginGeometry ??= new SphereGeometry(SAMPLE_ORIGIN_RADIUS, 10, 8);
                sample.footMarker = new Mesh(
                    sampleOriginGeometry,
                    new MeshBasicMaterial({
                        color: DEBUG_SOLID_COLOR,
                        depthTest: false,
                        transparent: true,
                        opacity: 0.85,
                    }),
                );
                sample.footMarker.renderOrder = 27;
                sample.footMarker.frustumCulled = false;
                scene.add(sample.footMarker);
            }
            // marker：该采样点的地面命中
            if (!sample.marker) {
                sampleHitGeometry ??= new SphereGeometry(SAMPLE_HIT_RADIUS, 10, 8);
                sample.marker = new Mesh(
                    sampleHitGeometry,
                    new MeshBasicMaterial({
                        color: DEBUG_HIT_COLOR,
                        wireframe: true,
                        depthTest: false,
                        transparent: true,
                        opacity: 0.8,
                    }),
                );
                sample.marker.renderOrder = 26;
                sample.marker.frustumCulled = false;
                scene.add(sample.marker);
            }
            if (!sample.rayLine) {
                sample.rayLine = new Line(
                    new BufferGeometry().setFromPoints([new Vector3(), new Vector3()]),
                    new LineBasicMaterial({
                        color: DEBUG_SOLID_COLOR,
                        transparent: true,
                        opacity: 0.45,
                        depthTest: false,
                    }),
                );
                sample.rayLine.renderOrder = 25;
                sample.rayLine.frustumCulled = false;
                scene.add(sample.rayLine);
            }
        }
    }
}

// 更新统一调试显示。
export function updateFootDebug(
    enabled: boolean,
    leg: FootIKLeg,
    hitPoint: Vector3,
    scale = 1,
    capsuleSupportY = NaN,
): void {
    if (!enabled || !leg.marker || !leg.rayLine) return;

    const s = Math.max(1e-4, scale);
    const hasCapsuleY = Number.isFinite(capsuleSupportY);

    // 腿级：IK 目标 + 最高命中 + 命中→目标
    leg.marker.visible = true;
    leg.marker.position.copy(leg.smoothedTarget);
    leg.marker.scale.setScalar(s);

    if (leg.hitMarker) {
        leg.hitMarker.visible = true;
        leg.hitMarker.position.copy(hitPoint);
        leg.hitMarker.scale.setScalar(s);
        setHitMarkerColor(leg.hitMarker, hasCapsuleY && hitPoint.y > capsuleSupportY);
    }

    leg.rayLine.visible = true;
    // 最高地面命中（线框球）→ IK 目标。
    leg.rayLine.geometry.setFromPoints([hitPoint, leg.smoothedTarget]);

    // 脚底四点：原点 + 命中 + 射线
    for (const sample of leg.soleSamples) {
        if (sample.footMarker) {
            sample.footMarker.visible = true;
            sample.footMarker.position.copy(sample.point);
            sample.footMarker.scale.setScalar(s);
        }
        if (sample.marker) {
            sample.marker.visible = sample.hasHit;
            if (sample.hasHit) {
                sample.marker.position.copy(sample.hitPoint);
                sample.marker.scale.setScalar(s);
                setHitMarkerColor(
                    sample.marker,
                    hasCapsuleY && sample.hitPoint.y > capsuleSupportY,
                );
            }
        }
        if (sample.rayLine) {
            sample.rayLine.visible = sample.hasHit;
            if (sample.hasHit) {
                sample.rayLine.geometry.setFromPoints([sample.point, sample.hitPoint]);
            }
        }
    }
}

// 统一切换所有 Foot IK 调试对象的显隐。
export function setDebugVisible(legs: FootIKLegs, visible: boolean): void {
    for (const side of FOOT_IK_SIDES) {
        const leg = legs[side];
        if (leg.marker) leg.marker.visible = visible;
        if (leg.hitMarker) leg.hitMarker.visible = visible;
        if (leg.rayLine) leg.rayLine.visible = visible;
        for (const sample of leg.soleSamples) {
            if (sample.footMarker) sample.footMarker.visible = visible;
            if (sample.marker) sample.marker.visible = visible && sample.hasHit;
            if (sample.rayLine) sample.rayLine.visible = visible && sample.hasHit;
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
        collectDebugObject(leg.hitMarker, geometries, materials);
        collectDebugObject(leg.rayLine, geometries, materials);
        leg.marker = null;
        leg.hitMarker = null;
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
