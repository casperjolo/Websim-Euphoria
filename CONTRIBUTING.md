中文 | [English](CONTRIBUTING_En.md)

# 贡献指南

感谢你对 [three-player-controller](https://github.com/hh-hang/three-player-controller) 的关注。本项目是基于 three.js 的轻量级玩家控制器，欢迎通过 Issue、讨论或 Pull Request 参与改进。

## 如何参与

你可以贡献的内容包括但不限于：

- 报告 Bug 或提出功能建议
- 改进文档与示例
- 修复缺陷、优化性能
- 完善碰撞、相机、动画、车辆、移动端控制等能力

在动手改代码前，建议先在 [Issues](https://github.com/hh-hang/three-player-controller/issues) 里搜索或开一个 Issue，说明你的想法，避免重复劳动。

## 开发环境

### 前置要求

- Node.js 20+
- npm

### 本地运行

```bash
git clone https://github.com/hh-hang/three-player-controller.git
cd three-player-controller
npm install
npm run dev
```

浏览器访问：`http://localhost:5173/three-player-controller/`

### 常用脚本

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 启动示例站点（Vite），日常开发主要用这个 |
| `npm run build` | 本地验证库能否成功构建 |

## 目录结构

```text
├── src/                 # 库源码（TypeScript）
│   ├── playerController.ts
│   ├── systems/         # 输入 / 相机 / 动画 / 车辆等子系统
│   ├── utils/           # 碰撞、移动端控制、车辆加载等工具
│   └── types/           # 类型定义
├── example/             # 演示页面与资源
├── package.json
├── tsup.config.ts       # 库构建配置
└── vite.config.ts       # 示例站点配置
```

- 库代码请改 `src/`，入口为 `src/index.ts`
- 演示与用法相关改动放在 `example/`
- peer 依赖：`three`、`three-mesh-bvh`；车辆功能可选依赖 `@dimforge/rapier3d-compat`

## 提交 Pull Request

1. Fork 本仓库并创建基于 `master` 的分支
2. 保持改动聚焦：一次 PR 解决一个问题或完成一个小功能
3. 本地验证：
   - `npm run build` 能成功构建
   - 相关示例在 `npm run dev` 下行为正确（人物 / 飞行 / 车辆 / 移动端等）
4. 如涉及 API 变更，请同步更新 `README.md` / `README_En.md`
5. 提交清晰的 commit message，说明「为什么改」而不只是「改了什么」
6. 向 `master` 发起 Pull Request，并在描述中说明：
   - 改动目的与背景
   - 测试方式
   - 关联的 Issue（如有）

合并后，推送到 `master` 会触发 GitHub Actions，自动构建示例并部署到 GitHub Pages。

## Issue 建议

提交 Bug 时尽量包含：

- three.js / three-player-controller 版本
- 浏览器与操作系统
- 最小复现步骤或可运行示例
- 期望行为与实际行为
- 控制台报错（如有）

提交功能建议时请说明使用场景，以及现有 API 为何不够用。

## 代码约定

- 使用 TypeScript，尽量补全公开 API 的类型
- 保持对外 API 稳定；破坏性变更需在 PR 中明确说明
- 新功能尽量可配置、可关闭，避免强行改变默认行为
- 碰撞、相机、输入相关改动请在示例中手动验证，注意帧率与大场景性能
- 不要提交无关文件、本地配置，或体积过大的测试资源（除非示例确实需要）

## 行为准则

请保持友善、尊重的交流。就事论事，聚焦技术问题本身。

## 许可证

本项目采用 [MIT License](LICENSE)。你提交的贡献将默认按相同许可证授权。

如有疑问，欢迎直接开 [Issue](https://github.com/hh-hang/three-player-controller/issues)。
