import {
    MathUtils,
    Quaternion,
    Raycaster,
    Vector3,
} from "three";
import { createCCDIKScratch, solveConstrainedCCD } from "./ccdIK.js";
import {
    buildFootPhaseDatabase,
    createFootPhaseOptions,
    createFootPhaseRuntimeState,
    sampleFootPhaseRuntime,
} from "./footPhase.js";
import {
    collectBones,
    createLeg,
    findHips,
    resolveConfiguredBone,
} from "./legSkeleton.js";
import {
    createDebugObjects,
    createSoleSampleDebugObjects,
    getFootPhaseDebugText,
    setDebugVisible,
    setSoleSampleDebugVisible,
    updateFootDebug,
    updateSoleSampleDebugObjects,
} from "./legIKDebug.js";

export class LegIKController {
    // 初始化脚部 IK 参数、骨骼引用和调试对象。
    constructor(player, options = {}) {
        this.player = player; // PlayerController 实例
        this.scene = options.scene; // three.js 场景实例，用于添加调试对象
        this.collider = options.collider; // 射线检测用地面碰撞体
        this.debug = options.debug ?? false; // 是否显示脚底 IK 调试对象，默认 false
        this.soleSampleDebug = options.soleSampleDebug ?? false; // 是否显示始终跟随 foot 骨骼的脚底采样点
        this.maxPelvisDrop = options.maxPelvisDrop ?? 0.1; // 骨盆最大下沉距离
        this.soleHalfWidth = options.soleHalfWidth ?? 0.035; // 虚拟脚底左右采样半宽
        this.soleToeExtend = options.soleToeExtend ?? 0.035; // 从 toeBase 继续向鞋尖方向延伸的采样距离
        this.soleHeelExtend = options.soleHeelExtend ?? 0.015; // 从 foot 反向向脚跟延伸的采样距离
        this.footAlignWeight = options.footAlignWeight ?? 1; // 脚掌贴合地面法线的强度
        this.maxFootTilt = options.maxFootTilt ?? 90 * Math.PI / 180; // 脚掌贴坡最大旋转角
        this.minKneeBend = options.minKneeBend ?? 2 * Math.PI / 180; // 膝盖最小弯曲角，避免腿完全锁死伸直
        this.maxKneeBend = options.maxKneeBend ?? 145 * Math.PI / 180; // 膝盖最大弯曲角，避免过度折叠

        // 第一阶段：从动画中自动采样脚步相位，用于调试并判断移动动画中的支撑脚。
        this.footPhaseOptions = createFootPhaseOptions(options); // 脚步相位采样与过滤参数
        this.footPhaseClips = new Map();
        this.footPhaseState = {
            clipName: "",
            normalizedTime: 0,
            left: createFootPhaseRuntimeState(),
            right: createFootPhaseRuntimeState(),
        };

        // 移动时只做“防穿模上抬 IK”：脚尖/脚跟命中点高过动画脚时才介入。
        // 不向下吸脚，避免走路动画被地面锁住导致滑步。
        this.moveLiftThreshold = options.moveLiftThreshold ?? 0.0005; // 移动时脚底上抬触发阈值

        // 胶囊已经上台阶、但脚射线还踩在低处时，把人物 mesh 临时往下拽。
        this.maxMeshStepDrop = options.maxMeshStepDrop ?? 0.18; // mesh 台阶视觉补偿的最大下拽距离
        this.meshBaseY = player.playerModel?.position.y ?? 0; // 人物 mesh 初始本地 y 坐标
        this.meshStepOffsetY = 0; // 当前 mesh 台阶视觉补偿偏移

        // 脚底检测射线
        this.raycaster = new Raycaster(new Vector3(), new Vector3(0, -1, 0), 0, 2.2);
        this.raycaster.firstHitOnly = true;

        // 复用临时对象
        this.up = new Vector3(0, 1, 0);
        this.tmpV1 = new Vector3();
        this.tmpV2 = new Vector3();
        this.tmpV3 = new Vector3();
        this.tmpV4 = new Vector3();
        this.tmpV5 = new Vector3();
        this.tmpQ1 = new Quaternion();
        this.tmpQ2 = new Quaternion();
        this.tmpQ3 = new Quaternion();
        this.ccdIKScratch = createCCDIKScratch();
        this.meshStepProbeSamples = ["heelL", "heelR", "toeL", "toeR"].map(name => ({
            name,
            point: new Vector3(),
            hitPoint: new Vector3(),
            hasHit: false,
        }));
        this.meshStepProbeFootSamplePoint = new Vector3();

        // 每帧 IK 修改过的骨骼先保存干净姿态
        this.adjusted = new Map();

        // 未传配置时才回退到启发式匹配
        const bones = collectBones(player.playerModel);
        this.skeletonConfig = options.skeleton ?? options.bones ?? null; // 骨骼绑定配置，支持骨骼名或 Bone 对象
        this.hips = resolveConfiguredBone(this.skeletonConfig?.hips, bones, "hips")
            ?? findHips(bones);
        this.legs = {
            left: createLeg("left", bones, 0x2dd4bf, this.skeletonConfig),
            right: createLeg("right", bones, 0xf97316, this.skeletonConfig),
        };

        if (!this.hips || !this.legs.left.ready || !this.legs.right.ready) {
            console.warn("[LegIK] 骨骼识别不完整，当前模型骨骼名：", bones.map(b => b.name));
        }
        player.playerModel?.updateMatrixWorld(true);
        this.initSoleLocalSamples(this.legs.left);
        this.initSoleLocalSamples(this.legs.right);
        this.buildFootPhaseDatabase();
        this.createDebugObjects();
        this.createSoleSampleDebugObjects();
    }

