import {
    ACESFilmicToneMapping,
    AmbientLight,
    BoxGeometry,
    BufferGeometry,
    Clock,
    CylinderGeometry,
    DirectionalLight,
    Float32BufferAttribute,
    Group,
    Mesh,
    MeshStandardMaterial,
    PerspectiveCamera,
    RepeatWrapping,
    SphereGeometry,
    SRGBColorSpace,
    Scene,
    TextureLoader,
    VSMShadowMap,
    Vector3,
    WebGLRenderer,
} from "three";
import { Sky } from "three/addons/objects/Sky.js";
import { MapControls } from "three/examples/jsm/Addons.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { GUI } from "three/examples/jsm/libs/lil-gui.module.min.js";
import Stats from "three/examples/jsm/libs/stats.module.js";
import { playerController } from "../src/playerController";
import { FootIK } from "../src/foot-ik";

const TILE_SIZE = 1;
const SLOPE_ANGLES = [20, 30, 40];
const L1_TOP = 1.2;

// 矩形主平台
const PLATFORM = { x: -18, z: 0, sizeX: 52, sizeZ: 36 };
const WALL_H = 2.0;
const WALL_T = 0.35;
const DECK_Y = -0.06;
const DECK_THICK = 0.12;

// 车辆停放
const VEHICLE_SPAWNS = [
    new Vector3(-1, 0, -11),
    new Vector3(-1, 0, 11),
];

// 半埋障碍带
const OBSTACLE_X0 = -9;
const OBSTACLE_COUNT = 6;
const OBSTACLE_SPACING = 1.8;

// 远端左：动态区；右：运动学平台区
const ZONE_PROP = { x: -34, z: -9, size: 12, drop: 0.25 };
const ZONE_KINE = { x: -34, z: 9 };
const PROP_SPHERE_R = 0.2;
const ACCENT_GRAY = 0xc8c8c8;
const KINE_ACCENT_COLOR = 0x7ec8e3;
const KINE_ACCENT_EMISSIVE = 0x123040;

// 染色材质
function tintMaterial(baseMat, hex) {
    const mat = baseMat.clone();
    mat.color?.setHex?.(hex);
    return mat;
}

// 运动学平台强调材质
function createKineAccentMaterial(baseMat) {
    const mat = baseMat.clone();
    mat.color?.setHex?.(KINE_ACCENT_COLOR);
    mat.emissive?.setHex?.(KINE_ACCENT_EMISSIVE);
    mat.emissiveIntensity = 0.15;
    return mat;
}
const KINE_LIFT_POS = new Vector3(ZONE_KINE.x + 2, 0.2, ZONE_KINE.z);
const KINE_SHUTTLE_A = new Vector3(ZONE_KINE.x - 2, 0.2, ZONE_KINE.z - 4);
const KINE_SHUTTLE_B = new Vector3(ZONE_KINE.x - 2, 0.2, ZONE_KINE.z + 4);
const KINE_SHUTTLE_HI_A = new Vector3(ZONE_KINE.x - 2, 0.8, ZONE_KINE.z - 4);
const KINE_SHUTTLE_HI_B = new Vector3(ZONE_KINE.x - 2, 0.8, ZONE_KINE.z + 4);

// 六棱柱顶圆形载人平台
const HEX_RIDE_RADIUS = 1.15;
const HEX_RIDE_THICKNESS = 0.1;
const HEX_RIDE_Y = L1_TOP + HEX_RIDE_THICKNESS * 0.5;
const HEX_RIDE_FROM = new Vector3(0, HEX_RIDE_Y, 0);
const HEX_RIDE_TO = new Vector3(
    PLATFORM.x - PLATFORM.sizeX * 0.5 + HEX_RIDE_RADIUS + 0.5,
    HEX_RIDE_Y,
    0,
);
const HEX_RIDE_SPEED = 2;

const scene = new Scene();
const animClock = new Clock();

