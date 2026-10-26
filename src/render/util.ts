import * as THREE from 'three';
import type { Vec3 } from '../sim/vec';

/** Simulation frame (x east, y north, z up) to Three.js (y up). */
export const toThree = (v: Vec3, out = new THREE.Vector3()) => out.set(v[0], v[2], -v[1]);

/** Deterministic PRNG so scenery is identical on every load. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth 2D value noise in roughly [-1, 1]. */
export function valueNoise(seed: number) {
  const hash = (ix: number, iy: number) => {
    let h = (ix * 374761393 + iy * 668265263 + seed * 2147483647) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 2147483648 - 1;
  };
  return (x: number, y: number) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const a = hash(ix, iy);
    const b = hash(ix + 1, iy);
    const c = hash(ix, iy + 1);
    const d = hash(ix + 1, iy + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}

export const colors = {
  ice: new THREE.Color('#cfe2ef'),
  wall: new THREE.Color('#e3eef6'),
  snow: new THREE.Color('#f6f9fc'),
  snowShade: new THREE.Color('#e4ecf4'),
  straw: new THREE.Color('#c9a04a'),
  padding: new THREE.Color('#a3242b'),
  wood: new THREE.Color('#c09257'),
  woodDark: new THREE.Color('#6b4a2b'),
  pine: new THREE.Color('#2e5a45'),
  pineLight: new THREE.Color('#3f6e53'),
  trunk: new THREE.Color('#5a4030'),
  rock: new THREE.Color('#7b8697'),
  skyTop: new THREE.Color('#5b97d1'),
  skyHorizon: new THREE.Color('#dde9f3'),
};