    // 恢复上一帧 IK 修改前的骨骼姿态
    restore() {
        // 先恢复上一帧的动画原始姿态，再让 mixer 推进当前帧
        // 调用顺序是：legIK.restore() -> player.update() -> legIK.update()
        for (const [bone, pose] of this.adjusted) {
            bone.position.copy(pose.position);
            bone.quaternion.copy(pose.quaternion);
        }
        this.adjusted.clear();
    }

    // 在动画更新后执行每帧腿部 IK 修正。
    update(delta = 1 / 60) {
        this.updateFootPhaseRuntime();

        // 不在地面时不做腿部贴地
        if (!this.collider || !this.player?.playerCapsule || !this.player?.playerIsOnGround) {
            this.resetMeshStepOffset(delta);
            this.setDebugVisible(false);
            return;
        }

        const model = this.player.playerModel;
        model?.updateMatrixWorld(true);

        // moving 决定是否关闭腿部 IK，移动时交给原动画。
        const moving = this.isLocomotion();

        // 先处理胶囊上台阶带来的视觉高度差，再算脚目标。
        this.applyMeshStepOffset(delta);
        model?.updateMatrixWorld(true);

        // 先算左右脚目标，再根据两只脚目标调整骨盆，最后解腿部 IK。
        this.updateFoot("left", delta, moving);
        this.updateFoot("right", delta, moving);
        this.applyPelvis(delta);
        this.applyLeg("left");
        this.applyLeg("right");
    }

    // 构建脚步相位库。具体采样和过滤逻辑在 footPhase.js 中，控制器只持有结果。
    buildFootPhaseDatabase() {
        const model = this.player?.playerModel;
        const clips = this.player?.animation?.clips ?? [];
        this.footPhaseClips = buildFootPhaseDatabase(model, clips, this.legs, this.footPhaseOptions);

        if (this.footPhaseClips.size > 0) {
            const summary = [...this.footPhaseClips.values()].map(clip => ({
                clip: clip.name,
                left: `land:${clip.left.land.length} lift:${clip.left.lift.length}`,
                right: `land:${clip.right.land.length} lift:${clip.right.lift.length}`,
            }));
            console.table(summary);
        } else {
            console.warn("[LegIK] 没有生成脚步相位数据，请确认 walk/run 动画和脚骨骼配置。");
        }
    }

