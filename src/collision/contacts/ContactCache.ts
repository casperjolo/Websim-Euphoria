import * as THREE from "three";
import { ContactManifold } from "./ContactManifold";
import { ContactPoint } from "./ContactPoint";
import { normalClass } from "./ContactReducer";

const MATCH_NORMAL = 0.95; // 法线点积低于此值视为不同流形
const MATCH_DISTANCE = 0.08; // 局部接触点匹配距离上限

/** findMatch 的命中结果。 */
type MatchResult = {
    point: ContactPoint; // 上一帧匹配到的接触点
    normal: THREE.Vector3; // 上一帧流形法线
};

/**
 * 帧间接触点匹配，用于冲量热启动（warm start）。
 * 求解前 match 继承冲量；求解后 save 供下一帧使用。
 */
export class ContactCache {
    private prev: ContactManifold[] = []; // 上一帧流形快照

    /**
     * 将上一帧冲量拷到本帧对应接触点。
     * 无匹配、或支撑面 ↔ 墙面切换时清零，避免错误热启动。
     */
    match(manifolds: ContactManifold[]): void {
        for (const manifold of manifolds) {
            for (const point of manifold.contacts) {
                const prev = this.findMatch(manifold.normal, point);
                if (!prev) {
                    point.resetImpulses();
                    continue;
                }
                // 法线类别突变（地面 ↔ 墙）时冲量不可复用
                const prevClass = normalClass(prev.normal);
                const nextClass = normalClass(manifold.normal);
                if (
                    (prevClass === "support" && nextClass === "wall") ||
                    (prevClass === "wall" && nextClass === "support")
                ) {
                    point.resetImpulses();
                    continue;
                }
                point.normalImpulse = prev.point.normalImpulse;
                point.tangentImpulse1 = prev.point.tangentImpulse1;
                point.tangentImpulse2 = prev.point.tangentImpulse2;
            }
        }
    }

    /** 深拷贝本帧流形与接触冲量，供下一帧 match。 */
    save(manifolds: ContactManifold[]): void {
        this.prev = manifolds.map((src) => {
            const copy = new ContactManifold();
            copy.normal.copy(src.normal);
            copy.normalSum.copy(src.normalSum);
            copy.contacts = src.contacts.map((p) => {
                const c = new ContactPoint();
                c.copyFrom(p);
                return c;
            });
            return copy;
        });
    }

    /**
     * 在上一帧中找法线接近且局部点最近的接触。
     * 用刚体局部坐标匹配，避免物体移动后面世界点对不上。
     */
    private findMatch(normal: THREE.Vector3, point: ContactPoint): MatchResult | null {
        let best: MatchResult | null = null;
        let bestDist = MATCH_DISTANCE * MATCH_DISTANCE;
        for (const manifold of this.prev) {
            if (manifold.normal.dot(normal) < MATCH_NORMAL) continue;
            for (const prev of manifold.contacts) {
                const d = prev.localPoint.distanceToSquared(point.localPoint);
                if (d < bestDist) {
                    bestDist = d;
                    best = { point: prev, normal: manifold.normal };
                }
            }
        }
        return best;
    }
}
