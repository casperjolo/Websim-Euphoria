import * as THREE from "three";
import { MapControls } from "three/examples/jsm/controls/MapControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { retargetClip } from "three/examples/jsm/utils/SkeletonUtils.js";
import { playerController } from "../src/PlayerController";

const base = import.meta.env.BASE_URL.endsWith("/")
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`;
const asset = (path) => `${base}${path.replace(/^\.\//, "")}`;

const PLAYER_SCALE = 0.01;
const FRED_RETARGET_SCALE = 0.01;
const FRED_BONE_MAP = Object.freeze({
    SKEL_Pelvis_00: "mixamorigHips",
    SKEL_L_Thigh_01: "mixamorigLeftUpLeg",
    SKEL_L_Calf_02: "mixamorigLeftLeg",
    SKEL_L_Foot_03: "mixamorigLeftFoot",
    SKEL_L_Foot_end_021: "mixamorigLeftToeBase",
    SKEL_R_Thigh_04: "mixamorigRightUpLeg",
    SKEL_R_Calf_05: "mixamorigRightLeg",
    SKEL_R_Foot_06: "mixamorigRightFoot",
    SKEL_R_Foot_end_022: "mixamorigRightToeBase",
    SKEL_Spine_Root_07: "mixamorigSpine",
    SKEL_Spine1_08: "mixamorigSpine1",
    SKEL_Spine2_09: "mixamorigSpine2",
    // Fred has one extra spine joint; reuse the upper Mixamo spine orientation.
    SKEL_Spine3_010: "mixamorigSpine2",
    SKEL_L_Clavicle_011: "mixamorigLeftShoulder",
    SKEL_L_UpperArm_012: "mixamorigLeftArm",
    SKEL_L_Forearm_013: "mixamorigLeftForeArm",
    SKEL_L_Hand_014: "mixamorigLeftHand",
    SKEL_L_Hand_end_023: "mixamorigLeftHand",
    SKEL_R_Clavicle_015: "mixamorigRightShoulder",
    SKEL_R_UpperArm_016: "mixamorigRightArm",
    SKEL_R_Forearm_017: "mixamorigRightForeArm",
    SKEL_R_Hand_018: "mixamorigRightHand",
    SKEL_R_Hand_end_024: "mixamorigRightHand",
    SKEL_Neck_1_019: "mixamorigNeck",
    SKEL_Head_020: "mixamorigHead",
    SKEL_Head_end_025: "mixamorigHead",
});
const LEVEL_SIZE = 96;
const HALF_LEVEL = LEVEL_SIZE / 2;
const spawn = new THREE.Vector3(-32, 3, -34);
const vehicleSpawn = new THREE.Vector3(-30.5, 0, -34);
const scene = new THREE.Scene();
const state = {
    player: null,
    vehicle: null,
    ready: false,
    started: false,
    elapsed: 0,
    cash: 2450,
    wanted: 0,
    lastHudUpdate: 0,
    lastMapUpdate: 0,
    colliderDebug: false,
    dynamicDebug: false,
    platformsPaused: false,
};

let camera;
let renderer;
let controls;
let gltfLoader;
let lastFrame = performance.now();
let toastTimer;
let staticColliderGroup;
let detailGroup;
let kinematicPlatforms = [];
let dynamicBodies = [];

const dom = {
    container: document.querySelector("#container"),
    loading: document.querySelector("#loading"),
    loadingFill: document.querySelector("#loading-fill"),
    loadingPercent: document.querySelector("#loading-percent"),
    loadingLabel: document.querySelector("#loading-label"),
    loadingDetail: document.querySelector("#loading-detail"),
    wantedStars: document.querySelector("#wanted-stars"),
    wantedLabel: document.querySelector("#wanted-label"),
    cash: document.querySelector("#cash"),
    clock: document.querySelector("#clock"),
    prompt: document.querySelector("#prompt"),
    promptText: document.querySelector("#prompt-text"),
    toast: document.querySelector("#toast"),
    toastTitle: document.querySelector("#toast-title"),
    toastCopy: document.querySelector("#toast-copy"),
    vehicleCard: document.querySelector("#vehicle-card"),
    vehicleState: document.querySelector("#vehicle-state"),
    vehicleMeta: document.querySelector("#vehicle-meta"),
    speed: document.querySelector("#speed-value"),
    gear: document.querySelector("#gear-value"),
    map: document.querySelector("#minimap"),
    mapCoords: document.querySelector("#map-coords"),
    crosshair: document.querySelector("#crosshair"),
};

function setLoading(progress, label, detail) {
    const value = Math.max(0, Math.min(100, Math.round(progress)));
    dom.loadingFill.style.width = `${value}%`;
    dom.loadingPercent.textContent = `${value}%`;
    if (label) dom.loadingLabel.textContent = label;
    if (detail) dom.loadingDetail.textContent = detail;
}

function loadModel(url, label, start, end) {
    return new Promise((resolve, reject) => {
        gltfLoader.load(
            url,
            (gltf) => {
                setLoading(end, label, "Asset ready");
                resolve(gltf);
            },
            (event) => {
                const ratio = event.total > 0 ? event.loaded / event.total : 0.5;
                setLoading(start + (end - start) * ratio, label, "Streaming test assets…");
            },
            (error) => reject(new Error(`${label} failed: ${error?.message ?? "GLB request failed"}`, { cause: error })),
        );
    });
}

function setupRenderer() {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(dom.container.clientWidth, dom.container.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.setAttribute("aria-label", "Euphoria City gridbox test level");
    dom.container.appendChild(renderer.domElement);

    camera = new THREE.PerspectiveCamera(
        58,
        dom.container.clientWidth / dom.container.clientHeight,
        0.05,
        240,
    );
    camera.position.set(spawn.x + 7, spawn.y + 4, spawn.z + 9);
    camera.lookAt(spawn.x, spawn.y, spawn.z);

    controls = new MapControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.enableZoom = false;
    controls.maxPolarAngle = Math.PI * 0.48;
    controls.minDistance = 0.05;
    controls.maxDistance = 3;
    controls.target.copy(spawn);

    scene.background = new THREE.Color(0x111a25);
    scene.fog = new THREE.Fog(0x111a25, 58, 145);

    scene.add(new THREE.HemisphereLight(0x9ab9d8, 0x10151b, 2.1));

    const sun = new THREE.DirectionalLight(0xffd7a0, 4.2);
    sun.position.set(-36, 48, 20);
    sun.target.position.set(0, 0, 0);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 150;
    sun.shadow.camera.left = -60;
    sun.shadow.camera.right = 60;
    sun.shadow.camera.top = 60;
    sun.shadow.camera.bottom = -60;
    sun.shadow.bias = -0.0002;
    sun.shadow.normalBias = 0.02;
    scene.add(sun, sun.target);

    const fill = new THREE.DirectionalLight(0x6c9dff, 1.25);
    fill.position.set(38, 20, -35);
    scene.add(fill);
}

function setupLoader() {
    // The player and vehicle files are self-contained GLBs, so no remote decoder is needed.
    gltfLoader = new GLTFLoader();
}

function material(color, options = {}) {
    return new THREE.MeshStandardMaterial({
        color,
        roughness: options.roughness ?? 0.72,
        metalness: options.metalness ?? 0.1,
        emissive: options.emissive ?? 0x000000,
        emissiveIntensity: options.emissiveIntensity ?? 0,
    });
}

function addOutline(mesh, color = 0x9fb6ca) {
    const outline = new THREE.LineSegments(
        new THREE.EdgesGeometry(mesh.geometry, 28),
        new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.34 }),
    );
    outline.position.copy(mesh.position);
    outline.quaternion.copy(mesh.quaternion);
    outline.scale.copy(mesh.scale);
    detailGroup.add(outline);
    return outline;
}

function addBox({ position, size, color = 0x30465a, emissive = 0x000000, outline = 0x9fb6ca, collider = true, rotationY = 0 }) {
    const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(size.x, size.y, size.z),
        material(color, { emissive, emissiveIntensity: emissive ? 0.7 : 0 }),
    );
    mesh.position.copy(position);
    mesh.rotation.y = rotationY;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (collider) staticColliderGroup.add(mesh);
    else scene.add(mesh);
    if (outline) addOutline(mesh, outline);
    return mesh;
}

