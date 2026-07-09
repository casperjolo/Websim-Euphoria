import {
    AnimationMixer,
    MathUtils,
    Vector3,
} from "three";

const tmpFoot = new Vector3();
const tmpToe = new Vector3();

// 创建单脚相位的运行时默认状态。
export function createFootPhaseRuntimeState() {
    return {
        planted: false,
        progress: 0,
        timeToLand: Infinity,
        nextLand: null,
        prevLift: null,
        nextLift: null,
        swingSpan: 1,
    };
}

// 从控制器配置中提取脚步相位采样参数。
export function createFootPhaseOptions(options = {}) {
    return {
        sampleCount: options.footPhaseSampleCount ?? 96,
        groundThreshold: options.footPhaseGroundThreshold ?? 0.025,
        minContactRatio: options.footPhaseMinContactRatio ?? 0.04,
        speedSlack: options.footPhaseSpeedSlack ?? 1.35,
    };
}

// 离线采样 walk/run 等循环移动动画，生成左右脚落地/抬脚相位。
export function buildFootPhaseDatabase(model, clips, legs, options = {}) {
    const phaseClips = new Map();
    if (!model || !clips?.length || !legs?.left?.ready || !legs?.right?.ready) return phaseClips;

    const bones = collectBones(model);
    const savedPoses = bones.map(bone => ({
        bone,
        position: bone.position.clone(),
        quaternion: bone.quaternion.clone(),
        scale: bone.scale.clone(),
    }));
    const savedModelMatrixNeedsUpdate = model.matrixWorldNeedsUpdate;
    const mixer = new AnimationMixer(model);

    try {
        for (const clip of clips) {
            if (!shouldAnalyzeFootPhaseClip(clip)) continue;
            const data = sampleFootPhaseClip(model, mixer, clip, legs, options);
            if (!data) continue;
            phaseClips.set(clip.name, data);
        }
    } finally {
        mixer.stopAllAction();
        mixer.uncacheRoot(model);
        for (const pose of savedPoses) {
            pose.bone.position.copy(pose.position);
            pose.bone.quaternion.copy(pose.quaternion);
            pose.bone.scale.copy(pose.scale);
        }
        model.matrixWorldNeedsUpdate = savedModelMatrixNeedsUpdate;
        model.updateMatrixWorld(true);
    }

    return phaseClips;
}

// 根据当前动画时间采样左右脚运行时相位，用于支撑脚判断和调试显示。
export function sampleFootPhaseRuntime(phaseClip, normalizedTime, duration) {
    if (!phaseClip) {
        return {
            left: createFootPhaseRuntimeState(),
            right: createFootPhaseRuntimeState(),
        };
    }

    return {
        left: sampleFootPhaseRuntimeSide(phaseClip.left, normalizedTime, duration),
        right: sampleFootPhaseRuntimeSide(phaseClip.right, normalizedTime, duration),
    };
}

// 收集模型层级下的全部骨骼，用于离线采样后恢复姿态。
function collectBones(root) {
    const bones = [];
    root?.traverse(obj => {
        if (obj.isBone) bones.push(obj);
    });
    return bones;
}

// 只分析循环移动动画，跳过 idle、jump 等非步态片段。
function shouldAnalyzeFootPhaseClip(clip) {
    if (!clip?.duration || clip.duration <= 0) return false;
    return /walk|run/i.test(clip.name);
}

// 对单个动画片段离线采样，生成左右脚相位数据。
function sampleFootPhaseClip(model, mixer, clip, legs, options) {
    const action = mixer.clipAction(clip);
    action.reset();
    action.setEffectiveWeight(1);
    action.play();

    const sampleCount = Math.max(16, options.sampleCount);
    const samples = [];
    for (let i = 0; i < sampleCount; i++) {
        const normalizedTime = i / sampleCount;
        mixer.setTime(normalizedTime * clip.duration);
        model.updateMatrixWorld(true);
        samples.push({
            time: normalizedTime,
            left: getFootPhaseSample(model, legs.left),
            right: getFootPhaseSample(model, legs.right),
        });
    }

    action.stop();

    return {
        name: clip.name,
        duration: clip.duration,
        left: analyzeFootPhaseSide(samples, "left", options),
        right: analyzeFootPhaseSide(samples, "right", options),
    };
}

