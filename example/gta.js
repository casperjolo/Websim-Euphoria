import * as THREE from "three";
import { MapControls } from "three/examples/jsm/controls/MapControls.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { playerController } from "../src/PlayerController";

const base = import.meta.env.BASE_URL.endsWith("/")
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`;
const asset = (path) => `${base}${path.replace(/^\.\//, "")}`;

const spawn = new THREE.Vector3(21.5, 4, 15);
const scene = new THREE.Scene();
const state = {
    player: null,
    vehicle: null,
    map: null,
    ready: false,
    started: false,
    elapsed: 0,
    missionIndex: 0,
    cash: 2450,
    wanted: 0,
    waypoint: new THREE.Vector3(),
    waypointGroundY: spawn.y,
    waypointReady: false,
    lastHudUpdate: 0,
    lastMapUpdate: 0,
    missionCooldown: 0,
};

const missions = [
    {
        title: "Get the sedan",
        detail: "The city is quiet. Find your ride and take the long way through the junction.",
        reward: 250,
        radius: 2.1,
        marker: "RIDE",
    },
    {
        title: "South Bank run",
        detail: "Take the sedan to the green beacon. Keep it clean and keep moving.",
        target: new THREE.Vector3(-1.32, 4, 14.83),
        reward: 500,
        radius: 2.7,
        marker: "RUN",
    },
    {
        title: "Loop the junction",
        detail: "One more stop. Cross the junction, then the city opens up.",
        target: new THREE.Vector3(-19.85, 4, 8.77),
        reward: 750,
        radius: 2.7,
        marker: "GO",
    },
];

let camera;
let renderer;
let controls;
let gltfLoader;
let marker;
let markerSprite;
let markerTexture;
let markerRing;
let markerBeam;
let lastFrame = performance.now();
let toastTimer;

const dom = {
    container: document.querySelector("#container"),
    loading: document.querySelector("#loading"),
    loadingFill: document.querySelector("#loading-fill"),
    loadingPercent: document.querySelector("#loading-percent"),
    loadingLabel: document.querySelector("#loading-label"),
    loadingDetail: document.querySelector("#loading-detail"),
    startScreen: document.querySelector("#start-screen"),
    startButton: document.querySelector("#start-btn"),
    missionCard: document.querySelector("#mission-card"),
    missionKicker: document.querySelector("#mission-kicker"),
    missionTitle: document.querySelector("#mission-title"),
    missionDetail: document.querySelector("#mission-detail"),
    missionProgress: document.querySelector("#mission-progress"),
    missionReward: document.querySelector("#mission-reward"),
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
                setLoading(end, label, "Collision-ready asset loaded");
                resolve(gltf);
            },
            (event) => {
                const ratio = event.total > 0 ? event.loaded / event.total : 0.5;
                setLoading(start + (end - start) * ratio, label, "Streaming city data…");
            },
            (error) => reject(error),
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
    renderer.domElement.setAttribute("aria-label", "Euphoria City game canvas");
    dom.container.appendChild(renderer.domElement);

    camera = new THREE.PerspectiveCamera(
        58,
        dom.container.clientWidth / dom.container.clientHeight,
        0.05,
        1400,
    );
    camera.position.set(spawn.x + 7, spawn.y + 4, spawn.z + 9);
    camera.lookAt(spawn.x, spawn.y, spawn.z);

    controls = new MapControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.enableZoom = false;
    controls.maxPolarAngle = Math.PI * 0.48;
    controls.minDistance = 0.08;
    controls.maxDistance = 1.2;
    controls.target.copy(spawn);

    scene.background = new THREE.Color(0x182535);
    scene.fog = new THREE.Fog(0x182535, 36, 150);

    const skyLight = new THREE.HemisphereLight(0x9ab9d8, 0x1c2229, 1.9);
    scene.add(skyLight);

    const sun = new THREE.DirectionalLight(0xffd8a6, 4.6);
    sun.position.set(-28, 42, 20);
    sun.target.position.set(spawn.x, 0, spawn.z);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 120;
    sun.shadow.camera.left = -45;
    sun.shadow.camera.right = 45;
    sun.shadow.camera.top = 45;
    sun.shadow.camera.bottom = -45;
    sun.shadow.bias = -0.0002;
    sun.shadow.normalBias = 0.02;
    scene.add(sun, sun.target);

    const fill = new THREE.DirectionalLight(0x83b9ff, 1.15);
    fill.position.set(36, 17, -30);
    scene.add(fill);
}

function setupLoader() {
    gltfLoader = new GLTFLoader();
    const draco = new DRACOLoader();
    draco.setDecoderPath("https://unpkg.com/three@0.180.0/examples/jsm/libs/draco/");
    gltfLoader.setDRACOLoader(draco);

    const ktx2 = new KTX2Loader();
    ktx2.setTranscoderPath("https://unpkg.com/three@0.180.0/examples/jsm/libs/basis/");
    ktx2.detectSupport(renderer);
    gltfLoader.setKTX2Loader(ktx2);
}

function prepareScene(model) {
    state.map = model;
    state.map.name = "euphoria-city-map";
    state.map.scale.setScalar(10);
    state.map.traverse((object) => {
        if (!object.isMesh) return;
        object.castShadow = true;
        object.receiveShadow = true;
        object.frustumCulled = true;
    });
    scene.add(state.map);
    scene.updateMatrixWorld(true);
}

function configurePlayerModel(model, animations) {
    return {
        model,
        animations: animations ?? [],
        scale: 0.001,
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
        rotateY: Math.PI,
    };
}

function setupPlayer(modelGltf) {
    state.player = new playerController();
    return state.player.init({
        scene,
        camera,
        controls,
        playerModelConfig: configurePlayerModel(modelGltf.scene, modelGltf.animations),
        initPos: spawn,
        minCamDistance: 8,
        maxCamDistance: 300,
        camLookAtHeightRatio: 0.52,
        enableSpringCamera: true,
        springCameraTime: 0.12,
        enableOverShoulderView: true,
        camOverShoulderOffsetRatio: 0.02,
        enableZoom: true,
        colliders: [
            { motion: "static", shape: { kind: "mesh", source: state.map } },
        ],
    });
}

function configureVehicle(model) {
    return {
        model,
        scale: 0.1,
        wheelsNames: ["Wheel_LF", "Wheel_RF", "Wheel_LR", "Wheel_RR"],
        position: spawn.clone().add(new THREE.Vector3(0, -0.2, -0.5)),
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

function groundYAt(x, z, fallback = spawn.y) {
    if (!state.map) return fallback;
    const raycaster = new THREE.Raycaster(
        new THREE.Vector3(x, fallback + 70, z),
        new THREE.Vector3(0, -1, 0),
        0,
        140,
    );
    const hits = raycaster.intersectObject(state.map, true);
    return hits[0]?.point.y ?? fallback;
}

function makeMarkerTexture(label) {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 76;
    const context = canvas.getContext("2d");
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "rgba(16, 19, 26, .86)";
    context.fillRect(2, 2, 252, 72);
    context.strokeStyle = "#d7f25b";
    context.lineWidth = 4;
    context.strokeRect(2, 2, 252, 72);
    context.fillStyle = "#f4f0e8";
    context.font = "700 34px Barlow Condensed, Impact, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(label, 128, 38);
    return new THREE.CanvasTexture(canvas);
}

function createMarker() {
    marker = new THREE.Group();
    marker.name = "mission-marker";
    marker.renderOrder = 20;

    markerRing = new THREE.Mesh(
        new THREE.TorusGeometry(1.05, 0.055, 8, 36),
        new THREE.MeshBasicMaterial({ color: 0xd7f25b, transparent: true, opacity: 0.94 }),
    );
    markerRing.rotation.x = Math.PI / 2;
    markerRing.renderOrder = 20;

    markerBeam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.035, 0.09, 3.3, 8),
        new THREE.MeshBasicMaterial({ color: 0xd7f25b, transparent: true, opacity: 0.22, depthWrite: false }),
    );
    markerBeam.position.y = 1.65;
    markerBeam.renderOrder = 19;

    markerTexture = makeMarkerTexture("RIDE");
    markerSprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: markerTexture,
        transparent: true,
        depthWrite: false,
        depthTest: false,
    }));
    markerSprite.scale.set(2.35, 0.7, 1);
    markerSprite.position.y = 3.55;
    markerSprite.renderOrder = 22;

    marker.add(markerRing, markerBeam, markerSprite);
    scene.add(marker);
}

