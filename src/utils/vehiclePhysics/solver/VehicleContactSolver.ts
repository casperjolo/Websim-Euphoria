import type { ContactManifold } from "../contacts/ContactManifold";
import type { VehicleRigidBody } from "../VehicleRigidBody";
import { solveFrictionConstraint, warmStartFriction } from "./FrictionConstraint";
import {
    prepareNormalConstraint,
    solveNormalConstraint,
    warmStartNormal,
} from "./NormalConstraint";

/** 车身接触的速度约束求解器。 */
export class VehicleContactSolver {
    velocityIterations = 8; // 速度迭代次数
    warmStart = true; // 是否沿用上一帧冲量

    /** 解法向与摩擦速度约束。 */
    solveVelocity(
        body: VehicleRigidBody,
        manifolds: ContactManifold[],
        dt: number,
    ): void {
        if (!manifolds.length) return;

        // 先准备台面穿透偏置
        for (const manifold of manifolds) {
            for (const point of manifold.contacts) {
                prepareNormalConstraint(manifold, point, dt);
            }
        }

        // 热启动：先施加上一帧冲量
        if (this.warmStart) {
            for (const manifold of manifolds) {
                for (const point of manifold.contacts) {
                    warmStartNormal(body, manifold, point);
                    warmStartFriction(body, point);
                }
            }
        }

        // 顺序迭代法向和摩擦
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
