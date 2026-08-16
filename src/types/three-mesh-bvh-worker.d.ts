declare module "three-mesh-bvh/src/workers/GenerateMeshBVHWorker.js" {
    export class GenerateMeshBVHWorker {
        generate(geometry: import("three").BufferGeometry, options?: object): Promise<import("three-mesh-bvh").MeshBVH>;
        dispose(): void;
        running: boolean;
    }
}
