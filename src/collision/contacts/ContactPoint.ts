import * as THREE from "three";

export const CONTACT_SKIN = 0.002;

export type RawContact = {
    point: THREE.Vector3;
    normal: THREE.Vector3;
    penetration: number;
};

/** 约束求解用的单个接触点。 */
export class ContactPoint {
    worldPoint = new THREE.Vector3();
    localPoint = new THREE.Vector3();
    penetration = 0;
    biasVelocity = 0;
    normalImpulse = 0;
    tangentImpulse1 = 0;
    tangentImpulse2 = 0;
    tangent1 = new THREE.Vector3();
    tangent2 = new THREE.Vector3();

    copyFrom(other: ContactPoint): void {
        this.worldPoint.copy(other.worldPoint);
        this.localPoint.copy(other.localPoint);
        this.penetration = other.penetration;
        this.normalImpulse = other.normalImpulse;
        this.tangentImpulse1 = other.tangentImpulse1;
        this.tangentImpulse2 = other.tangentImpulse2;
        this.tangent1.copy(other.tangent1);
        this.tangent2.copy(other.tangent2);
    }

    resetImpulses(): void {
        this.normalImpulse = 0;
        this.tangentImpulse1 = 0;
        this.tangentImpulse2 = 0;
    }
}
