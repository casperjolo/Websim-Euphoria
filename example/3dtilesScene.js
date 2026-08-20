import { TilesRenderer } from "3d-tiles-renderer";
import { CesiumIonAuthPlugin } from "3d-tiles-renderer/core/plugins";
import { GLTFExtensionsPlugin, LoadRegionPlugin, ReorientationPlugin, SphereRegion, TileCompressionPlugin, TilesFadePlugin } from "3d-tiles-renderer/plugins";
import { ACESFilmicToneMapping, AmbientLight, DirectionalLight, EquirectangularReflectionMapping, MathUtils, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";
import { playerController } from "../src/PlayerController";
import Stats from 'three/examples/jsm/libs/stats.module.js';

let player = null;

let camera;
let controls;
let tiles;
let renderer;
let scene;
let stats;

// 区域裁剪
let nearRegionPlugin = null;
let farRegionPlugin = null;
let nearRegion = null;
let farRegion = null;
const NEAR_RADIUS = 5;
const FAR_RADIUS = 20;

init();

async function init() {
    scene = new Scene();

    const cont = document.querySelector("#container");

    // 渲染器
    renderer = new WebGLRenderer({ antialias: true });
    renderer.setSize(cont.clientWidth, cont.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.6;
    renderer.setAnimationLoop(animate);
    cont.appendChild(renderer.domElement);

    // 相机
    camera = new PerspectiveCamera(60, cont.clientWidth / cont.clientHeight, 0.01, 10000);
    camera.position.set(1e3, 1e3, 1e3).multiplyScalar(0.5);

    // 控制器
    controls = new OrbitControls(camera, renderer.domElement);

    // 平行光
    const color = 0xffffff;
    const intensity = 10;
    const light = new DirectionalLight(color, intensity);
    light.position.set(50, 50, 50);
    light.target.position.set(0, 0, 0);
    light.castShadow = true;
    light.shadow.camera.top = 40;
    light.shadow.camera.bottom = -40;
    light.shadow.camera.left = -40;
    light.shadow.camera.right = 40;
    light.shadow.mapSize.width = 2048;
    light.shadow.mapSize.height = 2048;
    light.shadow.bias = -0.0005;
    light.shadow.camera.near = 0;
    light.shadow.camera.far = 100;
    scene.add(light);
    scene.add(light.target);
    // 环境光
    const ambient = new AmbientLight(0xffffff, 3.0);
    scene.add(ambient);

    // 背景
    new HDRLoader().load(
        "./img/env.hdr",
        (texture) => {
            texture.mapping = EquirectangularReflectionMapping;
            scene.background = texture;
        },
        undefined,
        (err) => {
            console.warn("HDR 加载失败：", err);
        }
    );

    // 帧率
    stats = new Stats();
    Object.assign(stats.dom.style, {
        position: "fixed",
        bottom: "0",
        left: "0",
        top: "auto",
        zIndex: "9998",
        display: "block",
    });
    document.body.appendChild(stats.dom);

    // 3DTiles
    reinstantiateTiles();

    await initPlayer();

    // 窗口大小监听
    onWindowResize();
    window.addEventListener("resize", onWindowResize, false);

    // 关闭加载页面
    window.hideLoader();
}

// 初始化区域裁剪插件
function initRegionCull() {
    nearRegionPlugin = new LoadRegionPlugin();
    tiles.registerPlugin(nearRegionPlugin);
    farRegionPlugin = new LoadRegionPlugin();
    tiles.registerPlugin(farRegionPlugin);

    nearRegion = new SphereRegion();
    nearRegion.sphere.radius = NEAR_RADIUS;
    nearRegion.errorTarget = 0;
    nearRegionPlugin.addRegion(nearRegion);

    farRegion = new SphereRegion();
    farRegion.sphere.radius = FAR_RADIUS;
    farRegion.errorTarget = 2;
    farRegionPlugin.addRegion(farRegion);

}

// 初始化玩家控制器
async function initPlayer() {
    renderer.render(scene, camera);

    // 加载碰撞体
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath("https://unpkg.com/three@0.153.0/examples/jsm/libs/draco/gltf/");
    const gltfLoader = new GLTFLoader();
    gltfLoader.setDRACOLoader(dracoLoader);
    const colliderGltf = await gltfLoader.loadAsync("./glb/eiffel_collider.glb");
    colliderGltf.scene.rotation.y = Math.PI;

    const playerGltf = await gltfLoader.loadAsync("./glb/josh.glb");
    const vehicleGltf = await gltfLoader.loadAsync("./glb/sedan.glb");

    // 初始化玩家控制器
    player = new playerController();
    await player.init({
        scene,
        camera,
        controls,
        playerModelConfig: {
            model: playerGltf.scene,
            animations: playerGltf.animations,
            scale: 0.01,
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
            headBoneName: "mixamorigHead",
        },
        initPos: new Vector3(105.96, 81.25, 62.92),
        minCamDistance: 50,
        maxCamDistance: 250,
        colliders: [
            { motion: "static", shape: { kind: "mesh", source: colliderGltf.scene } },
        ],
        thirdMouseMode: 1,
        enableSpringCamera: true,
    });

    initRegionCull();

    await player.loadVehicleModel({
        position: new Vector3(101.96, 81.25, 62.92),
        model: vehicleGltf.scene,
        animations: vehicleGltf.animations,
        scale: 1,
        wheelsNames: ["Wheel_LF", "Wheel_RF", "Wheel_LR", "Wheel_RR"],
        chassis: { density: 1 },
        power: { maxSpeed: 300, acceleration: 8, deceleration: 30 },
        driverSeatPosition: new Vector3(-0.6, 0.7, 0.4),
        driverSeatRotation: -Math.PI / 2,
    });

    const vehicle = player.getAllVehicles().at(-1);
    vehicle?.vehicleGroup?.traverse((child) => {
        if (child.isMesh) {
            child.material.metalness = 0.8;
            child.material.roughness = 0.0;
        }
    });

    window.addEventListener("keydown", (e) => {
        if (e.code !== "KeyR" || e.repeat) return;
        player.resetVehicle();
    });
}

// 创建3DTiles渲染器
function reinstantiateTiles() {
    tiles = new TilesRenderer();
    const apiToken =
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJmMzgwMGY3ZS1jOTMwLTQyNmQtOTkyNS03MDE4ZjlkYmY0MTYiLCJpZCI6MjIzMDk3LCJpYXQiOjE3MTg3NjgwNTN9.FcpK7jiFPzWZL8m6VxRbG7ly8LMecpXnDAMZJX_UehM";
    tiles.registerPlugin(
        new CesiumIonAuthPlugin({
            apiToken: apiToken,
            assetId: "2275207",
            autoRefreshToken: true,
        })
    );
    tiles.registerPlugin(new TileCompressionPlugin());
    tiles.registerPlugin(new TilesFadePlugin());
    tiles.registerPlugin(
        new GLTFExtensionsPlugin({
            dracoLoader: new DRACOLoader().setDecoderPath("https://unpkg.com/three@0.153.0/examples/jsm/libs/draco/gltf/"),
        })
    );
    tiles.registerPlugin(
        new ReorientationPlugin({
            lat: 48.8584 * MathUtils.DEG2RAD,
            lon: 2.2945 * MathUtils.DEG2RAD,
        })
    );

    scene.add(tiles.group);
    tiles.setResolutionFromRenderer(camera, renderer);
    tiles.setCamera(camera);
}

// 渲染循环更新
function animate() {
    if (!tiles) return;

    tiles.setResolutionFromRenderer(camera, renderer);
    tiles.setCamera(camera);
    camera.updateMatrixWorld();
    tiles.update();

    if (player) {
        player.update();
        if (nearRegion && farRegion) {
            const pos = player.getPosition();
            nearRegion.sphere.center.copy(pos).applyMatrix4(tiles.group.matrixWorldInverse);
            farRegion.sphere.center.copy(pos).applyMatrix4(tiles.group.matrixWorldInverse);
        }
        console.log(player.getPosition());  
    }

    renderer.render(scene, camera);

    stats?.update();
}

// 响应窗口尺寸变化
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    renderer.setSize(window.innerWidth, window.innerHeight);

    camera.updateProjectionMatrix();
    renderer.setPixelRatio(window.devicePixelRatio);
    tiles.setResolutionFromRenderer(camera, renderer);
}
