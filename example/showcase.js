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
    ExtrudeGeometry,
    Float32BufferAttribute,
    Group,
    Matrix4,
    Mesh,
    MeshStandardMaterial,
    PerspectiveCamera,
    PlaneGeometry,
    Quaternion,
    RepeatWrapping,
    ShaderMaterial,
    Shape,
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
import { playerController } from "../src/PlayerController";
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
const VEHICLE_SCALE_NORMAL = 0.5; // 大场景车辆缩放
// 梯形连接段长度：相对宽端开口宽度（宽矩形 / 收腰）
const TRAP_WIDE_LEN_RATIO = 0.45;
const TRAP_SLOPE_LEN_RATIO = 0.4;
const SLOPE_DOMINO_COUNT = 10;
// 收腰段：青通道 tint
const TRAP_TINT_COLOR = 0x88c8e0;

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
let trapScaleRange = null; // 收腰段：wideWestX 处 scale=1，westX 处 scale=0.1
let glowPortals = [];
let zoneScale = 1; // 当前场景总缩放（1 → MINI_SCALE）
const scaleGateWorldPos = new Vector3(); // 缩放判定用的世界坐标缓冲

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
    // 矩形西墙全开，开口贴合南北墙外缘，与梯形宽端相接
    const mainWestOpening = {
        zCenter: 0,
        width: mainLayout.platform.sizeZ + 2 * mainLayout.wallT,
    };
    // 小场景南北墙外缘宽度：梯形窄端西口与小矩形东侧共用
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
    const trapLayout = createTrapezoidLayout(
        mainWestX,
        mainLayout.platform.sizeZ,
        miniLayout.platform.sizeZ,
    );
    const trapWorld = buildTrapezoidArena(prototypeMat, mainLayout, trapLayout, miniLayout.wallH);
    trapWorld.name = "TrapezoidWorld";
    world.add(trapWorld);
    trapScaleRange = { eastX: trapLayout.wideWestX, westX: trapLayout.westX };

    const miniWorld = buildShowcaseWorld(prototypeMat, miniLayout, {
        omitEast: true,
    });
    miniWorld.name = "MiniWorld";
    const miniLocalEast = miniLayout.platform.x + miniLayout.platform.sizeX * 0.5;
    // 小场景台面东缘对齐梯形窄端西口
    miniWorld.position.set(trapLayout.westX - miniLocalEast, 0, 0);
    world.add(miniWorld);
    scene.add(world);

    // 豁口发光门帘：宽矩形/收腰交界 + 梯形西口（进入小场景）
    const slopeEastOpening = { zCenter: 0, width: trapLayout.halfWide * 2 };
    glowPortals = [
        createGlowGapPortal(mainLayout, slopeEastOpening, trapLayout.wideWestX),
        createGlowGapPortal(miniLayout, miniOpening, trapLayout.westX),
    ];
    for (const portal of glowPortals) scene.add(portal);

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
    spawnSlopeDominoes(prototypeMat, mainLayout, trapLayout, miniLayout.wallH);
    createKinematicPlatforms(prototypeMat, mainLayout, scene, {
        meetCenterX: trapLayout.eastX,
        slopeMeetCenterX: trapLayout.wideWestX,
        slopeWestX: trapLayout.westX,
    });
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

// 梯形连接段尺寸（东贴大场景，西贴小场景）
function createTrapezoidLayout(eastX, eastWidth, westWidth) {
    const wideLen = eastWidth * TRAP_WIDE_LEN_RATIO;
    const slopeLen = eastWidth * TRAP_SLOPE_LEN_RATIO;
    const wideWestX = eastX - wideLen;
    const westX = wideWestX - slopeLen;
    return {
        eastX,
        westX,
        wideWestX,
        halfWide: eastWidth * 0.5,
        halfNarrow: westWidth * 0.5,
    };
}

function getTrapezoidOutline(trap) {
    const { eastX, westX, wideWestX, halfWide, halfNarrow } = trap;
    return [
        { x: eastX, z: halfWide },
        { x: wideWestX, z: halfWide },
        { x: westX, z: halfNarrow },
        { x: westX, z: -halfNarrow },
        { x: wideWestX, z: -halfWide },
        { x: eastX, z: -halfWide },
    ];
}

function getWideSectionOutline(trap) {
    const { eastX, wideWestX, halfWide } = trap;
    return [
        { x: eastX, z: halfWide },
        { x: wideWestX, z: halfWide },
        { x: wideWestX, z: -halfWide },
        { x: eastX, z: -halfWide },
    ];
}

