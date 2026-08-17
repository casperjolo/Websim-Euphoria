import type * as THREE from "three";
import { CollisionGroup } from "./groups";

/** 碰撞体运动类型。 */
export type MotionType = "static" | "kinematic" | "dynamic";

/**
 * 碰撞形状。
 * mesh 挂 BVH 供射线 / shapecast；box / sphere 用于动态刚体登记与解析碰撞。
 */
export type CollisionShape =
    | { kind: "mesh"; mesh: THREE.Mesh }
    | { kind: "box"; halfExtents: THREE.Vector3 }
    | { kind: "sphere"; radius: number };

/** 世界中已登记的一条碰撞体。 */
export type CollisionCollider = {
    id: number; // 稳定标识
    motion: MotionType; // 运动类型
    shape: CollisionShape; // 形状
    groups: number; // 自己属于哪些业务组
    mask: number; // 自己要撞哪些组
    ready: boolean; // BVH / 资源是否可参与查询
    userData?: unknown; // 业务侧挂载数据
};

/** 底层登记参数。未传的 groups / mask 按 motion 给默认值。 */
export type AddColliderOptions = {
    motion: MotionType;
    shape: CollisionShape;
    groups?: number;
    mask?: number;
    ready?: boolean;
    userData?: unknown;
};

/**
 * 查询过滤。
 * 传入完整 collider 时双方 groups/mask 都要匹配；只传 `{ mask }` 时单向过滤。
 */
export type MeshQueryFilter = CollisionCollider | { mask: number };

/** query / queryMeshes 的可选过滤。 */
export type MeshQueryOptions = {
    skipIds?: number[]; // 额外排除的 id
    kinds?: CollisionShape["kind"][]; // 只保留这些形状
    motion?: MotionType | MotionType[]; // 只保留这些运动类型
};

/** 按运动类型给出默认业务分组与掩码。 */
function defaultBits(motion: MotionType): { groups: number; mask: number } {
    switch (motion) {
        case "static":
            return {
                groups: CollisionGroup.DEFAULT,
                mask: CollisionGroup.DEBRIS | CollisionGroup.VEHICLE,
            };
        case "kinematic":
            return {
                groups: CollisionGroup.DEFAULT,
                mask: CollisionGroup.DEBRIS | CollisionGroup.VEHICLE | CollisionGroup.CHARACTER,
            };
        case "dynamic":
            return {
                groups: CollisionGroup.DEBRIS,
                mask: CollisionGroup.DEFAULT | CollisionGroup.VEHICLE | CollisionGroup.DEBRIS,
            };
    }
}

/** 是否为完整 collider（相对仅含 mask 的单向查询）。 */
function isCollider(filter: MeshQueryFilter): filter is CollisionCollider {
    return "id" in filter && "motion" in filter && "groups" in filter;
}

/**
 * 碰撞体注册表。
 * 人物仍用胶囊推出，车辆仍用射线 / OBB；这里只统一「谁登记了、谁和谁该测」。
 */
export class CollisionWorld {
    private nextId = 1; // 递增 id
    private readonly colliders = new Map<number, CollisionCollider>(); // 已登记碰撞体

    /** 登记一条碰撞体，返回带 id 的条目。 */
    add(options: AddColliderOptions): CollisionCollider {
        const bits = defaultBits(options.motion);
        const entry: CollisionCollider = {
            id: this.nextId++,
            motion: options.motion,
            shape: options.shape,
            groups: options.groups ?? bits.groups,
            mask: options.mask ?? bits.mask,
            ready: options.ready ?? true,
            userData: options.userData,
        };
        this.colliders.set(entry.id, entry);
        return entry;
    }

    /** 按 id 取碰撞体，不存在则返回 undefined。 */
    get(id: number): CollisionCollider | undefined {
        return this.colliders.get(id);
    }

    /** 注销碰撞体。 */
    remove(id: number): void {
        this.colliders.delete(id);
    }

    /** 标记 BVH / 资源是否可参与查询。 */
    setReady(id: number, ready: boolean): void {
        const entry = this.colliders.get(id);
        if (entry) entry.ready = ready;
    }

    /** 覆盖碰撞掩码。 */
    setMask(id: number, mask: number): void {
        const entry = this.colliders.get(id);
        if (entry) entry.mask = mask;
    }

    /** 覆盖业务分组。 */
    setGroups(id: number, groups: number): void {
        const entry = this.colliders.get(id);
        if (entry) entry.groups = groups;
    }

    /** 覆盖 userData。 */
    setUserData(id: number, userData: unknown): void {
        const entry = this.colliders.get(id);
        if (entry) entry.userData = userData;
    }

    /**
     * 查询可参与检测的碰撞体。
     * 完整 collider：双向 groups/mask；仅 mask：单向。自动跳过未 ready 与自身 id。
     */
    query(filter: MeshQueryFilter, options?: MeshQueryOptions): CollisionCollider[] {
        const skip = new Set(options?.skipIds);
        const self = isCollider(filter) ? filter : null;
        if (self) skip.add(self.id);
        const mask = filter.mask;
        const kinds = options?.kinds;
        const motions = options?.motion
            ? (Array.isArray(options.motion) ? options.motion : [options.motion])
            : null;
        const out: CollisionCollider[] = [];
        for (const col of this.colliders.values()) {
            if (!col.ready || skip.has(col.id)) continue;
            if (motions && !motions.includes(col.motion)) continue;
            if (kinds && !kinds.includes(col.shape.kind)) continue;
            if ((col.groups & mask) === 0) continue;
            if (self && (self.groups & col.mask) === 0) continue;
            out.push(col);
        }
        return out;
    }

    /** 查询可做 BVH 射线 / shapecast 的网格。 */
    queryMeshes(filter: MeshQueryFilter, options?: MeshQueryOptions): THREE.Mesh[] {
        const meshes: THREE.Mesh[] = [];
        for (const col of this.query(filter, options)) {
            if (col.shape.kind === "mesh") meshes.push(col.shape.mesh);
        }
        return meshes;
    }

    /** 按运动类型列出 id（供 clearColliders）。 */
    idsByMotion(motion?: MotionType): number[] {
        const out: number[] = [];
        for (const col of this.colliders.values()) {
            if (motion && col.motion !== motion) continue;
            out.push(col.id);
        }
        return out;
    }

    /** 清空全部登记。 */
    clear(): void {
        this.colliders.clear();
    }
}