function addZonePad(x, z, width, depth, color) {
    const pad = new THREE.Mesh(
        new THREE.BoxGeometry(width, 0.06, depth),
        material(color, { emissive: color, emissiveIntensity: 0.22, roughness: 0.85 }),
    );
    pad.position.set(x, 0.035, z);
    pad.receiveShadow = true;
    detailGroup.add(pad);

    const border = new THREE.LineSegments(
        new THREE.EdgesGeometry(pad.geometry),
        new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 }),
    );
    border.position.copy(pad.position);
    detailGroup.add(border);
}

function addStripe(position, size, color) {
    return addBox({
        position: new THREE.Vector3(position.x, 0.085, position.z),
        size: new THREE.Vector3(size.x, 0.035, size.z),
        color,
        emissive: color,
        outline: null,
        collider: false,
    });
}

function createRampGeometry(width, height, depth) {
    const w = width / 2;
    const d = depth / 2;
    const vertices = new Float32Array([
        -w, 0, -d,  w, 0, -d,
        -w, 0, d,   w, 0, d,
        -w, height, d, w, height, d,
    ]);
    const indices = [
        0, 1, 3, 0, 3, 2, // base
        0, 5, 1, 0, 4, 5, // slope
        0, 2, 4, // left side
        1, 5, 3, // right side
        2, 3, 5, 2, 5, 4, // back wall
    ];
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
}

function addRamp(position, width, height, depth, color) {
    const mesh = new THREE.Mesh(
        createRampGeometry(width, height, depth),
        material(color, { roughness: 0.62, metalness: 0.18 }),
    );
    mesh.position.copy(position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    staticColliderGroup.add(mesh);
    addOutline(mesh, 0x9fb6ca);
    return mesh;
}

function makeLabelTexture(title, subtitle, color) {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 144;
    const context = canvas.getContext("2d");
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "rgba(12, 18, 26, .9)";
    context.fillRect(3, 3, 634, 138);
    context.strokeStyle = `#${color.toString(16).padStart(6, "0")}`;
    context.lineWidth = 5;
    context.strokeRect(3, 3, 634, 138);
    context.fillStyle = "#f4f0e8";
    context.font = "800 52px Barlow Condensed, Impact, sans-serif";
    context.textAlign = "left";
    context.textBaseline = "middle";
    context.fillText(title, 28, 57);
    context.fillStyle = `#${color.toString(16).padStart(6, "0")}`;
    context.font = "500 21px DM Mono, monospace";
    context.fillText(subtitle, 30, 108);
    return new THREE.CanvasTexture(canvas);
}

function addLevelLabel(title, subtitle, position, color = 0xd7f25b, scale = 5.4) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: makeLabelTexture(title, subtitle, color),
        transparent: true,
        depthTest: false,
        depthWrite: false,
    }));
    sprite.position.copy(position);
    sprite.scale.set(scale, scale * 0.225, 1);
    sprite.renderOrder = 15;
    detailGroup.add(sprite);
    return sprite;
}

