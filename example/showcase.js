import {
    ACESFilmicToneMapping,
    AmbientLight,
    BoxGeometry,
    BufferGeometry,
    Clock,
    Color,
    CylinderGeometry,
    DirectionalLight,
    DoubleSide,
    Float32BufferAttribute,
    Group,
    LatheGeometry,
    Mesh,
    MeshStandardMaterial,
    PerspectiveCamera,
    PlaneGeometry,
    RepeatWrapping,
    ShaderMaterial,
    SphereGeometry,
    SRGBColorSpace,
    Scene,
    TextureLoader,
    VSMShadowMap,
    Vector2,
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

const DECK_Y = -0.06;
const DECK_THICK = 0.12;

// 车辆停放（仅大场景）
const VEHICLE_SPAWNS = [
    new Vector3(-1, 0, -11),
    new Vector3(-1, 0, 11),
];

// 车辆调参（加载与 GUI 共用）
const VEHICLE_TUNING = {
    followVehicleDirection: true,
    debug: { showPhysicsBox: false, showWheelRays: false, showWheelTravel: false, showWheelSpheres: false },
    chassis: {
        density: 1,
        linearDamping: 0.05,
        angularDamping: 0.5,
        clearance: 0.8,
        sizeScale: { x: 0.9, y: 0.55, z: 0.9 },
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
        maxSpeed: 100,
        acceleration: 5,
        deceleration: 5,
    },
};

// 半埋障碍带
const OBSTACLE_X0 = -9;
const OBSTACLE_COUNT = 6;
const OBSTACLE_SPACING = 1.8;

// 远端左：动态区；右：运动学平台区
const ZONE_PROP = { x: -34, z: -9, size: 12, drop: 0.25 };
const ZONE_KINE = { x: -34, z: 9 };
const PROP_SPHERE_R = 0.2;
const ACCENT_GRAY = 0xc8c8c8;
const PROP_GRID = 4;
const PROP_BOX_SIZE = 0.38;
const PROP_ACCENT_COLOR = 0x7eb0d4;

const KINE_SHUTTLE_SPEED = 0.9;
const KINE_SPIN_SPEED = 0.35;

const MINI_SCALE = 0.1; // 小场景相对大场景的比例
const PLAYER_SCALE_NORMAL = 0.005; // 大场景人物缩放
const PLAYER_SCALE_MINI = PLAYER_SCALE_NORMAL * MINI_SCALE;
const VEHICLE_SCALE_NORMAL = 0.5; // 大场景车辆缩放
const VEHICLE_SCALE_MINI = VEHICLE_SCALE_NORMAL * MINI_SCALE;
const SCALE_ANIM_DURATION = 1;
const ZONE_EPS = 0.05; // 离开小场景判定的外扩余量
// 圆形场地半径相对矩形平台长边的倍数
const CIRCLE_RADIUS_SCALE = 1.5;

// 按比例生成场景布局
function createShowcaseLayout(scale = 1) {
    const s = scale;
    return {
        scale: s,
        platform: { x: -5 * s, z: 0, sizeX: 30 * s, sizeZ: 28 * s },
        wallH: 2.0 * s,
        wallT: 0.35 * s,
        deckY: DECK_Y * s,
        deckThick: DECK_THICK * s,
        l1Top: 1.2 * s,
        obstacleX0: -9 * s,
        obstacleCount: 6,
        obstacleSpacing: 1.8 * s,
        obstacleZ: 3.2 * s,
        obstacleCylR: 0.15 * s,
        obstacleCylLen: 2.5 * s,
        obstacleBoxSize: new Vector3(0.25 * s, 0.275 * s, 2.5 * s),
        stairWidth: 1 * s,
        rampWidth: 1 * s,
        kineThickness: 0.12 * s,
        kineTopOffset: 0.4 * s,
        tileSize: TILE_SIZE * s,
    };
}

// 染色材质
function tintMaterial(baseMat, hex) {
    const mat = baseMat.clone();
    mat.color?.setHex?.(hex);
    return mat;
}

const scene = new Scene();
const animClock = new Clock();

let camera;
let renderer;
let controls;
let player;
let footIK;
let gui;
let stats;
let kinematicPlatforms = [];
let mainLayout;
let miniScaleGate = null;
let glowPortal = null;
let zoneScale = 1; // 当前场景总缩放
let isScaling = false;
let scaleAnimFrame = null;
const scaleGateWorldPos = new Vector3(); // 闸门判定用的世界坐标缓冲

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
    camera = new PerspectiveCamera(55, container.clientWidth / container.clientHeight, 0.01, 800);
    camera.position.set(14, 10, 10);

    // 控制器
    controls = new MapControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.maxDistance = 260;
    controls.maxPolarAngle = Math.PI / 2.05;
    controls.target.set(0, 1, 0);

    // 环境光
    scene.add(new AmbientLight(0xffffff, 1.5));

    // 平行光
    const sun = new DirectionalLight(0xffffff, 2);
    sun.position.set(16, 48, 24);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 220;
    sun.shadow.camera.left = -90;
    sun.shadow.camera.right = 24;
    sun.shadow.camera.top = 70;
    sun.shadow.camera.bottom = -70;
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
    const prototypeMat = await loadTiledMaterial("./textures/showcase/prototype.png");
    mainLayout = createShowcaseLayout(1);
    const miniLayout = createShowcaseLayout(MINI_SCALE);
    // 矩形西墙全开，开口贴合南北墙外缘，与圆东侧相接
    const mainWestOpening = {
        zCenter: 0,
        width: mainLayout.platform.sizeZ + 2 * mainLayout.wallT,
    };
    // 小场景南北墙外缘宽度：大圆西豁口 / 小矩形西墙 / 小圆东豁口共用
    const miniOpening = {
        zCenter: 0,
        width: miniLayout.platform.sizeZ + 2 * miniLayout.wallT,
    };

    const world = new Group();
    world.name = "ShowcaseWorld";
    const mainWorld = buildShowcaseWorld(prototypeMat, mainLayout, { westGap: mainWestOpening });
    mainWorld.name = "MainWorld";
    world.add(mainWorld);

    const mainWestX = mainLayout.platform.x - mainLayout.platform.sizeX * 0.5;
    const circleRadius = Math.max(mainLayout.platform.sizeX, mainLayout.platform.sizeZ) * CIRCLE_RADIUS_SCALE;
    const circleCenter = {
        x: mainWestX - chordOffset(circleRadius, mainWestOpening.width),
        z: 0,
    };
    const circleWestX = circleCenter.x - chordOffset(circleRadius, miniOpening.width);

    const circleWorld = buildCircularArena(prototypeMat, mainLayout, {
        radius: circleRadius,
        center: circleCenter,
        eastGap: { angle: Math.PI * 0.5, width: mainWestOpening.width },
        westGap: { angle: Math.PI * 1.5, width: miniOpening.width },
    });
    circleWorld.name = "CircleWorld";
    world.add(circleWorld);

    const miniWorld = buildShowcaseWorld(prototypeMat, miniLayout, {
        omitEast: true,
        westGap: miniOpening,
    });
    miniWorld.name = "MiniWorld";
    const miniLocalEast = miniLayout.platform.x + miniLayout.platform.sizeX * 0.5;
    // 小场景台面东缘对齐大圆西侧豁口弦；南北墙东端略伸入豁口与圆墙咬合
    miniWorld.position.set(circleWestX - miniLocalEast, 0, 0);

    const miniCircleRadius = Math.max(miniLayout.platform.sizeX, miniLayout.platform.sizeZ) * CIRCLE_RADIUS_SCALE;
    const miniWestX = miniLayout.platform.x - miniLayout.platform.sizeX * 0.5;
    const miniCircleCenter = {
        x: miniWestX - chordOffset(miniCircleRadius, miniOpening.width),
        z: 0,
    };
    const miniCircleWorld = buildCircularArena(prototypeMat, miniLayout, {
        radius: miniCircleRadius,
        center: miniCircleCenter,
        eastGap: { angle: Math.PI * 0.5, width: miniOpening.width },
    });
    miniCircleWorld.name = "MiniCircleWorld";
    miniWorld.add(miniCircleWorld);
    world.add(miniWorld);
    scene.add(world);

    // 豁口发光门帘（大圆西侧，进入小场景处）
    glowPortal = createGlowGapPortal(mainLayout, miniOpening, circleWestX);
    scene.add(glowPortal);
    miniScaleGate = createMiniScaleBounds(miniLayout, miniWorld.position, {
        radius: miniCircleRadius,
        center: miniCircleCenter,
        wallT: miniLayout.wallT,
    });

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
        springCameraTime: 0.1,
        playerModelConfig: {
            model: playerGltf.scene,
            animations: playerGltf.animations,
            scale: PLAYER_SCALE_NORMAL,
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

    await spawnShowcaseVehicles(gltfLoader);
    spawnVehiclePropBodies(prototypeMat);
    spawnLayoutPropBodies(prototypeMat, miniLayout, miniWorld.position);
    createKinematicPlatforms(prototypeMat, mainLayout, scene);
    createKinematicPlatforms(prototypeMat, miniLayout, miniWorld);

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
function applyWorldTileUV(geometry, origin = { x: 0, y: 0, z: 0 }, tileSize = TILE_SIZE) {
    const flat = geometry.index ? geometry.toNonIndexed() : geometry;
    const pos = flat.getAttribute("position");
    const uv = new Float32BufferAttribute(new Float32Array(pos.count * 2), 2);
    const tile = Math.max(tileSize, 1e-6);

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
            uv.setXY(idx, u / tile, v / tile);
        }
    }

    flat.setAttribute("uv", uv);
    flat.computeVertexNormals();
    return flat;
}

