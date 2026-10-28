// Sweeps the track cross-sections along the centreline into one vertex-coloured mesh:
// ice floor with runner grooves, curved ice walls, snow lips and snow embankments
// (skirts) that tuck under the surrounding terrain.

import * as THREE from 'three';
import { CROSS_POINTS, FLOOR_SEGMENTS, SIDE_POINTS, type Track } from '../sim/track';
import { colors, toThree } from './util';
import { junctionTerrace } from './places';

/** Lateral reach of the snow embankment beyond each lip (m). */
export const SKIRT_WIDTH = 14;
/** Height above the floor at which the terrain meets the track (m). */
export const TERRAIN_BASE = 0.35;

const MESH_STEP = 2; // every second station: 1 m

/**
 * The embankment beyond a lip, as two points out from it (distance, height above the floor): down
 * gently to the ground, except beside the riders' terrace at Junction, where it drops as a wall to
 * the terrace's level (easing back to the usual bank either end).
 */
export function skirtProfile(track: Track, s: number, side: 1 | -1, lipZ: number, floor: number) {
  const mid = { out: SKIRT_WIDTH * 0.45, z: Math.max(lipZ * 0.35, TERRAIN_BASE + 0.15) };
  const far = { out: SKIRT_WIDTH, z: TERRAIN_BASE - 0.9 };
  const t = junctionTerrace(track);
  if (side !== t.side || s < t.s0 - 4 || s > t.s1 + 4) return { mid, far };
  const k = THREE.MathUtils.smoothstep(s, t.s0 - 4, t.s0) * (1 - THREE.MathUtils.smoothstep(s, t.s1, t.s1 + 4));
  const level = Math.min(lipZ - 0.05, t.z - floor - 0.04);
  return {
    mid: { out: mid.out + (0.3 - mid.out) * k, z: mid.z + (level - mid.z) * k },
    far: { out: far.out + (3 - far.out) * k, z: far.z + (level - 0.5 - far.z) * k },
  };
}

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
    const r = skirtProfile(track, st.s, -1, right.z, st.pos[2]);
    const l = skirtProfile(track, st.s, 1, left.z, st.pos[2]);
    const local: { y: number; z: number; color: THREE.Color }[] = [
      { y: right.y - r.far.out, z: r.far.z, color: colors.snow },
      { y: right.y - r.mid.out, z: r.mid.z, color: colors.snow },
      ...pts.map((p, i) => ({ y: p.y, z: p.z, color: crossColor(i, p.part, p.z, section.runoffRight, section.runoffLeft) })),
      { y: left.y + l.mid.out, z: l.mid.z, color: colors.snow },
      { y: left.y + l.far.out, z: l.far.z, color: colors.snow },
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
  const { mid, far } = skirtProfile(track, s, lateral >= left.y ? 1 : -1, lip.z, track.elevation(s));
  if (out > far.out) return null;
  if (out <= mid.out) return lip.z + (mid.z - lip.z) * (out / mid.out);
  return mid.z + (far.z - mid.z) * ((out - mid.out) / (far.out - mid.out));
}
