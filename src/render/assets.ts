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
  for (const [name, list] of Object.entries(parts)) {
    for (const p of list) {
      const m = p.material as THREE.MeshStandardMaterial;
      if (m.alphaTest > 0 || m.transparent || m.map?.format === THREE.RGBAFormat) {
        m.transparent = false;
        // The glTF comes in as blended, without depth writes: the mountains, drawn after, would
        // paint straight over every bough and leave only the trunks standing.
        m.depthWrite = true;
        // A low cut-off with alpha-to-coverage smooths the cards' edges.
        m.alphaTest = 0.3;
        m.alphaToCoverage = true;
        m.side = THREE.DoubleSide;
        // Light comes through the needles: without this the boughs on the shaded side go black.
        m.emissive = new THREE.Color('#ffffff');
        m.emissiveMap = m.map;
        m.emissiveIntensity = 0.22;
        if (name.endsWith('_far')) billboard(p);
      }
    }
  }
}

/**
 * The picture of a tree, for far away, turned to face the camera. Fixed crossed cards fail from a
 * distance: the one seen at a grazing angle smears into a blur or thins to a sliver, and a wood
 * turns into a grey band of trunks. A billboard is always seen square on. Mipmaps also average its
 * alpha, eating the outline; scaling alpha with the mip level keeps it as solid at 400 m as close up.
 */
function billboard(part: Part) {
  // Just the first of the two crossed cards (two triangles).
  part.geometry.setDrawRange(0, 6);
  const m = part.material;
  m.onBeforeCompile = (shader) => {
    const facing = `
      vec3 bbBase = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
      vec3 bbToCam = cameraPosition - bbBase;
      bbToCam.y = 0.0;
      bbToCam = length(bbToCam) > 1e-4 ? normalize(bbToCam) : vec3(0.0, 0.0, 1.0);
      vec3 bbRight = vec3(bbToCam.z, 0.0, -bbToCam.x);`;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <defaultnormal_vertex>',
        `#include <defaultnormal_vertex>
        {${facing}
          transformedNormal = normalize((viewMatrix * vec4(bbToCam, 0.0)).xyz);
        }`,
      )
      .replace(
        '#include <project_vertex>',
        `${facing}
        float bbWidth = length(instanceMatrix[0].xyz);
        float bbHeight = length(instanceMatrix[1].xyz);
        vec3 bbWorld = bbBase + bbRight * transformed.x * bbWidth + vec3(0.0, transformed.y * bbHeight, 0.0);
        vec4 mvPosition = viewMatrix * vec4(bbWorld, 1.0);
        gl_Position = projectionMatrix * mvPosition;`,
      );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <alphatest_fragment>',
      `#ifdef USE_MAP
        {
          vec2 texel = vMapUv * vec2(textureSize(map, 0));
          vec2 dx = dFdx(texel), dy = dFdy(texel);
          float mip = max(0.0, 0.5 * log2(max(dot(dx, dx), dot(dy, dy))));
          diffuseColor.a *= 1.0 + min(mip, 6.0) * 0.25;
        }
      #endif
      #include <alphatest_fragment>`,
    );
  };
  m.customProgramCacheKey = () => 'billboard';
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