// 创建展示场景
function buildShowcaseWorld(baseMat, layout, options = {}) {
    const root = new Group();
    const { platform, deckY, deckThick, tileSize } = layout;

    addBox(
        root,
        new Vector3(platform.x, deckY, platform.z),
        new Vector3(platform.sizeX, deckThick, platform.sizeZ),
        baseMat,
        tileSize,
    );
    createPlatformWalls(root, baseMat, layout, options);
    createClimbGroups(root, baseMat, layout);
    createHalfBuriedObstacles(root, baseMat, layout);

    return root;
}

// 平台围墙
function createPlatformWalls(root, baseMat, layout, options = {}) {
    const { platform, wallH, wallT, tileSize } = layout;
    const { x, z, sizeX, sizeZ } = platform;
    const halfX = sizeX * 0.5;
    const halfZ = sizeZ * 0.5;
    const y = wallH * 0.5;
    const westX = x - halfX - wallT * 0.5;
    const westGap = options.westGap;

    // 北 / 南
    addBox(root, new Vector3(x, y, z + halfZ + wallT * 0.5), new Vector3(sizeX + wallT * 2, wallH, wallT), baseMat, tileSize);
    addBox(root, new Vector3(x, y, z - halfZ - wallT * 0.5), new Vector3(sizeX + wallT * 2, wallH, wallT), baseMat, tileSize);

    // 东墙
    if (!options.omitEast) {
        addBox(root, new Vector3(x + halfX + wallT * 0.5, y, z), new Vector3(wallT, wallH, sizeZ), baseMat, tileSize);
    }

    // 西墙：可选中部豁口
    if (!westGap || westGap.width <= 0) {
        addBox(root, new Vector3(westX, y, z), new Vector3(wallT, wallH, sizeZ), baseMat, tileSize);
        return;
    }

    const gapHalf = westGap.width * 0.5;
    const gapCenter = westGap.zCenter;
    const southEnd = z - halfZ;
    const northEnd = z + halfZ;
    const gapSouth = gapCenter - gapHalf;
    const gapNorth = gapCenter + gapHalf;

    const southLen = gapSouth - southEnd;
    if (southLen > 1e-4) {
        addBox(
            root,
            new Vector3(westX, y, southEnd + southLen * 0.5),
            new Vector3(wallT, wallH, southLen),
            baseMat,
            tileSize,
        );
    }
    const northLen = northEnd - gapNorth;
    if (northLen > 1e-4) {
        addBox(
            root,
            new Vector3(westX, y, gapNorth + northLen * 0.5),
            new Vector3(wallT, wallH, northLen),
            baseMat,
            tileSize,
        );
    }
}

