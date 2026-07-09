import {
    ACESFilmicToneMapping,
    AmbientLight,
    BoxGeometry,
    CameraHelper,
    DirectionalLight,
    DirectionalLightHelper,
    Group,
    LineBasicMaterial,
    LineSegments,
    Mesh,
    MeshStandardMaterial,
    PCFShadowMap,
    PerspectiveCamera,
    Scene,
    BufferGeometry,
    Float32BufferAttribute,
    Vector3,
    WebGLRenderer,
} from "three";
import { Sky } from "three/addons/objects/Sky.js";
import { MapControls } from "three/examples/jsm/Addons.js";
import { GUI } from "three/examples/jsm/libs/lil-gui.module.min.js";
import Stats from "three/examples/jsm/libs/stats.module.js";
import { playerController } from "../../src/playerController";
import { LegIKController } from "./LegIKController.js";

const scene = new Scene();

let camera;
let renderer;
let controls;
let player;
let legIK;
let sunDebugHelper;
let sunShadowCameraHelper;
let sky;
let gui;
let debugParams;
let stats;
let legIKEnabled = true;
let leftMouseSlowMotion = false;
let rightMouseSlowMotion = false;
let savedPlayerTimeScale = 1;

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
    renderer.shadowMap.type = PCFShadowMap;
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
    camera.position.set(-6, 6, 9);

    // 控制器
    controls = new MapControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.maxDistance = 80;
    controls.maxPolarAngle = Math.PI / 2.05;
    controls.target.set(0, 0.8, 0);

    // 环境光
    scene.add(new AmbientLight(0xffffff, 1.8));

    // 平行光
    const sun = new DirectionalLight(0xffffff, 2);
    sun.position.set(6, 10, 7);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 35;
    sun.shadow.camera.left = -12;
    sun.shadow.camera.right = 12;
    sun.shadow.camera.top = 10;
    sun.shadow.camera.bottom = -10;
    sun.shadow.bias = -0.0002;
    scene.add(sun);
    sky = new Sky();
    sky.scale.setScalar(450000);
    scene.add(sky);
    const skyUniforms = sky.material.uniforms;
    skyUniforms["turbidity"].value = 10;
    skyUniforms["rayleigh"].value = 2;
    skyUniforms["mieCoefficient"].value = 0.005;
    skyUniforms["mieDirectionalG"].value = 0.99;
    updateSkySun(sun);
    sunDebugHelper = new DirectionalLightHelper(sun, 1.2, 0xffd166);
    sunDebugHelper.visible = false;
    scene.add(sunDebugHelper);
    sunShadowCameraHelper = new CameraHelper(sun.shadow.camera);
    sunShadowCameraHelper.visible = false;
    scene.add(sunShadowCameraHelper);

    // 测试场景
    const staticCollider = buildTestCourse();
    scene.add(staticCollider);
    addGroundGrid(scene);

    // 人物控制器
    player = new playerController();
    await player.init({
        scene,
        camera,
        controls,
        staticCollider,
        initPos: new Vector3(-7.5, 0.25, -3.5),
        minCamDistance: 10,
        maxCamDistance: 300,
        camLookAtHeightRatio: 0.5,
        enableSpringCamera: true,
        playerModelConfig: {
            url: "../glb/person6.glb",
            scale: 0.005,
            idleAnim: "idle",
            walkAnim: "walk",
            runAnim: "run",
            jumpAnim: "jump",
            speed: 200,
            // headBoneName: "mixamorigHead",
            rotateY: Math.PI / 2,
        },
        keyMap: { toggleFly: null }, // 关闭飞行
    });
    enableModelShadows(player.playerModel);

    // 骨骼配置
    const skeleton = {
        hips: "mixamorigHips",
        legs: {
            left: {
                upper: "mixamorigLeftUpLeg",
                lower: "mixamorigLeftLeg",
                foot: "mixamorigLeftFoot",
                toe: "mixamorigLeftToeBase",
            },
            right: {
                upper: "mixamorigRightUpLeg",
                lower: "mixamorigRightLeg",
                foot: "mixamorigRightFoot",
                toe: "mixamorigRightToeBase",
            },
        },
        arms: {
            left: {
                upper: "mixamorigLeftArm",
                lower: "mixamorigLeftForeArm",
                hand: "mixamorigLeftHand",
            },
            right: {
                upper: "mixamorigRightArm",
                lower: "mixamorigRightForeArm",
                hand: "mixamorigRightHand",
            },
        },
    };

    legIK = new LegIKController(player, {
        collider: player.collider,
        scene,
        skeleton,
    });

    createDebugPanel();

    window.addEventListener("resize", onResize);
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("blur", releaseRightMouseSlowMotion);
    renderer.domElement.addEventListener("contextmenu", event => event.preventDefault());

    window.hideLoader?.();
}

