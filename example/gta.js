import * as THREE from "three";
import { MapControls } from "three/examples/jsm/controls/MapControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
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
    cash: 2450,
    wanted: 0,
    lastHudUpdate: 0,
    lastMapUpdate: 0,
    selectedMenu: "free-roam",
};

let camera;
let renderer;
let controls;
let gltfLoader;
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
    menuNote: document.querySelector("#menu-note"),
    menuOptions: [...document.querySelectorAll("[data-menu]")],
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

const menuContent = {
    "free-roam": {
        note: "A living district, one set of wheels and no scripted route. Walk the block or take the sedan wherever the road leads.",
        action: "Enter free roam",
        available: true,
    },
    story: {
        note: "Story mode is reserved for the next chapter. For now, South Bank is open and the streets are yours.",
        action: "Story mode · coming soon",
        available: false,
    },
    options: {
        note: "Cinematic presentation is active. Use V to change the camera, R to reset the vehicle and E to get in or out.",
        action: "Enter free roam",
        available: true,
    },
    credits: {
        note: "A web sandbox built with Three.js, the player controller, vehicle physics and the GLB assets in this repository.",
        action: "Enter free roam",
        available: true,
    },
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
    // The three GTA assets are self-contained GLBs. Keep the sandbox offline-friendly
    // instead of depending on remote Draco/Basis decoder downloads.
    gltfLoader = new GLTFLoader();
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

function showToast(title, copy, duration = 3200) {
    dom.toastTitle.textContent = title;
    dom.toastCopy.textContent = copy;
    dom.toast.classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => dom.toast.classList.remove("visible"), duration);
}

function selectMenuItem(key) {
    const content = menuContent[key] ?? menuContent["free-roam"];
    state.selectedMenu = key;
    dom.menuOptions.forEach((button) => {
        const active = button.dataset.menu === key;
        button.classList.toggle("active", active);
        button.setAttribute("aria-selected", String(active));
    });
    dom.menuNote.textContent = content.note;
    dom.startButton.textContent = `${content.action}  →`;
    dom.startButton.disabled = !content.available;
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
        updateHUD(dt);
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

        state.player.onViewChange = (isFirstPerson) => {
            dom.crosshair.style.display = isFirstPerson ? "block" : "none";
        };
        state.player.onVehicleEnter = () => showToast("Vehicle entered", "South Bank is open. Take the city at your own pace.");
        state.player.onVehicleExit = () => showToast("On foot", "The sedan is parked where you left it.", 1800);

        const vehicleGltf = await loadModel(asset("glb/sedan.glb"), "Loading street vehicle", 74, 96);
        await setupVehicle(vehicleGltf);
        selectMenuItem("free-roam");
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
        const reason = error instanceof Error ? error.message : "Unknown asset error";
        setLoading(100, "City services offline", `Could not load local GLB assets · ${reason}`);
        dom.loadingFill.style.background = "#ff654e";
    }
}

dom.menuOptions.forEach((button) => {
    button.addEventListener("click", () => selectMenuItem(button.dataset.menu));
});

dom.startButton.addEventListener("click", () => {
    if (!state.ready) return;
    if (state.selectedMenu !== "free-roam" && !menuContent[state.selectedMenu].available) return;
    if (state.selectedMenu !== "free-roam") selectMenuItem("free-roam");
    if (state.started) return;

    state.started = true;
    dom.startScreen.style.display = "none";
    document.body.style.cursor = "none";
    state.player.onAllEvent();
    renderer.domElement.focus();
    showToast("Welcome to Euphoria", "Free roam is live. The city is yours.");
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

// The loop starts immediately so the loading screen has a live background while assets stream in.
requestAnimationFrame(function loop(now) {
    animate(now);
    requestAnimationFrame(loop);
});

init();