// 圆心到豁口弦的水平距离
function chordOffset(radius, gapWidth) {
    const half = gapWidth * 0.5;
    return Math.sqrt(Math.max(0, radius * radius - half * half));
}

// 豁口半角（相对圆心）
function gapHalfAngle(radius, gapWidth) {
    return Math.atan2(gapWidth * 0.5, chordOffset(radius, gapWidth));
}

// 圆形场地：圆盘地面 + 东/西豁口围墙
function buildCircularArena(baseMat, layout, { radius, center, eastGap, westGap }) {
    const root = new Group();
    const { deckY, deckThick, tileSize } = layout;
    const floorPos = new Vector3(center.x, deckY, center.z);
    const floorGeo = applyWorldTileUV(
        new CylinderGeometry(radius, radius, deckThick, 96),
        floorPos,
        tileSize,
    );
    const floor = new Mesh(floorGeo, baseMat);
    floor.name = "CircleFloor";
    floor.position.copy(floorPos);
    floor.castShadow = true;
    floor.receiveShadow = true;
    root.add(floor);

    addCircularWalls(root, baseMat, layout, radius, center, eastGap, westGap);
    return root;
}

// Lathe 绕 Y：phi=0 为 +Z，phi=π/2 为 +X，phi=3π/2 为 -X
function addCircularWalls(root, baseMat, layout, radius, center, eastGap, westGap) {
    const alphaE = gapHalfAngle(radius, eastGap.width);

    if (!westGap || westGap.width <= 0) {
        addArcWall(root, baseMat, layout, radius, center, eastGap.angle + alphaE, Math.PI * 2 - 2 * alphaE);
        addGapCap(root, baseMat, layout, radius, center, eastGap.angle - alphaE);
        addGapCap(root, baseMat, layout, radius, center, eastGap.angle + alphaE);
        return;
    }

    const alphaW = gapHalfAngle(radius, westGap.width);

    addArcWall(root, baseMat, layout, radius, center, eastGap.angle + alphaE, Math.PI - alphaE - alphaW);
    addArcWall(root, baseMat, layout, radius, center, westGap.angle + alphaW, Math.PI - alphaE - alphaW);

    addGapCap(root, baseMat, layout, radius, center, eastGap.angle - alphaE);
    addGapCap(root, baseMat, layout, radius, center, eastGap.angle + alphaE);
    addGapCap(root, baseMat, layout, radius, center, westGap.angle - alphaW);
    addGapCap(root, baseMat, layout, radius, center, westGap.angle + alphaW);
}