function addBeacon(position, color) {
    const light = new THREE.PointLight(color, 7, 15, 2);
    light.position.copy(position).setY(4.2);
    scene.add(light);

    const beacon = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.12, 2.5, 8),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8 }),
    );
    beacon.position.copy(position).setY(1.25);
    detailGroup.add(beacon);
    return beacon;
}

function createTestLevel() {
    staticColliderGroup = new THREE.Group();
    staticColliderGroup.name = "gridbox-static-colliders";
    detailGroup = new THREE.Group();
    detailGroup.name = "gridbox-details";
    scene.add(staticColliderGroup, detailGroup);

    const grid = new THREE.GridHelper(LEVEL_SIZE, 48, 0x5f7d98, 0x294155);
    grid.position.y = 0.012;
    grid.material.transparent = true;
    grid.material.opacity = 0.58;
    grid.userData.excludeFromCollider = true;
    scene.add(grid);

    // The single floor and perimeter make the test space easy to reason about.
    addBox({ position: new THREE.Vector3(0, -0.5, 0), size: new THREE.Vector3(LEVEL_SIZE, 1, LEVEL_SIZE), color: 0x1b2937, outline: 0x526b80 });
    addBox({ position: new THREE.Vector3(-HALF_LEVEL + 0.5, 4, 0), size: new THREE.Vector3(1, 8, LEVEL_SIZE), color: 0x223444, outline: 0x526b80 });
    addBox({ position: new THREE.Vector3(HALF_LEVEL - 0.5, 4, 0), size: new THREE.Vector3(1, 8, LEVEL_SIZE), color: 0x223444, outline: 0x526b80 });
    addBox({ position: new THREE.Vector3(0, 4, -HALF_LEVEL + 0.5), size: new THREE.Vector3(LEVEL_SIZE, 8, 1), color: 0x223444, outline: 0x526b80 });
    addBox({ position: new THREE.Vector3(0, 4, HALF_LEVEL - 0.5), size: new THREE.Vector3(LEVEL_SIZE, 8, 1), color: 0x223444, outline: 0x526b80 });

    // 01 — flat movement, acceleration, sprinting and jump clearance.
    addZonePad(-31, -17, 27, 25, 0x4b8cff);
    addLevelLabel("01 / MOVEMENT", "WASD  ·  SHIFT  ·  SPACE", new THREE.Vector3(-31, 6.2, -17), 0x83b9ff);
    addStripe(new THREE.Vector3(-31, -28), new THREE.Vector2(22, 0.32), 0x83b9ff);
    addStripe(new THREE.Vector3(-31, -6), new THREE.Vector2(22, 0.32), 0x83b9ff);
    addBox({ position: new THREE.Vector3(-40, 0.55, -17), size: new THREE.Vector3(1.2, 1.1, 5), color: 0x315d99, outline: 0x83b9ff });
    addBox({ position: new THREE.Vector3(-23, 0.85, -17), size: new THREE.Vector3(1.2, 1.7, 5), color: 0x315d99, outline: 0x83b9ff });
    addBox({ position: new THREE.Vector3(-31, 0.38, -10), size: new THREE.Vector3(5, 0.75, 1.2), color: 0x315d99, outline: 0x83b9ff });

    // 02 — stair stepping with a second, offset staircase for descending.
    addZonePad(-12, -17, 11, 25, 0xd18cff);
    addLevelLabel("02 / STAIRS", "STEP HEIGHT  ·  CAPSULE CONTACT", new THREE.Vector3(-12, 6.2, -17), 0xd18cff, 4.8);
    for (let i = 0; i < 8; i += 1) {
        const height = 0.34 * (i + 1);
        addBox({
            position: new THREE.Vector3(-12, height / 2, -26 + i * 2.15),
            size: new THREE.Vector3(6.7, height, 2.2),
            color: 0x624678,
            outline: 0xd18cff,
        });
    }
    for (let i = 0; i < 6; i += 1) {
        const height = 0.28 * (i + 1);
        addBox({
            position: new THREE.Vector3(-12, height / 2, -7 + i * 1.85),
            size: new THREE.Vector3(3.8, height, 1.9),
            color: 0x4d3a5c,
            outline: 0xd18cff,
        });
    }

    // 03 — ramps and slope normals.
    addZonePad(8, -18, 25, 23, 0xffb45c);
    addLevelLabel("03 / RAMPS", "SLOPE NORMALS  ·  CAMERA COLLISION", new THREE.Vector3(8, 7.2, -18), 0xffb45c, 4.8);
    addRamp(new THREE.Vector3(2.5, 0, -18), 7, 3.2, 12, 0x8b5b31);
    addRamp(new THREE.Vector3(13.5, 0, -18), 7, 4.8, 12, 0x8b5b31);
    addBox({ position: new THREE.Vector3(8, 0.25, -10), size: new THREE.Vector3(21, 0.5, 1), color: 0x9d6a36, outline: 0xffb45c });
    addStripe(new THREE.Vector3(2.5, -22), new THREE.Vector2(5, 0.28), 0xffb45c);
    addStripe(new THREE.Vector3(13.5, -22), new THREE.Vector2(5, 0.28), 0xffb45c);

    // 04 — wall sliding, squeeze tests and camera obstruction.
    addZonePad(32, -18, 17, 23, 0xff654e);
    addLevelLabel("04 / WALLS", "SLIDE  ·  SQUEEZE  ·  CAMERA", new THREE.Vector3(32, 6.2, -18), 0xff654e, 4.6);
    addBox({ position: new THREE.Vector3(26, 2.1, -22), size: new THREE.Vector3(1.2, 4.2, 12), color: 0x873f3e, outline: 0xff654e });
    addBox({ position: new THREE.Vector3(38, 2.1, -15), size: new THREE.Vector3(1.2, 4.2, 12), color: 0x873f3e, outline: 0xff654e });
    addBox({ position: new THREE.Vector3(32, 1.6, -9), size: new THREE.Vector3(13, 3.2, 1.2), color: 0x873f3e, outline: 0xff654e });
    addBox({ position: new THREE.Vector3(32, 0.65, -28), size: new THREE.Vector3(7, 1.3, 1.2), color: 0x873f3e, outline: 0xff654e });

    // 05 — moving platforms; the controller carries the player from their frame delta.
    addZonePad(-27, 15, 25, 19, 0x62e6bd);
    addLevelLabel("05 / KINEMATIC", "MOVERS  ·  PLATFORM CARRY", new THREE.Vector3(-27, 7.1, 15), 0x62e6bd, 4.9);
    addBox({ position: new THREE.Vector3(-37, 1.6, 15), size: new THREE.Vector3(1.3, 3.2, 12), color: 0x2d6d64, outline: 0x62e6bd });
    addBox({ position: new THREE.Vector3(-17, 1.6, 15), size: new THREE.Vector3(1.3, 3.2, 12), color: 0x2d6d64, outline: 0x62e6bd });
    addBox({ position: new THREE.Vector3(-27, 0.65, 23), size: new THREE.Vector3(12, 1.3, 1.3), color: 0x2d6d64, outline: 0x62e6bd });
    addBeacon(new THREE.Vector3(-27, 0, 15), 0x62e6bd);

    // 06 — dynamic boxes and spheres inside a low-walled test pen.
    addZonePad(10, 16, 25, 20, 0xd7f25b);
    addLevelLabel("06 / DYNAMICS", "PUSH  ·  IMPULSE  ·  RESTITUTION", new THREE.Vector3(10, 7.1, 16), 0xd7f25b, 4.8);
    addBox({ position: new THREE.Vector3(-1, 0.9, 16), size: new THREE.Vector3(1, 1.8, 14), color: 0x5b6f31, outline: 0xd7f25b });
    addBox({ position: new THREE.Vector3(21, 0.9, 16), size: new THREE.Vector3(1, 1.8, 14), color: 0x5b6f31, outline: 0xd7f25b });
    addBox({ position: new THREE.Vector3(10, 0.9, 25), size: new THREE.Vector3(22, 1.8, 1), color: 0x5b6f31, outline: 0xd7f25b });
    addRamp(new THREE.Vector3(10, 0, 8.8), 8, 2.1, 7, 0x607d32);

    // 07 — vehicle bay and an open straight for suspension / steering tests.
    addZonePad(-30, -35, 26, 13, 0xff654e);
    addLevelLabel("07 / VEHICLE", "E  ENTER  ·  SHIFT  HANDBRAKE  ·  R  RESET", new THREE.Vector3(-30, 5.6, -35), 0xff654e, 4.3);
    addStripe(new THREE.Vector3(-41, -35), new THREE.Vector2(0.28, 8), 0xff654e);
    addStripe(new THREE.Vector3(-19, -35), new THREE.Vector2(0.28, 8), 0xff654e);
    addBox({ position: new THREE.Vector3(-30, 0.45, -28.5), size: new THREE.Vector3(18, 0.9, 1), color: 0x8b3f3a, outline: 0xff654e });

    // Center orientation marker.
    addLevelLabel("GRIDBOX TEST RANGE", "MOVEMENT / COLLISION / VEHICLE MECHANICS", new THREE.Vector3(0, 8.8, 0), 0xf4f0e8, 6.8);
    addBeacon(new THREE.Vector3(0, 0, 0), 0x83b9ff);
}

