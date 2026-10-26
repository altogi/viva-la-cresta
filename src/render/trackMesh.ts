// Sweeps the track cross-sections along the centreline into one vertex-coloured mesh:
// ice floor with runner grooves, curved ice walls, snow lips and snow embankments
// (skirts) that tuck under the surrounding terrain.

import * as THREE from 'three';
import { CROSS_POINTS, FLOOR_SEGMENTS, SIDE_POINTS, type Track } from '../sim/track';
import { colors, toThree } from './util';

/** Lateral reach of the snow embankment beyond each lip (m). */
export const SKIRT_WIDTH = 14;
/** Height above the floor at which the terrain meets the track (m). */
export const TERRAIN_BASE = 0.35;

const MESH_STEP = 2; // every second station: 1 m

export function buildTrackMesh(track: Track): THREE.Mesh {
  const rowLength = CROSS_POINTS + 4; // two skirt points on each side
  const stations = track.stations.filter((_, i) => i % MESH_STEP === 0 || i === track.stations.length - 1);
  const positions = new Float32Array(stations.length * rowLength * 3);
  const vertexColors = new Float32Array(stations.length * rowLength * 3);
  const v = new THREE.Vector3();
  const c = new THREE.Color();

  stations.forEach((st, row) => {
    const section = track.section(st.s);
    const pts = track.crossSection(st.s, section);
    const right = pts[0];
    const left = pts[pts.length - 1];
    // Embankment: from the lip out and down into the ground.
    const local: { y: number; z: number; color: THREE.Color }[] = [
      { y: right.y - SKIRT_WIDTH, z: TERRAIN_BASE - 0.9, color: colors.snow },
      { y: right.y - SKIRT_WIDTH * 0.45, z: Math.max(right.z * 0.35, TERRAIN_BASE + 0.15), color: colors.snow },
      ...pts.map((p, i) => ({ y: p.y, z: p.z, color: crossColor(i, p.part, p.z, section.runoffRight, section.runoffLeft) })),
      { y: left.y + SKIRT_WIDTH * 0.45, z: Math.max(left.z * 0.35, TERRAIN_BASE + 0.15), color: colors.snow },
      { y: left.y + SKIRT_WIDTH, z: TERRAIN_BASE - 0.9, color: colors.snow },
    ];
    local.forEach((p, j) => {
      toThree(track.toWorld(st, p.y, p.z), v);
      const k = (row * rowLength + j) * 3;
      positions[k] = v.x;
      positions[k + 1] = v.y;
      positions[k + 2] = v.z;
      c.copy(p.color);
      vertexColors[k] = c.r;
      vertexColors[k + 1] = c.g;
      vertexColors[k + 2] = c.b;
    });
  });

  const indices: number[] = [];
  for (let row = 0; row < stations.length - 1; row++) {
    for (let j = 0; j < rowLength - 1; j++) {
      const a = row * rowLength + j;
      const b = a + 1;
      const d = a + rowLength;
      const e = d + 1;
      // Points run right to left, stations run forward: wind so normals face up.
      indices.push(a, d, b, b, d, e);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(vertexColors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.0 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  // Self-shadowing the curved walls causes terminator acne; scenery and riders still cast onto the ice.
  mesh.castShadow = false;
  mesh.name = 'track';
  return mesh;
}

const floorStart = SIDE_POINTS - 1;
const floorEnd = floorStart + FLOOR_SEGMENTS;

function crossColor(i: number, part: string, z: number, runoffRight: string, runoffLeft: string): THREE.Color {
  if (part === 'lip') {
    const straw = i === 0 ? runoffRight === 'straw' : runoffLeft === 'straw';
    return straw ? colors.straw : colors.snow;
  }
  if (part === 'floor' && i >= floorStart && i <= floorEnd) return colors.ice;
  // Walls whiten towards the top, where snow clings.
  return z > 1.2 ? colors.wall : colors.ice;
}

/**
 * Height of the visible track surface (ice, walls, lips and embankments) above the floor,
 * `lateral` metres left of the centreline at s; null beyond the embankments. Mirrors the mesh above.
 */
export function trackSurfaceHeight(track: Track, s: number, lateral: number): number | null {
  const pts = track.crossSection(s);
  const right = pts[0];
  const left = pts[pts.length - 1];
  if (lateral > right.y && lateral < left.y) {
    // In the channel: floor, or up a wall towards its lip.
    let best = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      if ((lateral - a.y) * (lateral - b.y) <= 0 && Math.abs(b.y - a.y) > 1e-6) {
        best = Math.max(best, a.z + ((lateral - a.y) / (b.y - a.y)) * (b.z - a.z));
      }
    }
    return best;
  }
  const lip = lateral >= left.y ? left : right;
  const out = Math.abs(lateral - lip.y);
  if (out > SKIRT_WIDTH) return null;
  const mid = SKIRT_WIDTH * 0.45;
  const midZ = Math.max(lip.z * 0.35, TERRAIN_BASE + 0.15);
  if (out <= mid) return lip.z + (midZ - lip.z) * (out / mid);
  return midZ + (TERRAIN_BASE - 0.9 - midZ) * ((out - mid) / (SKIRT_WIDTH - mid));
}
