import type { ContactManifold } from "../contacts/ContactManifold";
import type { ImpulseBody } from "./ImpulseBody";
import { solveFrictionConstraint, warmStartFriction } from "./FrictionConstraint";
import {
    prepareNormalConstraint,
    solveNormalConstraint,
    warmStartNormal,
} from "./NormalConstraint";

/**
 * 共享接触冲量求解器：法向 + 摩擦锥，可选热启动。
 * 人物胶囊不走此核（位置推出）；轮悬架 / 轮胎仍在车辆模块。
 */
export class ContactImpulseSolver {
    velocityIterations = 8; // 速度迭代次数
    warmStart = true; // 是否复用上一帧冲量做热启动

    /**
     * 对单个刚体与一组流形做速度级求解。
     * 顺序：准备 bias → 热启动 → 交替解法向 / 摩擦。
     */
    solveVelocity(
        body: ImpulseBody,
        manifolds: ContactManifold[],
        dt: number,
    ): void {
        if (!manifolds.length) return;

        // 写入弹性与穿透修正用的 biasVelocity
        for (const manifold of manifolds) {
            for (const point of manifold.contacts) {
                prepareNormalConstraint(body, manifold, point, dt);
            }
        }

        // 先施加缓存冲量，减少 resting 抖动
        if (this.warmStart) {
            for (const manifold of manifolds) {
                for (const point of manifold.contacts) {
                    warmStartNormal(body, manifold, point);
                    warmStartFriction(body, point);
                }
            }
        }

        // PGS：每轮先法向后摩擦
        for (let i = 0; i < this.velocityIterations; i++) {
            for (const manifold of manifolds) {
                for (const point of manifold.contacts) {
                    solveNormalConstraint(body, manifold, point);
                    solveFrictionConstraint(body, manifold, point);
                }
            }
        }
    }
}