    // 根据当前动画播放时间更新左右脚相位。这里只同步状态，不直接驱动 IK。
    updateFootPhaseRuntime() {
        const action = this.player?.animation?.state;
        const clip = action?.getClip?.();
        if (!clip || clip.duration <= 0) {
            this.footPhaseState.clipName = "";
            return;
        }

        const data = this.footPhaseClips.get(clip.name);
        this.footPhaseState.clipName = clip.name;
        this.footPhaseState.normalizedTime = ((action.time / clip.duration) % 1 + 1) % 1;

        if (!data) {
            this.footPhaseState.left = createFootPhaseRuntimeState();
            this.footPhaseState.right = createFootPhaseRuntimeState();
            return;
        }

        const runtime = sampleFootPhaseRuntime(data, this.footPhaseState.normalizedTime, clip.duration);
        this.footPhaseState.left = runtime.left;
        this.footPhaseState.right = runtime.right;
    }

    // 计算单脚 IK 目标、权重和骨盆偏移。
    updateFoot(side, delta, moving) {
        const leg = this.legs[side];
        if (!leg.ready) return;

        const footWorld = leg.foot.getWorldPosition(this.tmpV1);
        const phase = this.footPhaseState?.[side];
        const phasePlanted = moving && !!phase?.planted;
        leg.planted = !moving || phasePlanted;
        const hit = this.castBestFootGround(leg, footWorld);

        // 脚底没有命中地面时，本帧完全交还给原动画。
        if (!hit) {
            leg.plantedWeight = 0;
            leg.movePenetrating = false;
            leg.weight = 0;
            leg.offsetY = 0;
            return;
        }

        this.getWorldHitNormal(hit, leg.hitNormal);
        leg.hitPoint.copy(hit.point);

        // 命中点高过胶囊底部时，说明角色碰撞体已经把台阶/斜坡吃掉了。
        // 此时不再把脚吸向上方地面，避免 IK 和胶囊位移互相抢高度。
        if (this.hasFootHitAboveCapsuleBottom(leg)) {
            leg.weight = 0;
            leg.plantedWeight = 0;
            leg.offsetY = 0;
            leg.movePenetrating = false;
            leg.smoothedTarget.copy(footWorld);
            this.updateFootDebug(leg, leg.footSamplePoint, hit.point);
            return;
        }

        const liftAmount = this.getMovePenetrationLift(leg, footWorld);
        // 支撑脚直接追地面目标；摆动脚默认只做穿透上抬。
        // 贴地和防穿透独立触发：支撑脚追地面，任何相位陷入地面都抬起。
        const liftTargetY = footWorld.y + liftAmount;
        const targetY = liftTargetY;

        const target = this.tmpV2.copy(footWorld);
        target.y = targetY;

        // 防穿透只负责上抬，不参与脚步锁定状态。
        leg.movePenetrating = liftAmount > this.moveLiftThreshold;

        const wantedPlantedWeight = leg.planted ? 1 : 0;
        leg.plantedWeight = MathUtils.damp(leg.plantedWeight ?? 0, wantedPlantedWeight, 10, delta);

        // planted 贴地短时间渐入/渐出；穿透修正仍然立即介入，避免脚陷入地面。
        if (leg.movePenetrating) {
            leg.weight = 1;
        } else if (leg.plantedWeight > 0.001) {
            leg.weight = leg.plantedWeight;
        } else {
            // 移动 swing 脚听原动画，IK 不生效。
            leg.weight = 0;
        }

        // 骨盆只跟随贴地/防穿透，避免摆腿时骨盆抖动。
        leg.offsetY = (leg.planted || leg.movePenetrating) ? (targetY - footWorld.y) * leg.weight : 0;

        // 没有贴地或防穿透时，目标回到动画脚位，避免移动中被地面锁脚。
        leg.smoothedTarget.copy((leg.planted || leg.movePenetrating) ? target : footWorld);

        this.updateFootDebug(leg, leg.footSamplePoint, hit.point);
    }

