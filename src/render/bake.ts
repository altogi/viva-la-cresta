// Merge many small meshes into one per moving part, with their colours baked into the vertices:
// far fewer draw calls for background characters. Textured, transparent and glowing meshes stay as
// they are.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const baked = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 });

const plain = (mesh: THREE.Mesh) => {
  const m = mesh.material as THREE.MeshStandardMaterial;
  return !(mesh as THREE.SkinnedMesh).isSkinnedMesh && !Array.isArray(m) && !m.map && !m.transparent && !m.vertexColors && !(m.emissive && m.emissive.getHex() !== 0) && mesh.morphTargetInfluences === undefined;
};

/** Merge the plain meshes under `root` into one mesh per part: `root` itself and each of `parts`. */
export function bakeParts(root: THREE.Object3D, parts: THREE.Object3D[]) {
  const all = [root, ...parts];
  root.updateMatrixWorld(true);
  for (const part of all) {
    const toPart = part.matrixWorld.clone().invert();
    const geos: THREE.BufferGeometry[] = [];
    const meshes: THREE.Mesh[] = [];
    const walk = (node: THREE.Object3D) => {
      for (const child of node.children) {
        if (all.includes(child) || !child.visible) continue; // hidden things (a helmet not worn) stay out
        if (child instanceof THREE.Mesh && plain(child)) {
          const geo = (child.geometry as THREE.BufferGeometry).clone();
          geo.applyMatrix4(toPart.clone().multiply(child.matrixWorld));
          const flat = geo.index ? geo.toNonIndexed() : geo;
          for (const name of Object.keys(flat.attributes)) if (name !== 'position' && name !== 'normal') flat.deleteAttribute(name);
          const color = (child.material as THREE.MeshStandardMaterial).color;
          const colors = new Float32Array(flat.attributes.position.count * 3);
          for (let i = 0; i < colors.length; i += 3) colors.set([color.r, color.g, color.b], i);
          flat.setAttribute('color', new THREE.BufferAttribute(colors, 3));
          geos.push(flat);
          meshes.push(child);
        }
        walk(child);
      }
    };
    walk(part);
    for (const mesh of meshes) mesh.removeFromParent();
    if (geos.length) {
      const mesh = new THREE.Mesh(mergeGeometries(geos), baked);
      mesh.castShadow = true;
      part.add(mesh);
    }
  }
}