function setMarkerLabel(label) {
    if (!markerSprite) return;
    markerTexture?.dispose();
    markerTexture = makeMarkerTexture(label);
    markerSprite.material.map = markerTexture;
    markerSprite.material.needsUpdate = true;
}

function updateMarker(dt) {
    if (!marker || !state.player || !state.started || state.missionIndex >= missions.length) {
        if (marker) marker.visible = false;
        return;
    }

    const mission = missions[state.missionIndex];
    let target;
    let targetY;
    if (state.missionIndex === 0 && state.vehicle) {
        target = state.vehicle.vehicleGroup.position;
        targetY = target.y;
    } else {
        target = mission.target;
        targetY = state.waypointGroundY;
    }

    marker.position.set(target.x, targetY + 0.05, target.z);
    marker.rotation.y += dt * 0.85;
    markerRing.rotation.z += dt * 1.35;
    markerBeam.scale.y = 0.92 + Math.sin(state.elapsed * 3.2) * 0.08;
    markerSprite.material.opacity = 0.88 + Math.sin(state.elapsed * 4) * 0.1;
    marker.visible = true;
}

function setMissionWaypoint() {
    const mission = missions[state.missionIndex];
    if (!mission?.target) return;
    state.waypoint.copy(mission.target);
    state.waypointGroundY = groundYAt(state.waypoint.x, state.waypoint.z, state.waypoint.y);
    state.waypointReady = true;
    setMarkerLabel(mission.marker);
}

