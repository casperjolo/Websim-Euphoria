import {
    ACESFilmicToneMapping,
    Box3,
    BufferGeometry,
    CircleGeometry,
    Color,
    DirectionalLight,
    Float32BufferAttribute,
    MathUtils,
    Matrix3,
    Matrix4,
    Mesh,
    MeshLambertMaterial,
    PerspectiveCamera,
    Raycaster,
    RepeatWrapping,
    Scene,
    ShaderMaterial,
    ShadowMaterial,
    Sphere,
    SRGBColorSpace,
    TextureLoader,
    Vector2,
    Vector3,
    VSMShadowMap,
    WebGLRenderer,
    MeshPhysicalMaterial,
    PMREMGenerator,
    Path,
    Shape,
    ShapeGeometry
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Reflector } from "three/addons/objects/Reflector.js";
import { Sky } from "three/addons/objects/Sky.js";
import { LightProbeGrid } from "three/addons/lighting/LightProbeGrid.js";
import { LightProbeGridHelper } from "three/addons/helpers/LightProbeGridHelper.js";
import { GUI } from "three/addons/libs/lil-gui.module.min.js";
import Stats from "three/examples/jsm/libs/stats.module.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";

import { TilesRenderer } from "3d-tiles-renderer";
import {
    GLTFMeshFeaturesExtension,
    GLTFStructuralMetadataExtension,
    TilesFadePlugin,
} from "3d-tiles-renderer/plugins";
import { playerController } from "../src/playerController";

// ==================== 楼层数据 ====================

// 十层 3D Tiles 入口，数组下标与 marbleFloorConfigs、floorMeshConfig 一一对应
const floorUrls = [
    "bim/1F/tileset.json",
    "bim/2F/tileset.json",
    "bim/3F/tileset.json",
    "bim/4F/tileset.json",
    "bim/5F/tileset.json",
    "bim/6F/tileset.json",
    "bim/7F/tileset.json",
    "bim/8F/tileset.json",
    "bim/9F/tileset.json",
    "bim/10F/tileset.json",
];

// 每层大理石地板配置，坐标统一使用场景的世界 X/Z 坐标
// outline 为 null 时优先从对应楼层模型自动提取
// fallbackOutline 仅在自动提取失败时使用
const marbleFloorConfigs = [
    {
        floor: 1,
        expectedY: -1.7,
        extractionTolerance: 0.08,
        outline: null,
        holes: [],
        fallbackOutline: [[-26.1, -15.965], [26.1, -15.965], [26.1, -1.565], [-26.1, -1.565]],
    },
    {
        floor: 2,
        expectedY: 2.2,
        extractionTolerance: 0.08,
        outline: null,
        holes: [],
        fallbackOutline: [[-26.1, -7.425], [26.1, -7.425], [26.1, 6.975], [-26.1, 6.975]],
    },
    {
        floor: 3,
        expectedY: 5.5,
        extractionTolerance: 0.08,
        outline: null,
        holes: [],
        fallbackOutline: [[-26.1, -9.936], [26.1, -9.936], [26.1, 4.464], [-26.1, 4.464]],
    },
    {
        floor: 4,
        expectedY: 8.8,
        extractionTolerance: 0.08,
        outline: null,
        holes: [],
        fallbackOutline: [[-26.1, -7.2], [26.1, -7.2], [26.1, 7.2], [-26.1, 7.2]],
    },
    {
        floor: 5,
        expectedY: 12.1,
        extractionTolerance: 0.08,
        outline: null,
        holes: [],
        fallbackOutline: [[-26.0, -7.32], [26.0, -7.32], [26.0, 7.08], [-26.0, 7.08]],
    },
    {
        floor: 6,
        expectedY: 15.4,
        extractionTolerance: 0.08,
        outline: null,
        holes: [],
        fallbackOutline: [[-26.1, -7.2], [26.1, -7.2], [26.1, 7.2], [-26.1, 7.2]],
    },
    {
        floor: 7,
        expectedY: 18.7,
        extractionTolerance: 0.08,
        outline: null,
        holes: [],
        fallbackOutline: [[-26.1, -7.2], [26.1, -7.2], [26.1, 7.2], [-26.1, 7.2]],
    },
    {
        floor: 8,
        expectedY: 22.0,
        extractionTolerance: 0.08,
        outline: null,
        holes: [],
        fallbackOutline: [[-26.1, -7.2], [26.1, -7.2], [26.1, 7.2], [-26.1, 7.2]],
    },
    {
        floor: 9,
        expectedY: 25.3,
        extractionTolerance: 0.08,
        outline: null,
        holes: [],
        fallbackOutline: [[-26.1, -7.315], [26.1, -7.315], [26.1, 7.085], [-26.1, 7.085]],
    },
    {
        floor: 10,
        expectedY: 28.6,
        extractionTolerance: 0.08,
        maxGeometryThickness: 1.0,
        outline: null,
        holes: [],
        fallbackOutline: [[-22.973, -3.015], [-8.513, -3.015], [-8.513, 2.912], [-22.973, 2.912]],
    },
];

// ==================== 楼层材质映射 ====================

// 按楼层记录需要特殊处理的 Mesh 名称；未配置的 Mesh 使用默认材质处理
const floorMeshConfig = [
    // 0: 1F
    {
        mesh_0_29: 'glass',
    },
    // 1: 2F
    {
        mesh_0_12: 'glass',
    },
    // 2: 3F
    {
        mesh_0_8: 'glass',
    },
    // 3: 4F
    {
        mesh_0_9: 'glass',
    },
    // 4: 5F
    {
        mesh_0_5: 'glass',
    },
    // 5: 6F
    {
        mesh_0_6: 'glass',
    },
    // 6: 7F
    {
        mesh_0_16: 'glass',
    },
    // 7: 8F
    {
        mesh_0_6: 'glass',
    },
    // 8: 9F
    {
        mesh_0_13: 'glass',
    },
    // 9: 10F
    {
        mesh_0_11: 'glass',
    },
];

