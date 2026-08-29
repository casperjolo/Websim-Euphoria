import { resolve } from "path";
import { defineConfig } from "vite";

export default defineConfig({
    // Relative URLs keep the scene working on GitHub Pages forks and Arena previews.
    base: "./",
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
            },
        },
    },
});
