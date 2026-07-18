中文 | [English](README_En.md)

# three-player-controller

[![NPM Package][npm]][npm-url]
[![Github][github]][github-url]
[![X][x]][x-url]
[![CesiumJS](https://img.shields.io/badge/CesiumJS-player_controller-blue)](https://github.com/hh-hang/cesium-player-controller)

基于 three.js 的轻量级玩家控制器，开箱即用，提供人物胶囊体碰撞、动画、第一 / 三人称切换、相机避障；借助 three-mesh-bvh 加速碰撞检测，大场景下高性能运行。

# 示例

[![在线示例](https://github.com/hh-hang/three-player-controller/blob/master/example/public/img/readme/preview.jpg)](https://hh-hang.github.io/three-player-controller/index.html)

### 普通控制

![普通控制演示](https://github.com/hh-hang/three-player-controller/blob/master/example/public/img/readme/standard.gif)

### 飞行控制

![飞行控制演示](https://github.com/hh-hang/three-player-controller/blob/master/example/public/img/readme/flight.gif)

### 车辆控制

![车辆控制演示](https://github.com/hh-hang/three-player-controller/blob/master/example/public/img/readme/vehicle.gif)

### 移动端控制

![移动端控制演示](https://github.com/hh-hang/three-player-controller/blob/master/example/public/img/readme/mobile.gif)

# 安装

```bash
npm install three-player-controller three-mesh-bvh
```

## 可选依赖

如果需要车辆功能，请额外安装 Rapier：

```bash
npm install @dimforge/rapier3d-compat
```

# 本地运行

```bash
git clone https://github.com/hh-hang/three-player-controller.git
npm install
npm run dev
```

浏览器访问 `http://localhost:5173/three-player-controller/`。

# 使用

```ts
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { playerController } from "three-player-controller";

// 搭建 three.js 环境（场景 / 相机 / 渲染器 / 控制器）
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer();
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement);

// playerController 核心用法
const player = new playerController();

// 人物控制初始化
await player.init({
    scene,    // three.js 场景实例
    camera,   // three.js 相机实例
    controls, // 外部相机控制器
    playerModelConfig: {
        url: "./glb/person.glb",   // 模型路径（GLB/GLTF）
        scale: 0.001,              // 模型缩放
        idleAnim: "idle",          // 静止动画名
        walkAnim: "walk",          // 行走动画名
        runAnim: "run",            // 跑步动画名
        jumpAnim: "jump",          // 跳跃动画名；或传 ["起跳", "循环", "落地"] 分三段播放
    },
    initPos: new THREE.Vector3(0, 0, 0),  // 人物初始坐标
});

// 车辆控制初始化（可选）
await player.loadVehicleModel({
    url: "./glb/bugatti.glb",                                      // 车辆模型 URL
    position: new THREE.Vector3(0, 0, 0),                          // 车辆位置
    wheelsNames: ["Wheel_LF", "Wheel_RF", "Wheel_LR", "Wheel_RR"], // 顺序：左前、右前、左后、右后
    boardingPoint: new THREE.Vector3(0.5, 0, 1.8),                 // 上车触发点，局部坐标
});

// 每帧调用
function animate() {
    requestAnimationFrame(animate);
    player.update(); 
    renderer.render(scene, camera);
}
animate();
```

> `player.update()` 内部已接管传入的相机控制器，渲染循环中请勿再调用 `controls.update()`，否则会与内部的相机逻辑冲突。

### 完整参数示例

#### `init()`

```ts
await player.init({
    // 必填
    scene,    // three.js 场景实例
    camera,   // three.js 相机实例
    controls, // 外部相机控制器
    playerModelConfig: {
        url: "./glb/person.glb",   // 模型路径（GLB/GLTF）
        scale: 0.001,              // 模型缩放
        idleAnim: "idle",          // 静止动画名
        walkAnim: "walk",          // 行走动画名
        runAnim: "run",            // 跑步动画名
        jumpAnim: "jump",          // 跳跃动画名；或传 ["起跳", "循环", "落地"] 分三段播放

        // 方向动画（可选，不填则复用对应默认动画）
        leftWalkAnim: "leftWalk",         // 默认复用 walkAnim
        rightWalkAnim: "rightWalk",       // 默认复用 walkAnim
        backwardAnim: "walkBack",         // 默认复用 walkAnim
        flyAnim: "fly",                   // 默认复用 idleAnim
        flyIdleAnim: "flyIdle",           // 默认复用 idleAnim
        flyHoverForwardAnim: "flyFwd",    // 默认复用 flyAnim
        flyHoverBackAnim: "flyBack",      // 默认复用 flyIdleAnim
        flyHoverLeftAnim: "flyLeft",      // 默认复用 flyIdleAnim
        flyHoverRightAnim: "flyRight",    // 默认复用 flyIdleAnim
        flyHoverUpAnim: "flyUp",          // 默认复用 flyIdleAnim
        flyHoverDownAnim: "flyDown",      // 默认复用 flyIdleAnim
        enterCarAnim: "enterCar",         // 上车动画（使用车辆功能时必须配置）
        exitCarAnim: "exitCar",           // 下车动画（使用车辆功能时必须配置）

        // 物理参数（可选）
        gravity: -2400,     // 重力基准值，会按 scale 缩放
        jumpHeight: 600,    // 跳跃高度基准值，会按 scale 缩放
        speed: 200,         // 移动速度基准值，会按 scale 缩放
        flySpeed: 2100,     // 飞行速度基准值，会按 scale 缩放
        acceleration: 30,   // XZ 加速响应速度
        deceleration: 30,   // XZ 减速响应速度

        // 模型参数（可选）
        rotateY: 0,                            // 人物初始朝向（弧度），用于改变模型初始化面朝方向
        headBoneName: "Head",                  // 头部骨骼名，用于第一人称相机挂载
        firstPersonCameraOffset: [0, 40, 30],  // 第一人称相机局部偏移
        capsuleRadiusRatio: 1,                 // 胶囊体半径倍率
    },

    // 场景与碰撞（可选）
    initPos: new THREE.Vector3(0, 0, 0),       // 初始出生点
    staticCollider: mesh,                      // 静态碰撞体来源，不传则遍历整个场景
    dynamicCollider: platform,                 // 初始化时注册的动态碰撞体

    // 相机（可选）
    minCamDistance: 100,           // 第三人称最小镜头距离
    maxCamDistance: 440,           // 第三人称最大镜头距离
    camLookAtHeightRatio: 0.8,     // 相机看向点高度比例，0=底部 1=顶部
    thirdMouseMode: 1,             // 鼠标控制模式 0-5，详见字段说明
    enableZoom: false,             // 是否允许滚轮缩放
    enableOverShoulderView: false, // 是否启用过肩视角
    camOverShoulderOffsetRatio: 0.2, // 第三人称相机过肩视角横向偏移比例
    isFirstPerson: false,          // 初始是否进入第一人称
    enableSpringCamera: false,     // 是否启用弹簧相机
    springCameraTime: 0.05,        // 弹簧相机平滑时间（秒），越小跟随越紧

    // 其他（可选）
    mouseSensitivity: 5,           // 鼠标灵敏度
    timeScale: 1,                  // 时间缩放系数，<1 慢动作，>1 快进
    keyMap: {                      // 自定义键位（以下为默认值；可改键、数组多绑或传 null 禁用，详见“自定义键位”）
        forward: ["KeyW", "ArrowUp"],        // 前进
        backward: ["KeyS", "ArrowDown"],     // 后退
        left: ["KeyA", "ArrowLeft"],         // 左移
        right: ["KeyD", "ArrowRight"],       // 右移
        sprint: ["ShiftLeft", "ShiftRight"], // 冲刺
        jump: ["Space"],                     // 跳跃
        toggleView: ["KeyV"],                // 切换视角
        toggleFly: ["KeyF"],                 // 切换飞行模式
        toggleVehicle: ["KeyE"],             // 上 / 下车
    },
    isShowMobileControls: true,    // 移动端是否显示虚拟控制 UI
    mobileControls: {              // 移动端按钮显隐、图标与布局（默认全部显示并使用英文标签）
        joystick: true,             // 是否显示摇杆，默认 true
        jump: {                     // 传 false 隐藏，传对象自定义图标和布局
            // icon: "/icons/custom-jump.svg",
            // brakeIcon: "/icons/custom-brake.svg",
            right: 24,
            bottom: 32,
            size: 64,
        },
        fly: true,                  // true 或不传时使用默认值
        view: true,
        vehicle: true,
    },
});
```

#### `loadVehicleModel()`

```ts
await player.loadVehicleModel({
    // 必填
    url: "./glb/bugatti.glb",                                      // 车辆模型 URL
    position: new THREE.Vector3(0, 0, 0),                          // 车辆位置
    wheelsNames: ["Wheel_LF", "Wheel_RF", "Wheel_LR", "Wheel_RR"], // 顺序：左前、右前、左后、右后
    boardingPoint: new THREE.Vector3(0.5, 0, 1.8),                 // 上车触发点，局部坐标

    // 可选
    scale: 0.1,                                // 车辆模型缩放，默认 1
    animations: {
        openDoorAnim: "openDoorLF",            // 车门开关动画名
    },
    seatOffset: new THREE.Vector3(0, 0.6, 0),  // 角色座位偏移，默认 (0,0,0)
    chassisRatio: 0.15,                        // 底盘高度比例，默认 0.2
    suspensionRestLengthRatio: 0.2,            // 悬挂静止长度比例，默认 0.2
    followVehicleDirection: true,              // 驾驶时镜头跟随车辆朝向，默认 true
    speedMultiplier: 1,                        // 单车速度倍率，默认 1
});
```

# API

## 生命周期

| 方法 | 说明 |
| --- | --- |
| `init(opts, callback?)` | 初始化控制器，资源加载完成后执行 `callback`。 |
| `update(dt?)` | 每帧更新移动、碰撞和动画；内部已接管传入的相机控制器，渲染循环中无需再调用 `controls.update()`。 |
| `destroy()` | 销毁控制器并移除事件监听。 |
| `reset(pos?)` | 将角色重置到指定位置或初始位置。 |
| `switchPlayerModel(model)` | 运行时切换角色模型，并保留当前位置和朝向。 |
| `loadVehicleModel(opts)` | 加载车辆，可重复调用加载多辆车。 |
| `changeView()` | 切换第一 / 第三人称视角。 |
| `setFirstPersonCamera(vertAngle?)` | 直接进入第一人称，可指定初始垂直角度。 |
| `buildStaticCollider(sources?)` | 构建静态碰撞体；不传则遍历整个场景。 |
| `addDynamicCollider(source)` | 注册动态碰撞体（如可移动平台）。 |
| `removeDynamicCollider(source)` | 移除已注册的动态碰撞体。 |
| `clearDynamicColliders()` | 移除所有动态碰撞体。 |

## 状态获取

| 方法 | 返回内容 |
| --- | --- |
| `getPosition()` | 当前角色位置。 |
| `getVelocity()` | 当前角色速度，类型为 `THREE.Vector3`。 |
| `getIsFirstPerson()` | 当前是否为第一人称。 |
| `getIsFlying()` | 当前是否处于飞行模式。 |
| `getIsOnGround()` | 当前是否在地面上。 |
| `getCurrentDelta()` | 当前帧实际使用的时间步长，已进行帧长钳制并应用 `timeScale`。 |
| `getControllerMode()` | 控制模式，`0` 为人物，`1` 为车辆。 |
| `getPlayerModel()` | 当前加载的人物模型对象。 |
| `getPlayerCapsule()` | 角色胶囊体网格。 |
| `getActiveVehicle()` | 当前正在使用的车辆实例。 |
| `getAllVehicles()` | 所有已加载车辆实例。 |
| `getCollider()` | 用于 BVH 检测的合并碰撞网格。 |
| `getCurrentPlayerAnimationName()` | 当前播放的动画片段名，没有则返回 `null`。 |
| `getCenterScreenRaycastHit()` | 屏幕中心射线检测结果，适合做瞄准或交互。 |
| `getActiveDynamicCollider()` | 当前玩家站立的动态碰撞体，不在动态碰撞体上时返回 `null`。 |
| `getCurrentLocomotionSet()` | 当前移动动作组名。 |

## 输入与运行时控制

| 方法 | 说明 |
| --- | --- |
| `setInput(input)` | 注入外部输入状态，适合手柄或自定义按键系统。 |
| `setKeyMap(map?)` | 运行时自定义键位；不传则恢复默认键位（见[自定义键位](#自定义键位)）。 |
| `setMouseSensitivity(v)` | 设置鼠标灵敏度。 |
| `setPlayerScale(v)` | 动态修改角色缩放，并同步碰撞相关参数。 |
| `setPlayerSpeed(v)` | 设置移动速度。 |
| `setPlayerFlySpeed(v)` | 设置飞行速度。 |
| `setJumpHeight(v)` | 设置跳跃高度。 |
| `setGravity(v)` | 设置重力。 |
| `setMinCamDistance(v)` | 设置第三人称最小镜头距离。 |
| `setMaxCamDistance(v)` | 设置第三人称最大镜头距离。 |
| `setCamLookAtHeightRatio(v)` | 设置第三人称相机看向点高度比例（0=底部，1=顶部）。 |
| `setCamOverShoulderOffsetRatio(v)` | 设置第三人称相机过肩视角横向偏移比例。 |
| `setThirdMouseMode(v)` | 设置第三人称鼠标模式：[0 | 1 | 2 | 3 | 4 | 5]。 |
| `setEnableZoom(v)` | 设置是否允许镜头缩放。 |
| `setOverShoulderView(v)` | 开关过肩视角偏移。 |
| `setDebug(v)` | 开关碰撞体调试显示。 |
| `setEnableToward(v)` | 开关鼠标驱动的朝向 / 视角更新。 |
| `setSkipCapsuleCollision(v)` | `v` 为 `true` 时临时跳过玩家胶囊体碰撞检测。 |

### 输入监听

`init()` 完成后键盘和鼠标监听已默认开启，无需手动调用。以下两个方法用于运行时临时关闭再恢复监听。

```ts
player.offAllEvent(); // 关闭键盘和鼠标输入监听
player.onAllEvent();  // 重新开启键盘和鼠标输入监听
```

### 默认键位

| 动作 | 默认键 | 功能 |
| --- | --- | --- |
| `forward` | `W` / `ArrowUp` | 前进 |
| `backward` | `S` / `ArrowDown` | 后退 |
| `left` | `A` / `ArrowLeft` | 左移 |
| `right` | `D` / `ArrowRight` | 右移 |
| `sprint` | `Shift` | 冲刺 |
| `jump` | `Space` | 跳跃 |
| `toggleView` | `V` | 切换视角 |
| `toggleFly` | `F` | 切换飞行模式 |
| `toggleVehicle` | `E` | 上车 / 下车 |
| — | 鼠标移动 | 控制视角 |

### 自定义键位

通过 `keyMap` 可以把上表的任意动作改绑到其它按键，或禁用某个动作。键名使用 [`KeyboardEvent.code`](https://developer.mozilla.org/zh-CN/docs/Web/API/KeyboardEvent/code)（如 `"KeyE"`、`"ArrowUp"`、`"Space"`，注意是 `"KeyE"` 而非 `"e"`）。

每个动作三种取值：

- **不填** → 使用默认键
- **字符串 / 字符串数组** → 替换为指定按键（数组可绑定多个键）
- **`null`** → 禁用该动作（任何键都不会触发）

初始化时配置：

```ts
await player.init({
    // ...
    keyMap: {
        forward: "KeyE",          // 改为按 E 前进（替换默认 W / ↑）
        jump: null,               // 禁用跳跃
        left: ["KeyA", "KeyJ"],   // 同时绑定 A 和 J
        // 其余动作未填，保持默认键
    },
});
```

运行时切换键位方案：

```ts
player.setKeyMap({ forward: "KeyI", backward: "KeyK" }); // 应用新键位
player.setKeyMap();                                      // 恢复全部默认
```

### `setInput`

```ts
player.setInput({
    moveX: number,        // 水平移动轴，范围 -1～1，正数向右
    moveY: number,        // 纵向移动轴，范围 -1～1，正数向前
    lookDeltaX: number,   // 视角水平增量，通常来自 mousemove 的 movementX
    lookDeltaY: number,   // 视角垂直增量，通常来自 mousemove 的 movementY
    jump: boolean,        // 跳跃，持续状态（true=按下，false=松开）；飞行时控制上升
    shift: boolean,       // 冲刺/加速，持续状态（true=按下，false=松开）
    toggleView: boolean,  // 触发式，传 true 切换第一/第三人称视角
    toggleFly: boolean,   // 触发式，传 true 切换飞行模式
    toggleVehicle: boolean, // 触发式，传 true 上车 / 下车
});
```

## 动画

| 方法 | 说明 |
| --- | --- |
| `playPlayerAnimationByName(name, fade?)` | 按动画片段名直接播放角色动画。 |
| `registerAnimation(key, clipName, opts?)` | 注册自定义动画片段。 |
| `playAnimation(key, opts?)` | 播放已注册的自定义动画。 |
| `registerLocomotionSet(setName, map)` | 注册一套移动动画集合，用于替换内置移动动画。 |
| `switchLocomotionSet(setName, fade?)` | 切换到指定的移动动画集合。 |

### `registerAnimation`

```ts
player.registerAnimation(key, clipName, {
    loop?: boolean,              // 是否循环播放，默认 true
    timeScale?: number,          // 动画播放放缩，默认 1
    duration?: number,           // 动画播放时长，默认 0
    clampWhenFinished?: boolean, // 是否在播放结束后将动画时间重置为 0，默认 false
    onFinished?: () => void,     // 动画播放结束后触发
});
```

`duration` 与 `timeScale` 同时设置时，`duration` 优先生效。

### `playAnimation`

```ts
player.playAnimation(key, {
    fade?: number,          // 过渡时长（秒），默认 0.18
    force?: boolean,        // 为 true 时强制从头重播，即使当前已在播放该动画
    returnToPrev?: boolean, // 仅对 LoopOnce 动画生效，播放结束后自动恢复上一个动画状态
});
```

### `registerLocomotionSet`

支持的 key：`idle` | `walking` | `walking_backward` | `running` | `jumping` | `flyidle` | `flying`，填写的 key 会替换对应内置动画，未填的保持原有动画。

```ts
player.registerLocomotionSet("combat", {
    idle: "CombatIdle",
    walking: "CombatWalk",
    walking_backward: "CombatBack",
    running: "CombatRun",
    jumping: "CombatJump",
    flyidle: "CombatFlyIdle",
    flying: "CombatFly",
});
```

## 事件

```ts
player.onAnimationChange = (name, action) => {};   // 角色当前动画切换时触发
player.onBeforeViewChange = (isFirstPerson) => {}; // 第一 / 第三人称切换前触发
player.onViewChange = (isFirstPerson) => {};       // 第一 / 第三人称切换后触发
player.onGroundChange = (onGround) => {};          // 落地状态变化时触发
player.onVehicleEnter = (vehicle) => {};           // 上车完成后触发
player.onVehicleExit = (vehicle) => {};            // 下车完成后触发
player.onTowardChange = (dx, dy, speed) => {};     // 朝向 / 视角输入更新时触发
```

## 字段说明

### `PlayerControllerOptions`

| 字段 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `scene` | `THREE.Scene` | 是 | — | three.js 场景实例。 |
| `camera` | `THREE.PerspectiveCamera` | 是 | — | three.js 相机实例。 |
| `controls` | `any` | 是 | — | 外部相机控制器，通常为 `OrbitControls`。 |
| `playerModelConfig` | `PlayerModelOptions` | 是 | — | 角色模型与参数配置。 |
| `initPos` | `THREE.Vector3` | 否 | `(0, 0, 0)` | 初始出生点。 |
| `mouseSensitivity` | `number` | 否 | `5` | 鼠标灵敏度。 |
| `minCamDistance` | `number` | 否 | `100` | 第三人称最小镜头距离。 |
| `maxCamDistance` | `number` | 否 | `440` | 第三人称最大镜头距离。 |
| `staticCollider` | `THREE.Object3D \| THREE.Object3D[]` | 否 | — | 静态碰撞体来源；不传则遍历整个场景。 |
| `dynamicCollider` | `THREE.Object3D \| THREE.Object3D[]` | 否 | — | 初始化时注册的动态碰撞体。 |
| `isShowMobileControls` | `boolean` | 否 | `true` | 是否在移动端显示虚拟控制 UI。 |
| `mobileControls` | `MobileControlsOptions` | 否 | 全部显示 | 移动端按钮显隐、图标与布局配置。 |
| `thirdMouseMode` | `0 \| 1 \| 2 \| 3 \| 4 \| 5` | 否 | `1` | 第三人称视角下的鼠标控制模式（0:隐藏鼠标，控制朝向及视角；1:隐藏鼠标，仅控制视角；2:显示鼠标，拖拽控制朝向及视角；3:显示鼠标，拖拽仅控制视角；4:显示鼠标，拖拽控制视角且人物朝向跟随相机水平方向；5:隐藏鼠标，控制视角且人物朝向跟随相机水平方向） |
| `enableZoom` | `boolean` | 否 | `false` | 是否允许滚轮缩放。 |
| `enableOverShoulderView` | `boolean` | 否 | `false` | 是否启用过肩视角。 |
| `camOverShoulderOffsetRatio` | `number` | 否 | `0.2` | 第三人称相机过肩视角横向偏移比例。 |
| `isFirstPerson` | `boolean` | 否 | `false` | 初始化时是否直接进入第一人称。 |
| `enableSpringCamera` | `boolean` | 否 | `false` | 是否启用弹簧相机（目标点以弹簧阻尼跟随角色）。 |
| `springCameraTime` | `number` | 否 | `0.05` | 弹簧平滑时间（秒），越小跟随越紧。 |
| `camLookAtHeightRatio` | `number` | 否 | `0.8` | 第三人称相机看向点高度比例（0=胶囊底部，1=顶部）。 |
| `timeScale` | `number` | 否 | `1` | 时间缩放系数，<1 慢动作，>1 快进。 |
| `keyMap` | `KeyMap` | 否 | 默认键位 | 自定义键位映射，详见[自定义键位](#自定义键位)。 |

### `PlayerModelOptions`

| 字段 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `url` | `string` | 是 | — | 人物模型路径（GLB/GLTF）。 |
| `scale` | `number` | 是 | — | 人物模型缩放。 |
| `idleAnim` | `string` | 是 | — | Idle 动画名。 |
| `walkAnim` | `string` | 是 | — | Walk 动画名。 |
| `runAnim` | `string` | 是 | — | Run 动画名。 |
| `jumpAnim` | `string \| [string, string, string]` | 是 | — | 跳跃动画名。传字符串播放单一动画；传三元素数组 `[起跳, 循环, 落地]` 分三阶段播放，落地后自动衔接移动动画。 |
| `leftWalkAnim` | `string` | 否 | `walkAnim` | 左移动画名，不填则复用 `walkAnim`。 |
| `rightWalkAnim` | `string` | 否 | `walkAnim` | 右移动画名，不填则复用 `walkAnim`。 |
| `backwardAnim` | `string` | 否 | `walkAnim` | 后退动画名，不填则复用 `walkAnim`。 |
| `flyAnim` | `string` | 否 | `idleAnim` | 飞行动画名，不填则复用 `idleAnim`。 |
| `flyIdleAnim` | `string` | 否 | `idleAnim` | 飞行待机动画名，不填则复用 `idleAnim`。 |
| `flyHoverForwardAnim` | `string` | 否 | `flyAnim` | 飞行前进时的悬停动画名，不填则复用 `flyAnim`。 |
| `flyHoverBackAnim` | `string` | 否 | `flyIdleAnim` | 飞行后退时的悬停动画名，不填则复用 `flyIdleAnim`。 |
| `flyHoverLeftAnim` | `string` | 否 | `flyIdleAnim` | 飞行左移时的悬停动画名，不填则复用 `flyIdleAnim`。 |
| `flyHoverRightAnim` | `string` | 否 | `flyIdleAnim` | 飞行右移时的悬停动画名，不填则复用 `flyIdleAnim`。 |
| `flyHoverUpAnim` | `string` | 否 | `flyIdleAnim` | 飞行上升时的悬停动画名，不填则复用 `flyIdleAnim`。 |
| `flyHoverDownAnim` | `string` | 否 | `flyIdleAnim` | 飞行下降时的悬停动画名，不填则复用 `flyIdleAnim`。 |
| `enterCarAnim` | `string` | 否 | — | 上车动画名；使用车辆功能时必须配置。 |
| `exitCarAnim` | `string` | 否 | — | 下车动画名；使用车辆功能时必须配置。 |
| `gravity` | `number` | 否 | `-2400` | 重力基准值（按 `scale` 缩放）。 |
| `jumpHeight` | `number` | 否 | `600` | 跳跃高度基准值（按 `scale` 缩放）。 |
| `speed` | `number` | 否 | `200` | 移动速度基准值（按 `scale` 缩放）。 |
| `flySpeed` | `number` | 否 | `2100` | 飞行速度基准值（按 `scale` 缩放）。 |
| `rotateY` | `number` | 否 | `0` | 人物初始朝向（弧度），用于改变模型初始化面朝方向。 |
| `headBoneName` | `string` | 否 | — | 头部骨骼或节点名称，用于第一人称相机挂载。 |
| `firstPersonCameraOffset` | `[number, number, number]` | 否 | 有内置默认值 | 第一人称相机局部偏移；有 `headBoneName` 则相对头骨骼，否则相对胶囊体。 |
| `capsuleRadiusRatio` | `number` | 否 | `1` | 胶囊体半径倍率，用于微调碰撞宽度。 |
| `acceleration` | `number` | 否 | `30` | XZ 方向加速响应速度，值越大加速越快。 |
| `deceleration` | `number` | 否 | `30` | XZ 方向减速响应速度，值越大停止越快。 |

### `MobileControlsOptions`

| 字段 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `joystick` | `boolean` | 否 | `true` | 是否显示支持 360° 连续方向的摇杆。 |
| `jump` | `boolean \| JumpButtonOptions` | 否 | `true` | 跳跃/刹车按钮；`false` 隐藏，对象可自定义图片和布局。 |
| `fly` | `boolean \| MobileButtonOptions` | 否 | `true` | 飞行按钮；`false` 隐藏，对象可自定义图片和布局。 |
| `view` | `boolean \| MobileButtonOptions` | 否 | `true` | 视角切换按钮；`false` 隐藏，对象可自定义图片和布局。 |
| `vehicle` | `boolean \| MobileButtonOptions` | 否 | `true` | 上下车按钮；`false` 隐藏，对象可自定义图片和布局。 |

### `MobileButtonOptions` / `JumpButtonOptions`

| 字段 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `left` / `right` | `number` | 否 | 内置位置 | 按钮距离左侧或右侧的位置（px）。设置 `left` 且未设置 `right` 时会清除默认右侧定位。 |
| `top` / `bottom` | `number` | 否 | 内置位置 | 按钮距离顶部或底部的位置（px）。设置 `top` 且未设置 `bottom` 时会清除默认底部定位。 |
| `size` | `number` | 否 | `56` | 圆形按钮直径（px）。 |
| `icon` | `string` | 否 | 英文标签 | 自定义图片 URL。 |
| `brakeIcon` | `string` | 否 | `BRAKE` 标签 | 仅用于 `JumpButtonOptions`，设置车辆模式下的刹车图片 URL。 |

### `VehicleOptions`

| 字段 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `url` | `string` | 是 | — | 车辆模型路径（GLB/GLTF）。 |
| `position` | `THREE.Vector3` | 是 | — | 车辆初始世界坐标。 |
| `wheelsNames` | `string[]` | 是 | — | 车轮节点名数组，顺序为左前、右前、左后、右后。 |
| `scale` | `number` | 否 | `1` | 车辆模型缩放。 |
| `animations.openDoorAnim` | `string` | 否 | — | 车门开关动画名。 |
| `boardingPoint` | `THREE.Vector3` | 是 | — | 上车点，局部坐标。 |
| `seatOffset` | `THREE.Vector3` | 否 | `(0, 0, 0)` | 角色上车后座位偏移。 |
| `chassisRatio` | `number` | 否 | `0.2` | 底盘高度比例。 |
| `suspensionRestLengthRatio` | `number` | 否 | `0.2` | 悬挂静止长度比例。 |
| `followVehicleDirection` | `boolean` | 否 | `true` | 驾驶时镜头是否跟随车辆朝向。 |
| `speedMultiplier` | `number` | 否 | `1` | 单车速度倍率。 |

# 反馈

如果你有任何问题或者好的想法欢迎提交[issue](https://github.com/hh-hang/three-player-controller/issues)

# 致谢

[three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh)

[three](https://github.com/mrdoob/three.js)

[npm]: https://img.shields.io/npm/v/three-player-controller
[npm-url]: https://www.npmjs.com/package/three-player-controller
[github]: https://img.shields.io/badge/-hh--hang-181717?style=flat&logo=github&logoColor=white&labelColor=888
[github-url]: https://github.com/hh-hang
[x]: https://img.shields.io/badge/-vgyuvhang-000000?style=flat&logo=x&logoColor=white&labelColor=888
[x-url]: https://x.com/vgyuvhang