// 不同类型 Mesh 的材质处理函数，由 floorMeshConfig 中的类型名称索引
const materialHandlers = {
    // 将原模型材质替换为可透射、带环境反射的玻璃材质
    glass(c) {
        const orig = c.material;
        c.material = new MeshPhysicalMaterial({
            map: orig.map || null,
            normalMap: orig.normalMap || null,
            roughnessMap: orig.roughnessMap || null,
            metalnessMap: orig.metalnessMap || null,
            aoMap: orig.aoMap || null,
            metalness: 0,
            roughness: 0.0,
            transmission: 0.9,
            ior: 1.6,
            transparent: true,
            opacity: 0.85,
            envMapIntensity: 1.0,
            thickness: 0.1,
            clearcoat: 1.0,
            clearcoatRoughness: 0.05,
        });
        c.material.needsUpdate = true;
    },
    // 提升原楼面材质的光泽，并开启投射、接收阴影
    floor(c) {
        const orig = c.material;
        c.material = new MeshPhysicalMaterial({
            map: orig.map || null,
            normalMap: orig.normalMap || null,
            roughnessMap: orig.roughnessMap || null,
            aoMap: orig.aoMap || null,
            metalness: 0.0,
            roughness: 0.3,
            envMapIntensity: 0.8,
            clearcoat: 0.6,
            clearcoatRoughness: 0.1,
        });
        c.material.needsUpdate = true;
        c.castShadow = params.shadows;
        c.receiveShadow = params.shadows;
        c.frustumCulled = false;
    },
    // 将原材质改为高反射金属材质
    metal(c) {
        const orig = c.material;
        c.material = new MeshPhysicalMaterial({
            map: orig.map || null,
            normalMap: orig.normalMap || null,
            roughnessMap: orig.roughnessMap || null,
            metalnessMap: orig.metalnessMap || null,
            aoMap: orig.aoMap || null,
            metalness: 1.0,
            roughness: 0.0,
            envMapIntensity: 1.5,
        });
        c.material.needsUpdate = true;
        c.castShadow = params.shadows;
        c.receiveShadow = params.shadows;
        c.frustumCulled = false;
    },
    // 释放无需渲染的 Mesh 资源并从场景树移除
    hidden(c) {
        c.geometry?.dispose();
        if (Array.isArray(c.material)) {
            c.material.forEach(m => m.dispose());
        } else {
            c.material?.dispose();
        }
        c.removeFromParent();
    },
    // 普通 Mesh 保留原材质，只统一阴影和视锥裁剪设置
    _default(c) {
        c.castShadow = params.shadows;
        c.receiveShadow = params.shadows;
        c.frustumCulled = false;
    },
};

// ==================== 场景引用 ====================

const scene = new Scene(); // 三维场景
const gltfLoader = new GLTFLoader(); // Tile 内 GLTF/GLB 模型加载器
const stats = new Stats(); // 帧率统计面板

let camera; // 透视相机
let renderer; // WebGL 渲染器
let controls; // 轨道控制器
const tilesList = []; // 十层 TilesRenderer 实例
let tilesUpdateEnabled = true; // 3D Tiles 流式更新开关
let player = null; // 玩家控制器实例
let isUpdatePlayer = false; // 角色控制更新开关
let gui; // 调试面板

// ==================== 环境光照与 GI ====================

let probes = null; // 光照探针网格
let probesHelper = null; // 光照探针可视化辅助
let sky; // 程序化天空
let pmremGenerator = null; // 天空环境贴图预过滤器
const sun = new Vector3(); // Sky Shader 使用的太阳方向
let dirLight; // 太阳平行光

// ==================== 大理石反射地板 ====================

let reflectiveFloor = null; // 全场复用的唯一 Reflector
let reflectiveFloorShadowReceiver = null; // 当前反射楼层的透明阴影接收面
const marbleFloorMeshes = []; // 十层普通大理石地板
const floorTileScenes = marbleFloorConfigs.map(() => []); // 按楼层缓存已加载的 Tile 内容
let activeMarbleFloorIndex = -1; // 当前启用反射的楼层下标
let reflectionFrame = 0; // 反射更新节流使用的帧计数
let isRenderingReflection = false; // 防止反射相机递归触发 Reflector

// ==================== 调试参数 ====================

const params = {
    enabled: true, // 启用 GI 光照探针
    showProbes: false, // 显示探针辅助网格
    skyEnvMap: false, // 使用天空作为场景环境贴图
    probeSize: 0.25, // 探针辅助球尺寸
    boundsX: 0, // 探针网格中心 X
    boundsY: 19, // 探针网格中心 Y
    boundsZ: -8, // 探针网格中心 Z
    sizeX: 60, // 探针覆盖宽度
    sizeY: 37, // 探针覆盖高度
    sizeZ: 20, // 探针覆盖深度
    countX: 14, // X 轴探针数量
    countY: 12, // Y 轴探针数量
    countZ: 5, // Z 轴探针数量
    lightAzimuth: 45, // 太阳方位角
    lightElevation: 19, // 太阳高度角
    lightIntensity: 50, // 平行光强度
    shadows: true, // 实时阴影开关
};

// ==================== 初始化 ====================

init();

