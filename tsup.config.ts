import { defineConfig } from "tsup";

export default defineConfig({
    entry: {
        index: "src/index.ts",
        "foot-ik": "src/foot-ik.ts",
    },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    clean: true,
    external: ["three", "three-mesh-bvh", "@dimforge/rapier3d-compat"],
    target: "es2020",
    minify: false,
});
