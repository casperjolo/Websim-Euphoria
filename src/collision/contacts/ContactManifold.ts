import * as THREE from "three";
import { ContactPoint } from "./ContactPoint";

/** 同一法线簇下的接触点集合。 */
export class ContactManifold {
    normal = new THREE.Vector3();
    normalSum = new THREE.Vector3();
    contacts: ContactPoint[] = [];

    clear(): void {
        this.contacts.length = 0;
        this.normal.set(0, 1, 0);
        this.normalSum.set(0, 0, 0);
    }
}