let camera;
let renderer;
let controls;
let player;
let footIK;
let gui;
let stats;
let prototypeMat;
let kinematicPlatforms = [];

init();

// 初始化
async function init() {
    const container = document.querySelector("#container");

    // 渲染器
    renderer = new WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = VSMShadowMap;
    renderer.setAnimationLoop(animate);
    container.appendChild(renderer.domElement);

    // 帧率
    stats = new Stats();
    Object.assign(stats.dom.style, {
        position: "fixed",
        bottom: "0px",
        left: "0px",
        top: "auto",
        zIndex: "9998",
        display: "block",
    });
    document.body.appendChild(stats.dom);

    // 相机
    camera = new PerspectiveCamera(55, container.clientWidth / container.clientHeight, 0.01, 500);
    camera.position.set(16, 12, 8);

    // 控制器
    controls = new MapControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.maxDistance = 160;
    controls.maxPolarAngle = Math.PI / 2.05;
    controls.target.set(-12, 1, 0);

    // 环境光
    scene.add(new AmbientLight(0xffffff, 1.5));

    // 平行光
    const sun = new DirectionalLight(0xffffff, 2);
    sun.position.set(16, 36, 24);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 140;
    sun.shadow.camera.left = -50;
    sun.shadow.camera.right = 30;
    sun.shadow.camera.top = 40;
    sun.shadow.camera.bottom = -40;
    sun.shadow.bias = -0.0005;
    scene.add(sun);

    const sky = new Sky();
    sky.scale.setScalar(450000);
    scene.add(sky);
    const skyUniforms = sky.material.uniforms;
    skyUniforms["turbidity"].value = 10;
    skyUniforms["rayleigh"].value = 2;
    skyUniforms["mieCoefficient"].value = 0.001;
    skyUniforms["mieDirectionalG"].value = 0.99;
    skyUniforms["sunPosition"].value.copy(sun.position.clone().normalize());

    // 测试场景
    prototypeMat = await loadTiledMaterial("./textures/showcase/prototype.png");
    const world = buildShowcaseWorld(prototypeMat);
    scene.add(world);

    // 加载玩家模型

    const gltfLoader = new GLTFLoader();
    const playerGltf = await gltfLoader.loadAsync("./glb/ual.glb");

    // 初始化玩家控制器
    player = new playerController();
    await player.init({
        scene,
        camera,
        controls,
        colliders: [
            { motion: "static", shape: { kind: "mesh", source: world } },
        ],
        initPos: new Vector3(6.5, 0.4, 0.5),
        minCamDistance: 8,
        maxCamDistance: 300,
        camLookAtHeightRatio: 0.5,
        enableSpringCamera: true,
        playerModelConfig: {
            model: playerGltf.scene,
            animations: playerGltf.animations,
            scale: 0.005,
            idleAnim: "Idle_Loop",
            walkAnim: "Walk_Loop",
            runAnim: "Sprint_Loop",
            jumpAnim: ["Jump_Start", "Jump_Loop", "Jump_Land"],
            flyAnim: "fly",
            flyIdleAnim: "flyIdle",
            flyHoverForwardAnim: "flyHoverForward",
            flyHoverBackAnim: "flyHoverBack",
            flyHoverLeftAnim: "flyHoverLeft",
            flyHoverRightAnim: "flyHoverRight",
            flyHoverUpAnim: "flyHoverUp",
            flyHoverDownAnim: "flyHoverDown",
            drivingAnim: "Driving_Loop",
            headBoneName: "Head",
            firstPersonCameraOffset: [0, 0.15, 0.12],
            rotateY: -Math.PI / 2,
            speed: 100,
            runSpeed: 600,
        },
    });
    enableModelShadows(player.playerModel);

    // 初始化脚部 IK
    footIK = new FootIK({
        enabled: true,
        soleSkinThickness: 1.6,
        skeleton: {
            hips: "pelvis",
            legs: {
                left: {
                    upper: "thigh_l",
                    lower: "calf_l",
                    foot: "foot_l",
                    toe: "ball_l",
                },
                right: {
                    upper: "thigh_r",
                    lower: "calf_r",
                    foot: "foot_r",
                    toe: "ball_r",
                },
            },
        },
    });
    player.use(footIK);

    createKinematicZone(prototypeMat);
    createHexRidePlatform(prototypeMat);
    spawnPropBodies();
    await spawnShowcaseVehicles(gltfLoader);

    createDebugPanel();

    window.addEventListener("resize", onResize);
    window.addEventListener("keydown", (e) => {
        if (e.code !== "KeyR" || e.repeat) return;
        player?.resetVehicle();
    });
    window.hideLoader?.();
}