function getSlopeSectionOutline(trap) {
    const { wideWestX, westX, halfWide, halfNarrow } = trap;
    return [
        { x: wideWestX, z: halfWide },
        { x: westX, z: halfNarrow },
        { x: westX, z: -halfNarrow },
        { x: wideWestX, z: -halfWide },
    ];
}

function isSlopeSectionEdge(a, b) {
    return Math.abs(b.x - a.x) > 1e-4 && Math.abs(b.z - a.z) > 1e-4;
}

// 宽矩形 + 收腰梯形
function buildTrapezoidArena(baseMat, layout, trap, westWallH) {
    const root = new Group();
    const trapMat = tintMaterial(baseMat, TRAP_TINT_COLOR);
    addPolygonFloor(root, getWideSectionOutline(trap), layout, baseMat);
    addPolygonFloor(root, getSlopeSectionOutline(trap), layout, trapMat);
    addOutlineWalls(root, getTrapezoidOutline(trap), layout, baseMat, trapMat, trap, westWallH);
    return root;
}

function addPolygonFloor(root, points, layout, material) {
    const { deckY, deckThick, tileSize } = layout;
    const shape = new Shape();
    shape.moveTo(points[0].x, -points[0].z);
    for (let i = 1; i < points.length; i++) {
        shape.lineTo(points[i].x, -points[i].z);
    }
    shape.closePath();

    const geo = new ExtrudeGeometry(shape, { depth: deckThick, bevelEnabled: false, steps: 1 });
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, deckY - deckThick * 0.5, 0);
    const floor = new Mesh(applyWorldTileUV(geo, { x: 0, y: 0, z: 0 }, tileSize), material);
    floor.name = "TrapezoidFloor";
    floor.castShadow = true;
    floor.receiveShadow = true;
    root.add(floor);
    return floor;
}

// 沿多边形外缘砌墙，跳过东西两端开口；收腰段墙高从大场景线性降到小场景
function addOutlineWalls(root, points, layout, wideMat, slopeMat, trap, westWallH) {
    const n = points.length;
    let cx = 0;
    let cz = 0;
    for (const p of points) {
        cx += p.x;
        cz += p.z;
    }
    cx /= n;
    cz /= n;

    const heightAt = (p) => (
        Math.abs(p.x - trap.wideWestX) < 1e-4 || p.x > trap.wideWestX
            ? layout.wallH
            : westWallH
    );

    for (let i = 0; i < n; i++) {
        const a = points[i];
        const b = points[(i + 1) % n];
        const isEastGap = Math.abs(a.x - trap.eastX) < 1e-4 && Math.abs(b.x - trap.eastX) < 1e-4;
        const isWestGap = Math.abs(a.x - trap.westX) < 1e-4 && Math.abs(b.x - trap.westX) < 1e-4;
        if (isEastGap || isWestGap) continue;

        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const len = Math.hypot(dx, dz);
        if (len < 1e-4) continue;

        const midX = (a.x + b.x) * 0.5;
        const midZ = (a.z + b.z) * 0.5;
        let nx = -dz / len;
        let nz = dx / len;
        if (nx * (cx - midX) + nz * (cz - midZ) > 0) {
            nx = -nx;
            nz = -nz;
        }

        const hA = heightAt(a);
        const hB = heightAt(b);
        const material = isSlopeSectionEdge(a, b) ? slopeMat : wideMat;
        if (Math.abs(hA - hB) > 1e-4) {
            addTaperedWall(root, layout, material, a, b, hA, hB, nx, nz);
        } else {
            addOrientedWall(root, layout, material, midX, midZ, len, nx, nz, dx, dz);
        }
    }
}

