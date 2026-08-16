import * as THREE from "three";
import { ContactManifold } from "./ContactManifold";
import { ContactPoint } from "./ContactPoint";
import { normalClass } from "./ContactReducer";

const MATCH_NORMAL = 0.95; // 热启动匹配的法线点积阈值
const MATCH_DISTANCE = 0.08; // 热启动匹配的局部点距离阈值

type MatchResult = {
    point: ContactPoint; // 上一帧接触点
    normal: THREE.Vector3; // 上一帧法线
};

/** 帧间接触点匹配，用于冲量热启动。 */
export class ContactCache {
    private prev: ContactManifold[] = []; // 上一帧流形

    /** 把上一帧冲量拷到匹配的新接触上。 */
    match(manifolds: ContactManifold[]): void {
        for (const manifold of manifolds) {
            for (const point of manifold.contacts) {
                const prev = this.findMatch(manifold.normal, point);
                if (!prev) {
                    point.resetImpulses(); // 新接触从 0 开始
                    continue;
                }
                const prevClass = normalClass(prev.normal);
                const nextClass = normalClass(manifold.normal);
                // 台面与立面互切时不继承冲量，避免把支撑力带到墙上
                if (
                    (prevClass === "support" && nextClass === "wall") ||
                    (prevClass === "wall" && nextClass === "support")
                ) {
                    point.resetImpulses();
                    continue;
                }
                // 继承上一帧法向和切向冲量
                point.normalImpulse = prev.point.normalImpulse;
                point.tangentImpulse1 = prev.point.tangentImpulse1;
                point.tangentImpulse2 = prev.point.tangentImpulse2;
            }
        }
    }

    /** 保存本帧流形，供下一帧匹配。 */
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

    // 法线接近且局部点最近的上一帧接触
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