// 初始化渲染环境并按依赖顺序加载地形、楼层、地板与 GI
async function init() {
    const cont = document.querySelector("#container");

    // 渲染器
    renderer = new WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.1;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = VSMShadowMap;
    cont.appendChild(renderer.domElement);

    // 帧率
    Object.assign(stats.dom.style, {
        position: "fixed",
        bottom: "0",
        left: "0",
        top: "auto",
        zIndex: "9998",
    });
    document.body.appendChild(stats.dom);

    // 相机
    camera = new PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.rotation.order = "YXZ";

    // 控制器
    controls = new OrbitControls(camera, renderer.domElement);
    controls.maxDistance = 2000;
    controls.maxPolarAngle = Math.PI / 2;
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.target.set(0, 0, 0);
    controls.update();

    // 平行光
    dirLight = new DirectionalLight(0xfff2dc, params.lightIntensity);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.setScalar(2048);
    const shadowExtent = Math.max(params.sizeX, params.sizeZ) * 0.7;
    dirLight.shadow.camera.left = -shadowExtent;
    dirLight.shadow.camera.right = shadowExtent;
    dirLight.shadow.camera.top = shadowExtent;
    dirLight.shadow.camera.bottom = -shadowExtent;
    dirLight.shadow.camera.near = 0.1;
    dirLight.shadow.camera.far = params.sizeY * 4.0;
    dirLight.shadow.bias = -0.001;
    scene.add(dirLight);
    scene.add(dirLight.target);

    // 天空
    sky = new Sky();
    sky.scale.setScalar(450000);
    scene.add(sky);
    const skyUniforms = sky.material.uniforms;
    skyUniforms["turbidity"].value = 10;
    skyUniforms["rayleigh"].value = 2;
    skyUniforms["mieCoefficient"].value = 0.005;
    skyUniforms["mieDirectionalG"].value = 0.8;
    pmremGenerator = new PMREMGenerator(renderer);
    pmremGenerator.compileCubemapShader();
    updateLightPosition();

    // 模型加载器
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath("https://unpkg.com/three@0.180.0/examples/jsm/libs/draco/");
    gltfLoader.setDRACOLoader(dracoLoader);
    const ktx2Loader = new KTX2Loader();
    ktx2Loader.setTranscoderPath("https://unpkg.com/three@0.180.0/examples/jsm/libs/basis/");
    ktx2Loader.detectSupport(renderer);
    gltfLoader.setKTX2Loader(ktx2Loader);

    // 消除兼容性警告
    gltfLoader.register(() => new GLTFMeshFeaturesExtension());
    gltfLoader.register(() => new GLTFStructuralMetadataExtension());
    gltfLoader.register(() => ({ name: "EXT_instance_features" }));

    // 渲染循环
    renderer.setAnimationLoop(animate);

    window.hideLoader();

    // 办公楼周围的低面数卫星影像地形
    await initSurroundingTerrain();

    // 加载 3D Tiles
    await initTiles(floorUrls);
    tilesUpdateEnabled = false;

    // GUI
    initGUI();

    // 初始化地板 Shader 时提供临时环境贴图，保证反射材质参数正确建立
    scene.environment = pmremGenerator.fromScene(sky).texture;

    // 反射相关
    await initMarbleFloors();

    // 初始烘焙
    await bakeWithSettings();

    scene.environment = params.skyEnvMap ? pmremGenerator.fromScene(sky).texture : null;

    // 进入角色控制按钮
    const btn = document.getElementById("start-btn");
    btn.addEventListener("click", async () => {
        btn.style.display = "none";
        document.getElementById("hints").style.display = "block";
        await initPlayer();
    });

    window.addEventListener("resize", onWindowResize);
    initClickPick();
}

// ==================== 周边地形 ====================

// 初始化办公楼周围的低面数卫星影像地形
async function initSurroundingTerrain() {
    const terrainTexture = await new TextureLoader().loadAsync(
        "./textures/satellite-office-campus.webp"
    );
    terrainTexture.colorSpace = SRGBColorSpace;
    terrainTexture.anisotropy = Math.min(
        4,
        renderer.capabilities.getMaxAnisotropy()
    );

    // 半径 1000m、64 个三角面
    const terrain = new Mesh(
        new CircleGeometry(1000, 64),
        new MeshLambertMaterial({ map: terrainTexture })
    );
    terrain.name = "SatelliteSurroundingTerrain";
    terrain.position.set(0, -2.97, -8);
    terrain.rotation.x = -Math.PI / 2;
    terrain.castShadow = false;
    terrain.receiveShadow = true;
    terrain.renderOrder = -2;
    scene.add(terrain);
}

// ==================== 地板几何提取 ====================

const marbleUvScale = 1.25; // 世界坐标到地砖 UV 的缩放比例
const floorCoplanarTolerance = 0.01; // 单个楼面三角形允许的最大高度差
const marbleGroutColor = new Color(0xC0C0C0); // 砖缝颜色
const marbleGroutWidth = 0.003; // 单块地砖 UV 空间中的砖缝宽度
// 将新增材质面略微抬高，避免与模型原楼面完全共面产生深度闪烁
const marbleFloorRenderOffset = 0.002;

// 将世界 X/Z 轮廓转换到 Reflector 使用的局部 XY 平面
// Reflector 固定以局部 +Z 作为反射法线，之后整体旋转到世界 +Y
function createFloorGeometryFromOutline(outline, holes = []) {
    const shape = new Shape();
    outline.forEach(([x, z], pointIndex) => {
        if (pointIndex === 0) {
            shape.moveTo(x, -z);
        } else {
            shape.lineTo(x, -z);
        }
    });
    shape.closePath();

    holes.forEach((holePoints) => {
        const hole = new Path();
        holePoints.forEach(([x, z], pointIndex) => {
            if (pointIndex === 0) {
                hole.moveTo(x, -z);
            } else {
                hole.lineTo(x, -z);
            }
        });
        hole.closePath();
        shape.holes.push(hole);
    });

    const geometry = new ShapeGeometry(shape);
    applyMarbleUvs(geometry);
    return geometry;
}

// 普通材质和自定义反射 Shader 共用同一套世界尺度 UV
function applyMarbleUvs(geometry) {
    const position = geometry.getAttribute("position");
    const uvs = new Float32Array(position.count * 2);
    for (let vertexIndex = 0; vertexIndex < position.count; vertexIndex++) {
        uvs[vertexIndex * 2] = position.getX(vertexIndex) * marbleUvScale;
        uvs[vertexIndex * 2 + 1] = position.getY(vertexIndex) * marbleUvScale;
    }
    geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
}