function addTaperedWall(root, layout, material, a, b, hA, hB, nx, nz) {
    const { wallT, tileSize } = layout;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const along = new Vector3((b.x - a.x) / len, 0, (b.z - a.z) / len);
    const up = new Vector3(0, 1, 0);
    const out = new Vector3(nx, 0, nz);

    // 外法线与 along×up 反向时会变成左手系，正面被剔掉；改为从另一端挤出
    let origin = a;
    let startH = hA;
    let endH = hB;
    const xAxis = along.clone();
    if (xAxis.clone().cross(up).dot(out) < 0) {
        xAxis.negate();
        origin = b;
        startH = hB;
        endH = hA;
    }

    const shape = new Shape();
    shape.moveTo(0, 0);
    shape.lineTo(len, 0);
    shape.lineTo(len, endH);
    shape.lineTo(0, startH);
    shape.closePath();

    const geo = new ExtrudeGeometry(shape, { depth: wallT, bevelEnabled: false, steps: 1 });
    const m = new Matrix4().makeBasis(xAxis, up, out);
    m.setPosition(origin.x, 0, origin.z);
    geo.applyMatrix4(m);

    const mesh = new Mesh(applyWorldTileUV(geo, { x: 0, y: 0, z: 0 }, tileSize), material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
    return mesh;
}

function addOrientedWall(root, layout, material, midX, midZ, length, nx, nz, dx, dz) {
    const { wallH, wallT, tileSize } = layout;
    const pos = new Vector3(midX + nx * wallT * 0.5, wallH * 0.5, midZ + nz * wallT * 0.5);
    const geo = new BoxGeometry(wallT, wallH, length);
    geo.rotateY(Math.atan2(dx, dz));
    const mesh = new Mesh(applyWorldTileUV(geo, pos, tileSize), material);
    mesh.position.copy(pos);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
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
    for (const portal of glowPortals) {
        const mat = portal?.userData?.material;
        if (mat?.uniforms?.uTime) mat.uniforms.uTime.value = t;
    }
}

// 两数是否视为同一缩放
function isNearScale(a, b) {
    return Math.abs(a - b) <= Math.max(Math.abs(b) * 1e-4, 1e-8);
}

// 收腰段 X：eastX → 1，westX → MINI_SCALE
// 收腰段 X：wideWestX → 1，westX → MINI_SCALE；宽矩形段保持 1
function zoneScaleFromX(x) {
    if (!trapScaleRange) return 1;
    const { eastX: narrowStartX, westX } = trapScaleRange;
    if (x > narrowStartX) return 1;
    const span = narrowStartX - westX;
    if (span <= 1e-6) return x <= westX ? MINI_SCALE : 1;
    const t = Math.min(1, Math.max(0, (narrowStartX - x) / span));
    return 1 + t * (MINI_SCALE - 1);
}

function playerScaleForZone(z = zoneScale) {
    return PLAYER_SCALE_NORMAL * z;
}

function vehicleScaleForZone(z = zoneScale) {
    return VEHICLE_SCALE_NORMAL * z;
}

function isDriving() {
    return player?.controllerMode === 1 && Boolean(player.getActiveVehicle?.());
}

function getScaleGatePosition() {
    if (isDriving()) {
        const v = player.getActiveVehicle();
        if (v?.vehicleGroup) return v.vehicleGroup.position;
    }
    const cap = player?.playerCapsule;
    if (cap) return cap.getWorldPosition(scaleGateWorldPos);
    return player?.getPosition?.() ?? null;
}

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

// 按收腰段 X 连续缩放：越往 -X 越小
function updateTrapScale() {
    if (!player || !trapScaleRange) return;
    const pos = getScaleGatePosition();
    if (!pos) return;

    zoneScale = zoneScaleFromX(pos.x);
    applyPlayerScale(playerScaleForZone(zoneScale));

    const vehicles = player.getAllVehicles?.() ?? [];
    if (!vehicles.length || !player.setVehicleScale) return;
    for (const v of vehicles) {
        const target = vehicleScaleForZone(zoneScaleFromX(v.vehicleGroup.position.x));
        if (!isNearScale(v.scale, target)) player.setVehicleScale(v, target);
    }
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
                density: 10,
                ...(gravity != null ? { gravity } : null),
            });
        }
    }
}