/**
 * Fred is exported as a rigid-body rig: every visible part is parented to a
 * Bone, but there is no SkinnedMesh for Three.js to bind animation tracks to.
 * A virtual Skeleton gives AnimationMixer's `.bones[...]` bindings a target
 * while keeping Fred's original rigid mesh hierarchy intact.
 */
function prepareFredRetargetTarget(model) {
    model.updateMatrixWorld(true);

    // Fred's source file is centered around the pelvis. The controller expects
    // the model origin to be at the feet when it positions the visual model.
    const bindBounds = new THREE.Box3().setFromObject(model);
    model.position.y -= bindBounds.min.y;
    model.updateMatrixWorld(true);

    const bones = [];
    model.traverse((object) => {
        if (object.isBone) bones.push(object);
    });
    if (!bones.length) throw new Error("Fred retarget target has no bones");

    model.skeleton = new THREE.Skeleton(bones);
    return model;
}

function findSkinnedMesh(model) {
    let result = null;
    model.traverse((object) => {
        if (!result && object.isSkinnedMesh) result = object;
    });
    return result;
}

function createFredLocalOffsets(target, sourceModel) {
    const offsets = {};
    const sourceQuaternion = new THREE.Quaternion();
    const targetQuaternion = new THREE.Quaternion();

    sourceModel.updateMatrixWorld(true);
    target.updateMatrixWorld(true);

    for (const [targetName, sourceName] of Object.entries(FRED_BONE_MAP)) {
        const targetBone = target.getObjectByName(targetName);
        const sourceBone = sourceModel.getObjectByName(sourceName);
        if (!targetBone || !sourceBone) {
            throw new Error(`Fred retarget mapping missing: ${targetName} → ${sourceName}`);
        }

        // SkeletonUtils transfers world rotations. This offset converts the
        // Mixamo rest-pose axes into Fred's rest-pose axes before each track is
        // written, which is required because the two rigs use different bone
        // coordinate frames.
        targetBone.getWorldQuaternion(targetQuaternion);
        sourceBone.getWorldQuaternion(sourceQuaternion);
        offsets[targetName] = new THREE.Matrix4().makeRotationFromQuaternion(
            sourceQuaternion.clone().invert().multiply(targetQuaternion),
        );
    }

    return offsets;
}