    // 对一只脚的四个虚拟脚底点分别向下射线，选择命中高度最高的点作为本帧调试/法线参考。
    castBestFootGround(leg, footWorld, samples = leg.soleSamples, footSamplePoint = leg.footSamplePoint) {
        this.updateSoleSamples(leg, footWorld, samples, footSamplePoint);

        let bestHit = null;
        for (const sample of samples) {
            sample.hasHit = false;
            const hit = this.castGroundAtSample(sample.point);
            if (!hit) continue;
            sample.hasHit = true;
            sample.hitPoint.copy(hit.point);
            if (!bestHit || hit.point.y > bestHit.point.y) {
                bestHit = hit;
                footSamplePoint?.copy(sample.point);
            }
        }

        return bestHit;
    }

    // 基于初始化姿态，把脚底四个采样点固定到 foot 骨骼本地空间。
    initSoleLocalSamples(leg) {
        if (!leg?.ready) return;

        const footWorld = leg.foot.getWorldPosition(this.tmpV1);
        const toeWorld = leg.toe
            ? leg.toe.getWorldPosition(this.tmpV2)
            : this.tmpV2.copy(footWorld).add(this.tmpV3.set(0, 0, 1).applyQuaternion(leg.foot.getWorldQuaternion(this.tmpQ1)).setY(0).normalize().multiplyScalar(0.12));

        const forward = this.tmpV3.copy(toeWorld).sub(footWorld).setY(0);
        if (forward.lengthSq() < 0.0001) {
            forward.set(0, 0, 1).applyQuaternion(leg.foot.getWorldQuaternion(this.tmpQ1)).setY(0);
        }
        forward.normalize();

        const side = this.tmpV4.crossVectors(forward, this.up).normalize();
        const heelCenter = this.tmpV5.copy(footWorld).addScaledVector(forward, -this.soleHeelExtend);
        const toeCenter = this.tmpV2.copy(toeWorld).addScaledVector(forward, this.soleToeExtend);

        heelCenter.y = toeCenter.y;

        leg.foot.updateMatrixWorld(true);
        const samples = leg.soleSamples;
        samples[0].point.copy(heelCenter).addScaledVector(side, this.soleHalfWidth);
        samples[1].point.copy(heelCenter).addScaledVector(side, -this.soleHalfWidth);
        samples[2].point.copy(toeCenter).addScaledVector(side, this.soleHalfWidth);
        samples[3].point.copy(toeCenter).addScaledVector(side, -this.soleHalfWidth);

        for (const sample of samples) {
            sample.local.copy(sample.point);
            leg.foot.worldToLocal(sample.local);
        }
        leg.footSamplePoint.copy(heelCenter);
    }

    // 把 foot-local 脚底四点转换到世界空间，供射线、穿透检测和调试使用。
    updateSoleSamples(leg, footWorld, samples = leg.soleSamples, footSamplePoint = leg.footSamplePoint) {
        if (!leg?.ready) return;
        if (!leg.soleSamples[0]?.local) this.initSoleLocalSamples(leg);

        leg.foot.updateMatrixWorld(true);
        const sourceSamples = leg.soleSamples;
        const count = Math.min(samples.length, sourceSamples.length);
        for (let i = 0; i < count; i++) {
            samples[i].point.copy(sourceSamples[i].local).applyMatrix4(leg.foot.matrixWorld);
        }

        if (footSamplePoint && samples.length >= 2) {
            footSamplePoint.copy(samples[0].point).add(samples[1].point).multiplyScalar(0.5);
        }
    }

    // 统一穿透检测：四个脚底采样点中，只要 sample.y 低于对应地面 y，就取最大上抬量。
    getMovePenetrationLift(leg, footWorld) {
        const capsuleBottomY = this.getCapsuleBottomY();
        let lift = 0;
        for (const sample of leg.soleSamples) {
            if (!sample.hasHit) continue;

            const penetration = sample.hitPoint.y - sample.point.y;
            if (penetration > this.moveLiftThreshold) {
                lift = Math.max(lift, penetration);
            }
        }

        if (!Number.isFinite(capsuleBottomY)) return Math.max(0, lift);

        return lift;
    }