// 一次遍历全部 Tiles，提取落在各楼层高度、法线朝上的水平三角面
function extractMarbleFloorGeometries() {
    // 每层独立累积顶点，并记录面积加权高度与去重键
    const extractedFloors = marbleFloorConfigs.map(() => ({
        positions: [],
        normals: [],
        uvs: [],
        triangleKeys: new Set(),
        weightedY: 0,
        totalArea: 0,
    }));

    // 复用计算对象，避免遍历大量三角面时反复分配临时内存
    const vertexA = new Vector3();
    const vertexB = new Vector3();
    const vertexC = new Vector3();
    const edgeAB = new Vector3();
    const edgeAC = new Vector3();
    const triangleNormal = new Vector3();
    const inverseTileSceneMatrix = new Matrix4();
    const objectRelativeMatrix = new Matrix4();
    const tileSceneWorldMatrix = new Matrix4();
    const objectWorldMatrix = new Matrix4();
    const worldBounds = new Box3();

    floorTileScenes.forEach((tileScenes, sourceFloorIndex) => {
        const tiles = tilesList[sourceFloorIndex];
        tiles.group.updateWorldMatrix(true, false);

        tileScenes.forEach((tileScene) => {
            // Tile 内容即使当前不可见也可能已从 group 脱离这里显式组合
            // TilesRenderer 的全局矩阵、内容矩阵和 Mesh 相对矩阵，得到稳定世界坐标
            tileScene.updateWorldMatrix(true, true);
            inverseTileSceneMatrix.copy(tileScene.matrixWorld).invert();
            tileSceneWorldMatrix.multiplyMatrices(
                tiles.group.matrixWorld,
                tileScene.matrix
            );

            tileScene.traverse((object) => {
                if (!object.isMesh || !object.geometry) return;

                const geometry = object.geometry;
                const position = geometry.getAttribute("position");
                if (!position) return;

                const index = geometry.getIndex();
                const elementCount = index ? index.count : position.count;
                objectRelativeMatrix.multiplyMatrices(
                    inverseTileSceneMatrix,
                    object.matrixWorld
                );
                objectWorldMatrix.multiplyMatrices(
                    tileSceneWorldMatrix,
                    objectRelativeMatrix
                );

                // 先用世界包围盒厚度和高度做粗筛，减少逐三角形检查次数
                if (!geometry.boundingBox) geometry.computeBoundingBox();
                worldBounds.copy(geometry.boundingBox).applyMatrix4(objectWorldMatrix);
                const geometryThickness = worldBounds.max.y - worldBounds.min.y;
                const isFloorCandidate = marbleFloorConfigs.some((config) => {
                    if (config.outline) return;
                    const maxThickness = config.maxGeometryThickness ?? 0.15;
                    return (
                        geometryThickness <= maxThickness &&
                        config.expectedY >= worldBounds.min.y - config.extractionTolerance &&
                        config.expectedY <= worldBounds.max.y + config.extractionTolerance
                    );
                });
                if (!isFloorCandidate) return;

                for (let elementIndex = 0; elementIndex + 2 < elementCount; elementIndex += 3) {
                    const indexA = index ? index.getX(elementIndex) : elementIndex;
                    const indexB = index ? index.getX(elementIndex + 1) : elementIndex + 1;
                    const indexC = index ? index.getX(elementIndex + 2) : elementIndex + 2;

                    vertexA.fromBufferAttribute(position, indexA).applyMatrix4(objectWorldMatrix);
                    vertexB.fromBufferAttribute(position, indexB).applyMatrix4(objectWorldMatrix);
                    vertexC.fromBufferAttribute(position, indexC).applyMatrix4(objectWorldMatrix);

                    const minY = Math.min(vertexA.y, vertexB.y, vertexC.y);
                    const maxY = Math.max(vertexA.y, vertexB.y, vertexC.y);
                    if (maxY - minY > floorCoplanarTolerance) continue;

                    edgeAB.subVectors(vertexB, vertexA);
                    edgeAC.subVectors(vertexC, vertexA);
                    triangleNormal.crossVectors(edgeAB, edgeAC);

                    // 只取朝上的面，排除楼板底面以及落在相同高度的退化三角形
                    if (triangleNormal.y <= 1e-6) continue;

                    const triangleY = (vertexA.y + vertexB.y + vertexC.y) / 3;
                    let floorIndex = -1;
                    let floorDistance = Infinity;
                    marbleFloorConfigs.forEach((config, configIndex) => {
                        if (config.outline) return;
                        const distance = Math.abs(triangleY - config.expectedY);
                        if (distance <= config.extractionTolerance && distance < floorDistance) {
                            floorIndex = configIndex;
                            floorDistance = distance;
                        }
                    });
                    if (floorIndex < 0) continue;

                    const target = extractedFloors[floorIndex];
                    // 毫米级量化后忽略完全重复的三角面，避免不同内容块重复覆盖
                    const triangleKey = [vertexA, vertexB, vertexC]
                        .map((vertex) => `${Math.round(vertex.x * 1000)},${Math.round(vertex.z * 1000)}`)
                        .sort()
                        .join("|");
                    if (target.triangleKeys.has(triangleKey)) continue;
                    target.triangleKeys.add(triangleKey);

                    [vertexA, vertexB, vertexC].forEach((vertex) => {
                        const localX = vertex.x;
                        const localY = -vertex.z;
                        target.positions.push(localX, localY, 0);
                        target.normals.push(0, 0, 1);
                        target.uvs.push(localX * marbleUvScale, localY * marbleUvScale);
                    });

                    // 用三角形面积计算实际楼面高度，降低零碎误差面的影响
                    const triangleArea = triangleNormal.y * 0.5;
                    target.weightedY += triangleY * triangleArea;
                    target.totalArea += triangleArea;
                }
            });
        });
    });

    return extractedFloors.map((extracted, floorIndex) => {
        const config = marbleFloorConfigs[floorIndex];

        // 手工 outline 的优先级最高，便于单独修正自动识别不理想的楼层
        if (config.outline?.length >= 3) {
            config.resolvedY = config.expectedY;
            return createFloorGeometryFromOutline(config.outline, config.holes);
        }

        // 至少提取到一个有效三角形时，直接构建非索引楼面几何体
        if (extracted.positions.length >= 9) {
            const geometry = new BufferGeometry();
            geometry.setAttribute(
                "position",
                new Float32BufferAttribute(extracted.positions, 3)
            );
            geometry.setAttribute(
                "normal",
                new Float32BufferAttribute(extracted.normals, 3)
            );
            geometry.setAttribute(
                "uv",
                new Float32BufferAttribute(extracted.uvs, 2)
            );
            geometry.computeBoundingBox();
            geometry.computeBoundingSphere();

            config.resolvedY = extracted.weightedY / extracted.totalArea;
            console.info(
                `[MarbleFloor] ${config.floor}F 自动提取 ` +
                `${extracted.positions.length / 9} 个三角面`
            );
            return geometry;
        }

        // 自动提取失败时退回人工矩形，确保该楼层仍可正常切换反射
        config.resolvedY = config.expectedY;
        console.warn(
            `[MarbleFloor] ${config.floor}F 未提取到有效楼面，已使用 fallbackOutline`
        );
        return createFloorGeometryFromOutline(config.fallbackOutline, config.holes);
    });
}

