import * as THREE from "three";

// 胶囊碰撞所需的临时对象
export interface CollisionTemps {
    invMat: THREE.Matrix4;    // 碰撞体世界矩阵的逆矩阵
    localSeg: THREE.Line3;    // 胶囊段在碰撞体本地空间的副本
    localBox: THREE.Box3;     // 胶囊段在碰撞体本地空间的包围盒
    closestSeg: THREE.Vector3; // 胶囊段最近点
    closestTri: THREE.Vector3; // 三角面最近点
}

/** 地面体积探测的通用命中结果。 */
export interface GroundProbeHit {
    point: THREE.Vector3;
    normal: THREE.Vector3;
    /** 从胶囊下端球心沿向下方向到支撑点的距离。 */
    distance: number;
}

/**
 * 一次圆柱地面探测的参数、临时向量和当前最近命中。
 */
export interface GroundProbeQuery {
    start: THREE.Vector3;
    down: THREE.Vector3;
    maxDistance: number;
    radius: number;
    radiusSq: number;
    minNormalY: number;
    delta: THREE.Vector3;
    radialOffset: THREE.Vector3;
    hit: GroundProbeHit;
}

/** BVH 三角形和动态盒表面三角形共同具备的最小查询接口。 */
export interface GroundProbeTriangle {
    closestPointToSegment(
        segment: THREE.Line3,
        trianglePoint: THREE.Vector3,
        segmentPoint: THREE.Vector3,
    ): number;
    getNormal(target: THREE.Vector3): THREE.Vector3;
}

/** 地面体积探测所需的复用临时对象。 */
export interface GroundProbeTemps {
    invMat: THREE.Matrix4;
    normalMat: THREE.Matrix3;
    localSeg: THREE.Line3;
    localBox: THREE.Box3;
    colliderScale: THREE.Vector3;
    localTriPoint: THREE.Vector3;
    localSegPoint: THREE.Vector3;
    localNormal: THREE.Vector3;
    query: GroundProbeQuery;
}

// 创建一组预分配的临时对象
export function createCollisionTemps(): CollisionTemps {
    return {
        invMat: new THREE.Matrix4(),
        localSeg: new THREE.Line3(),
        localBox: new THREE.Box3(),
        closestSeg: new THREE.Vector3(),
        closestTri: new THREE.Vector3(),
    };
}

/** 创建可跨帧复用的圆柱地面探测状态。 */
export function createGroundProbeQuery(): GroundProbeQuery {
    return {
        start: new THREE.Vector3(),
        down: new THREE.Vector3(0, -1, 0),
        maxDistance: 0,
        radius: 0,
        radiusSq: 0,
        minNormalY: 0,
        delta: new THREE.Vector3(),
        radialOffset: new THREE.Vector3(),
        hit: {
            point: new THREE.Vector3(),
            normal: new THREE.Vector3(),
            distance: Infinity,
        },
    };
}

/** 写入本次探测参数，并清空上一次留下的最近命中。 */
export function resetGroundProbeQuery(
    query: GroundProbeQuery,
    start: THREE.Vector3,
    down: THREE.Vector3,
    maxDistance: number,
    radius: number,
    minNormalY: number,
): void {
    query.start.copy(start);
    query.down.copy(down).normalize();
    query.maxDistance = Math.max(0, maxDistance);
    query.radius = Math.max(0, radius);
    query.radiusSq = query.radius * query.radius;
    query.minNormalY = minNormalY;
    query.hit.distance = Infinity;
}

/**
 * 将形状算法给出的表面点送入统一的圆柱筛选器。
 * 返回 true 表示该点有效，并且替换了当前最近命中。
 */
export function tryGroundProbeCandidate(
    query: GroundProbeQuery,
    point: THREE.Vector3,
    normal: THREE.Vector3,
): boolean {
    query.delta.subVectors(point, query.start);

    // 投影到向下轴得到探测深度；轴起点上方和圆柱末端之外都不属于传感区。
    const distance = query.delta.dot(query.down);
    if (
        distance < -1e-5
        || distance > query.maxDistance + 1e-5
        || distance >= query.hit.distance
    ) return false;

    // 去掉轴向分量后只剩横向偏移，用它判断候选点是否落在圆柱半径内。
    query.radialOffset.copy(query.delta).addScaledVector(query.down, -distance);
    if (query.radialOffset.lengthSq() > query.radiusSq) return false;

    // 只接受法线足够朝上的可站立表面。
    if (-normal.dot(query.down) < query.minNormalY) return false;

    query.hit.distance = distance;
    query.hit.point.copy(point);
    query.hit.normal.copy(normal);
    return true;
}

