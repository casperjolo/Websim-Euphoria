# Contributing Guide

Thanks for your interest in [three-player-controller](https://github.com/hh-hang/three-player-controller). This project is a lightweight player controller for three.js. Contributions via Issues, Discussions, or Pull Requests are welcome.

## Ways to Contribute

You can help by:

- Reporting bugs or suggesting features
- Improving docs and examples
- Fixing bugs or optimizing performance
- Enhancing collision, camera, animation, vehicle, or mobile controls

Please search or open an [Issue](https://github.com/hh-hang/three-player-controller/issues) before large code changes to avoid duplicated work.

## Development Setup

### Prerequisites

- Node.js 20+
- npm

### Run locally

```bash
git clone https://github.com/hh-hang/three-player-controller.git
cd three-player-controller
npm install
npm run dev
```

Open: `http://localhost:5173/three-player-controller/`

### Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the example site (Vite) — use this for day-to-day work |
| `npm run build` | Locally verify the library builds |

## Project Layout

```text
├── src/                 # Library source (TypeScript)
│   ├── playerController.ts
│   ├── systems/         # Input / camera / animation / vehicle systems
│   ├── utils/           # Collision, mobile UI, vehicle loading helpers
│   └── types/           # Type definitions
├── example/             # Demo pages and assets
├── package.json
├── tsup.config.ts       # Library build config
└── vite.config.ts       # Example site config
```

- Library changes go in `src/` (entry: `src/index.ts`)
- Demo / usage changes go in `example/`
- Peer deps: `three`, `three-mesh-bvh`; optional vehicle peer: `@dimforge/rapier3d-compat`

## Pull Requests

1. Fork the repo and create a branch from `master`
2. Keep the PR focused: one issue or one small feature per PR
3. Verify locally:
   - `npm run build` succeeds
   - Related demos work under `npm run dev` (standard / fly / vehicle / mobile, as applicable)
4. Update `README.md` / `README_En.md` if public APIs change
5. Use clear commit messages that explain *why*, not only *what*
6. Open a PR against `master` and include:
   - Motivation / background
   - How you tested
   - Linked Issue (if any)

Pushes to `master` trigger GitHub Actions to build examples and deploy GitHub Pages.

## Issues

For bugs, please include:

- three.js / three-player-controller versions
- Browser and OS
- Minimal reproduction steps or a runnable demo
- Expected vs actual behavior
- Console errors (if any)

For feature requests, describe the use case and why existing APIs fall short.

## Coding Guidelines

- Prefer TypeScript with solid types for public APIs
- Keep public APIs stable; call out breaking changes clearly in the PR
- Prefer optional / configurable behavior over changing defaults unexpectedly
- Manually verify collision, camera, and input changes in examples; watch performance in large scenes
- Do not commit unrelated files, local configs, or oversized assets unless the demo truly needs them

## Code of Conduct

Be respectful and constructive. Focus on the technical problem.

## License

This project is licensed under the [MIT License](LICENSE). Contributions are accepted under the same license.

Questions? Open an [Issue](https://github.com/hh-hang/three-player-controller/issues).