// ==================== 大理石地板材质 ====================

// 初始化办公楼的反射地板
async function initMarbleFloors() {
    const reflectionTextureSize = 512; // 反射 RenderTarget 边长

    // 一张纹理同时供普通楼层 Shader 和反射楼层 Shader 使用
    const floorTexture = await new TextureLoader().loadAsync("./textures/marble-floor.jpg");
    floorTexture.colorSpace = SRGBColorSpace;
    floorTexture.wrapS = RepeatWrapping;
    floorTexture.wrapT = RepeatWrapping;
    floorTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();

    // 共用颜色函数统一纹理亮度、重复尺度和程序化砖缝
    const marbleFloorColorChunk = /* glsl */ `
        vec3 getMarbleFloorColor() {
            vec3 mapColor = texture2D(map, vMapUv).rgb * 3.0;

            vec2 tileUv = fract(vMapUv);
            vec2 edgeDistance = min(tileUv, 1.0 - tileUv);
            vec2 edgeSmoothing = max(fwidth(vMapUv), vec2(0.0001));
            vec2 tileMask = smoothstep(
                vec2(groutWidth),
                vec2(groutWidth) + edgeSmoothing,
                edgeDistance
            );
            float groutMask = 1.0 - tileMask.x * tileMask.y;

            return mix(mapColor, groutColor * 3.0, groutMask);
        }
    `;

    // 反射楼层：在相同大理石底色上混合 Reflector 的投影纹理
    const floorReflectorShader = {
        name: "TexturedReflectorShader",
        uniforms: {
            color: { value: new Color(0xffffff) },
            tDiffuse: { value: null },
            textureMatrix: { value: null },
            map: { value: floorTexture },
            reflectionStrength: { value: 0.2 },
            groutColor: { value: marbleGroutColor },
            groutWidth: { value: marbleGroutWidth },
        },
        vertexShader: /* glsl */ `
            uniform mat4 textureMatrix;

            varying vec4 vReflectionUv;
            varying vec2 vMapUv;

            #include <logdepthbuf_pars_vertex>

            void main() {
                vMapUv = uv;
                vReflectionUv = textureMatrix * vec4(position, 1.0);

                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);

                #include <logdepthbuf_vertex>
            }
        `,
        fragmentShader: /* glsl */ `
            uniform sampler2D tDiffuse;
            uniform sampler2D map;
            uniform vec3 color;
            uniform float reflectionStrength;
            uniform vec3 groutColor;
            uniform float groutWidth;

            varying vec4 vReflectionUv;
            varying vec2 vMapUv;

            #include <logdepthbuf_pars_fragment>

            ${marbleFloorColorChunk}

            void main() {
                #include <logdepthbuf_fragment>

                vec3 reflectionColor = texture2DProj(tDiffuse, vReflectionUv).rgb;
                vec3 finalColor = mix(
                    getMarbleFloorColor(),
                    reflectionColor * color,
                    reflectionStrength
                );

                gl_FragColor = vec4(finalColor, 1.0);

                #include <tonemapping_fragment>
                #include <colorspace_fragment>
            }
        `,
    };

    // 普通楼层：只渲染共用的大理石底色，不承担反射采样
    const marbleMaterial = new ShaderMaterial({
        name: "MarbleFloorBaseMaterial",
        uniforms: {
            map: { value: floorTexture },
            groutColor: { value: marbleGroutColor },
            groutWidth: { value: marbleGroutWidth },
        },
        vertexShader: /* glsl */ `
            varying vec2 vMapUv;

            #include <logdepthbuf_pars_vertex>

            void main() {
                vMapUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);

                #include <logdepthbuf_vertex>
            }
        `,
        fragmentShader: /* glsl */ `
            uniform sampler2D map;
            uniform vec3 groutColor;
            uniform float groutWidth;

            varying vec2 vMapUv;

            #include <logdepthbuf_pars_fragment>

            ${marbleFloorColorChunk}

            void main() {
                #include <logdepthbuf_fragment>

                gl_FragColor = vec4(getMarbleFloorColor(), 1.0);

                #include <tonemapping_fragment>
                #include <colorspace_fragment>
            }
        `,
    });

    // ShaderMaterial 不自动接收 Three.js 灯光阴影，叠加透明 ShadowMaterial 补回阴影
    const floorShadowMaterial = new ShadowMaterial({
        color: 0x000000,
        opacity: 0.28,
        depthWrite: false,
    });

    const floorGeometries = extractMarbleFloorGeometries();

    // 十层始终保留普通大理石地板；当前反射层会临时隐藏对应的普通地板
    marbleFloorConfigs.forEach((config, floorIndex) => {
        const floor = new Mesh(floorGeometries[floorIndex], marbleMaterial);
        floor.name = `MarbleFloor_${config.floor}F`;
        floor.position.y = config.resolvedY + marbleFloorRenderOffset;
        floor.rotation.x = -Math.PI / 2;
        floor.castShadow = false;
        floor.receiveShadow = false;

        const shadowReceiver = new Mesh(
            floorGeometries[floorIndex],
            floorShadowMaterial
        );
        shadowReceiver.name = `MarbleFloorShadowReceiver_${config.floor}F`;
        shadowReceiver.position.z = 0.002;
        shadowReceiver.receiveShadow = true;
        shadowReceiver.renderOrder = 1;
        floor.add(shadowReceiver);

        marbleFloorMeshes.push(floor);
        scene.add(floor);
    });

    // 全场只创建一个 Reflector，并在人物换层时移动到当前楼层
    reflectiveFloor = new Reflector(floorGeometries[0], {
        textureWidth: reflectionTextureSize,
        textureHeight: reflectionTextureSize,
        clipBias: 0.003,
        multisample: 0,
        color: 0xffffff,
        shader: floorReflectorShader,
    });

    configureReflectorUpdate(reflectiveFloor, {
        updateEveryNFrames: 2, // 隔帧更新
        frameOffset: 0, // 在偶数帧执行
        maxFps: 30, // 同时限制反射最高帧率
    });

    reflectiveFloor.name = "MarbleReflectiveFloor";
    reflectiveFloor.rotateX(-Math.PI / 2);

    reflectiveFloorShadowReceiver = new Mesh(
        floorGeometries[0],
        floorShadowMaterial
    );
    reflectiveFloorShadowReceiver.name = "MarbleFloorShadowReceiver";
    reflectiveFloorShadowReceiver.position.z = 0.002;
    reflectiveFloorShadowReceiver.receiveShadow = true;
    reflectiveFloorShadowReceiver.renderOrder = 1;
    reflectiveFloor.add(reflectiveFloorShadowReceiver);

    scene.add(reflectiveFloor);
    setActiveMarbleFloor(0);
}