function makeRetargetableClip(sourceClip) {
    if (sourceClip.duration > 0) return sourceClip;

    // A few of Josh's hover clips are single-key, zero-duration poses.
    // SkeletonUtils samples by duration, so give those poses two identical
    // keys over a tiny interval before retargeting them.
    const frame = 1 / 30;
    const tracks = sourceClip.tracks.map((track) => {
        const valueSize = track.getValueSize();
        const firstValues = track.values.slice(0, valueSize);
        const values = new track.values.constructor(valueSize * 2);
        values.set(firstValues, 0);
        values.set(firstValues, valueSize);
        return new track.constructor(track.name, new Float32Array([0, frame]), values);
    });
    return new THREE.AnimationClip(`${sourceClip.name} static source`, frame * 2, tracks);
}

function retargetFredAnimations(model, sourceModel, sourceAnimations) {
    const sourceMesh = findSkinnedMesh(sourceModel);
    if (!sourceMesh) throw new Error("Josh animation source has no skinned mesh");
    if (!sourceAnimations?.length) throw new Error("Josh animation source has no clips");

    const localOffsets = createFredLocalOffsets(model, sourceModel);
    const animations = sourceAnimations.map((sourceClip) => {
        const clip = retargetClip(model, sourceMesh, makeRetargetableClip(sourceClip), {
            names: FRED_BONE_MAP,
            localOffsets,
            hip: "mixamorigHips",
            scale: FRED_RETARGET_SCALE,
            useFirstFramePosition: true,
            fps: 30,
        });
        clip.name = sourceClip.name;
        return clip;
    });

    // Do not leave the target in the last sampled source pose while the
    // controller creates its mixer and chooses the initial idle action.
    model.skeleton.pose();
    model.updateMatrixWorld(true);
    return animations;
}

function configurePlayerModel(model, animations) {
    return {
        model,
        animations: animations ?? [],
        scale: PLAYER_SCALE,
        idleAnim: "idle1",
        walkAnim: "walk",
        runAnim: "run",
        jumpAnim: ["jump", "Jump_Loop", "Jump_Land"],
        flyAnim: "fly",
        flyIdleAnim: "flyIdle",
        flyHoverForwardAnim: "flyHoverForward",
        flyHoverBackAnim: "flyHoverBack",
        flyHoverLeftAnim: "flyHoverLeft",
        flyHoverRightAnim: "flyHoverRight",
        flyHoverUpAnim: "flyHoverUp",
        flyHoverDownAnim: "flyHoverDown",
        drivingAnim: "Driving_Loop",
        headBoneName: "SKEL_Head_020",
        rotateY: Math.PI,
    };
}

function setupPlayer(modelGltf, animations) {
    state.player = new playerController();
    return state.player.init({
        scene,
        camera,
        controls,
        playerModelConfig: configurePlayerModel(modelGltf.scene, animations),
        initPos: spawn,
        minCamDistance: 5,
        maxCamDistance: 260,
        camLookAtHeightRatio: 0.52,
        enableSpringCamera: true,
        springCameraTime: 0.12,
        enableOverShoulderView: true,
        camOverShoulderOffsetRatio: 0.02,
        enableZoom: true,
        isShowMobileControls: true,
        colliders: [
            { motion: "static", shape: { kind: "mesh", source: staticColliderGroup } },
        ],
    });
}

function configureVehicle(model) {
    return {
        model,
        scale: 0.5,
        wheelsNames: ["Wheel_LF", "Wheel_RF", "Wheel_LR", "Wheel_RR"],
        position: vehicleSpawn.clone(),
        driverSeatPosition: new THREE.Vector3(-0.6, 1.0, 0.4),
        driverSeatRotation: -Math.PI / 2,
        followVehicleDirection: true,
        chassis: {
            density: 1,
            linearDamping: 0.05,
            angularDamping: 0.5,
            clearance: 0.25,
            sizeScale: { x: 0.9, y: 0.65, z: 0.9 },
        },
        suspension: {
            restLength: 0.15,
            maxTravel: 0.15,
            stiffness: 25,
            compression: 2.1,
            relaxation: 2.5,
            maxForce: 6000,
            frictionSlip: 8,
            sideFrictionStiffness: 1,
            rollInfluence: 0.12,
        },
        steering: {
            maxSteerAngle: Math.PI / 5,
            steerTime: 0.45,
            steerReturnTimeSlow: 0.55,
            steerReturnTimeFast: 0.4,
            highSpeedSteerScale: 0.3,
        },
        grip: {
            maxG: 1.2,
            sideFrictionIdle: 1,
            sideFrictionFrontMin: 0.55,
            sideFrictionRearMin: 0.45,
            handbrakeRearFriction: 0.35,
            handbrakeRearDriveScale: 0.65,
            handbrakeReleaseTime: 0.15,
            wheelbaseRatio: 0.55,
        },
        power: {
            maxSpeed: 120,
            acceleration: 7,
            deceleration: 8,
        },
    };
}