function showToast(title, copy, duration = 3200) {
    dom.toastTitle.textContent = title;
    dom.toastCopy.textContent = copy;
    dom.toast.classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => dom.toast.classList.remove("visible"), duration);
}

function updateMissionUI() {
    const mission = missions[state.missionIndex];
    if (!mission) {
        dom.missionCard.classList.add("complete");
        dom.missionKicker.textContent = "All clear · Free roam";
        dom.missionTitle.textContent = "City unlocked";
        dom.missionDetail.textContent = "You made the run. Take the car anywhere, explore the scene or reset it with R.";
        dom.missionProgress.textContent = "03 / 03";
        dom.missionReward.textContent = "+$1,500 banked";
        setMarkerLabel("FREE");
        return;
    }

    dom.missionCard.classList.toggle("complete", false);
    dom.missionKicker.textContent = state.missionIndex === 0 ? "Current objective" : "Active job · South Bank";
    dom.missionTitle.textContent = mission.title;
    dom.missionDetail.textContent = mission.detail;
    dom.missionProgress.textContent = `${String(state.missionIndex + 1).padStart(2, "0")} / 03`;
    dom.missionReward.textContent = `Reward +$${mission.reward.toLocaleString()}`;
}

function advanceMission() {
    const completed = missions[state.missionIndex];
    if (!completed) return;
    state.cash += completed.reward;
    state.missionIndex += 1;
    state.missionCooldown = 1.2;
    state.wanted = state.missionIndex >= missions.length ? 0 : 1;
    updateMissionUI();
    setMissionWaypoint();

    if (state.missionIndex >= missions.length) {
        showToast("Run complete", "The city is yours. Free roam unlocked.", 5000);
    } else if (state.missionIndex === 1) {
        showToast("Ride acquired", "South Bank is waiting. Follow the green beacon.");
    } else {
        showToast("Checkpoint cleared", "Nice line. One last stop at the junction.");
    }
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

    const scale = 4.15;
    const toMap = (x, z) => ({
        x: center + (x - position.x) * scale,
        y: center + (z - position.z) * scale,
    });

    // A hand-drawn street grid keeps the map legible even when the scene is dark.
    context.lineCap = "square";
    context.lineWidth = 10;
    context.strokeStyle = "rgba(244, 240, 232, .13)";
    const streets = [
        [[-42, -17], [42, -17]],
        [[-42, 8], [42, 8]],
        [[-25, -42], [-25, 42]],
        [[5, -42], [5, 42]],
        [[28, -42], [28, 42]],
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
    context.strokeStyle = "rgba(244, 240, 232, .28)";
    for (const [[x1, z1], [x2, z2]] of streets) {
        const a = toMap(x1, z1);
        const b = toMap(x2, z2);
        context.beginPath();
        context.moveTo(a.x, a.y);
        context.lineTo(b.x, b.y);
        context.stroke();
    }

    const mission = missions[state.missionIndex];
    const target = state.missionIndex === 0 && state.vehicle
        ? state.vehicle.vehicleGroup.position
        : mission?.target;
    if (target) {
        const point = toMap(target.x, target.z);
        const distance = Math.hypot(point.x - center, point.y - center);
        if (distance < radius - 7) {
            context.beginPath();
            context.arc(point.x, point.y, 9 + Math.sin(state.elapsed * 4) * 2, 0, Math.PI * 2);
            context.strokeStyle = "#d7f25b";
            context.lineWidth = 3;
            context.stroke();
            context.beginPath();
            context.arc(point.x, point.y, 3, 0, Math.PI * 2);
            context.fillStyle = "#d7f25b";
            context.fill();
        }
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
    state.missionCooldown = Math.max(0, state.missionCooldown - dt);

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

function checkMissionProgress() {
    if (!state.started || !state.player || state.missionCooldown > 0) return;
    const mission = missions[state.missionIndex];
    if (!mission || state.missionIndex === 0 || state.player.getControllerMode() !== 1) return;

    const position = state.player.getPosition();
    if (!position) return;
    const distance = Math.hypot(position.x - mission.target.x, position.z - mission.target.z);
    if (distance <= mission.radius) advanceMission();
}

function onResize() {
    if (!camera || !renderer) return;
    const width = dom.container.clientWidth;
    const height = dom.container.clientHeight;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
}

function animate(now = performance.now()) {
    if (!renderer || !camera) return;
    const dt = Math.min((now - lastFrame) / 1000, 1 / 30);
    lastFrame = now;
    state.elapsed += dt;

    if (state.player && state.started) {
        state.player.update(dt);
        checkMissionProgress();
        updateHUD(dt);
        updateMarker(dt);
    }

    renderer.render(scene, camera);
}

async function init() {
    try {
        setupRenderer();
        setupLoader();
        setLoading(4, "Loading South Bank", "Establishing a stream to the city…");

        const mapGltf = await loadModel(asset("glb/crash_junction.glb"), "Loading South Bank", 4, 55);
        prepareScene(mapGltf.scene);

        const playerGltf = await loadModel(asset("glb/josh.glb"), "Loading resident profile", 55, 74);
        await setupPlayer(playerGltf);
        state.player.getPlayerModel()?.traverse((object) => {
            if (!object.isMesh) return;
            object.castShadow = true;
            object.receiveShadow = true;
        });

        const vehicleGltf = await loadModel(asset("glb/sedan.glb"), "Loading street vehicle", 74, 96);
        await setupVehicle(vehicleGltf);
        createMarker();
        updateMissionUI();
        updateWantedUI();
        setLoading(100, "City services online", "South Bank is ready to explore");

        // Loading the controller binds input listeners. Hold them until the player presses Enter City.
        state.player.offAllEvent();
        state.ready = true;
        dom.loading.classList.add("fade-out");
        window.setTimeout(() => {
            dom.loading.style.display = "none";
            dom.startScreen.style.display = "grid";
        }, 450);
    } catch (error) {
        console.error("Euphoria City failed to initialize", error);
        setLoading(100, "City services offline", "Could not load the local GLB assets. Check the dev server and refresh.");
        dom.loadingFill.style.background = "#ff654e";
    }
}

dom.startButton.addEventListener("click", () => {
    if (!state.ready || state.started) return;
    state.started = true;
    dom.startScreen.style.display = "none";
    document.body.style.cursor = "none";
    state.player.onAllEvent();
    renderer.domElement.focus();
    showToast("Welcome to Euphoria", "Find the marked sedan to start your first run.");
});

window.addEventListener("keydown", (event) => {
    if (!state.started || !state.player) return;
    if (event.code === "KeyR" && !event.repeat) {
        state.player.resetVehicle();
        showToast("Vehicle reset", "Back on four wheels.", 1800);
    }
});

window.addEventListener("pointerlockchange", () => {
    if (!state.started) return;
    document.body.style.cursor = document.pointerLockElement ? "none" : "auto";
});

window.addEventListener("resize", onResize);

rendererSafeLoop();
function rendererSafeLoop() {
    // The loop starts immediately so the loading screen has a live background while assets stream in.
    requestAnimationFrame(function loop(now) {
        animate(now);
        requestAnimationFrame(loop);
    });
}

init();