// 切换反射楼层时，仅移动唯一的反射面，并恢复上一层的普通大理石地板
function setActiveMarbleFloor(floorIndex) {
    if (
        floorIndex === activeMarbleFloorIndex ||
        floorIndex < 0 ||
        floorIndex >= marbleFloorConfigs.length
    ) {
        return;
    }

    if (activeMarbleFloorIndex >= 0) {
        // 恢复离开楼层的普通地板
        marbleFloorMeshes[activeMarbleFloorIndex].visible = true;
    }

    // 隐藏当前层普通地板，并让唯一 Reflector 复用该层几何体
    activeMarbleFloorIndex = floorIndex;
    marbleFloorMeshes[activeMarbleFloorIndex].visible = false;
    reflectiveFloor.geometry = marbleFloorMeshes[activeMarbleFloorIndex].geometry;
    reflectiveFloorShadowReceiver.geometry = reflectiveFloor.geometry;
    reflectiveFloor.position.y =
        marbleFloorConfigs[activeMarbleFloorIndex].resolvedY + marbleFloorRenderOffset;
    reflectiveFloor.updateMatrixWorld();
}

// 每帧使用人物 Y 坐标选择距离最近的站立楼层
// 超出建筑高度时自然钳制到一楼或十楼，无需额外边界分支
function updateMarbleFloorForPlayer() {
    const playerY = player?.getPosition()?.y;
    if (!Number.isFinite(playerY)) return;

    let nearestFloorIndex = 0;
    let nearestDistance = Infinity;
    const firstFloorY = marbleFloorConfigs[0].resolvedY;
    marbleFloorConfigs.forEach((config, floorIndex) => {
        // 人物胶囊体在一楼站立时 Y=0，其余站立高度与楼面保持相同高度差
        const standingY = config.resolvedY - firstFloorY;
        const distance = Math.abs(playerY - standingY);
        if (distance < nearestDistance) {
            nearestDistance = distance;
            nearestFloorIndex = floorIndex;
        }
    });

    setActiveMarbleFloor(nearestFloorIndex);
}

// 配置反射地板的更新频率，降低额外反射相机带来的渲染开销
function configureReflectorUpdate(reflector, {
    updateEveryNFrames = 1,
    frameOffset = 0,
    maxFps = 30,
} = {}) {
    const renderReflection = reflector.onBeforeRender;
    const reflectionFrameInterval = Math.max(0, 1000 / maxFps - 1);
    let lastReflectionTime = -Infinity;

    reflector.onBeforeRender = function (...args) {
        // Reflector 内部也会调用 renderer.render，必须阻止嵌套反射
        if (isRenderingReflection) return;

        // 帧间隔和时间间隔同时满足时才更新反射纹理
        if (reflectionFrame % updateEveryNFrames !== frameOffset) return;

        const now = performance.now();
        if (now - lastReflectionTime < reflectionFrameInterval) return;

        lastReflectionTime = now;
        isRenderingReflection = true;
        try {
            renderReflection.apply(this, args);
        } finally {
            isRenderingReflection = false;
        }
    };
}

// ==================== 渲染循环与玩家 ====================

// 动画循环
function animate() {
    if (isUpdatePlayer && player) {
        player.update();
        updateMarbleFloorForPlayer();
    } else {
        controls.update();
    }
    if (tilesUpdateEnabled) {
        tilesList.forEach((t) => t.update());
    }
    reflectionFrame += 1;
    renderer.render(scene, camera);
    stats.update();
}

// 初始化玩家
async function initPlayer() {
    renderer.render(scene, camera);
    isUpdatePlayer = true;

    player = new playerController();
    await player.init({
        scene,
        camera,
        controls,
        playerModelConfig: {
            url: "./glb/UAL1_Standard.glb",
            scale: 0.01,
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
            rotateY: Math.PI,
            speed: 120,
            headBoneName: "Head",
            firstPersonCameraOffset: [0, 0.15, 0.12],
        },
        initPos: new Vector3(1.27, 0, 11.524),
        minCamDistance: 50,
        maxCamDistance: 160,
        springCameraTime: true,
        camLookAtHeightRatio: 0.7,
    });

    // 动画减速一半
    player.animation.actions?.get("idle")?.setEffectiveTimeScale(0.5);

    // 玩家模型参与场景阴影，并覆盖示例人物的两组基础配色
    player.getPlayerModel()?.traverse((child) => {
        if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
            if (child.name === "Mannequin_1") {
                child.material.color.set(0xfff4e6);
            }
            if (child.name === "Mannequin_2") {
                child.material.color.set(0x000000);
            }
        }
    });

    // 第一人称使用更宽视场角，第三人称恢复默认视场角
    player.onViewChange = (isFirstPerson) => {
        camera.fov = isFirstPerson ? 75 : 60;
        camera.updateProjectionMatrix();
    };
}

// ==================== 环境光照与 GI ====================

