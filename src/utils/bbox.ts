import * as THREE from "three";

const _vertex = new THREE.Vector3();
/** 获取物体世界包围盒及中心、尺寸。按世界坐标顶点扩盒子。 */
export function getBbox(object: THREE.Object3D) {
    object.updateMatrixWorld(true);
    const bbox = new THREE.Box3();
    object.traverse(child => {
        const geometry = (child as THREE.Mesh).geometry;
        const position = geometry?.attributes?.position;
        if (!position) return;
        const matrixWorld = child.matrixWorld;
        for (let i = 0, n = position.count; i < n; i++) {
            _vertex.fromBufferAttribute(position, i).applyMatrix4(matrixWorld);
            bbox.expandByPoint(_vertex);
        }
    });
    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    bbox.getCenter(center);
    bbox.getSize(size);
    return { bbox, center, size };
}