// 收腰段两侧：沿斜墙各 10 个渐小动态长方体
function spawnSlopeDominoes(baseMat, layout, trap, westWallH) {
    if (!player) return;
    const mat = tintMaterial(baseMat, PROP_ACCENT_COLOR);
    const deckTop = layout.deckY + layout.deckThick * 0.5;
    const slopeLen = trap.wideWestX - trap.westX;
    const geo = new BoxGeometry(1, 1, 1);

    const spawnSide = (sign) => {
        const zWide = sign * trap.halfWide;
        const zNarrow = sign * trap.halfNarrow;
        const inward = sign > 0 ? -1 : 1;

        for (let i = 0; i < SLOPE_DOMINO_COUNT; i++) {
            const t = (i + 0.5) / SLOPE_DOMINO_COUNT;
            const sizeMul = 1 + t * (MINI_SCALE - 1);
            const wallH = layout.wallH * (1 - t) + westWallH * t;
            const dominoH = wallH;
            const dominoLen = (slopeLen / SLOPE_DOMINO_COUNT) * 0.82 * sizeMul;
            const dominoW = 0.3 * sizeMul;
            // 宽面（高×长）朝向 ±X，薄边在 X 轴
            const halfExtents = new Vector3(dominoW * 0.5, dominoH * 0.5, dominoLen * 0.5);

            const x = trap.wideWestX + t * (trap.westX - trap.wideWestX);
            const zEdge = zWide + t * (zNarrow - zWide);
            const inset = layout.wallT + dominoLen * 0.5 + 0.04;
            const pos = new Vector3(x, deckTop + dominoH * 0.5, zEdge + inward * inset);

            const mesh = new Mesh(geo, mat);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            scene.add(mesh);
            player.addCollider({
                motion: "dynamic",
                shape: {
                    kind: "box",
                    halfExtents,
                    position: pos,
                },
                mesh,
                restitution: 0.15,
                friction: 0.65,
                density: 1,
            });
        }
    };

    spawnSide(1);
    spawnSide(-1);
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
function createKinematicPlatforms(baseMat, layout, parent, options = {}) {
    const { sideLength, topHeight, platformApothem } = getHexClimbMetrics(layout);
    const size = new Vector3(sideLength, layout.kineThickness, sideLength);
    const y = topHeight + layout.kineTopOffset - layout.kineThickness * 0.5;
    const half = sideLength * 0.5;
    const mat = tintMaterial(baseMat, PROP_ACCENT_COLOR);
    const prefix = layout.scale === 1 ? "Kine" : "MiniKine";

    const farEastX = -platformApothem - half;
    const deckWestX = layout.platform.x - layout.platform.sizeX * 0.5;
    const farWestX = deckWestX + half;
    const defaultMeetX = (farEastX + farWestX) * 0.5;
    const meetCenterX = options.meetCenterX ?? defaultMeetX;
    const slopeMeetCenterX = options.slopeMeetCenterX;
    const slopeWestX = options.slopeWestX;

    // 同一相位 p：p=1 在收腰矩形并排；有收腰段时 p=0 在收腰起点并排
    const farEast = new Vector3(farEastX, y, 0);
    const meetEast = new Vector3(meetCenterX + half, y, 0);
    const spinFrom = Number.isFinite(slopeMeetCenterX)
        ? new Vector3(slopeMeetCenterX + half, y, 0)
        : new Vector3(farWestX, y, 0);
    const spinTo = new Vector3(meetCenterX - half, y, 0);

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
        from: spinFrom,
        to: spinTo,
        size,
        mat,
        spinSpeed: KINE_SPIN_SPEED,
        tileSize: layout.tileSize,
    });

    if (Number.isFinite(slopeMeetCenterX) && Number.isFinite(slopeWestX)) {
        addKinematicShuttle({
            parent,
            name: `${prefix}ShuttleSlope`,
            from: new Vector3(slopeMeetCenterX - half, y, 0),
            to: new Vector3(slopeWestX + half, y, 0),
            size,
            mat,
            spinSpeed: 0,
            tileSize: layout.tileSize,
            zoneScale: true,
        });
    }
}

// 创建单个往返平台
function addKinematicShuttle({ parent, name, from, to, size, mat, spinSpeed, tileSize, zoneScale = false }) {
    const mesh = addBox(parent, from.clone(), size, mat, tileSize);
    mesh.name = name;
    player.addCollider({
        motion: "kinematic",
        shape: { kind: "mesh", source: mesh },
        follow: mesh,
    });
    const entry = {
        mesh,
        from: from.clone(),
        to: to.clone(),
        spinSpeed,
        zoneScale,
        lastZoneScale: 1,
    };
    if (zoneScale) applyKinematicZoneScale(entry, zoneScaleFromX(from.x));
    kinematicPlatforms.push(entry);
}

/** 收腰段运动学平台：按 X 与人物相同的 zoneScale 缩放视觉与碰撞。 */
function applyKinematicZoneScale(entry, targetScale) {
    if (!entry?.mesh || !Number.isFinite(targetScale)) return;
    if (isNearScale(entry.lastZoneScale, targetScale)) return;
    const ratio = targetScale / entry.lastZoneScale;
    entry.mesh.scale.setScalar(targetScale);
    player?.scaleKinematicColliderContent(entry.mesh, ratio);
    entry.lastZoneScale = targetScale;
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
        if (entry.zoneScale) applyKinematicZoneScale(entry, zoneScaleFromX(entry.mesh.position.x));
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
        updateTrapScale();
        player.update();
    } else {
        controls?.update();
    }
    renderer.render(scene, camera);
    stats?.update();
}
