// Models made in Blender (see /blender): loaded once at start, before the scenery is built.
// Coordinates match the game's (Blender's Z up becomes Y up on export, north becomes -Z).

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/** One mesh of a model, split by material, ready to be instanced. */
export interface Part {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}

export interface Assets {
  /** Tree models by name (spruce_0..2, larch_0..1, spruce_far, larch_far), base at the origin. */
  trees: Record<string, Part[]>;
  mountains: THREE.Object3D;
  models: Record<string, THREE.Object3D>;
}

const base = import.meta.env.BASE_URL;

async function load(loader: GLTFLoader, file: string) {
  return (await loader.loadAsync(`${base}models/${file}`)).scene;
}

/** The parts of each top-level object, in its own frame. */
function partsOf(scene: THREE.Object3D): Record<string, Part[]> {
  const out: Record<string, Part[]> = {};
  for (const child of scene.children) {
    const parts: Part[] = [];
    child.updateMatrixWorld(true);
    const toChild = child.matrixWorld.clone().invert();
    child.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const geometry = (o.geometry as THREE.BufferGeometry).clone().applyMatrix4(toChild.clone().multiply(o.matrixWorld));
      parts.push({ geometry, material: o.material as THREE.Material });
    });
    out[child.name] = parts;
  }
  return out;
}

/** Foliage cards are alpha-clipped and seen from both sides. */
function prepareFoliage(parts: Record<string, Part[]>) {
  for (const list of Object.values(parts)) {
    for (const p of list) {
      const m = p.material as THREE.MeshStandardMaterial;
      if (m.alphaTest > 0 || m.transparent || m.map?.format === THREE.RGBAFormat) {
        m.transparent = false;
        // A low cut-off with alpha-to-coverage keeps thin needles from vanishing in the distance
        // (mipmaps soften the alpha) and smooths the cards' edges.
        m.alphaTest = 0.3;
        m.alphaToCoverage = true;
        m.side = THREE.DoubleSide;
      }
    }
  }
}

export async function loadAssets(names: string[] = []): Promise<Assets> {
  const loader = new GLTFLoader();
  const [trees, mountains, ...more] = await Promise.all([load(loader, 'trees.glb'), load(loader, 'mountains.glb'), ...names.map((n) => load(loader, `${n}.glb`))]);
  const treeParts = partsOf(trees);
  prepareFoliage(treeParts);
  mountains.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      const m = o.material as THREE.MeshStandardMaterial;
      m.roughness = 1;
      m.metalness = 0;
      o.receiveShadow = false;
      o.castShadow = false;
    }
  });
  const models: Record<string, THREE.Object3D> = {};
  names.forEach((n, i) => (models[n] = more[i]));
  return { trees: treeParts, mountains, models };
}