// 更新灯光位置
function updateLightPosition() {
    const azimuth = MathUtils.degToRad(params.lightAzimuth);
    const elevation = MathUtils.degToRad(params.lightElevation);
    const radius = 100;
    const horizontal = Math.cos(elevation) * radius;
    const vertical = Math.sin(elevation) * radius;

    dirLight.position.set(Math.cos(azimuth) * horizontal, vertical, Math.sin(azimuth) * horizontal);
    dirLight.target.position.set(0, 0, 0);
    dirLight.target.updateMatrixWorld();

    // Sky 使用球坐标方向，需将高度角转换为从 Y 轴量起的极角
    const phi = MathUtils.degToRad(90 - params.lightElevation);
    const theta = MathUtils.degToRad(params.lightAzimuth);
    sun.setFromSphericalCoords(1, phi, theta);
    sky.material.uniforms["sunPosition"].value.copy(sun);

}

let rebakeTimer = null;
// 合并 GUI 连续输入，停止操作 250ms 后再重新烘焙
function scheduleRebake() {
    if (rebakeTimer !== null) clearTimeout(rebakeTimer);
    rebakeTimer = setTimeout(() => {
        rebakeTimer = null;
        bakeWithSettings();
    }, 250);
}

let isBaking = false;
let bakeQueued = false;
// 烘焙全楼光照探针；烘焙期间的新请求会在当前任务结束后再执行一次
async function bakeWithSettings() {
    if (isBaking) {
        // 只记录一次排队状态，避免拖动 GUI 时并发创建多组探针
        bakeQueued = true;
        return;
    }
    isBaking = true;
    document.getElementById("bake-overlay").classList.add("visible");
    // 双帧等待，确保浏览器先渲染出进度条再开始烘焙
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    do {
        bakeQueued = false;
        if (probes) {
            scene.remove(probes);
            probes.dispose();
        }

        // 重建探针网格，使范围、密度和位置参数立即生效
        probes = new LightProbeGrid(
            params.sizeX, params.sizeY, params.sizeZ,
            params.countX, params.countY, params.countZ
        );
        probes.position.set(params.boundsX, params.boundsY, params.boundsZ);

        if (probesHelper) probesHelper.visible = false;

        // Reflector 依赖相机视角，不参与静态 GI；临时换回普通楼面参与烘焙
        const probeFar = Math.max(params.sizeX, params.sizeY, params.sizeZ) * 2.0;
        const floorWasVisible = reflectiveFloor?.visible;
        const activeNormalFloor = marbleFloorMeshes[activeMarbleFloorIndex];
        const activeNormalFloorWasVisible = activeNormalFloor?.visible;
        if (reflectiveFloor) reflectiveFloor.visible = false;
        // 烘焙期间用普通材质补回当前层，防止 GI 中缺少整块楼面
        if (activeNormalFloor) activeNormalFloor.visible = true;
        try {
            probes.bake(renderer, scene, { cubemapSize: 32, near: 0.05, far: probeFar });
        } finally {
            if (reflectiveFloor) reflectiveFloor.visible = floorWasVisible;
            if (activeNormalFloor) activeNormalFloor.visible = activeNormalFloorWasVisible;
        }

        probes.visible = params.enabled;
        scene.add(probes);

        // 首次创建辅助对象，后续烘焙只替换它引用的探针数据
        if (!probesHelper) {
            probesHelper = new LightProbeGridHelper(probes, params.probeSize);
            scene.add(probesHelper);
        } else {
            probesHelper.probes = probes;
            probesHelper.update();
        }
        probesHelper.visible = params.showProbes;
    } while (bakeQueued);
    isBaking = false;
    document.getElementById("bake-overlay").classList.remove("visible");
}

// 初始化 GUI
function initGUI() {
    gui = new GUI();

    const envFolder = gui.addFolder("Environment");
    envFolder.add(params, "skyEnvMap").name("Sky Env Map").onChange((v) => {
        scene.environment = v ? pmremGenerator.fromScene(sky).texture : null;
    });
    envFolder.open();

    const giFolder = gui.addFolder("Global Illumination (GI)");
    giFolder.add(params, "enabled").name("Enable GI").onChange((v) => {
        if (probes) probes.visible = v;
    });
    giFolder.add(params, "showProbes").name("Show Probes").onChange((v) => {
        if (probesHelper) probesHelper.visible = v;
    });
    giFolder.add(params, "probeSize", 0.05, 2, 0.05).name("Probe Size").onChange((v) => {
        if (probesHelper) {
            scene.remove(probesHelper);
            probesHelper.dispose();
            probesHelper = new LightProbeGridHelper(probes, v);
            probesHelper.visible = params.showProbes;
            scene.add(probesHelper);
        }
    });

    const lightFolder = gui.addFolder("Sun Settings");
    lightFolder.add(params, "lightAzimuth", -180, 180, 1).name("Azimuth")
        .onChange(() => { updateLightPosition(); })
        .onFinishChange(() => { scheduleRebake(); });
    lightFolder.add(params, "lightElevation", 0, 90, 1).name("Elevation")
        .onChange(() => { updateLightPosition(); })
        .onFinishChange(() => { scheduleRebake(); });
    lightFolder.add(params, "lightIntensity", 0, 100, 0.1).name("Intensity")
        .onChange((v) => { dirLight.intensity = v; })
        .onFinishChange(() => { scheduleRebake(); });
    lightFolder.add(params, "shadows").name("Shadows").onFinishChange((v) => {
        renderer.shadowMap.enabled = v;
        dirLight.castShadow = v;
        tilesList.forEach((t) => {
            t.group.traverse((c) => {
                if (c.isMesh) {
                    c.castShadow = v;
                    c.receiveShadow = v;
                }
            });
        });
        scheduleRebake();
    });
    lightFolder.open();
}

// ==================== 3D Tiles ====================