// 创建调试面板
function createDebugPanel() {
    const params = {
        legIKEnabled: true,
        footIKDebug: false,
        soleSampleDebug: false,
        footPhaseDebug: false,
        leftFootPhase: "",
        rightFootPhase: "",
        sunDebug: false,
        playerDebug: false,
    };
    debugParams = params;

    player?.setDebug(params.playerDebug);
    legIK?.setDebugEnabled(params.footIKDebug && params.legIKEnabled);
    legIK?.setSoleSampleDebugEnabled(params.soleSampleDebug);
    sunDebugHelper.visible = params.sunDebug;
    sunShadowCameraHelper.visible = params.sunDebug;

    gui = new GUI({ title: "Debug", width: 240 });
    gui.domElement.style.position = "fixed";
    gui.domElement.style.top = "12px";
    gui.domElement.style.right = "12px";

    gui.add(params, "playerDebug").name("Player Collider").onChange(value => {
        player?.setDebug(value);
    });
    gui.add(params, "legIKEnabled").name("Enable Leg IK").onChange(value => {
        legIKEnabled = value;
        if (!value) {
            legIK?.restore();
            legIK?.setDebugEnabled(false);
        } else {
            legIK?.setDebugEnabled(params.footIKDebug);
        }
    });
    gui.add(params, "footIKDebug").name("Foot IK Debug").onChange(value => {
        legIK?.setDebugEnabled(value && legIKEnabled);
    });
    gui.add(params, "soleSampleDebug").name("Sole Sample Debug").onChange(value => {
        legIK?.setSoleSampleDebugEnabled(value);
    });
    gui.add(params, "footPhaseDebug").name("Foot Phase Debug");
    gui.add(params, "leftFootPhase").name("Left Foot Phase").listen().disable();
    gui.add(params, "rightFootPhase").name("Right Foot Phase").listen().disable();
    gui.add(params, "sunDebug").name("Sun Debug").onChange(value => {
        sunDebugHelper.visible = value;
        sunShadowCameraHelper.visible = value;
    });
}

// 创建楼梯与斜坡测试场景
function updateSkySun(light) {
    sky.material.uniforms["sunPosition"].value.copy(light.position).normalize();
}

// 创建测试场景
function buildTestCourse() {
    const root = new Group();
    const groundMat = new MeshStandardMaterial({ color: 0xd8d5cf, roughness: 0.9 });
    const stairMats = [
        new MeshStandardMaterial({ color: 0xb8b0a1, roughness: 0.75 }),
        new MeshStandardMaterial({ color: 0xc3a28f, roughness: 0.75 }),
        new MeshStandardMaterial({ color: 0xa8b4c4, roughness: 0.75 }),
    ];
    const rampMats = [
        new MeshStandardMaterial({ color: 0xadbca8, roughness: 0.8 }),
        new MeshStandardMaterial({ color: 0x9fb7b4, roughness: 0.8 }),
        new MeshStandardMaterial({ color: 0xc0b48c, roughness: 0.8 }),
    ];
    const wallMat = new MeshStandardMaterial({ color: 0x9a9691, roughness: 0.88 });

    addBox(root, new Vector3(0, -0.06, 0), new Vector3(20, 0.12, 12), groundMat);
    createBoundaryWalls(root, wallMat);

    createStairs(root, new Vector3(-6.5, 0, -3.5), 0.08, stairMats[0]);
    createStairs(root, new Vector3(-1.2, 0, -3.5), 0.12, stairMats[1]);
    createStairs(root, new Vector3(4.1, 0, -3.5), 0.16, stairMats[2]);

    createRamp(root, new Vector3(-6.1, 0, 3), 10, rampMats[0]);
    createRamp(root, new Vector3(-0.3, 0, 3), 18, rampMats[1]);
    createRamp(root, new Vector3(5.8, 0, 3), 28, rampMats[2]);

    return root;
}

// 创建地面网格
function addGroundGrid(root) {
    const width = 20;
    const depth = 12;
    const step = 1;
    const points = [];

    for (let x = -width / 2; x <= width / 2 + 0.0001; x += step) {
        points.push(new Vector3(x, 0, -depth / 2), new Vector3(x, 0, depth / 2));
    }
    for (let z = -depth / 2; z <= depth / 2 + 0.0001; z += step) {
        points.push(new Vector3(-width / 2, 0, z), new Vector3(width / 2, 0, z));
    }

    const geometry = new BufferGeometry().setFromPoints(points);
    const material = new LineBasicMaterial({ color: 0xbcb7af });
    const grid = new LineSegments(geometry, material);
    grid.position.y = 0.004;
    root.add(grid);
    return grid;
}

