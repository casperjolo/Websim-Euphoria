import * as THREE from "three";
import { ContactPoint } from "./ContactPoint";

/** 同一法线簇下的接触点集合。 */
export class ContactManifold {
    normal = new THREE.Vector3(); // 平均接触法线
    normalSum = new THREE.Vector3(); // 法线累加，用于求平均
    contacts: ContactPoint[] = []; // 本簇接触点

    /** 清空接触点与法线。 */
    clear(): void {
        this.contacts.length = 0;
        this.normal.set(0, 1, 0);
        this.normalSum.set(0, 0, 0);
    }
}