// 加载 tiling 纹理材质
async function loadTiledMaterial(url) {
    const texture = await new TextureLoader().loadAsync(url);
    texture.colorSpace = SRGBColorSpace;
    texture.wrapS = RepeatWrapping;
    texture.wrapT = RepeatWrapping;
    texture.repeat.set(1, 1);
    texture.anisotropy = 8;
    return new MeshStandardMaterial({
        map: texture,
        roughness: 0.85,
        metalness: 0.05,
    });
}

// 按世界尺度写入 UV
function applyWorldTileUV(geometry, origin = { x: 0, y: 0, z: 0 }) {
    const flat = geometry.index ? geometry.toNonIndexed() : geometry;
    const pos = flat.getAttribute("position");
    const uv = new Float32BufferAttribute(new Float32Array(pos.count * 2), 2);

    for (let t = 0; t < pos.count; t += 3) {
        const ax = pos.getX(t);
        const ay = pos.getY(t);
        const az = pos.getZ(t);
        const bx = pos.getX(t + 1);
        const by = pos.getY(t + 1);
        const bz = pos.getZ(t + 1);
        const cx = pos.getX(t + 2);
        const cy = pos.getY(t + 2);
        const cz = pos.getZ(t + 2);

        const e1x = bx - ax;
        const e1y = by - ay;
        const e1z = bz - az;
        const e2x = cx - ax;
        const e2y = cy - ay;
        const e2z = cz - az;
        const nx = Math.abs(e1y * e2z - e1z * e2y);
        const ny = Math.abs(e1z * e2x - e1x * e2z);
        const nz = Math.abs(e1x * e2y - e1y * e2x);

        for (let i = 0; i < 3; i++) {
            const idx = t + i;
            const x = pos.getX(idx) + origin.x;
            const y = pos.getY(idx) + origin.y;
            const z = pos.getZ(idx) + origin.z;
            let u = 0;
            let v = 0;
            if (ny >= nx && ny >= nz) {
                u = x;
                v = z;
            } else if (nx >= ny && nx >= nz) {
                u = z;
                v = y;
            } else {
                u = x;
                v = y;
            }
            uv.setXY(idx, u / TILE_SIZE, v / TILE_SIZE);
        }
    }

    flat.setAttribute("uv", uv);
    flat.computeVertexNormals();
    return flat;
}

// 创建展示场景
function buildShowcaseWorld(baseMat) {
    const root = new Group();
    root.name = "ShowcaseWorld";

    // 矩形主平台 + 围墙
    addBox(
        root,
        new Vector3(PLATFORM.x, DECK_Y, PLATFORM.z),
        new Vector3(PLATFORM.sizeX, DECK_THICK, PLATFORM.sizeZ),
        baseMat,
    );
    createPlatformWalls(root, baseMat);
    createClimbGroups(root, baseMat);

    // 半埋横向圆柱 + 半埋长方体
    createHalfBuriedObstacles(root, baseMat);

    // 远端左：装饰地板 + 静态方块
    createPropPit(root, baseMat);

    return root;
}