    // 计算胶囊底部的世界高度，用于限制脚部上抬。
    getCapsuleBottomY() {
        const capsule = this.player.playerCapsule;
        const info = capsule?.capsuleInfo;
        if (!capsule || !info?.segment || !Number.isFinite(info.radius)) return NaN;

        capsule.updateMatrixWorld();
        const start = this.tmpV2.copy(info.segment.start).applyMatrix4(capsule.matrixWorld);
        const end = this.tmpV3.copy(info.segment.end).applyMatrix4(capsule.matrixWorld);
        // return Math.min(start.y, end.y) - info.radius;
        return Math.min(start.y, end.y);
    }

    // 任意脚底采样交点高于胶囊底部时，本帧这条腿完全不做脚 IK。
    hasFootHitAboveCapsuleBottom(leg) {
        const capsuleBottomY = this.getCapsuleBottomY();
        if (!Number.isFinite(capsuleBottomY)) return false;

        for (const sample of leg.soleSamples) {
            if (sample.hasHit && sample.hitPoint.y > capsuleBottomY) return true;
        }
        return false;
    }

    // 当胶囊中心已经踩到更高台阶，但某只脚还射到更低地面时，下拽人物 mesh。
    applyMeshStepOffset(delta) {
        const model = this.player.playerModel;
        const capsule = this.player.playerCapsule;
        if (!model || !capsule) return;

        // 胶囊中心向下射线代表 碰撞体站在哪个高度。
        const capsuleHit = this.castCapsuleGround();
        if (!capsuleHit) {
            this.resetMeshStepOffset(delta);
            return;
        }

        // 左右脚各自向下射线；取更低的脚地面，判断是否有脚还留在台阶下方。
        let lowestFootGroundY = Infinity;
        for (const side of ["left", "right"]) {
            const leg = this.legs[side];
            if (!leg.ready) continue;

            const footWorld = leg.foot.getWorldPosition(this.tmpV1);
            const footHit = this.castBestFootGround(
                leg,
                footWorld,
                this.meshStepProbeSamples,
                this.meshStepProbeFootSamplePoint,
            );
            if (footHit) lowestFootGroundY = Math.min(lowestFootGroundY, footHit.point.y);
        }

        if (!Number.isFinite(lowestFootGroundY)) {
            this.resetMeshStepOffset(delta);
            return;
        }

        // 如果脚地面低于胶囊地面，差值是负数；把这个负偏移应用到 mesh 根节点。
        const drop = lowestFootGroundY - capsuleHit.point.y;
        const wantedOffset = MathUtils.clamp(drop, -this.maxMeshStepDrop, 0);
        this.setMeshStepOffset(wantedOffset, delta);
    }

    // 平滑设置人物 mesh 相对胶囊的台阶视觉偏移。
    setMeshStepOffset(wantedOffset, delta) {
        const model = this.player.playerModel;
        if (!model) return;

        const speed = 10;

        this.meshStepOffsetY = MathUtils.damp(this.meshStepOffsetY, wantedOffset, speed, delta);
        if (Math.abs(this.meshStepOffsetY) < 0.0001) this.meshStepOffsetY = 0;

        model.position.y = this.meshBaseY + this.meshStepOffsetY;
        model.updateMatrixWorld(true);
    }

    // 离地、没有命中地面，或不需要台阶补偿时，让 mesh 回到胶囊下的基准位置。
    resetMeshStepOffset(delta) {
        this.setMeshStepOffset(0, delta);
    }

    // 判断当前动画是否属于移动类动画。
    isLocomotion() {
        const name = this.player.getCurrentPlayerAnimationName?.() ?? "";
        return /walk|run|left|right|back/i.test(name);
    }

    // 从骨骼采样点上方发射射线。
    castGroundAtSample(sampleWorld) {
        return this.castGroundFrom(sampleWorld.x, sampleWorld.y + 0.45, sampleWorld.z);
    }

    // 从胶囊中心向下检测当前碰撞体真正支撑在哪个地面高度。
    castCapsuleGround() {
        const capsule = this.player.playerCapsule;
        const radius = capsule.capsuleInfo?.radius ?? 0.15;
        return this.castGroundFrom(capsule.position.x, capsule.position.y, capsule.position.z);
    }

