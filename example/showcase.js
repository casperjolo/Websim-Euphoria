import {
    ACESFilmicToneMapping,
    AmbientLight,
    BoxGeometry,
    BufferGeometry,
    CylinderGeometry,
    DirectionalLight,
    Float32BufferAttribute,
    Group,
    Mesh,
    MeshStandardMaterial,
    PerspectiveCamera,
    RepeatWrapping,
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

const PLAZA_SIZE = 24;
const TILE_SIZE = 1;
const SLOPE_ANGLES = [20, 30, 40];

const scene = new Scene();

let camera;
let renderer;
let controls;
let player;
let footIK;
let gui;
let stats;
let prototypeMat;

init();

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
    camera.position.set(8, 10, 14);

    // 控制器
    controls = new MapControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.maxDistance = 120;
    controls.maxPolarAngle = Math.PI / 2.05;
    controls.target.set(0, 1, 0);

    // 环境光
    scene.add(new AmbientLight(0xffffff, 1.5));

    // 平行光
    const sun = new DirectionalLight(0xffffff, 2);
    sun.position.set(6, 10, 7);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 60;
    sun.shadow.camera.left = -28;
    sun.shadow.camera.right = 28;
    sun.shadow.camera.top = 28;
    sun.shadow.camera.bottom = -28;
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
    prototypeMat = await loadPrototypeMaterial();
    const world = buildShowcaseWorld(prototypeMat);
    scene.add(world);

    // 人物控制器
    const gltfLoader = new GLTFLoader();
    const playerGltf = await gltfLoader.loadAsync("./glb/ual.glb");

    player = new playerController();
    await player.init({
        scene,
        camera,
        controls,
        colliders: [
            { motion: "static", shape: { kind: "mesh", source: world } },
        ],
        initPos: new Vector3(0, 0.4, 10),
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
            headBoneName: "Head",
            firstPersonCameraOffset: [0, 0.15, 0.12],
            rotateY: Math.PI / 2,
            speed: 100,
            runSpeed: 600,
        },
    });
    enableModelShadows(player.playerModel);

    // Foot IK
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

    createDebugPanel();

    window.addEventListener("resize", onResize);
    window.hideLoader?.();
}

// 加载 prototype 纹理材质
async function loadPrototypeMaterial() {
    const texture = await new TextureLoader().loadAsync("./textures/showcase/prototype.png");
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

    addBox(root, new Vector3(0, -0.06, 0), new Vector3(PLAZA_SIZE, 0.12, PLAZA_SIZE), baseMat);
    createClimbGroups(root, baseMat);

    return root;
}

// 创建攀爬组与中心平台
function createClimbGroups(root, baseMat) {
    const topHeight = 1.2;
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
    if (player) player.update();
    else controls?.update();
    renderer.render(scene, camera);
    stats?.update();
}