// 平台围墙
function createPlatformWalls(root, baseMat) {
    const { x, z, sizeX, sizeZ } = PLATFORM;
    const halfX = sizeX * 0.5;
    const halfZ = sizeZ * 0.5;
    const y = WALL_H * 0.5;

    // 北 / 南 / 西 / 东
    addBox(root, new Vector3(x, y, z + halfZ + WALL_T * 0.5), new Vector3(sizeX + WALL_T * 2, WALL_H, WALL_T), baseMat);
    addBox(root, new Vector3(x, y, z - halfZ - WALL_T * 0.5), new Vector3(sizeX + WALL_T * 2, WALL_H, WALL_T), baseMat);
    addBox(root, new Vector3(x - halfX - WALL_T * 0.5, y, z), new Vector3(WALL_T, WALL_H, sizeZ), baseMat);
    addBox(root, new Vector3(x + halfX + WALL_T * 0.5, y, z), new Vector3(WALL_T, WALL_H, sizeZ), baseMat);
}

// 半埋圆柱 + 半埋长方体
function createHalfBuriedObstacles(root, baseMat) {
    const accentMat = tintMaterial(baseMat, ACCENT_GRAY);
    const cylR = 0.15;
    const cylLen = 2.5;
    const boxSize = new Vector3(0.25, 0.275, 2.5);
    // 主平台顶面
    const deckTop = DECK_Y + DECK_THICK * 0.5;

    for (let i = 0; i < OBSTACLE_COUNT; i++) {
        const x = OBSTACLE_X0 - i * OBSTACLE_SPACING;

        // 横向半埋圆柱
        const cylPos = new Vector3(x, deckTop, -3.2);
        const cylGeo = applyWorldTileUV(
            new CylinderGeometry(cylR, cylR, cylLen, 24),
            cylPos,
        );
        cylGeo.rotateX(Math.PI / 2);
        const cyl = new Mesh(cylGeo, accentMat);
        cyl.position.copy(cylPos);
        cyl.castShadow = true;
        cyl.receiveShadow = true;
        root.add(cyl);

        // 半埋长方体
        addBox(root, new Vector3(x, deckTop, 3.2), boxSize, accentMat);
    }
}

// 远端左：略低装饰地板
function createPropPit(root, baseMat) {
    const { x, z, size, drop } = ZONE_PROP;
    const floorY = DECK_Y - drop;
    addBox(root, new Vector3(x, floorY, z), new Vector3(size, DECK_THICK, size), baseMat);
}

// 远端右：升降 + 平移运动学平台
function createKinematicZone(baseMat) {
    const platformMat = createKineAccentMaterial(baseMat);

    const liftSize = new Vector3(2.7, 0.1, 2.7);
    const liftPos = KINE_LIFT_POS.clone();
    const liftMesh = addBox(scene, liftPos, liftSize, platformMat);
    liftMesh.name = "KineLift";
    player.addCollider({
        motion: "kinematic",
        shape: { kind: "mesh", source: liftMesh },
        follow: liftMesh,
    });
    kinematicPlatforms.push({
        mesh: liftMesh,
        kind: "lift",
        baseY: liftPos.y,
        distance: 3.2,
        speed: 0.55,
    });

    const shuttleSize = new Vector3(2.2, 0.1, 2.2);
    const shuttleMesh = addBox(scene, KINE_SHUTTLE_A.clone(), shuttleSize, platformMat);
    shuttleMesh.name = "KineShuttle";
    player.addCollider({
        motion: "kinematic",
        shape: { kind: "mesh", source: shuttleMesh },
        follow: shuttleMesh,
    });
    kinematicPlatforms.push({
        mesh: shuttleMesh,
        kind: "shuttle",
        from: KINE_SHUTTLE_A.clone(),
        to: KINE_SHUTTLE_B.clone(),
        speed: 0.35,
        invert: false,
    });

    // y=0.8 反向平移平台
    const shuttleHiMesh = addBox(scene, KINE_SHUTTLE_HI_B.clone(), shuttleSize, platformMat);
    shuttleHiMesh.name = "KineShuttleHi";
    player.addCollider({
        motion: "kinematic",
        shape: { kind: "mesh", source: shuttleHiMesh },
        follow: shuttleHiMesh,
    });
    kinematicPlatforms.push({
        mesh: shuttleHiMesh,
        kind: "shuttle",
        from: KINE_SHUTTLE_HI_A.clone(),
        to: KINE_SHUTTLE_HI_B.clone(),
        speed: 0.35,
        invert: true,
        spinSpeed: 0.8,
    });
}

