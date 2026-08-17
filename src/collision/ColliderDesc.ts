import type * as THREE from "three";
import type { MotionType } from "./CollisionWorld";

/** 从场景节点采集并合并的三角网格。 */
export type MeshSourceShape = {
    kind: "mesh";
    /** 采集几何的来源；必传。 */
    source: THREE.Object3D | THREE.Object3D[];
    mesh?: never;
};

/** 已有（可含 BVH）的碰撞网格。 */
export type MeshReadyShape = {
    kind: "mesh";
    mesh: THREE.Mesh;
    source?: never;
};

export type MeshShape = MeshSourceShape | MeshReadyShape;

export type BoxShape = {
    kind: "box";
    halfExtents: THREE.Vector3;
    /** 世界位置，或相对 follow 的局部偏移。 */
    position?: THREE.Vector3;
    quaternion?: THREE.Quaternion;
};

export type SphereShape = {
    kind: "sphere";
    radius: number;
    /** 世界位置，或相对 follow 的局部偏移。 */
    position?: THREE.Vector3;
};

export type ColliderShape = MeshShape | BoxShape | SphereShape;

type ColliderDescBase = {
    groups?: number;
    mask?: number;
    useWorker?: boolean;
    userData?: unknown;
};

export type StaticColliderDesc = ColliderDescBase & {
    motion: "static";
    shape: ColliderShape;
    follow?: never;
};

export type KinematicColliderDesc = ColliderDescBase & {
    motion: "kinematic";
    shape: ColliderShape;
    /** 每帧碰撞体对齐该节点的 matrixWorld；mesh+source 时默认跟 source。 */
    follow?: THREE.Object3D;
};

export type DynamicColliderDesc = ColliderDescBase & {
    motion: "dynamic";
    shape: ColliderShape;
    follow?: never;
    /** 密度，质量 = 体积 × 密度；默认见 DYNAMIC_BODY_DEFAULTS。 */
    density?: number;
    /** 弹性，0 不反弹，1 完全弹；默认见 DYNAMIC_BODY_DEFAULTS。 */
    restitution?: number;
    /** 摩擦；默认见 DYNAMIC_BODY_DEFAULTS。 */
    friction?: number;
    /** 线阻尼，越大滑行越快停；默认见 DYNAMIC_BODY_DEFAULTS。 */
    linearDamping?: number;
    /** 角阻尼，越大旋转越快停；默认见 DYNAMIC_BODY_DEFAULTS。 */
    angularDamping?: number;
    gravity?: number;
    /** 动态球可选视觉网格。 */
    mesh?: THREE.Mesh;
    color?: number;
    velocity?: THREE.Vector3;
    angularVelocity?: THREE.Vector3;
};

/** 动态刚体材质默认值（球 / 盒等共用）。 */
export const DYNAMIC_BODY_DEFAULTS = {
    density: 1,
    restitution: 0.2,
    friction: 0.6,
    linearDamping: 0.4,
    angularDamping: 0.6,
};

/** 统一创建描述。dynamic+mesh 允许但不推荐（见文档）。 */
export type ColliderDesc = StaticColliderDesc | KinematicColliderDesc | DynamicColliderDesc;

/** addCollider 返回的句柄。 */
export type ColliderHandle = {
    id: number;
    motion: MotionType;
    /** 运动学跟随目标（若有）。 */
    follow: THREE.Object3D | null;
    /** mesh 采集源（若有）。 */
    source: THREE.Object3D | null;
    /** 用于 BVH 查询的网格（static/kinematic mesh）。 */
    collisionMesh: THREE.Mesh | null;
};
