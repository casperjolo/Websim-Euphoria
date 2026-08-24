import * as THREE from "three";
import { MeshBVH, acceleratedRaycast } from "three-mesh-bvh";
import * as BufferGeometryUtils from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { BvhWorkerPool } from "../utils/BvhWorkerPool";

/**
 * 碰撞网格构建工具。
 */

/** 调试辅助物及其子级不应被烘焙进 mesh collider。 */
function isExcludedFromCollider(object: THREE.Object3D): boolean {
    let current: THREE.Object3D | null = object;
    while (current) {
        if (current.userData.excludeFromCollider === true) return true;
        current = current.parent;
    }
    return false;
}

/** 校验并补全合并所需属性（position / normal / uv）；含 NaN 或顶点数不足时返回 null。 */
export function ensureAttributesMinimal(geom: THREE.BufferGeometry): THREE.BufferGeometry | null {
    if (!geom.attributes.position) return null;
    const position = geom.attributes.position.array;
    for (let i = 0; i < position.length; i++) {
        if (!Number.isFinite(position[i])) return null;
    }
    if (geom.attributes.position.count < 3) return null;
    if (!geom.attributes.normal) geom.computeVertexNormals();
    if (!geom.attributes.uv) {
        const count = geom.attributes.position.count;
        geom.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(count * 2), 2));
    }
    return geom;
}

/**
 * 统一一组几何的属性布局，便于 BufferGeometryUtils.mergeGeometries。
 * 去掉非必需属性；冲突项删除；缺失项用零填充。
 */
export function unifiedAttribute(collected: THREE.BufferGeometry[]): THREE.BufferGeometry[] {
    type AttrMeta = { itemSize: number; arrayCtor: any; examples: number; normalized: boolean };
    const attrMap = new Map<string, AttrMeta>();
    const attrConflict = new Set<string>();
    const required = new Set(["position", "normal", "uv"]);

    for (const g of collected)
        for (const name of Object.keys(g.attributes))
            if (!required.has(name)) g.deleteAttribute(name);

    for (const g of collected) {
        for (const name of Object.keys(g.attributes)) {
            const attr = g.attributes[name] as THREE.BufferAttribute;
            const ctor = (attr.array as any).constructor;
            if (!attrMap.has(name)) {
                attrMap.set(name, { itemSize: attr.itemSize, arrayCtor: ctor, examples: 1, normalized: attr.normalized });
            } else {
                const m = attrMap.get(name)!;
                if (m.itemSize !== attr.itemSize || m.arrayCtor !== ctor || m.normalized !== attr.normalized) attrConflict.add(name);
                else m.examples++;
            }
        }
    }

    for (const name of attrConflict) {
        for (const g of collected) if (g.attributes[name]) g.deleteAttribute(name);
        attrMap.delete(name);
    }

    for (const [name, meta] of attrMap) {
        for (const g of collected) {
            if (!g.attributes[name]) {
                const count = g.attributes.position.count;
                g.setAttribute(name, new THREE.BufferAttribute(new meta.arrayCtor(count * meta.itemSize), meta.itemSize, meta.normalized));
            }
        }
    }
    return collected;
}

/** 遍历 sources，把 Mesh / LineSegments 克隆到世界空间并收集（跳过 name === "capsule"）。 */
function collectWorldSpaceGeometries(sources: THREE.Object3D[]): THREE.BufferGeometry[] {
    const collected: THREE.BufferGeometry[] = [];
    const collectMesh = (mesh: THREE.Mesh | THREE.LineSegments) => {
        try {
            let geom = mesh.geometry.clone();
            geom.applyMatrix4(mesh.matrixWorld);
            if (geom.index) geom = geom.toNonIndexed();
            const safe = ensureAttributesMinimal(geom);
            if (safe) collected.push(safe);
        } catch (e) {
            console.warn("处理网格时出错：", mesh, e);
        }
    };
    for (const obj of sources) {
        obj.updateMatrixWorld(true);
        obj.traverse(c => {
            const a = c as any;
            if (
                (a.isMesh || a.isLineSegments)
                && a.geometry
                && c.name !== "capsule"
                && !isExcludedFromCollider(c)
            ) collectMesh(a);
        });
    }
    return collected;
}

const _rtcTranslation = new THREE.Matrix4();
const _rtcCenter = new THREE.Vector3();

/**
 * 把合并后的几何收到包围盒中心附近，避免大坐标留在 Float32 顶点里。
 * 返回平移到原点的中心，调用方需把它编进 bakeInverse。
 */