// 采样单只脚在动画中的高度和水平位置。高度取 foot/toe 更低者，水平位置用 foot 做相位速度判断。
function getFootPhaseSample(model, leg) {
    const foot = leg.foot.getWorldPosition(tmpFoot);
    const toeY = leg.toe ? leg.toe.getWorldPosition(tmpToe).y : foot.y;
    const contactY = Math.min(foot.y, toeY);
    const footY = foot.y;
    model.worldToLocal(foot);
    return {
        y: contactY,
        footY,
        x: foot.x,
        z: foot.z,
    };
}

// 分析单只脚的落地相位。高度只作为候选，水平速度和主接触段过滤用来剔除摆动脚擦地。
function analyzeFootPhaseSide(samples, sideKey, options) {
    let minY = Infinity;
    for (const sample of samples) minY = Math.min(minY, sample[sideKey].y);

    const speeds = calculateFootPhaseSpeeds(samples, sideKey);
    const heightContacts = samples.map(sample => sample[sideKey].y <= minY + options.groundThreshold);
    const speedContacts = filterFootPhaseBySpeed(heightContacts, speeds, options.speedSlack);
    const filtered = keepMainFootContactRun(filterShortFootContacts(speedContacts, options.minContactRatio));
    const land = [];
    const landOffsets = [];
    const lift = [];

    for (let i = 0; i < filtered.length; i++) {
        const prev = filtered[(i - 1 + filtered.length) % filtered.length];
        const cur = filtered[i];
        if (!prev && cur) {
            land.push(samples[i].time);
            landOffsets.push({
                x: samples[i][sideKey].x,
                z: samples[i][sideKey].z,
            });
        }
        if (prev && !cur) lift.push(samples[i].time);
    }

    return {
        minY,
        samples: samples.map(sample => ({
            time: sample.time,
            x: sample[sideKey].x,
            z: sample[sideKey].z,
            y: sample[sideKey].footY,
        })),
        contacts: filtered,
        speeds,
        land,
        landOffsets,
        lift,
    };
}

// 计算脚在动画相位中的水平速度。摆动脚即使高度很低，通常 XZ 速度也会明显大于支撑脚。
function calculateFootPhaseSpeeds(samples, sideKey) {
    const speeds = [];
    for (let i = 0; i < samples.length; i++) {
        const prev = samples[(i - 1 + samples.length) % samples.length][sideKey];
        const next = samples[(i + 1) % samples.length][sideKey];
        speeds.push(Math.hypot(next.x - prev.x, next.z - prev.z));
    }
    return speeds;
}

// 在低高度候选点中继续过滤水平速度，避免摆动脚中途擦过地面被当成 plant。
function filterFootPhaseBySpeed(contacts, speeds, speedSlack) {
    const contactSpeeds = speeds.filter((speed, index) => contacts[index]).sort((a, b) => a - b);
    if (contactSpeeds.length === 0) return contacts.slice();

    const median = contactSpeeds[Math.floor(contactSpeeds.length * 0.5)];
    const p75 = contactSpeeds[Math.floor(contactSpeeds.length * 0.75)];
    const threshold = Math.max(median, p75) * speedSlack;
    return contacts.map((contact, index) => contact && speeds[index] <= threshold);
}

// 去掉过短的接触段，避免脚尖高度抖动产生零碎 plant。
function filterShortFootContacts(contacts, minContactRatio) {
    const minLen = Math.max(1, Math.round(contacts.length * minContactRatio));
    const filtered = contacts.slice();

    for (const run of getCircularContactRuns(contacts, true)) {
        if (run.indices.length >= minLen) continue;
        for (const index of run.indices) filtered[index] = false;
    }

    return filtered;
}