/**
 * 从三角面生成表面候选点，再交给统一圆柱筛选器。
 * 网格可传入本地到世界的变换；动态盒的三角形已经在世界空间，无需传变换。
 */
export function tryGroundProbeTriangle(
    query: GroundProbeQuery,
    segment: THREE.Line3,
    triangle: GroundProbeTriangle,
    trianglePoint: THREE.Vector3,
    segmentPoint: THREE.Vector3,
    normal: THREE.Vector3,
    pointMatrix?: THREE.Matrix4,
    normalMatrix?: THREE.Matrix3,
): boolean {
    // 三角面到圆柱中心轴的最近点，就是该三角面最有可能落入圆柱的候选点。
    triangle.closestPointToSegment(segment, trianglePoint, segmentPoint);
    if (pointMatrix) trianglePoint.applyMatrix4(pointMatrix);

    triangle.getNormal(normal);
    if (normalMatrix) normal.applyMatrix3(normalMatrix);
    normal.normalize();

    return tryGroundProbeCandidate(query, trianglePoint, normal);
}

/** 创建一组地面体积探测临时对象。 */
export function createGroundProbeTemps(): GroundProbeTemps {
    return {
        invMat: new THREE.Matrix4(),
        normalMat: new THREE.Matrix3(),
        localSeg: new THREE.Line3(),
        localBox: new THREE.Box3(),
        colliderScale: new THREE.Vector3(),
        localTriPoint: new THREE.Vector3(),
        localSegPoint: new THREE.Vector3(),
        localNormal: new THREE.Vector3(),
        query: createGroundProbeQuery(),
    };
}

/**
 * 用带半径的竖直传感区查找胶囊脚下的可支撑网格。
 * 中心射线落在细缝中时，传感区仍能触及缝隙两侧的顶面。
 */
export function probeMeshGround(
    sensorStart: THREE.Vector3,
    down: THREE.Vector3,
    maxDistance: number,
    sensorRadius: number,
    minNormalY: number,
    collider: THREE.Mesh,
    temps: GroundProbeTemps,
): GroundProbeHit | null {
    const boundsTree = (collider.geometry as any)?.boundsTree;
    if (!boundsTree || maxDistance <= 0 || sensorRadius <= 0 || down.lengthSq() === 0) return null;

    resetGroundProbeQuery(
        temps.query,
        sensorStart,
        down,
        maxDistance,
        sensorRadius,
        minNormalY,
    );
    temps.invMat.copy(collider.matrixWorld).invert();
    temps.normalMat.getNormalMatrix(collider.matrixWorld);
    temps.localSeg.start.copy(temps.query.start).applyMatrix4(temps.invMat);
    temps.localSeg.end.copy(temps.query.start)
        .addScaledVector(temps.query.down, temps.query.maxDistance)
        .applyMatrix4(temps.invMat);

    // BVH 宽相位：用包住整个探测圆柱的本地 AABB 排除远处节点。
    // 非等比缩放时取最小轴缩放计算半径，包围盒会偏大但不会漏掉候选面。
    temps.colliderScale.setFromMatrixScale(collider.matrixWorld);
    const minScale = Math.max(
        1e-8,
        Math.min(temps.colliderScale.x, temps.colliderScale.y, temps.colliderScale.z),
    );
    const localRadius = sensorRadius / minScale;
    temps.localBox.makeEmpty()
        .expandByPoint(temps.localSeg.start)
        .expandByPoint(temps.localSeg.end)
        .expandByScalar(localRadius);

    boundsTree.shapecast({
        intersectsBounds: (box: THREE.Box3) => box.intersectsBox(temps.localBox),
        intersectsTriangle: (tri: any) => {
            // 窄相位、坐标变换和候选过滤由网格与动态盒共用的函数完成。
            tryGroundProbeTriangle(
                temps.query,
                temps.localSeg,
                tri,
                temps.localTriPoint,
                temps.localSegPoint,
                temps.localNormal,
                collider.matrixWorld,
                temps.normalMat,
            );
        },
    });

    return Number.isFinite(temps.query.hit.distance) ? temps.query.hit : null;
}