// 创建一组边界墙
function createBoundaryWalls(root, material) {
    const wallHeight = 1.2;
    const wallThickness = 0.16;
    const halfWidth = 10;
    const halfDepth = 6;
    const centerY = wallHeight / 2;

    addBox(root, new Vector3(0, centerY, -halfDepth), new Vector3(halfWidth * 2, wallHeight, wallThickness), material);
    addBox(root, new Vector3(0, centerY, halfDepth), new Vector3(halfWidth * 2, wallHeight, wallThickness), material);
    addBox(root, new Vector3(-halfWidth, centerY, 0), new Vector3(wallThickness, wallHeight, halfDepth * 2), material);
    addBox(root, new Vector3(halfWidth, centerY, 0), new Vector3(wallThickness, wallHeight, halfDepth * 2), material);
}

// 创建一组楼梯
function createStairs(root, start, stepHeight, material) {
    const stepCount = 7;
    const stepDepth = 0.42;
    const width = 1.9;

    for (let i = 0; i < stepCount; i++) {
        const height = stepHeight * (i + 1);
        addBox(
            root,
            new Vector3(start.x + i * stepDepth, height / 2, start.z),
            new Vector3(stepDepth, height, width),
            material,
        );
    }
}

// 创建一个斜坡
function createRamp(root, position, angleDeg, material) {
    const length = 3.4;
    const width = 1.8;
    const height = Math.tan(angleDeg * Math.PI / 180) * length;
    const ramp = new Mesh(createRampGeometry(length, height, width), material);
    ramp.position.copy(position);
    ramp.castShadow = true;
    ramp.receiveShadow = true;
    root.add(ramp);
    return ramp;
}

// 添加盒体碰撞物
function createRampGeometry(length, height, width) {
    const halfLength = length / 2;
    const halfWidth = width / 2;
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
    const flatGeometry = geometry.toNonIndexed();
    flatGeometry.computeVertexNormals();
    return flatGeometry;
}

function addBox(root, position, scale, material) {
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), material);
    mesh.position.copy(position);
    mesh.scale.copy(scale);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
    return mesh;
}

// 启用模型阴影
function enableModelShadows(root) {
    root?.traverse(obj => {
        if (!obj.isMesh) return;
        obj.castShadow = true;
        obj.receiveShadow = true;
    });
}

// 每帧调用
function animate() {
    sunDebugHelper?.update();
    sunShadowCameraHelper?.update();
    if (legIKEnabled) legIK?.restore();
    if (player) {
        player.update()
    } else {
        controls.update();
    }
    const delta = player?.currentDelta ?? 1 / 60;
    if (legIKEnabled) {
        legIK?.update(player?.currentDelta ?? delta);
    }
    legIK?.updateSoleSampleDebug();
    updateFootPhasePanel();
    renderer.render(scene, camera);
    stats?.update();
}

// 更新脚步相位调试面板
function updateFootPhasePanel() {
    if (!debugParams || !legIK || !debugParams.footPhaseDebug) return;
    debugParams.leftFootPhase = legIK.getFootPhaseDebugText("left");
    debugParams.rightFootPhase = legIK.getFootPhaseDebugText("right");
}

// 鼠标右键慢动作
function onMouseDown(event) {
    if (!player) return;
    if (event.button == 2) {
        rightMouseSlowMotion = true;
    }
    if (event.button == 0) {
        leftMouseSlowMotion = true;
    }
    updatePlayerTimeScale();
}

// 鼠标右键慢动作释放
function onMouseUp(event) {
    if (event.button == 2) {
        rightMouseSlowMotion = false;
    }
    if (event.button == 0) {
        leftMouseSlowMotion = false;
    }
    updatePlayerTimeScale();

}

// 集中更新 player.timeScale
function releaseRightMouseSlowMotion() {
    rightMouseSlowMotion = false;
    leftMouseSlowMotion = false;
    updatePlayerTimeScale();
}

// 更新 player.timeScale
function updatePlayerTimeScale() {
    if (!player) return;

    if (leftMouseSlowMotion) {
        player.timeScale = 0;
    } else if (rightMouseSlowMotion) {
        player.timeScale = 0.1;
    } else {
        player.timeScale = savedPlayerTimeScale;
    }
}

// 窗口尺寸变化
function onResize() {
    const container = document.querySelector("#container");
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
}