function recenterGeometry(geometry: THREE.BufferGeometry, target: THREE.Vector3): THREE.Vector3 {
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    if (!box || box.isEmpty()) {
        target.set(0, 0, 0);
        return target;
    }
    box.getCenter(target);
    if (target.lengthSq() === 0) return target;
    geometry.translate(-target.x, -target.y, -target.z);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return target;
}

/**
 * 用合并几何创建线框调试 Mesh，并挂上 acceleratedRaycast。
 * localSpace 时关闭 matrixAutoUpdate，由外部每帧对齐 follow。
 */
function makeDebugMesh(geometry: THREE.BufferGeometry, localSpace: boolean): THREE.Mesh {
    const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({
            opacity: 0.5,
            transparent: true,
            wireframe: true,
            depthTest: true,
            side: THREE.DoubleSide,
        }),
    );
    mesh.raycast = acceleratedRaycast;
    if (localSpace) {
        mesh.matrixAutoUpdate = false;
    } else {
        mesh.layers.enable(1);
    }
    return mesh;
}

/** build*MergedMesh 的返回值：调试用 mesh + 待挂 BVH 的 geometry。 */
export type BuiltMeshCollider = {
    mesh: THREE.Mesh;
    geometry: THREE.BufferGeometry;
    /** 运动学烘焙：inv(source.matrixWorld) * T(rtcCenter)。*/
    bakeInverse?: THREE.Matrix4;
};

/**
 * 合并 source 为世界空间静态碰撞网格。
 * 仅合并几何，不挂 BVH；调用方需再走 attachBoundsTree，否则不能参与碰撞查询。
 */
export function buildStaticMergedMesh(sources: THREE.Object3D | THREE.Object3D[]): BuiltMeshCollider | null {
    const list = Array.isArray(sources) ? sources : [sources];
    let collected = collectWorldSpaceGeometries(list);
    if (!collected.length) return null;
    collected = unifiedAttribute(collected);
    const merged = BufferGeometryUtils.mergeGeometries(collected, false);
    if (!merged) {
        console.error("合并几何失败");
        return null;
    }
    return { mesh: makeDebugMesh(merged, false), geometry: merged };
}

/**
 * 合并 source 为运动学碰撞网格。
 * 先乘 matrixWorld 落到当前世界 / 局部 ENU，再绕包围盒中心收成小坐标；
 * 调用方需再走 attachBoundsTree，并每帧用
 * source.matrixWorld * bakeInverse 跟随。
 */
export function buildKinematicMergedMesh(source: THREE.Object3D): BuiltMeshCollider | null {
    source.updateMatrixWorld(true);
    let collected = collectWorldSpaceGeometries([source]);
    if (!collected.length) return null;
    collected = unifiedAttribute(collected);
    const merged = BufferGeometryUtils.mergeGeometries(collected, false);
    if (!merged) {
        console.error("合并运动学几何失败");
        return null;
    }
    const rtcCenter = recenterGeometry(merged, _rtcCenter);
    const bakeInverse = new THREE.Matrix4().copy(source.matrixWorld).invert();
    bakeInverse.multiply(_rtcTranslation.makeTranslation(rtcCenter.x, rtcCenter.y, rtcCenter.z));
    const mesh = makeDebugMesh(merged, true);
    mesh.matrix.copy(source.matrixWorld).multiply(bakeInverse);
    mesh.updateMatrixWorld(true);
    return { mesh, geometry: merged, bakeInverse };
}

/**
 * 为几何挂上 MeshBVH（写入 geometry.boundsTree）。
 * useWorker + workerPool 时异步构建，失败回退主线程；onStale 为真则丢弃过期结果。
 */
export function attachBoundsTree(
    geometry: THREE.BufferGeometry,
    options: {
        useWorker?: boolean;
        workerPool?: BvhWorkerPool;
        maxDepth?: number;
        onReady: (bvh: MeshBVH) => void;
        onStale?: () => boolean;
    },
): void {
    const maxDepth = options.maxDepth;
    const sync = () => {
        const bvh = maxDepth != null
            ? new MeshBVH(geometry, { maxDepth })
            : new MeshBVH(geometry);
        (geometry as any).boundsTree = bvh;
        options.onReady(bvh);
    };

    if (!options.useWorker || !options.workerPool) {
        sync();
        return;
    }

    void options.workerPool.generate(geometry).then((bvh) => {
        if (options.onStale?.()) return;
        (geometry as any).boundsTree = bvh;
        options.onReady(bvh);
    }).catch((error) => {
        if (options.onStale?.()) return;
        console.warn("异步构建 BVH 失败，回退到主线程：", error);
        sync();
    });
}