// 六棱柱顶圆形载人平台
function createHexRidePlatform(baseMat) {
    const platformMat = createKineAccentMaterial(baseMat);
    const pos = HEX_RIDE_FROM.clone();
    const geo = applyWorldTileUV(
        new CylinderGeometry(HEX_RIDE_RADIUS, HEX_RIDE_RADIUS, HEX_RIDE_THICKNESS, 32),
        pos,
    );
    const mesh = new Mesh(geo, platformMat);
    mesh.position.copy(pos);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = "HexRidePlatform";
    scene.add(mesh);
    player.addCollider({
        motion: "kinematic",
        shape: { kind: "mesh", source: mesh },
        follow: mesh,
    });

    const travelDist = HEX_RIDE_FROM.distanceTo(HEX_RIDE_TO);
    kinematicPlatforms.push({
        mesh,
        kind: "ride",
        from: HEX_RIDE_FROM.clone(),
        to: HEX_RIDE_TO.clone(),
        progress: 0,
        dir: 1,
        progressSpeed: travelDist > 1e-4 ? HEX_RIDE_SPEED / travelDist : 0,
    });
}

// 两端缓入缓出
function easeEndsLinearMiddle(progress, easeRatio = 0.18) {
    const ease = Math.min(Math.max(easeRatio, 0.001), 0.49);
    const maxSpeed = 1 / (1 - ease);
    if (progress < ease) return (maxSpeed * progress * progress) / (2 * ease);
    if (progress > 1 - ease) return 1 - (maxSpeed * (1 - progress) * (1 - progress)) / (2 * ease);
    return maxSpeed * (progress - ease / 2);
}

// 是否站在指定运动学平台上
function isPlayerRidingPlatform(mesh) {
    return (
        player?.getActiveKinematicCollider()?.source === mesh
        && player.getIsOnGround()
    );
}

// 更新运动学平台
function updateKinematicZone(t) {
    const dt = player?.getCurrentDelta?.() || 1 / 60;

    for (const entry of kinematicPlatforms) {
        if (entry.kind === "lift") {
            const amount = Math.sin(t * entry.speed) * entry.distance;
            entry.mesh.position.y = entry.baseY + amount + entry.distance;
        } else if (entry.kind === "shuttle") {
            const phase = (t * entry.speed / Math.PI) % 2;
            const raw = phase <= 1 ? phase : 2 - phase;
            let p = easeEndsLinearMiddle(raw);
            if (entry.invert) p = 1 - p;
            entry.mesh.position.lerpVectors(entry.from, entry.to, p);
            if (entry.spinSpeed) entry.mesh.rotation.y = t * entry.spinSpeed;
        } else if (entry.kind === "ride") {
            // 站上才移动，离开则停
            if (isPlayerRidingPlatform(entry.mesh) && entry.progressSpeed > 0) {
                entry.progress += entry.dir * entry.progressSpeed * dt;
                if (entry.progress >= 1) {
                    entry.progress = 1;
                    entry.dir = -1;
                } else if (entry.progress <= 0) {
                    entry.progress = 0;
                    entry.dir = 1;
                }
            }
            entry.mesh.position.lerpVectors(entry.from, entry.to, entry.progress);
        }
    }
}