function setupVehicle(modelGltf) {
    return state.player.loadVehicleModel(configureVehicle(modelGltf.scene)).then((vehicle) => {
        state.vehicle = vehicle;
        if (!vehicle) throw new Error("Vehicle could not be initialized");
        vehicle.vehicleGroup.traverse((object) => {
            if (!object.isMesh) return;
            object.castShadow = true;
            object.receiveShadow = true;
        });
        return vehicle;
    });
}

function createKinematicPlatform(position, size, color, motion) {
    const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(size.x, size.y, size.z),
        material(color, { emissive: color, emissiveIntensity: 0.3, metalness: 0.28 }),
    );
    mesh.position.copy(position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    const outline = addOutline(mesh, color);

    const handle = state.player.addCollider({
        motion: "kinematic",
        shape: { kind: "mesh", source: mesh },
        follow: mesh,
    });
    kinematicPlatforms.push({ mesh, outline, origin: position.clone(), motion, handle, time: motion.phase ?? 0 });
}

function setupKinematicPlatforms() {
    createKinematicPlatform(
        new THREE.Vector3(-27, 2.25, 15),
        new THREE.Vector3(5.5, 0.5, 5.5),
        0x62e6bd,
        { axis: "x", distance: 5.5, speed: 0.55, phase: 0 },
    );
    createKinematicPlatform(
        new THREE.Vector3(-27, 1.5, 20),
        new THREE.Vector3(4, 0.5, 4),
        0x83b9ff,
        { axis: "y", distance: 2.8, speed: 0.8, phase: Math.PI / 2 },
    );
    createKinematicPlatform(
        new THREE.Vector3(-20, 3.2, 15),
        new THREE.Vector3(3.5, 0.5, 3.5),
        0xd18cff,
        { axis: "z", distance: 5, speed: 0.45, phase: Math.PI },
    );
}

function updateKinematicPlatforms(dt) {
    if (state.platformsPaused) return;
    for (const platform of kinematicPlatforms) {
        platform.time += dt * platform.motion.speed;
        const offset = Math.sin(platform.time) * platform.motion.distance;
        platform.mesh.position.copy(platform.origin);
        platform.mesh.position[platform.motion.axis] += offset;
        platform.outline.position.copy(platform.mesh.position);
        platform.outline.quaternion.copy(platform.mesh.quaternion);
        platform.outline.scale.copy(platform.mesh.scale);
    }
}

function dynamicMaterial(color) {
    return material(color, { roughness: 0.45, metalness: 0.18, emissive: color, emissiveIntensity: 0.12 });
}

function addDynamicBox(position, halfExtents, color, options = {}) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), dynamicMaterial(color));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    const body = state.player.dynamics.addBox({
        motion: "dynamic",
        shape: { kind: "box", halfExtents: halfExtents.clone(), position: position.clone() },
        mesh,
        density: options.density ?? 1,
        restitution: options.restitution ?? 0.28,
        friction: options.friction ?? 0.8,
        linearDamping: options.linearDamping ?? 0.32,
        angularDamping: options.angularDamping ?? 0.5,
        velocity: options.velocity,
        angularVelocity: options.angularVelocity,
    });
    dynamicBodies.push({
        body,
        initialPosition: position.clone(),
        initialQuaternion: body.quaternion.clone(),
        initialVelocity: options.velocity?.clone() ?? new THREE.Vector3(),
        initialAngularVelocity: options.angularVelocity?.clone() ?? new THREE.Vector3(),
    });
    return body;
}

function addDynamicSphere(position, radius, color, options = {}) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), dynamicMaterial(color));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    const body = state.player.dynamics.addSphere({
        motion: "dynamic",
        shape: { kind: "sphere", radius, position: position.clone() },
        mesh,
        density: options.density ?? 1,
        restitution: options.restitution ?? 0.65,
        friction: options.friction ?? 0.55,
        linearDamping: options.linearDamping ?? 0.18,
        angularDamping: options.angularDamping ?? 0.3,
        velocity: options.velocity,
        angularVelocity: options.angularVelocity,
    });
    dynamicBodies.push({
        body,
        initialPosition: position.clone(),
        initialQuaternion: body.quaternion.clone(),
        initialVelocity: options.velocity?.clone() ?? new THREE.Vector3(),
        initialAngularVelocity: options.angularVelocity?.clone() ?? new THREE.Vector3(),
    });
    return body;
}

function setupDynamicBodies() {
    const colors = [0xff654e, 0x83b9ff, 0xd18cff, 0xd7f25b];
    for (let i = 0; i < 4; i += 1) {
        addDynamicBox(
            new THREE.Vector3(7.4 + (i % 2) * 2.2, 1 + Math.floor(i / 2) * 2.05, 15.2),
            new THREE.Vector3(0.9, 0.9, 0.9),
            colors[i],
            { restitution: 0.24, angularVelocity: new THREE.Vector3(0, (i - 1.5) * 0.8, 0) },
        );
    }
    for (let i = 0; i < 4; i += 1) {
        addDynamicSphere(
            new THREE.Vector3(13.5 + (i % 2) * 2.2, 1.2 + Math.floor(i / 2) * 2.4, 16.2),
            1.05,
            colors[(i + 1) % colors.length],
            { restitution: 0.78, velocity: new THREE.Vector3((i - 1.5) * 0.2, 0, 0) },
        );
    }
}

