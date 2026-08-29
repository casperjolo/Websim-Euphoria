import { resolve } from "path";
import { defineConfig } from "vite";

export default defineConfig({
    base: "/three-player-controller/",
    root: resolve(__dirname, "example"),
    server: {
        host: true,
        // Arena's live preview is served through a generated host.
        allowedHosts: true,
    },
    optimizeDeps: {
        exclude: ["tellux", "three-mesh-bvh"],
    },
    build: {
        outDir: resolve(__dirname, "docs"),
        emptyOutDir: true,
        rollupOptions: {
            input: {
                main: resolve(__dirname, "example", "index.html"),
                gta: resolve(__dirname, "example", "gta.html"),
                gltf: resolve(__dirname, "example", "glTF.html"),
                tiles: resolve(__dirname, "example", "3dtilesScene.html"),
                dgs: resolve(__dirname, "example", "3dgs.html"),
                shooting: resolve(__dirname, "example", "shooting", "shooting.html"),
                footik: resolve(__dirname, "example", "footIK.html"),
                showcase: resolve(__dirname, "example", "showcase.html"),
            },
        },
    },
});