// 左侧动态球 / 盒
function spawnPropBodies() {
    const { x, z, size } = ZONE_PROP;
    const deckTop = DECK_Y + DECK_THICK * 0.5;
    const inset = size * 0.5 - 1.2;
    const sphereY = deckTop + PROP_SPHERE_R + 0.05;
    const sphereSpots = [
        new Vector3(x - inset, sphereY, z - inset),
        new Vector3(x, sphereY, z - inset * 0.5),
        new Vector3(x + inset, sphereY, z - inset),
        new Vector3(x - inset * 0.5, sphereY, z + inset * 0.3),
        new Vector3(x + inset * 0.5, sphereY, z + inset),
    ];
    const propMat = createKineAccentMaterial(prototypeMat);

    for (const pos of sphereSpots) {
        const mesh = new Mesh(new SphereGeometry(1, 24, 16), propMat.clone());
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        scene.add(mesh);
        player.addCollider({
            motion: "dynamic",
            shape: { kind: "sphere", radius: PROP_SPHERE_R, position: pos.clone() },
            mesh,
            restitution: 0.35,
            friction: 0.55,
        });
    }

    const boxH = 0.35;
    const boxHalf = new Vector3(0.2125, boxH * 0.5, 0.2125);
    const boxY = deckTop + boxHalf.y + 0.05;
    const boxSpots = [
        new Vector3(x - inset, boxY, z),
        new Vector3(x + inset, boxY, z),
        new Vector3(x, boxY, z + inset * 0.2),
        new Vector3(x - inset * 0.4, boxY, z - inset * 0.7),
        new Vector3(x + inset * 0.4, boxY, z + inset * 0.6),
        new Vector3(x - inset * 0.4, boxY, z - inset * 0.2),
        new Vector3(x + inset * 0.35, boxY, z + inset * 0.15),
        new Vector3(x, boxY + boxHalf.y * 2.2, z),
    ];
    for (const pos of boxSpots) {
        const mesh = new Mesh(new BoxGeometry(1, 1, 1), propMat.clone());
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        scene.add(mesh);
        player.addCollider({
            motion: "dynamic",
            shape: {
                kind: "box",
                halfExtents: boxHalf.clone(),
                position: pos.clone(),
            },
            mesh,
            restitution: 0.2,
            friction: 0.65,
            density: 1.2,
        });
    }
}

// 加载展示车辆
async function spawnShowcaseVehicles(gltfLoader) {
    const gltf = await gltfLoader.loadAsync("./glb/suv.glb");
    for (const spawnPos of VEHICLE_SPAWNS) {
        // 每辆车需要独立模型实例
        const model = gltf.scene.clone(true);
        await player.loadVehicleModel({
            model,
            animations: gltf.animations,
            scale: 0.5,
            position: spawnPos.clone(),
            wheelsNames: ["Wheel_LF", "Wheel_RF", "Wheel_LR", "Wheel_RR"],
            driverSeatPosition: new Vector3(-0.6, 0.7, 0.4),
            driverSeatRotation: -Math.PI / 2,
            chassisClearance: 1,
            suspensionRestLengthRatio: 0.2,
            suspensionTravelRatio: 0.3,
            suspensionStiffness: 250,
            suspensionCompression: 6,
            suspensionRelaxation: 6,
            maxSuspensionForce: 10000,
            frictionSlip: 20,
            sideFrictionStiffness: 2,
            followVehicleDirection: true,
            density: 1,
            maxSpeed: 100,
            acceleration: 8,
            deceleration: 30,
        });

        const vehicle = player.getAllVehicles().at(-1);
        vehicle?.vehicleGroup?.traverse((child) => {
            if (!child.isMesh) return;
            child.castShadow = true;
            child.receiveShadow = true;
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            for (const mat of mats) {
                if (!mat) continue;
                mat.metalness = 0.8;
                mat.roughness = 0.0;
            }
        });
    }
}