function resetDynamicBodies() {
    for (const entry of dynamicBodies) {
        const { body, initialPosition, initialQuaternion, initialVelocity, initialAngularVelocity } = entry;
        body.position.copy(initialPosition);
        body.quaternion.copy(initialQuaternion);
        body.velocity.copy(initialVelocity);
        body.angularVelocity.copy(initialAngularVelocity);
        body.wakeUp();
        body.mesh.position.copy(body.position);
        body.mesh.quaternion.copy(body.quaternion);
    }
}

function showToast(title, copy, duration = 3200) {
    dom.toastTitle.textContent = title;
    dom.toastCopy.textContent = copy;
    dom.toast.classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => dom.toast.classList.remove("visible"), duration);
}

function updatePrompt() {
    if (!state.started || !state.player) {
        dom.prompt.classList.remove("visible");
        return;
    }

    if (state.player.getControllerMode() === 1) {
        dom.promptText.textContent = "Exit vehicle";
        dom.prompt.classList.add("visible");
        return;
    }

    const position = state.player.getPosition();
    const nearVehicle = state.vehicle && position
        ? state.player.vehicle.isInBoardingRange(state.vehicle, position)
        : false;
    if (nearVehicle) {
        dom.promptText.textContent = "Enter sedan";
        dom.prompt.classList.add("visible");
    } else {
        dom.prompt.classList.remove("visible");
    }
}

function updateWantedUI() {
    dom.wantedStars.innerHTML = Array.from({ length: 5 }, (_, index) => (
        `<span class="${index < state.wanted ? "active" : ""}">★</span>`
    )).join("");
    dom.wantedLabel.textContent = state.wanted ? "EYES ON YOU" : "CLEAN";
}

function updateVehicleUI() {
    const driving = state.player?.getControllerMode() === 1 && state.vehicle;
    dom.vehicleCard.classList.toggle("visible", Boolean(driving));
    if (!driving) return;

    const velocity = state.vehicle.chassisBody.linvel();
    const speed = Math.round(Math.hypot(velocity.x, velocity.z) * 3.6);
    dom.speed.textContent = String(Math.min(120, speed));
    dom.gear.textContent = state.player.input.bkd ? "R" : speed > 1 ? "D" : "P";
    dom.vehicleState.textContent = speed > 3 ? "Sedan · Moving" : "Sedan · Street spec";
    dom.vehicleMeta.textContent = state.player.input.shift ? "Handbrake engaged · R reset" : "Handbrake ready · R reset";
}

function updateClock() {
    const totalMinutes = (19 * 60 + 42 + Math.floor(state.elapsed * 0.22)) % (24 * 60);
    const hours = Math.floor(totalMinutes / 60).toString().padStart(2, "0");
    const minutes = (totalMinutes % 60).toString().padStart(2, "0");
    dom.clock.textContent = `${hours}:${minutes}`;
}

function drawMinimap() {
    if (!state.player) return;
    const context = dom.map.getContext("2d");
    const size = dom.map.width;
    const center = size / 2;
    const radius = size * 0.47;
    const position = state.player.getPosition();
    if (!position) return;

    context.clearRect(0, 0, size, size);
    context.save();
    context.beginPath();
    context.arc(center, center, radius, 0, Math.PI * 2);
    context.clip();
    context.fillStyle = "rgba(9, 14, 20, .95)";
    context.fillRect(0, 0, size, size);

    const scale = 3.6;
    const toMap = (x, z) => ({
        x: center + (x - position.x) * scale,
        y: center + (z - position.z) * scale,
    });

    context.lineCap = "square";
    context.lineWidth = 10;
    context.strokeStyle = "rgba(244, 240, 232, .13)";
    const streets = [
        [[-43, -34], [43, -34]],
        [[-43, -5], [43, -5]],
        [[-43, 16], [43, 16]],
        [[-33, -43], [-33, 43]],
        [[-12, -43], [-12, 43]],
        [[10, -43], [10, 43]],
        [[32, -43], [32, 43]],
    ];
    for (const [[x1, z1], [x2, z2]] of streets) {
        const a = toMap(x1, z1);
        const b = toMap(x2, z2);
        context.beginPath();
        context.moveTo(a.x, a.y);
        context.lineTo(b.x, b.y);
        context.stroke();
    }
    context.lineWidth = 2;
    context.strokeStyle = "rgba(244, 240, 232, .3)";
    for (const [[x1, z1], [x2, z2]] of streets) {
        const a = toMap(x1, z1);
        const b = toMap(x2, z2);
        context.beginPath();
        context.moveTo(a.x, a.y);
        context.lineTo(b.x, b.y);
        context.stroke();
    }

    const heading = new THREE.Vector3(0, 0, -1).applyQuaternion(state.player.getPlayerCapsule().quaternion);
    context.save();
    context.translate(center, center);
    context.rotate(Math.atan2(heading.x, -heading.z));
    context.beginPath();
    context.moveTo(0, -12);
    context.lineTo(8, 9);
    context.lineTo(0, 5);
    context.lineTo(-8, 9);
    context.closePath();
    context.fillStyle = "#ff654e";
    context.fill();
    context.strokeStyle = "#fffaf1";
    context.lineWidth = 2;
    context.stroke();
    context.restore();

    context.restore();
    context.beginPath();
    context.arc(center, center, radius, 0, Math.PI * 2);
    context.strokeStyle = "rgba(244, 240, 232, .4)";
    context.lineWidth = 2;
    context.stroke();
    dom.mapCoords.textContent = `X ${Math.round(position.x).toString().padStart(3, "0")} · Z ${Math.round(position.z).toString().padStart(3, "0")}`;
}

