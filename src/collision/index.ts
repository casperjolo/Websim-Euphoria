export type { MotionType, CollisionCollider, CollisionShape, AddColliderOptions, MeshQueryFilter, MeshQueryOptions } from "./CollisionWorld";
export { CollisionWorld } from "./CollisionWorld";
export {
    CollisionGroup,
    CHARACTER_QUERY_MASK,
    ALL_COLLISION_MASK,
    type CollisionGroupBits,
} from "./groups";
export type {
    ColliderDesc,
    ColliderHandle,
    ColliderShape,
    MeshShape,
    BoxShape,
    SphereShape,
    StaticColliderDesc,
    KinematicColliderDesc,
    DynamicColliderDesc,
} from "./ColliderDesc";
export { DYNAMIC_BODY_DEFAULTS } from "./ColliderDesc";
export { DynamicBody } from "./DynamicBody";
export type { DynamicBodyKind, DynamicBodyMaterialOptions } from "./DynamicBody";
export { DynamicSphereBody, isSphereBody } from "./DynamicSphere";
export type { AddDynamicSphereOptions } from "./DynamicSphere";
export {
    buildStaticMergedMesh,
    buildKinematicMergedMesh,
    attachBoundsTree,
    ensureAttributesMinimal,
    unifiedAttribute,
} from "./ColliderBuild";