// 创建攀爬组与中心平台
function createClimbGroups(root, baseMat) {
    const topHeight = L1_TOP;
    const stepCount = 7;
    const stepHeight = topHeight / stepCount;
    const stairWidth = 1;
    const rampWidth = 1;
    const armSpan = stairWidth + rampWidth;
    const platformSides = 6;
    const platformApothem = armSpan / (2 * Math.tan(Math.PI / platformSides));
    const platformCircumRadius = platformApothem / Math.cos(Math.PI / platformSides);

    // 中心六棱柱
    const platformPos = new Vector3(0, topHeight * 0.5, 0);
    const platformGeo = applyWorldTileUV(
        new CylinderGeometry(platformCircumRadius, platformCircumRadius, topHeight, platformSides),
        platformPos,
    );
    const platform = new Mesh(platformGeo, baseMat);
    platform.position.copy(platformPos);
    platform.castShadow = true;
    platform.receiveShadow = true;
    root.add(platform);

    for (let index = 0; index < 3; index++) {
        const arm = new Group();
        arm.rotation.y = index * (Math.PI * 2 / 3);
        root.add(arm);

        const angleDeg = SLOPE_ANGLES[index];
        const stairZ = -stairWidth * 0.5;
        const rampZ = rampWidth * 0.5;
        const runLength = topHeight / Math.tan(angleDeg * Math.PI / 180);
        const stepDepth = runLength / stepCount;

        createStairsToPlatform(arm, {
            platformRadius: platformApothem,
            stepHeight,
            stepCount,
            stepDepth,
            width: stairWidth,
            z: stairZ,
            baseMat,
        });

        createRampToPlatform(arm, {
            platformRadius: platformApothem,
            angleDeg,
            length: runLength,
            width: rampWidth,
            z: rampZ,
            baseMat,
        });
    }
}

// 创建一组楼梯
function createStairsToPlatform(root, { platformRadius, stepHeight, stepCount, stepDepth, width, z, baseMat }) {
    const stairRun = stepCount * stepDepth;
    const outer = platformRadius + stairRun;

    for (let i = 0; i < stepCount; i++) {
        const height = stepHeight * (i + 1);
        const x = outer - (i + 0.5) * stepDepth;
        addBox(
            root,
            new Vector3(x, height / 2, z),
            new Vector3(stepDepth, height, width),
            baseMat,
        );
    }
}

// 创建一个斜坡
function createRampToPlatform(root, { platformRadius, angleDeg, length, width, z, baseMat }) {
    const height = Math.tan(angleDeg * Math.PI / 180) * length;
    const origin = new Vector3(platformRadius + length * 0.5, 0, z);
    const rotY = Math.PI;
    const ramp = new Mesh(createRampGeometry(length, height, width, origin, rotY), baseMat);
    ramp.position.copy(origin);
    ramp.rotation.y = rotY;
    ramp.castShadow = true;
    ramp.receiveShadow = true;
    root.add(ramp);
    return ramp;
}