function updateHUD(dt) {
    state.lastHudUpdate += dt;
    state.lastMapUpdate += dt;

    if (state.lastHudUpdate > 0.08) {
        state.lastHudUpdate = 0;
        dom.cash.textContent = `$${state.cash.toLocaleString()}`;
        updateWantedUI();
        updatePrompt();
        updateVehicleUI();
        updateClock();
    }
    if (state.lastMapUpdate > 0.08) {
        state.lastMapUpdate = 0;
        drawMinimap();
    }
}

function animate(now = performance.now()) {
    if (!renderer || !camera) return;
    const dt = Math.min((now - lastFrame) / 1000, 1 / 30);
    lastFrame = now;
    state.elapsed += dt;

    if (state.player && state.started) {
        updateKinematicPlatforms(dt);
        state.player.update(dt);
        updateHUD(dt);
    }

    renderer.render(scene, camera);
}

function toggleColliderDebug() {
    state.colliderDebug = !state.colliderDebug;
    state.player.setColliderDebug(state.colliderDebug);
    showToast("Static collider debug", state.colliderDebug ? "BVH collision meshes visible." : "BVH collision meshes hidden.", 1800);
}

function toggleDynamicDebug() {
    state.dynamicDebug = !state.dynamicDebug;
    state.player.setDynamicBodyDebug(state.dynamicDebug);
    showToast("Dynamic body debug", state.dynamicDebug ? "Rigid-body bounds visible." : "Rigid-body bounds hidden.", 1800);
}

function resetTestLevel() {
    state.player.reset(spawn.clone());
    resetDynamicBodies();
    showToast("Test level reset", "Player and dynamic bodies returned to their start points.", 2000);
}

async function init() {
    try {
        setupRenderer();
        setupLoader();
        createTestLevel();
        setLoading(8, "Building gridbox", "Creating static test colliders…");

        // Josh remains loaded only as the Mixamo animation source. Fred is the
        // sole visible player model in the gridbox experience.
        const animationSourceGltf = await loadModel(asset("glb/josh.glb"), "Loading motion library", 8, 34);
        const playerGltf = await loadModel(asset("glb/Fred.glb"), "Loading Fred character", 34, 60);
        prepareFredRetargetTarget(playerGltf.scene);
        const fredAnimations = retargetFredAnimations(
            playerGltf.scene,
            animationSourceGltf.scene,
            animationSourceGltf.animations,
        );
        await setupPlayer(playerGltf, fredAnimations);
        state.player.getPlayerModel()?.traverse((object) => {
            if (!object.isMesh) return;
            object.castShadow = true;
            object.receiveShadow = true;
        });

        state.player.onViewChange = (isFirstPerson) => {
            dom.crosshair.style.display = isFirstPerson ? "block" : "none";
        };
        state.player.onVehicleEnter = () => showToast("Vehicle entered", "Use this range to test steering, suspension and handbrake.");
        state.player.onVehicleExit = () => showToast("On foot", "Try the stairs, ramps, movers and dynamic pen.", 1800);

        setupKinematicPlatforms();
        setupDynamicBodies();

        const vehicleGltf = await loadModel(asset("glb/sedan.glb"), "Loading test vehicle", 60, 96);
        await setupVehicle(vehicleGltf);
        updateWantedUI();
        setLoading(100, "Test range online", "Click the level to capture the mouse");

        state.ready = true;
        state.started = true;
        dom.loading.classList.add("fade-out");
        window.setTimeout(() => {
            dom.loading.style.display = "none";
            showToast("Gridbox ready", "Test movement, collision, movers, dynamics and the sedan.", 4600);
        }, 450);
    } catch (error) {
        console.error("Euphoria City gridbox failed to initialize", error);
        const reason = error instanceof Error ? error.message : "Unknown level error";
        setLoading(100, "Test range offline", `Could not initialize gridbox · ${reason}`);
        dom.loadingFill.style.background = "#ff654e";
    }
}

window.addEventListener("keydown", (event) => {
    if (!state.started || !state.player || event.repeat) return;
    if (event.code === "KeyR") {
        state.player.resetVehicle();
        showToast("Vehicle reset", "Back on four wheels.", 1800);
    } else if (event.code === "KeyC") {
        toggleColliderDebug();
    } else if (event.code === "KeyB") {
        toggleDynamicDebug();
    } else if (event.code === "KeyP") {
        state.platformsPaused = !state.platformsPaused;
        showToast("Kinematic platforms", state.platformsPaused ? "Paused." : "Moving.", 1800);
    } else if (event.code === "KeyT") {
        resetTestLevel();
    }
});

window.addEventListener("pointerlockchange", () => {
    if (!state.started) return;
    document.body.style.cursor = document.pointerLockElement ? "none" : "auto";
});

window.addEventListener("resize", () => {
    if (!camera || !renderer) return;
    const width = dom.container.clientWidth;
    const height = dom.container.clientHeight;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
});

requestAnimationFrame(function loop(now) {
    animate(now);
    requestAnimationFrame(loop);
});

init();
