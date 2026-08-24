/** 碰撞业务分组 bitmask（与 MotionType 正交）。 */
export const CollisionGroup = {
    ALL: 0xffff,
    /** 场景静态 / 运动学网格等默认层。 */
    DEFAULT: 1 << 0,
    /** 人物相关（预留）。 */
    CHARACTER: 1 << 1,
    /** 车辆底盘盒。 */
    VEHICLE: 1 << 2,
    /** 动态碎片（球等）。 */
    DEBRIS: 1 << 3,
} as const;

/** 人物胶囊 / 相机射线的单向查询目标。 */
export const CHARACTER_QUERY_MASK = CollisionGroup.DEFAULT;

/** 全部分组掩码。 */
export const ALL_COLLISION_MASK = CollisionGroup.ALL;

export type CollisionGroupBits = (typeof CollisionGroup)[keyof typeof CollisionGroup];