// 创建斜坡几何体。
function createRampGeometry(length, height, width, origin = { x: 0, y: 0, z: 0 }, rotY = 0) {
    const halfLength = length / 2;
    const halfWidth = width / 2;
    const cosY = Math.cos(rotY);
    const sinY = Math.sin(rotY);
    const vertices = [
        -halfLength, 0, -halfWidth,
        halfLength, 0, -halfWidth,
        halfLength, height, -halfWidth,
        -halfLength, 0, halfWidth,
        halfLength, 0, halfWidth,
        halfLength, height, halfWidth,
    ];
    const indices = [
        0, 1, 4, 0, 4, 3,
        1, 2, 5, 1, 5, 4,
        0, 3, 5, 0, 5, 2,
        0, 2, 1,
        3, 4, 5,
    ];
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    const flat = geometry.toNonIndexed();
    const pos = flat.getAttribute("position");
    const uv = new Float32BufferAttribute(new Float32Array(pos.count * 2), 2);

    for (let t = 0; t < pos.count; t += 3) {
        const ax = pos.getX(t);
        const ay = pos.getY(t);
        const az = pos.getZ(t);
        const bx = pos.getX(t + 1);
        const by = pos.getY(t + 1);
        const bz = pos.getZ(t + 1);
        const cx = pos.getX(t + 2);
        const cy = pos.getY(t + 2);
        const cz = pos.getZ(t + 2);

        const e1x = bx - ax;
        const e1y = by - ay;
        const e1z = bz - az;
        const e2x = cx - ax;
        const e2y = cy - ay;
        const e2z = cz - az;
        const nx = e1y * e2z - e1z * e2y;
        const ny = e1z * e2x - e1x * e2z;
        const nz = e1x * e2y - e1y * e2x;
        const nLen = Math.hypot(nx, ny, nz) || 1;
        const nnx = nx / nLen;
        const nny = ny / nLen;
        const nnz = nz / nLen;

        for (let i = 0; i < 3; i++) {
            const idx = t + i;
            const lx = pos.getX(idx);
            const ly = pos.getY(idx);
            const lz = pos.getZ(idx);
            const x = origin.x + lx * cosY + lz * sinY;
            const y = origin.y + ly;
            const z = origin.z - lx * sinY + lz * cosY;
            let u = 0;
            let v = 0;

            if (Math.abs(nnz) > 0.7) {
                u = Math.hypot(lx + halfLength, ly);
                v = y;
            } else if (Math.abs(nnx) > 0.7) {
                u = z;
                v = y;
            } else if (Math.abs(nny) > 0.7 && nny < 0) {
                u = x;
                v = z;
            } else {
                u = Math.hypot(lx + halfLength, ly);
                v = z;
            }
            uv.setXY(idx, u / TILE_SIZE, v / TILE_SIZE);
        }
    }

    flat.setAttribute("uv", uv);
    flat.computeVertexNormals();
    return flat;
}

// 添加盒子
function addBox(root, position, size, material) {
    const geo = applyWorldTileUV(new BoxGeometry(size.x, size.y, size.z), position);
    const mesh = new Mesh(geo, material);
    mesh.position.copy(position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
    return mesh;
}

// 启用模型阴影
function enableModelShadows(root) {
    root?.traverse((obj) => {
        if (obj.isMesh) {
            obj.castShadow = true;
            obj.receiveShadow = true;
        }
    });
}

// 创建调试面板
function createDebugPanel() {
    const params = {
        colliderDebug: false,
        playerCapsuleDebug: false,
        footIKEnabled: true,
        resetVehicle() {
            player?.resetVehicle();
        },
        clearSpheres() {
            player?.clearDynamicBodies();
        },
    };

    gui = new GUI({ title: "Debug", width: 260 });
    gui.domElement.style.position = "fixed";
    gui.domElement.style.top = "12px";
    gui.domElement.style.right = "12px";
    gui.domElement.addEventListener("pointerdown", (e) => e.stopPropagation());

    const sceneFolder = gui.addFolder("Scene");
    sceneFolder.add(params, "colliderDebug").name("Collider Debug").onChange((value) => {
        player?.setColliderDebug(value);
    });
    sceneFolder.add(params, "playerCapsuleDebug").name("Player Capsule").onChange((value) => {
        player?.setPlayerCapsuleDebug?.(value);
    });
    sceneFolder.add(params, "footIKEnabled").name("Foot IK").onChange((value) => {
        footIK?.setEnabled(value);
    });
    sceneFolder.add(params, "resetVehicle").name("Reset Vehicle");
    sceneFolder.add(params, "clearSpheres").name("Clear Spheres");
    sceneFolder.open();
}

// 窗口尺寸变化
function onResize() {
    const container = document.querySelector("#container");
    if (!container || !camera || !renderer) return;
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
}

// 每帧调用
function animate() {
    const t = animClock.getElapsedTime();
    if (player) {
        updateKinematicZone(t);
        player.update();
    } else {
        controls?.update();
    }
    renderer.render(scene, camera);
    stats?.update();
}
