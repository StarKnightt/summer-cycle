import * as THREE from "three";
import { G, REFL, shadowDepthMaterial } from "./materials";

/** Render layers: 0 = main view, 1 = casts sun shadow, 2 = appears in paddy reflections. */
export const LAYER_SHADOW = 1;
export const LAYER_REFLECT = 2;

export function onLayers(o: THREE.Object3D, ...layers: number[]): void {
  o.traverse((c) => {
    for (const l of layers) c.layers.enable(l);
  });
}

/**
 * One directional shadow map that follows the rider (centred ahead of her, where the camera
 * looks). Texel-snapped so shadows don't shimmer as the frustum slides.
 */
export class SunShadow {
  readonly rt: THREE.WebGLRenderTarget;
  readonly cam: THREE.OrthographicCamera;
  readonly mat = shadowDepthMaterial();
  private readonly size: number;
  private readonly half: number;
  /** Direction toward the light for the shadow camera; defaults to the shading sun `uSunDir`. */
  dir: THREE.Vector3 | null = null;
  private bias = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);

  constructor(size = 2048, half = 55) {
    this.size = size;
    this.half = half;
    this.rt = new THREE.WebGLRenderTarget(size, size, {
      depthTexture: new THREE.DepthTexture(size, size, THREE.UnsignedIntType),
      type: THREE.UnsignedByteType,
    });
    this.rt.depthTexture!.minFilter = THREE.NearestFilter;
    this.rt.depthTexture!.magFilter = THREE.NearestFilter;
    this.cam = new THREE.OrthographicCamera(-half, half, half, -half, 1, 320);
    this.cam.layers.set(LAYER_SHADOW);
    G.uShadowMap.value = this.rt.depthTexture;
    G.uShadowTexel.value.set(1 / size, 1 / size);
    G.uShadowRange.value = 319;
    G.uShadowHalf.value = half;
  }

  update(renderer: THREE.WebGLRenderer, scene: THREE.Scene, center: THREE.Vector3): void {
    const sun = this.dir ?? G.uSunDir.value;
    // Snap the centre to the texel grid in light space.
    const texel = (this.half * 2) / this.size;
    const lightRot = new THREE.Matrix4().lookAt(sun, new THREE.Vector3(), new THREE.Vector3(0, 1, 0));
    const inv = lightRot.clone().invert();
    const c = center.clone().applyMatrix4(inv);
    c.x = Math.round(c.x / texel) * texel;
    c.y = Math.round(c.y / texel) * texel;
    c.applyMatrix4(lightRot);
    this.cam.position.copy(c).addScaledVector(sun, 160);
    this.cam.up.set(0, 1, 0);
    this.cam.lookAt(c);
    this.cam.updateMatrixWorld();
    this.cam.updateProjectionMatrix();
    G.uShadowMat.value.copy(this.bias).multiply(this.cam.projectionMatrix).multiply(this.cam.matrixWorldInverse);
    G.uShadowCenter.value.copy(center);
    G.uShadowOn.value = 1;

    const prevOverride = scene.overrideMaterial;
    scene.overrideMaterial = this.mat;
    renderer.setRenderTarget(this.rt);
    renderer.clear();
    renderer.render(scene, this.cam);
    scene.overrideMaterial = prevOverride;
    renderer.setRenderTarget(null);
  }
}

/**
 * Planar mirror for the flooded paddies (same maths as three's Reflector: mirrored virtual camera
 * + oblique near-plane clip), rendered at reduced resolution with only the reflect layer.
 */
export class PaddyReflection {
  readonly rt: THREE.WebGLRenderTarget;
  readonly cam = new THREE.PerspectiveCamera();
  private tex = new THREE.Matrix4();
  private readonly normal = new THREE.Vector3(0, 1, 0);

  constructor(w: number, h: number) {
    this.rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, count: 2 });
    this.cam.layers.set(LAYER_REFLECT);
    REFL.uRefl.value = this.rt.textures[0];
    REFL.uReflOn.value = 1;
  }

  setSize(w: number, h: number): void {
    this.rt.setSize(w, h);
  }

  update(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, planeY: number): void {
    const n = this.normal;
    const mirror = new THREE.Vector3(0, planeY, 0);
    mirror.x = camera.position.x;
    mirror.z = camera.position.z;
    const camPos = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
    const view = new THREE.Vector3().subVectors(mirror, camPos);
    if (view.dot(n) > 0) return;
    view.reflect(n).negate().add(mirror);
    const rot = new THREE.Matrix4().extractRotation(camera.matrixWorld);
    const look = new THREE.Vector3(0, 0, -1).applyMatrix4(rot).add(camPos);
    const target = new THREE.Vector3().subVectors(mirror, look).reflect(n).negate().add(mirror);
    const vc = this.cam;
    vc.position.copy(view);
    vc.up.set(0, 1, 0).applyMatrix4(rot).reflect(n);
    vc.lookAt(target);
    vc.far = camera.far;
    vc.near = camera.near;
    vc.updateMatrixWorld();
    vc.projectionMatrix.copy(camera.projectionMatrix);

    this.tex.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.tex.multiply(vc.projectionMatrix).multiply(vc.matrixWorldInverse);
    REFL.uReflMat.value.copy(this.tex);
    REFL.uReflY.value = planeY;

    // Oblique clip plane: drop everything below the water surface.
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, mirror);
    plane.applyMatrix4(vc.matrixWorldInverse);
    const clip = new THREE.Vector4(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    const pm = vc.projectionMatrix.elements;
    const q = new THREE.Vector4(
      (Math.sign(clip.x) + pm[8]) / pm[0],
      (Math.sign(clip.y) + pm[9]) / pm[5],
      -1,
      (1 + pm[10]) / pm[14],
    );
    clip.multiplyScalar(2 / clip.dot(q));
    pm[2] = clip.x;
    pm[6] = clip.y;
    pm[10] = clip.z + 1 - 0.003;
    pm[14] = clip.w;
    vc.projectionMatrixInverse.copy(vc.projectionMatrix).invert();

    renderer.setRenderTarget(this.rt);
    renderer.clear();
    G.uNoFringe.value = 1;
    renderer.render(scene, vc);
    G.uNoFringe.value = 0;
    renderer.setRenderTarget(null);
  }
}