    // 从指定世界坐标向下射线检测可踩踏地面。
    castGroundFrom(x, y, z) {
        this.raycaster.ray.origin.set(x, y, z);
        const hits = this.raycaster.intersectObject(this.collider, false);
        return hits.find(hit => this.getWorldHitNormal(hit, this.tmpV3).y > 0.18) ?? null;
    }

    // 将射线命中的局部法线转换为世界空间法线。
    getWorldHitNormal(hit, target) {
        target.copy(hit.face?.normal ?? this.up);
        const normalMatrix = this.tmpQ3;
        hit.object.getWorldQuaternion(normalMatrix);
        target.applyQuaternion(normalMatrix).normalize();
        return target;
    }

    // 根据双脚高度差对骨盆做平滑补偿。
    applyPelvis(delta) {
        if (!this.hips) return;

        // 如果某只脚目标比动画脚低很多，只拉脚会导致腿被过度拉长。
        // 骨盆向下补偿一部分，让两条腿都有空间够到目标。
        const left = this.legs.left.offsetY;
        const right = this.legs.right.offsetY;
        const leftW = this.legs.left.weight;
        const rightW = this.legs.right.weight;
        const wantedWorldOffset = MathUtils.clamp(Math.min(left * leftW, right * rightW), -this.maxPelvisDrop, 0.035);

        if (this.pelvisOffset === undefined) this.pelvisOffset = 0;
        this.pelvisOffset = MathUtils.damp(this.pelvisOffset, wantedWorldOffset, 12, delta);
        if (Math.abs(this.pelvisOffset) < 0.0001) return;

        this.capture(this.hips);
        const parentScale = this.hips.parent?.getWorldScale(this.tmpV1).y || 1;
        this.hips.position.y += this.pelvisOffset / parentScale;
        this.hips.updateMatrixWorld(true);
    }

    // 对指定腿执行 IK 求解并贴合脚掌。
    applyLeg(side) {
        const leg = this.legs[side];
        if (!leg.ready || leg.weight <= 0.001) return;

        // 保存动画给出的 foot 世界旋转，解腿后再按权重恢复，最后只叠加少量贴地旋转。
        const animatedFootWorldQ = leg.foot.getWorldQuaternion(this.tmpQ1).clone();

        // 穿透修正
        this.solveCCD(leg, leg.smoothedTarget, leg.weight, 8);
        this.preserveFootWorldRotation(leg, animatedFootWorldQ, leg.weight);
        this.alignFootToGround(leg);
        this.correctPostAlignSoleContact(leg);
    }

    // 抵消腿部 IK 对 foot 子骨骼造成的被动旋转，保留动画本来的脚掌朝向。
    preserveFootWorldRotation(leg, animatedWorldQ, weight) {
        this.capture(leg.foot);

        const currentWorldQ = leg.foot.getWorldQuaternion(this.tmpQ1);
        currentWorldQ.slerp(animatedWorldQ, MathUtils.clamp(weight, 0, 1));

        const parentWorldQ = leg.foot.parent.getWorldQuaternion(this.tmpQ2);
        leg.foot.quaternion.copy(parentWorldQ.invert().multiply(currentWorldQ));
        leg.foot.updateMatrixWorld(true);
    }

    // 使用约束 CCD 旋转大腿和小腿，让脚靠近目标点。
    solveCCD(leg, target, weight, iterations = 3) {
        solveConstrainedCCD(leg, target, weight, iterations, {
            capture: bone => this.capture(bone),
            minKneeBend: this.minKneeBend,
            maxKneeBend: this.maxKneeBend,
            scratch: this.ccdIKScratch,
        });
    }