// 每只脚在一个循环里通常只有一个主要支撑段，保留最长的接触段可去掉中途擦地的假 plant。
function keepMainFootContactRun(contacts) {
    const runs = getCircularContactRuns(contacts, true);
    if (runs.length <= 1) return contacts;

    const mainRun = runs.sort((a, b) => b.indices.length - a.indices.length)[0];
    const filtered = new Array(contacts.length).fill(false);
    for (const index of mainRun.indices) filtered[index] = true;
    return filtered;
}

// 提取循环数组中连续相同值的片段，处理首尾相连的动画循环。
function getCircularContactRuns(values, targetValue) {
    const runs = [];
    const visited = new Array(values.length).fill(false);

    const start = values.findIndex((value, index) => {
        const prev = values[(index - 1 + values.length) % values.length];
        return value === targetValue && prev !== targetValue;
    });
    if (start < 0) {
        return values[0] === targetValue
            ? [{ indices: values.map((_, index) => index) }]
            : runs;
    }

    for (let offset = 0; offset < values.length; offset++) {
        const i = (start + offset) % values.length;
        if (visited[i] || values[i] !== targetValue) continue;

        const indices = [];
        let j = i;
        while (!visited[j] && values[j] === targetValue) {
            visited[j] = true;
            indices.push(j);
            j = (j + 1) % values.length;
            if (j === i) break;
        }
        runs.push({ indices });
    }

    return runs;
}

// 根据当前归一化时间，计算单脚是否支撑、摆腿进度和下一次落点。
function sampleFootPhaseRuntimeSide(sideData, normalizedTime, duration) {
    const sampleCount = sideData.contacts.length;
    const sampleIndex = Math.floor(normalizedTime * sampleCount) % sampleCount;
    const planted = !!sideData.contacts[sampleIndex];
    const nextLandInfo = nextPhaseEventInfo(sideData.land, normalizedTime);
    const nextLand = nextLandInfo?.time ?? null;
    const nextLift = nextPhaseEvent(sideData.lift, normalizedTime);
    const prevLift = prevPhaseEvent(sideData.lift, normalizedTime);
    const swingSpan = wrapPhaseDistance(prevLift, nextLand) || 1;
    const swingDone = wrapPhaseDistance(prevLift, normalizedTime);

    return {
        planted,
        progress: planted ? 1 : MathUtils.clamp(swingDone / swingSpan, 0, 1),
        timeToLand: wrapPhaseDistance(normalizedTime, nextLand) * duration,
        nextLand,
        prevLift,
        nextLandOffset: nextLandInfo?.index !== undefined
            ? sideData.landOffsets[nextLandInfo.index] ?? null
            : null,
        nextLift,
        swingSpan,
    };
}

// 查找循环时间轴上距离当前时间最近的下一个事件，并保留事件索引。
function nextPhaseEventInfo(events, normalizedTime) {
    if (!events.length) return null;
    let bestIndex = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < events.length; i++) {
        const distance = wrapPhaseDistance(normalizedTime, events[i]);
        if (distance < bestDistance) {
            bestIndex = i;
            bestDistance = distance;
        }
    }
    return {
        index: bestIndex,
        time: events[bestIndex],
    };
}

// 查找循环时间轴上的下一个事件。
function nextPhaseEvent(events, normalizedTime) {
    if (!events.length) return null;
    let best = events[0];
    let bestDistance = Infinity;
    for (const eventTime of events) {
        const distance = wrapPhaseDistance(normalizedTime, eventTime);
        if (distance < bestDistance) {
            best = eventTime;
            bestDistance = distance;
        }
    }
    return best;
}

// 查找循环时间轴上的上一个事件。
function prevPhaseEvent(events, normalizedTime) {
    if (!events.length) return normalizedTime;
    let best = events[0];
    let bestDistance = Infinity;
    for (const eventTime of events) {
        const distance = wrapPhaseDistance(eventTime, normalizedTime);
        if (distance < bestDistance) {
            best = eventTime;
            bestDistance = distance;
        }
    }
    return best;
}

// 计算归一化循环时间轴上的前向距离。
function wrapPhaseDistance(from, to) {
    if (from === null || to === null) return 0;
    return (to - from + 1) % 1;
}