// 创建楼层 Tile
function createTiles(url, floorIndex) {
    const t = new TilesRenderer(url);
    t.manager.addHandler(/\.(gltf|glb)$/g, gltfLoader);
    t.errorTarget = 4;
    t.displayActiveTiles = true;
    t.registerPlugin(new TilesFadePlugin());
    const meshConfig = floorMeshConfig[floorIndex] ?? {};
    t.addEventListener("load-model", ({ scene: tileScene }) => {
        if (!tileScene) return;
        // 缓存原始 Tile 内容，供所有楼层加载完成后自动提取楼面
        floorTileScenes[floorIndex].push(tileScene);
        const toRemove = [];
        tileScene.traverse((c) => {
            if (c.isMesh) {
                // console.log(`load-model [${floorIndex}F]`, c.name);
                const type = meshConfig[c.name];
                if (type === 'hidden') {
                    // 遍历结束后统一移除，避免正在遍历场景树时修改其结构
                    toRemove.push(c);
                } else {
                    const handler = materialHandlers[type] ?? materialHandlers._default;
                    handler(c);
                }
            }
        });
        toRemove.forEach((c) => materialHandlers.hidden(c));
    });
    scene.add(t.group);
    t.setCamera(camera);
    t.setResolutionFromRenderer(camera, renderer);
    tilesList.push(t);
    return t;
}

// 初始化楼层 Tile
async function initTiles(urls) {
    // 首层解算坐标变换矩阵，其余楼层复用
    const primary = createTiles(urls[0], 0);

    const finalMatrix = await new Promise((resolve) => {
        const onLoad = () => {
            // 包围球同时用于模型归心和初始相机距离
            const sphere = new Sphere();
            primary.getBoundingSphere(sphere);
            const center = sphere.center.clone();
            const radius = sphere.radius;
            const offset = new Vector3(radius * 1.2, radius, radius * 1.2);
            const root = primary.root;

            // 兼容根 tileset 和嵌套 tileset 两种导出结构
            let m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
            if (root?.children?.length > 1 && root?.children[0].content?.uri?.includes("tileset.json")) {
                if (root?.children[0]?.children) {
                    m = root.children[0].children[0].transform ?? m;
                }
            } else if (root?.transform) {
                m = root.transform;
            }

            // 将 Tiles 坐标轴转换为 Three.js 的 Y-Up，并围绕包围球中心旋转、归心
            const rotationMat3 = new Matrix3().set(m[0], m[1], m[2], m[8], m[9], m[10], -m[4], -m[5], -m[6]);
            const rotationMat4 = new Matrix4().setFromMatrix3(rotationMat3);
            const t1 = new Matrix4().makeTranslation(center.x, center.y, center.z);
            const t2 = new Matrix4().makeTranslation(-center.x, -center.y, -center.z);
            let mat = new Matrix4().multiplyMatrices(t1, rotationMat4).multiply(t2);
            mat = new Matrix4().makeTranslation(-center.x, -center.y, -center.z).multiply(mat);

            primary.group.matrix.copy(mat);
            primary.group.matrixAutoUpdate = false;
            primary.group.updateMatrixWorld(true);

            controls.target.set(0, 0, 0);
            camera.position.copy(offset);
            camera.lookAt(0, 0, 0);
            camera.updateProjectionMatrix();

            primary.removeEventListener("load-tileset", onLoad);
            resolve(mat);
        };
        primary.addEventListener("load-tileset", onLoad);
    });

    // 其余楼层直接套用首层矩阵
    for (let i = 1; i < urls.length; i++) {
        const t = createTiles(urls[i], i);
        t.group.matrix.copy(finalMatrix);
        t.group.matrixAutoUpdate = false;
        t.group.updateMatrixWorld(true);
    }

    // 等待所有楼层瓦片几何体完全加载
    await waitForAllTilesLoaded();
}

// 等待所有楼层瓦片几何体完全加载
function waitForAllTilesLoaded() {
    return new Promise((resolve) => {
        let stableChecks = 0; // 连续满足完成条件的次数
        const STABLE_THRESHOLD = 10; // 防止请求短暂归零造成误判
        const CHECK_INTERVAL = 50; // 轮询间隔
        let hasStartedLoading = false; // 是否观察到过真实加载过程

        function check() {
            // parsing 结束才代表 Tile 场景树可以用于楼面几何提取
            const queued = tilesList.reduce((s, t) => s + t.stats.queued, 0);
            const downloading = tilesList.reduce((s, t) => s + t.stats.downloading, 0);
            const parsing = tilesList.reduce((s, t) => s + t.stats.parsing, 0);
            const allFloorsHaveContent = floorTileScenes.every(
                (tileScenes, floorIndex) =>
                    tileScenes.length > 0 || tilesList[floorIndex].stats.failed > 0
            );

            if (!hasStartedLoading && (queued > 0 || downloading > 0 || parsing > 0)) {
                hasStartedLoading = true;
            }

            // 本地缓存命中时可能来不及观察到加载中的状态，因此同时以每层已有内容为准
            if (
                (hasStartedLoading || allFloorsHaveContent) &&
                allFloorsHaveContent &&
                downloading === 0 &&
                parsing === 0
            ) {
                stableChecks++;
                if (stableChecks >= STABLE_THRESHOLD) {
                    resolve();
                    return;
                }
            } else {
                stableChecks = 0;
            }

            setTimeout(check, CHECK_INTERVAL);
        }

        setTimeout(check, CHECK_INTERVAL);
    });
}

// ==================== 交互与窗口 ====================

const _raycaster = new Raycaster();
const _pointer = new Vector2();
// 初始化点击选择
function initClickPick() {
    renderer.domElement.addEventListener("click", (e) => {
        const rect = renderer.domElement.getBoundingClientRect();
        _pointer.set(
            ((e.clientX - rect.left) / rect.width) * 2 - 1,
            -((e.clientY - rect.top) / rect.height) * 2 + 1
        );
        _raycaster.setFromCamera(_pointer, camera);

        // 只收集当前已加载的楼层 Mesh，返回距离相机最近的命中结果
        const objects = [];
        tilesList.forEach((t) => t.group.traverse((c) => { if (c.isMesh) objects.push(c); }));
        const hits = _raycaster.intersectObjects(objects, false);
        if (hits.length > 0) {
            const mesh = hits[0].object;
            console.log(hits[0]);
        }
    });
}

// 同步相机、渲染器和每层 TilesRenderer 的视口分辨率
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    tilesList.forEach((t) => t.setResolutionFromRenderer(camera, renderer));
}
