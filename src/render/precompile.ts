import * as THREE from "three";
import type { Post } from "./post";
import type { SunShadow } from "./lightpasses";

/**
 * Compile every shader variant the first frame will use (scene into the MRT target, the shadow
 * override on each mesh kind, every post pass offscreen + on screen) through the parallel-compile
 * path, reporting 0…1 as programs finish, so the first real frame does not stall for seconds.
 */
export async function precompile(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  post: Post,
  shadow: SunShadow,
  onProgress: (f: number) => void,
  pause: () => Promise<void>,
): Promise<void> {
  const prev = renderer.getRenderTarget();

  renderer.setRenderTarget(post.mrt);
  renderer.compile(scene, camera);
  await pause();

  // The shadow pass renders the scene with an override material: the variants differ per mesh kind.
  const swapped: [THREE.Mesh, THREE.Material | THREE.Material[]][] = [];
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.layers.test(shadow.cam.layers)) {
      swapped.push([m, m.material]);
      m.material = shadow.mat;
    }
  });
  renderer.setRenderTarget(shadow.rt);
  renderer.compile(scene, shadow.cam);
  for (const [m, mat] of swapped) m.material = mat;
  await pause();

  const quads = new THREE.Scene();
  const plane = new THREE.PlaneGeometry(2, 2);
  const seen = new Set<THREE.Material>();
  const take = (v: unknown) => {
    if (v instanceof THREE.Material && !seen.has(v)) {
      seen.add(v);
      quads.add(new THREE.Mesh(plane, v));
    }
  };
  for (const pass of post.composer.passes)
    for (const v of Object.values(pass)) {
      if (Array.isArray(v)) v.forEach(take);
      else take(v);
      take((v as { material?: unknown } | null)?.material);
    }
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  renderer.setRenderTarget(post.composer.renderTarget1);
  renderer.compile(quads, ortho);
  renderer.setRenderTarget(null);
  renderer.compile(quads, ortho);
  renderer.setRenderTarget(prev);
  plane.dispose();

  const programs = renderer.info.programs ?? [];
  const pending = () => programs.filter((p) => !(p as unknown as { isReady(): boolean }).isReady()).length;
  const total = Math.max(1, programs.length);
  for (let left = pending(); left > 0; left = pending()) {
    onProgress(1 - left / total);
    await new Promise((r) => setTimeout(r, 40));
  }
  onProgress(1);
}

/**
 * Draw each part of the scene once, alone and unculled, into the real targets: buffer uploads and
 * the driver's deferred per-draw shader work land here in small slices instead of in frame one.
 */
export async function warmDraws(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  post: Post,
  shadow: SunShadow,
  parts: THREE.Object3D[],
  onPart: (i: number) => void,
  pause: () => Promise<void>,
): Promise<void> {
  const culled: THREE.Object3D[] = [];
  scene.traverse((o) => {
    if (o.frustumCulled) {
      o.frustumCulled = false;
      culled.push(o);
    }
  });
  const vis = parts.map((p) => p.visible);
  const prev = renderer.getRenderTarget();
  for (let i = 0; i < parts.length; i++) {
    parts.forEach((p, j) => (p.visible = j === i));
    renderer.setRenderTarget(post.mrt);
    renderer.render(scene, camera);
    const po = scene.overrideMaterial;
    scene.overrideMaterial = shadow.mat;
    renderer.setRenderTarget(shadow.rt);
    renderer.render(scene, shadow.cam);
    scene.overrideMaterial = po;
    renderer.setRenderTarget(prev);
    onPart(i);
    await pause();
  }
  parts.forEach((p, j) => (p.visible = vis[j]));
  for (const o of culled) o.frustumCulled = true;
}