    // 脚掌贴坡会绕 foot 骨骼旋转,旋转后脚底采样点可能重新离地或轻微入地。
    correctPostAlignSoleContact(leg) {
        if (leg.weight <= 0.001) return;

        const footWorld = leg.foot.getWorldPosition(this.tmpV1);
        this.updateSoleSamples(leg, footWorld);

        let contactOffset = -Infinity;
        let anyHit = false;
        for (const sample of leg.soleSamples) {
            sample.hasHit = false;
            const hit = this.castGroundAtSample(sample.point);
            if (!hit) continue;

            sample.hasHit = true;
            sample.hitPoint.copy(hit.point);
            anyHit = true;
            const offset = hit.point.y - sample.point.y;
            contactOffset = Math.max(contactOffset, offset);
        }

        if (!anyHit) return;

        const flatContactBias = 0.015;
        const slopeContactWeight = MathUtils.clamp(leg.hitNormal.y, 0, 1);
        contactOffset += flatContactBias * slopeContactWeight;
        // contactOffset = MathUtils.clamp(contactOffset, -0.06, 0.06);

        if (Math.abs(contactOffset) <= 0.0001) return;

        const alignedFootWorldQ = leg.foot.getWorldQuaternion(this.tmpQ1).clone();
        const correctedTarget = this.tmpV2.copy(footWorld).addScaledVector(this.up, contactOffset);

        this.solveCCD(leg, correctedTarget, leg.weight, 4);
        this.preserveFootWorldRotation(leg, alignedFootWorldQ, 1);
    }

    // 根据地面法线轻微调整脚掌朝向。
    alignFootToGround(leg) {
        // 脚掌贴坡：把脚的 up 方向部分旋到地面法线。
        // 用最大角度限制避免台阶边缘的法线让脚踝扭得过夸张。
        if (leg.hitNormal.y < 0.35 || leg.weight <= 0.001) return;
        this.capture(leg.foot);

        const footWorldQ = leg.foot.getWorldQuaternion(this.tmpQ1);
        const alignQ = this.tmpQ2.setFromUnitVectors(this.up, leg.hitNormal);

        const maxTilt = this.maxFootTilt;
        const realAngle = 2 * Math.acos(MathUtils.clamp(alignQ.w, -1, 1));
        if (realAngle > maxTilt) {
            alignQ.slerp(new Quaternion(), 1 - maxTilt / realAngle);
        }
        alignQ.slerp(new Quaternion(), 1 - leg.weight * this.footAlignWeight);

        const targetWorldQ = alignQ.multiply(footWorldQ);
        const parentWorldQ = leg.foot.parent.getWorldQuaternion(this.tmpQ3);
        leg.foot.quaternion.copy(parentWorldQ.invert().multiply(targetWorldQ));
        leg.foot.updateMatrixWorld(true);
    }

    // 保存骨骼原始姿态，便于下一帧恢复。
    capture(bone) {
        // 第一次修改骨骼前保存原姿态，下一帧 restore 会用它恢复。
        if (this.adjusted.has(bone)) return;
        this.adjusted.set(bone, {
            position: bone.position.clone(),
            quaternion: bone.quaternion.clone(),
        });
    }

    // 创建调试用的脚目标标记和射线线段。
    createDebugObjects() {
        createDebugObjects(this);
    }

    // 更新单只脚的调试标记和检测线位置。
    updateFootDebug(leg, footWorld, hitPoint) {
        updateFootDebug(this, leg, footWorld, hitPoint);
    }

    // 统一切换腿部 IK 调试对象的显示状态。
    setDebugVisible(visible) {
        setDebugVisible(this, visible);
    }

    createSoleSampleDebugObjects() {
        createSoleSampleDebugObjects(this);
    }

    updateSoleSampleDebug() {
        updateSoleSampleDebugObjects(this);
    }

    setSoleSampleDebugVisible(visible) {
        setSoleSampleDebugVisible(this, visible);
    }

    // 控制脚底 IK 目标、foot/toe 射线等调试对象显隐。
    setDebugEnabled(enabled) {
        this.debug = enabled;
        if (enabled) {
            this.createDebugObjects();
        }
        this.setDebugVisible(enabled);
    }

    // 控制始终跟随 foot 骨骼的四个脚底采样点显隐。
    setSoleSampleDebugEnabled(enabled) {
        this.soleSampleDebug = enabled;
        if (enabled) {
            this.createSoleSampleDebugObjects();
        }
        this.setSoleSampleDebugVisible(enabled);
    }

    // 返回指定脚当前动画相位的调试文本。
    getFootPhaseDebugText(side) {
        return getFootPhaseDebugText(this, side);
    }

}