/**
 * 将胶囊与单个网格做 BVH 碰撞检测。
 * `useDynamicsSegment` 时用接到脚底的段（飞行），否则用悬空段（步行上台阶）。
 * @param capsule       胶囊所在的 Object3D（位置会被直接修改）
 * @param capsuleInfo   胶囊描述：局部空间线段 + 半径
 * @param collider      目标碰撞网格
 * @param temps         预分配临时对象
 * @param skipTri       可选：返回 true 则跳过该三角面
 */
export function applyCapsuleCollision(
    capsule: THREE.Object3D,
    capsuleInfo: { segment: THREE.Line3; radius: number; dynamicsSegment?: THREE.Line3 },
    collider: THREE.Mesh,
    temps: CollisionTemps,
    skipTri?: (tri: any, dir: THREE.Vector3) => boolean,
    useDynamicsSegment = false,
): void {
    const segment = useDynamicsSegment
        ? (capsuleInfo.dynamicsSegment ?? capsuleInfo.segment)
        : capsuleInfo.segment;
    // 胶囊段变换到碰撞体本地空间
    temps.invMat.copy(collider.matrixWorld).invert();
    temps.localSeg.start.copy(segment.start).applyMatrix4(capsule.matrixWorld).applyMatrix4(temps.invMat);
    temps.localSeg.end.copy(segment.end).applyMatrix4(capsule.matrixWorld).applyMatrix4(temps.invMat);

    // 构建本地包围盒
    temps.localBox.makeEmpty();
    temps.localBox.expandByPoint(temps.localSeg.start).expandByPoint(temps.localSeg.end);
    temps.localBox.expandByScalar(capsuleInfo.radius);

    // 碰撞查询
    (collider.geometry as any)?.boundsTree?.shapecast({
        intersectsBounds: (box: THREE.Box3) => box.intersectsBox(temps.localBox),
        intersectsTriangle: (tri: any) => {
            // 初步筛选
            const distance = tri.closestPointToSegment(temps.localSeg, temps.closestSeg, temps.closestTri);
            if (distance >= capsuleInfo.radius) return;

            // 二次筛选
            const dir = temps.closestTri.clone().sub(temps.closestSeg).normalize();
            if (skipTri?.(tri, dir)) return;

            // 推开胶囊段
            temps.localSeg.start.addScaledVector(dir, capsuleInfo.radius - distance);
            temps.localSeg.end.addScaledVector(dir, capsuleInfo.radius - distance);
        },
    });

    // 应用碰撞修正
    const newPos = temps.closestSeg.copy(temps.localSeg.start).applyMatrix4(collider.matrixWorld);
    const delta = temps.closestTri.subVectors(newPos, capsule.position);
    const offset = Math.max(0, delta.length() - 1e-5);
    capsule.position.add(delta.normalize().multiplyScalar(offset));
}

/**
 * 胶囊段与球的重叠。
 * 命中时 temps.closestSeg 为段上最近点，temps.closestTri 为胶囊指向球的单位法线，返回穿透深度。
 */
export function capsuleSphereOverlap(
    capsule: THREE.Object3D,
    capsuleInfo: { segment: THREE.Line3; radius: number; dynamicsSegment?: THREE.Line3 },
    spherePos: THREE.Vector3,
    sphereRadius: number,
    temps: CollisionTemps,
): number {
    const segment = capsuleInfo.dynamicsSegment ?? capsuleInfo.segment;
    temps.localSeg.start.copy(segment.start).applyMatrix4(capsule.matrixWorld);
    temps.localSeg.end.copy(segment.end).applyMatrix4(capsule.matrixWorld);
    temps.localSeg.closestPointToPoint(spherePos, true, temps.closestSeg);
    temps.closestTri.subVectors(spherePos, temps.closestSeg);
    const dist = temps.closestTri.length();
    const minDist = capsuleInfo.radius + sphereRadius;
    if (dist >= minDist) return 0;
    if (dist > 1e-8) temps.closestTri.multiplyScalar(1 / dist);
    else temps.closestTri.set(0, 1, 0);
    return minDist - dist;
}