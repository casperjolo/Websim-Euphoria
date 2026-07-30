import * as THREE from "three";

/** 获取物体世界包围盒及中心、尺寸。 */
export function getBbox(object: THREE.Object3D) {
    const bbox = new THREE.Box3().setFromObject(object);
    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    bbox.getCenter(center);
    bbox.getSize(size);
    return { bbox, center, size };
}