// 一段有厚度的圆弧墙
function addArcWall(root, baseMat, layout, radius, center, phiStart, phiLength) {
    const { wallH, wallT, tileSize } = layout;
    const points = [
        new Vector2(radius, 0),
        new Vector2(radius + wallT, 0),
        new Vector2(radius + wallT, wallH),
        new Vector2(radius, wallH),
        new Vector2(radius, 0),
    ];
    const segs = Math.max(12, Math.ceil(96 * Math.abs(phiLength) / (Math.PI * 2)));
    const geo = applyWorldTileUV(
        new LatheGeometry(points, segs, phiStart, phiLength),
        { x: center.x, y: 0, z: center.z },
        tileSize,
    );
    const mesh = new Mesh(geo, baseMat);
    mesh.position.set(center.x, 0, center.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
    return mesh;
}

// 豁口端面，封住墙体厚度
function addGapCap(root, baseMat, layout, radius, center, phi) {
    const { wallH, wallT, tileSize } = layout;
    const rMid = radius + wallT * 0.5;
    const pos = new Vector3(
        center.x + rMid * Math.sin(phi),
        wallH * 0.5,
        center.z + rMid * Math.cos(phi),
    );
    const mesh = addBox(root, pos, new Vector3(wallT, wallH, wallT), baseMat, tileSize);
    mesh.rotation.y = phi - Math.PI * 0.5;
    return mesh;
}

// 创建豁口半透明发光门帘
function createGlowGapPortal(layout, westGap, doorX) {
    const group = new Group();
    group.name = "GlowGapPortal";

    const mat = new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        uniforms: {
            uTime: { value: 0 },
            uColor: { value: new Color(0x66e0ff) },
            uIntensity: { value: 1.35 },
        },
        vertexShader: /* glsl */ `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: /* glsl */ `
            uniform float uTime;
            uniform vec3 uColor;
            uniform float uIntensity;
            varying vec2 vUv;

            void main() {
                float edgeX = smoothstep(0.0, 0.12, vUv.x) * smoothstep(0.0, 0.12, 1.0 - vUv.x);
                float edgeY = smoothstep(0.0, 0.08, vUv.y) * smoothstep(0.0, 0.1, 1.0 - vUv.y);
                float veil = edgeX * edgeY;
                float wave = 0.55 + 0.45 * sin(vUv.y * 14.0 - uTime * 2.4);
                float scan = 0.35 + 0.65 * pow(abs(sin(vUv.x * 3.14159 + uTime * 1.6)), 2.0);
                float alpha = veil * (0.22 + 0.38 * wave * scan);
                vec3 col = uColor * (uIntensity + 0.55 * wave);
                gl_FragColor = vec4(col, alpha);
            }
        `,
    });

    const mesh = new Mesh(
        new PlaneGeometry(westGap.width, layout.wallH),
        mat,
    );
    mesh.name = "GlowGapCurtain";
    mesh.rotation.y = Math.PI * 0.5;
    mesh.position.set(doorX, layout.wallH * 0.5, westGap.zCenter);
    mesh.renderOrder = 2;
    mesh.frustumCulled = false;
    group.add(mesh);
    group.userData.material = mat;
    return group;
}

// 更新发光门帘时间
function updateGlowPortal(t) {
    const mat = glowPortal?.userData?.material;
    if (mat?.uniforms?.uTime) mat.uniforms.uTime.value = t;
}

// 小场景世界范围
function createMiniScaleBounds(layout, worldOffset, circle) {
    const { platform, wallT } = layout;
    const ox = worldOffset.x + platform.x;
    const oz = (worldOffset.z ?? 0) + platform.z;
    const halfX = platform.sizeX * 0.5;
    const halfZ = platform.sizeZ * 0.5;
    const bounds = {
        minX: ox - halfX - wallT,
        maxX: ox + halfX,
        minZ: oz - halfZ - wallT,
        maxZ: oz + halfZ + wallT,
    };
    if (!circle) return bounds;

    const cx = worldOffset.x + circle.center.x;
    const cz = (worldOffset.z ?? 0) + (circle.center.z ?? 0);
    const r = circle.radius + (circle.wallT ?? wallT);
    bounds.minX = Math.min(bounds.minX, cx - r);
    bounds.maxX = Math.max(bounds.maxX, cx + r);
    bounds.minZ = Math.min(bounds.minZ, cz - r);
    bounds.maxZ = Math.max(bounds.maxZ, cz + r);
    return bounds;
}

// 点是否落在小场景范围内
function isInsideMiniScaleBounds(pos, bounds, pad = 0) {
    return (
        pos.x >= bounds.minX - pad
        && pos.x <= bounds.maxX + pad
        && pos.z >= bounds.minZ - pad
        && pos.z <= bounds.maxZ + pad
    );
}

// 两数是否视为同一缩放
function isNearScale(a, b) {
    return Math.abs(a - b) <= Math.max(Math.abs(b) * 1e-4, 1e-8);
}

// 当前总缩放下的人物目标尺寸
function playerScaleForZone(z = zoneScale) {
    return z < 1 ? PLAYER_SCALE_MINI : PLAYER_SCALE_NORMAL;
}

// 当前总缩放下的车辆目标尺寸
function vehicleScaleForZone(z = zoneScale) {
    return z < 1 ? VEHICLE_SCALE_MINI : VEHICLE_SCALE_NORMAL;
}

// 是否处于载具驾驶
function isDriving() {
    return player?.controllerMode === 1 && Boolean(player.getActiveVehicle?.());
}

// 缩放闸门用的世界坐标；驾驶时取车身位置
function getScaleGatePosition() {
    if (isDriving()) {
        const v = player.getActiveVehicle();
        if (v?.vehicleGroup) return v.vehicleGroup.position;
    }
    const cap = player?.playerCapsule;
    if (cap) return cap.getWorldPosition(scaleGateWorldPos);
    return player?.getPosition?.() ?? null;
}

// 人物当前缩放是否已对齐总缩放
function playerNeedsZoneScale(z = zoneScale) {
    const current = player?.playerModelConfig?.scale;
    if (current == null) return false;
    return !isNearScale(current, playerScaleForZone(z));
}

// 按胶囊尺寸重算站立 / 落地阈值
function recomputePlayerGroundThresholds() {
    const cap = player?.playerCapsule;
    const info = cap?.capsuleInfo;
    if (!info) return;
    const sy = cap.scale.y || 1;
    const ride = player.rideHeight * player.playerModelConfig.scale;
    player.snapH = (-info.segment.end.y) * sy + info.radius + ride;
    player.maxH = player.snapH + ride;
}

// 应用人物缩放；驾驶中保持胶囊局部缩放，由车身缩放带动
function applyPlayerScale(targetScale) {
    if (!player?.setPlayerScale || isNearScale(player.playerModelConfig.scale, targetScale)) return;
    if (!isDriving()) {
        player.setPlayerScale(targetScale);
        return;
    }
    const cap = player.playerCapsule;
    const savedScale = cap.scale.clone();
    player.setPlayerScale(targetScale);
    cap.scale.copy(savedScale);
    recomputePlayerGroundThresholds();
}

// 收集尚未对齐目标尺寸的车辆
function pickVehiclesForZone(z) {
    const all = player?.getAllVehicles?.() ?? [];
    if (!all.length || !miniScaleGate) return [];
    const target = vehicleScaleForZone(z);
    const active = player.getActiveVehicle?.() ?? null;
    return all.filter((v) => {
        if (isNearScale(v.scale, target)) return false;
        if (v === active) return true;
        const pos = v.vehicleGroup.position;
        if (z < 1) return isInsideMiniScaleBounds(pos, miniScaleGate, ZONE_EPS);
        return !isInsideMiniScaleBounds(pos, miniScaleGate, 0);
    });
}

// 插值到指定总缩放
function animateToZone(nextZone, duration = SCALE_ANIM_DURATION) {
    if (!player) return;
    if (scaleAnimFrame !== null) {
        cancelAnimationFrame(scaleAnimFrame);
        scaleAnimFrame = null;
    }

    zoneScale = nextZone;
    const playerTarget = playerScaleForZone(nextZone);
    const vehicleTarget = vehicleScaleForZone(nextZone);
    const vehiclesToScale = pickVehiclesForZone(nextZone);
    const fromPlayer = player.playerModelConfig?.scale ?? playerTarget;
    const scalePlayer = playerNeedsZoneScale(nextZone);
    const fromVehicleScales = vehiclesToScale.map((v) => v.scale);

    if (!scalePlayer && !vehiclesToScale.length) return;

    isScaling = true;
    const startTime = performance.now();

    const tick = (now) => {
        const t = Math.min((now - startTime) / (duration * 1000), 1);

        if (player.setVehicleScale) {
            for (let i = 0; i < vehiclesToScale.length; i++) {
                const vs = fromVehicleScales[i] + (vehicleTarget - fromVehicleScales[i]) * t;
                player.setVehicleScale(vehiclesToScale[i], vs);
            }
        }

        if (scalePlayer) {
            const current = fromPlayer + (playerTarget - fromPlayer) * t;
            applyPlayerScale(current);
        }

        if (t < 1) {
            scaleAnimFrame = requestAnimationFrame(tick);
        } else {
            scaleAnimFrame = null;
            isScaling = false;
        }
    };

    scaleAnimFrame = requestAnimationFrame(tick);
}

// 进入 / 离开小场景范围时切换缩放
function updateMiniScaleGate() {
    if (!player || !miniScaleGate || isScaling) return;
    const pos = getScaleGatePosition();
    if (!pos) return;

    const inside = isInsideMiniScaleBounds(pos, miniScaleGate, 0);
    const insideLoose = isInsideMiniScaleBounds(pos, miniScaleGate, ZONE_EPS);

    if (zoneScale === 1 && inside) {
        animateToZone(MINI_SCALE);
        return;
    }
    if (zoneScale === MINI_SCALE && !insideLoose) {
        animateToZone(1);
        return;
    }

    // 当前范围内尚未对齐的对象补齐缩放
    if (playerNeedsZoneScale()) {
        animateToZone(zoneScale);
        return;
    }
    const pending = pickVehiclesForZone(zoneScale);
    if (pending.length) animateToZone(zoneScale);
}

// 半埋圆柱 + 半埋长方体
function createHalfBuriedObstacles(root, baseMat, layout) {
    const accentMat = tintMaterial(baseMat, ACCENT_GRAY);
    const {
        obstacleX0,
        obstacleCount,
        obstacleSpacing,
        obstacleZ,
        obstacleCylR,
        obstacleCylLen,
        obstacleBoxSize,
        deckY,
        deckThick,
        tileSize,
    } = layout;
    const deckTop = deckY + deckThick * 0.5;

    for (let i = 0; i < obstacleCount; i++) {
        const x = obstacleX0 - i * obstacleSpacing;

        const cylPos = new Vector3(x, deckTop, -obstacleZ);
        const cylGeo = applyWorldTileUV(
            new CylinderGeometry(obstacleCylR, obstacleCylR, obstacleCylLen, 24),
            cylPos,
            tileSize,
        );
        cylGeo.rotateX(Math.PI / 2);
        const cyl = new Mesh(cylGeo, accentMat);
        cyl.position.copy(cylPos);
        cyl.castShadow = true;
        cyl.receiveShadow = true;
        root.add(cyl);

        addBox(root, new Vector3(x, deckTop, obstacleZ), obstacleBoxSize.clone(), accentMat, tileSize);
    }
}

// 加载展示车辆
async function spawnShowcaseVehicles(gltfLoader) {
    const gltf = await gltfLoader.loadAsync("./glb/suv.glb");
    for (const spawnPos of VEHICLE_SPAWNS) {
        const model = gltf.scene.clone(true);
        await player.loadVehicleModel({
            model,
            animations: gltf.animations,
            scale: VEHICLE_SCALE_NORMAL,
            position: spawnPos.clone(),
            wheelsNames: ["Wheel_LF", "Wheel_RF", "Wheel_LR", "Wheel_RR"],
            driverSeatPosition: new Vector3(-0.6, 0.7, 0.4),
            driverSeatRotation: -Math.PI / 2,
            modelRotation: -Math.PI / 2,
            followVehicleDirection: VEHICLE_TUNING.followVehicleDirection,
            debug: VEHICLE_TUNING.debug,
            chassis: VEHICLE_TUNING.chassis,
            suspension: VEHICLE_TUNING.suspension,
            steering: VEHICLE_TUNING.steering,
            grip: VEHICLE_TUNING.grip,
            power: VEHICLE_TUNING.power,
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

// 车辆前方动态刚体
function spawnVehiclePropBodies(baseMat) {
    const vehicles = player?.getAllVehicles?.() ?? [];
    if (vehicles.length < 2) return;
    const propMat = tintMaterial(baseMat, PROP_ACCENT_COLOR);
    spawnSphereGrid(vehicles[0], propMat, mainLayout);
    spawnBoxWall(vehicles[1], propMat, mainLayout);
}

// 按布局生成动态球阵与箱墙
function spawnLayoutPropBodies(baseMat, layout, worldOffset) {
    const propMat = tintMaterial(baseMat, PROP_ACCENT_COLOR);
    const s = layout.scale;
    const forward = new Vector3(-1, 0, 0);
    const right = new Vector3(0, 0, 1);
    const xMid = layout.obstacleX0 - (layout.obstacleCount - 1) * layout.obstacleSpacing * 0.5;
    const deckTop = (worldOffset.y ?? 0) + layout.deckY + layout.deckThick * 0.5;
    const ox = worldOffset.x;
    const oz = worldOffset.z ?? 0;

    const gravity = player.gravity * s;
    spawnSphereGridAt({
        mat: propMat,
        center: new Vector3(ox + xMid, 0, oz + VEHICLE_SPAWNS[0].z * s),
        forward,
        right,
        radius: PROP_SPHERE_R * s,
        deckTop,
        gravity,
    });
    spawnBoxWallAt({
        mat: propMat,
        center: new Vector3(ox + xMid, 0, oz + VEHICLE_SPAWNS[1].z * s),
        right,
        boxSize: PROP_BOX_SIZE * s,
        deckTop,
        gravity,
    });
}

// 车辆前向 / 右向轴
function getVehicleAxes(vehicle) {
    vehicle.vehicleGroup.updateMatrixWorld(true);
    const forward = vehicle.forwardLocal.clone().transformDirection(vehicle.vehicleGroup.matrixWorld).normalize();
    const right = new Vector3(0, 1, 0).cross(forward).normalize();
    return { origin: vehicle.vehicleGroup.position, forward, right };
}

// 障碍带中线处的放置中心
function getPropCenter(vehicle, layout) {
    const { origin, forward, right } = getVehicleAxes(vehicle);
    const center = origin.clone();
    center.x = layout.obstacleX0 - (layout.obstacleCount - 1) * layout.obstacleSpacing * 0.5;
    return { forward, right, center };
}

// 4×4 贴地球阵（相对车辆）
function spawnSphereGrid(vehicle, mat, layout) {
    const { forward, right, center } = getPropCenter(vehicle, layout);
    spawnSphereGridAt({
        mat,
        center,
        forward,
        right,
        radius: PROP_SPHERE_R * layout.scale,
        deckTop: layout.deckY + layout.deckThick * 0.5,
    });
}

// 4×4 贴地球阵
function spawnSphereGridAt({ mat, center, forward, right, radius, deckTop, gravity }) {
    const spacing = radius * 2;
    const start = center.clone().addScaledVector(forward, -(PROP_GRID - 1) * spacing * 0.5);
    const geo = new SphereGeometry(1, 24, 16);

    for (let row = 0; row < PROP_GRID; row++) {
        for (let col = 0; col < PROP_GRID; col++) {
            const pos = start.clone()
                .addScaledVector(forward, row * spacing)
                .addScaledVector(right, (col - (PROP_GRID - 1) * 0.5) * spacing);
            pos.y = deckTop + radius;
            const mesh = new Mesh(geo, mat);
            mesh.scale.setScalar(radius);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            scene.add(mesh);
            player.addCollider({
                motion: "dynamic",
                shape: { kind: "sphere", radius, position: pos },
                mesh,
                restitution: 0.35,
                friction: 0.55,
                ...(gravity != null ? { gravity } : null),
            });
        }
    }
}

// 4×4 箱墙（相对车辆）
function spawnBoxWall(vehicle, mat, layout) {
    const { right, center } = getPropCenter(vehicle, layout);
    spawnBoxWallAt({
        mat,
        center,
        right,
        boxSize: PROP_BOX_SIZE * layout.scale,
        deckTop: layout.deckY + layout.deckThick * 0.5,
    });
}

// 4×4 箱墙
function spawnBoxWallAt({ mat, center, right, boxSize, deckTop, gravity }) {
    const half = boxSize * 0.5;
    const start = center.clone();
    const geo = new BoxGeometry(1, 1, 1);
    const halfExtents = new Vector3(half, half, half);

    for (let row = 0; row < PROP_GRID; row++) {
        for (let col = 0; col < PROP_GRID; col++) {
            const pos = start.clone()
                .addScaledVector(right, (col - (PROP_GRID - 1) * 0.5) * boxSize);
            pos.y = deckTop + boxSize * (row + 0.5);
            const mesh = new Mesh(geo, mat);
            mesh.scale.setScalar(boxSize);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            scene.add(mesh);
            player.addCollider({
                motion: "dynamic",
                shape: {
                    kind: "box",
                    halfExtents: halfExtents.clone(),
                    position: pos,
                },
                mesh,
                restitution: 0.12,
                friction: 0.7,
                density: 1.2,
                ...(gravity != null ? { gravity } : null),
            });
        }
    }
}

// 六棱柱攀爬尺寸
function getHexClimbMetrics(layout) {
    const stairWidth = layout.stairWidth;
    const rampWidth = layout.rampWidth;
    const armSpan = stairWidth + rampWidth;
    const platformSides = 6;
    const platformApothem = armSpan / (2 * Math.tan(Math.PI / platformSides));
    const platformCircumRadius = platformApothem / Math.cos(Math.PI / platformSides);
    const sideLength = 2 * platformApothem * Math.tan(Math.PI / platformSides);
    return {
        stairWidth,
        rampWidth,
        armSpan,
        platformSides,
        platformApothem,
        platformCircumRadius,
        sideLength,
        topHeight: layout.l1Top,
    };
}

// 运动学往返平台
function createKinematicPlatforms(baseMat, layout, parent) {
    const { sideLength, topHeight, platformApothem } = getHexClimbMetrics(layout);
    const size = new Vector3(sideLength, layout.kineThickness, sideLength);
    const y = topHeight + layout.kineTopOffset - layout.kineThickness * 0.5;
    const half = sideLength * 0.5;
    const mat = tintMaterial(baseMat, PROP_ACCENT_COLOR);
    const prefix = layout.scale === 1 ? "Kine" : "MiniKine";

    const farEastX = -platformApothem - half;
    const deckWestX = layout.platform.x - layout.platform.sizeX * 0.5;
    const farWestX = deckWestX + half;
    const midX = (farEastX + farWestX) * 0.5;

    const farEast = new Vector3(farEastX, y, 0);
    const meetEast = new Vector3(midX + half, y, 0);
    const farWest = new Vector3(farWestX, y, 0);
    const meetWest = new Vector3(midX - half, y, 0);

    addKinematicShuttle({
        parent,
        name: `${prefix}Shuttle`,
        from: farEast,
        to: meetEast,
        size,
        mat,
        spinSpeed: 0,
        tileSize: layout.tileSize,
    });
    addKinematicShuttle({
        parent,
        name: `${prefix}ShuttleSpin`,
        from: farWest,
        to: meetWest,
        size,
        mat,
        spinSpeed: KINE_SPIN_SPEED,
        tileSize: layout.tileSize,
    });
}

// 创建单个往返平台
function addKinematicShuttle({ parent, name, from, to, size, mat, spinSpeed, tileSize }) {
    const mesh = addBox(parent, from.clone(), size, mat, tileSize);
    mesh.name = name;
    player.addCollider({
        motion: "kinematic",
        shape: { kind: "mesh", source: mesh },
        follow: mesh,
    });
    kinematicPlatforms.push({
        mesh,
        from: from.clone(),
        to: to.clone(),
        spinSpeed,
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

// 更新运动学平台
function updateKinematicPlatforms(t) {
    const phase = (t * KINE_SHUTTLE_SPEED / Math.PI) % 2;
    const raw = phase <= 1 ? phase : 2 - phase;
    const p = easeEndsLinearMiddle(raw);

    for (const entry of kinematicPlatforms) {
        entry.mesh.position.lerpVectors(entry.from, entry.to, p);
        if (entry.spinSpeed) entry.mesh.rotation.y = t * entry.spinSpeed;
    }
}

// 创建攀爬组与中心平台
function createClimbGroups(root, baseMat, layout) {
    const {
        topHeight,
        stairWidth,
        rampWidth,
        platformSides,
        platformApothem,
        platformCircumRadius,
    } = getHexClimbMetrics(layout);
    const stepCount = 7;
    const stepHeight = topHeight / stepCount;
    const tileSize = layout.tileSize;

    const platformPos = new Vector3(0, topHeight * 0.5, 0);
    const platformGeo = applyWorldTileUV(
        new CylinderGeometry(platformCircumRadius, platformCircumRadius, topHeight, platformSides),
        platformPos,
        tileSize,
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
            tileSize,
        });

        createRampToPlatform(arm, {
            platformRadius: platformApothem,
            angleDeg,
            length: runLength,
            width: rampWidth,
            z: rampZ,
            baseMat,
            tileSize,
        });
    }
}

// 创建一组楼梯
function createStairsToPlatform(root, { platformRadius, stepHeight, stepCount, stepDepth, width, z, baseMat, tileSize }) {
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
            tileSize,
        );
    }
}

// 创建一个斜坡
function createRampToPlatform(root, { platformRadius, angleDeg, length, width, z, baseMat, tileSize }) {
    const height = Math.tan(angleDeg * Math.PI / 180) * length;
    const origin = new Vector3(platformRadius + length * 0.5, 0, z);
    const rotY = Math.PI;
    const ramp = new Mesh(createRampGeometry(length, height, width, origin, rotY, tileSize), baseMat);
    ramp.position.copy(origin);
    ramp.rotation.y = rotY;
    ramp.castShadow = true;
    ramp.receiveShadow = true;
    root.add(ramp);
    return ramp;
}

// 创建斜坡几何体。
function createRampGeometry(length, height, width, origin = { x: 0, y: 0, z: 0 }, rotY = 0, tileSize = TILE_SIZE) {
    const halfLength = length / 2;
    const halfWidth = width / 2;
    const cosY = Math.cos(rotY);
    const sinY = Math.sin(rotY);
    const tile = Math.max(tileSize, 1e-6);
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
            uv.setXY(idx, u / tile, v / tile);
        }
    }

    flat.setAttribute("uv", uv);
    flat.computeVertexNormals();
    return flat;
}

// 添加盒子
function addBox(root, position, size, material, tileSize = TILE_SIZE) {
    const geo = applyWorldTileUV(new BoxGeometry(size.x, size.y, size.z), position, tileSize);
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

// 将调参写回场上全部车辆
function applyVehicleTuning() {
    const t = VEHICLE_TUNING;
    const vehicles = player?.getAllVehicles?.() ?? [];
    for (const v of vehicles) {
        const he = v.halfExtents;
        const volume = 8 * he.x * he.y * he.z;
        v.chassisBody.setMass(volume * Math.max(1e-8, t.chassis.density));
        v.chassisBody.linearDamping = t.chassis.linearDamping;
        v.chassisBody.angularDamping = t.chassis.angularDamping;

        Object.assign(v.steering, t.steering);
        Object.assign(v.grip, t.grip);
        v.maxSpeed = t.power.maxSpeed * v.scale;
        v.acceleration = t.power.acceleration * v.scale;
        v.deceleration = t.power.deceleration * v.scale;
        v.followVehicleDirection = t.followVehicleDirection;

        const sus = t.suspension;
        const staticSag = 9.81 * v.scale / (4 * Math.max(1e-4, sus.stiffness));
        const rest = Math.max(sus.restLength * v.scale, staticSag * 1.2);
        v.sideFrictionStiffness = sus.sideFrictionStiffness;

        const n = v.vehicleController.numWheels();
        for (let i = 0; i < n; i++) {
            v.vehicleController.setWheelSuspensionRestLength(i, rest);
            v.vehicleController.setWheelMaxSuspensionTravel(i, sus.maxTravel * v.scale);
            v.vehicleController.setWheelSuspensionStiffness(i, sus.stiffness);
            v.vehicleController.setWheelSuspensionCompression(i, sus.compression);
            v.vehicleController.setWheelSuspensionRelaxation(i, sus.relaxation);
            v.vehicleController.setWheelMaxSuspensionForce(i, sus.maxForce);
            v.vehicleController.setWheelFrictionSlip(i, sus.frictionSlip);
            v.vehicleController.setWheelSideFrictionStiffness(i, sus.sideFrictionStiffness);
            v.vehicleController.setWheelRollInfluence(i, sus.rollInfluence);
        }

        if (v.physicsBoxMesh) {
            if (t.debug.showPhysicsBox) v.vehicleGroup.add(v.physicsBoxMesh);
            else v.vehicleGroup.remove(v.physicsBoxMesh);
        }
        if (v.wheelRayDebug) v.wheelRayDebug.visible = t.debug.showWheelRays;
        if (v.wheelTravelDebug) v.wheelTravelDebug.visible = t.debug.showWheelTravel;
        if (v.wheelSphereDebug) v.wheelSphereDebug.visible = t.debug.showWheelSpheres;
    }
    if (player?.vehicle?.params?.debug) {
        player.vehicle.params.debug.showPhysicsBox = t.debug.showPhysicsBox;
        player.vehicle.params.debug.showWheelRays = t.debug.showWheelRays;
        player.vehicle.params.debug.showWheelTravel = t.debug.showWheelTravel;
        player.vehicle.params.debug.showWheelSpheres = t.debug.showWheelSpheres;
    }
}

// 创建调试面板
function createDebugPanel() {
    const params = {
        colliderDebug: false,
        playerCapsuleDebug: false,
        dynamicBodyDebug: false,
        vehiclePhysicsDebug: false,
        footIKEnabled: true,
        footIKDebug: false,
        maxSteerDeg: VEHICLE_TUNING.steering.maxSteerAngle * 180 / Math.PI,
        resetVehicle() {
            player?.resetVehicle();
        },
    };

    gui = new GUI({ title: "调试", width: 300 });
    Object.assign(gui.domElement.style, {
        position: "fixed",
        top: "12px",
        right: "12px",
        maxHeight: "calc(100vh - 24px)",
        overflowY: "auto",
    });
    gui.domElement.addEventListener("pointerdown", (e) => e.stopPropagation());

    const sceneFolder = gui.addFolder("Scene");
    sceneFolder.add(params, "colliderDebug").name("Mesh Collider").onChange((value) => {
        player?.setColliderDebug(value);
    });
    sceneFolder.add(params, "playerCapsuleDebug").name("角色胶囊").onChange((value) => {
        player?.setPlayerCapsuleDebug?.(value);
    });
    sceneFolder.add(params, "dynamicBodyDebug").name("Dynamic Body").onChange((value) => {
        player?.setDynamicBodyDebug?.(value);
    });
    sceneFolder.add(params, "vehiclePhysicsDebug").name("Vehicle Physics").onChange((value) => {
        player?.setVehiclePhysicsDebug?.(value);
    });
    sceneFolder.add(params, "footIKEnabled").name("Foot IK").onChange((value) => {
        footIK?.setEnabled(value);
    });
    sceneFolder.add(params, "footIKDebug").name("Foot IK 调试").onChange((value) => {
        footIK?.setDebugEnabled(value);
    });
    sceneFolder.add(params, "resetVehicle").name("Reset Vehicle");
    sceneFolder.open();

    const t = VEHICLE_TUNING;
    const vehicleFolder = gui.addFolder("车辆");

    vehicleFolder.add(t, "followVehicleDirection").name("镜头跟随车头").onChange(applyVehicleTuning);
    vehicleFolder.add(t.debug, "showPhysicsBox").name("显示物理盒").onChange(applyVehicleTuning);
    vehicleFolder.add(t.debug, "showWheelRays").name("车轮射线").onChange(applyVehicleTuning);
    vehicleFolder.add(t.debug, "showWheelTravel").name("车轮行程").onChange(applyVehicleTuning);
    vehicleFolder.add(t.debug, "showWheelSpheres").name("车轮碰撞球").onChange(applyVehicleTuning);

    const chassisFolder = vehicleFolder.addFolder("底盘");
    chassisFolder.add(t.chassis, "density", 0.1, 10, 0.05).name("密度").onChange(applyVehicleTuning);
    chassisFolder.add(t.chassis, "linearDamping", 0, 2, 0.01).name("线阻尼").onChange(applyVehicleTuning);
    chassisFolder.add(t.chassis, "angularDamping", 0, 5, 0.01).name("角阻尼").onChange(applyVehicleTuning);
    chassisFolder.open();

    const susFolder = vehicleFolder.addFolder("悬挂");
    susFolder.add(t.suspension, "restLength", 0.05, 2, 0.01).name("静止长度").onChange(applyVehicleTuning);
    susFolder.add(t.suspension, "maxTravel", 0.05, 10, 0.05).name("最大行程").onChange(applyVehicleTuning);
    susFolder.add(t.suspension, "stiffness", 0.1, 50, 0.01).name("刚度").onChange(applyVehicleTuning);
    susFolder.add(t.suspension, "compression", 0, 8, 0.01).name("压缩阻尼").onChange(applyVehicleTuning);
    susFolder.add(t.suspension, "relaxation", 0, 8, 0.01).name("回弹阻尼").onChange(applyVehicleTuning);
    susFolder.add(t.suspension, "maxForce", 100, 50000, 100).name("最大悬挂力").onChange(applyVehicleTuning);
    susFolder.add(t.suspension, "frictionSlip", 0.1, 50, 0.1).name("纵向抓地").onChange(applyVehicleTuning);
    susFolder.add(t.suspension, "sideFrictionStiffness", 0, 5, 0.01).name("侧向摩擦刚度").onChange(applyVehicleTuning);
    susFolder.add(t.suspension, "rollInfluence", 0, 1, 0.01).name("侧倾影响").onChange(applyVehicleTuning);
    susFolder.open();

    const steerFolder = vehicleFolder.addFolder("转向");
    steerFolder.add(params, "maxSteerDeg", 5, 60, 0.5).name("最大转向角").onChange((deg) => {
        t.steering.maxSteerAngle = deg * Math.PI / 180;
        applyVehicleTuning();
    });
    steerFolder.add(t.steering, "steerTime", 0.05, 3, 0.05).name("打满舵时间").onChange(applyVehicleTuning);
    steerFolder.add(t.steering, "steerReturnTimeSlow", 0.05, 3, 0.05).name("低速回正时间").onChange(applyVehicleTuning);
    steerFolder.add(t.steering, "steerReturnTimeFast", 0.05, 3, 0.05).name("高速回正时间").onChange(applyVehicleTuning);
    steerFolder.add(t.steering, "highSpeedSteerScale", 0.15, 1, 0.01).name("高速转角比例").onChange(applyVehicleTuning);
    steerFolder.open();

    const gripFolder = vehicleFolder.addFolder("抓地");
    gripFolder.add(t.grip, "maxG", 0.1, 3, 0.05).name("侧向加速度上限").onChange(applyVehicleTuning);
    gripFolder.add(t.grip, "sideFrictionIdle", 0, 2, 0.01).name("直线侧向摩擦").onChange(applyVehicleTuning);
    gripFolder.add(t.grip, "sideFrictionFrontMin", 0, 2, 0.01).name("前轮摩擦下限").onChange(applyVehicleTuning);
    gripFolder.add(t.grip, "sideFrictionRearMin", 0, 2, 0.01).name("后轮摩擦下限").onChange(applyVehicleTuning);
    gripFolder.add(t.grip, "handbrakeRearFriction", 0, 2, 0.01).name("手刹后轮摩擦").onChange(applyVehicleTuning);
    gripFolder.add(t.grip, "handbrakeRearDriveScale", 0, 1, 0.01).name("手刹后驱比例").onChange(applyVehicleTuning);
    gripFolder.add(t.grip, "handbrakeReleaseTime", 0.01, 1, 0.01).name("松手刹时间").onChange(applyVehicleTuning);
    gripFolder.add(t.grip, "wheelbaseRatio", 0.2, 1, 0.01).name("轴距比例").onChange(applyVehicleTuning);
    gripFolder.open();

    const powerFolder = vehicleFolder.addFolder("动力");
    powerFolder.add(t.power, "maxSpeed", 10, 400, 1).name("最高速度").onChange(applyVehicleTuning);
    powerFolder.add(t.power, "acceleration", 0.5, 40, 0.1).name("加速度").onChange(applyVehicleTuning);
    powerFolder.add(t.power, "deceleration", 0.5, 80, 0.1).name("制动减速度").onChange(applyVehicleTuning);
    powerFolder.open();

    vehicleFolder.open();
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
    updateGlowPortal(t);
    if (player) {
        updateKinematicPlatforms(t);
        updateMiniScaleGate();
        player.update();
    } else {
        controls?.update();
    }
    renderer.render(scene, camera);
    stats?.update();
}
