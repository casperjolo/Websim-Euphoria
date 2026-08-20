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
} from "./colliderDesc";
export { DYNAMIC_BODY_DEFAULTS } from "./colliderDesc";
export { DynamicBody } from "./DynamicBody";
export type { DynamicBodyKind, DynamicBodyMaterialOptions } from "./DynamicBody";
export { DynamicSphereBody, isSphereBody } from "./DynamicSphere";
export { DynamicBoxBody, isBoxBody } from "./DynamicBox";
export {
    buildStaticMergedMesh,
    buildKinematicMergedMesh,
    attachBoundsTree,
    ensureAttributesMinimal,
    unifiedAttribute,
} from "./colliderBuild";
