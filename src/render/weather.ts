// The day's weather on screen: a hot day's glare, or snow falling through a white-out haze that
// hides the far mountains (and, near enough, Shuttlecock).

import * as THREE from 'three';
import type { World } from './world';
import type { Weather } from '../game/conditions';

const FLAKES = 4500;
/** Snow falls in a box this size round the camera, following it. */
const BOX = 46;

export class WeatherView {
  private readonly flakes: THREE.Points;
  private readonly speed = new Float32Array(FLAKES);
  private readonly clear: { exposure: number; sun: number; env: number; fog: [number, number]; background: THREE.Color };
  private current: Weather | null = null;
  private time = 0;

  constructor(private readonly world: World) {
    const fog = world.scene.fog as THREE.Fog;
    this.clear = { exposure: world.renderer.toneMappingExposure, sun: world.sun.intensity, env: world.scene.environmentIntensity, fog: [fog.near, fog.far], background: (world.scene.background as THREE.Color).clone() };
    const pos = new Float32Array(FLAKES * 3);
    for (let i = 0; i < FLAKES; i++) {
      pos[i * 3] = (Math.random() - 0.5) * BOX;
      pos[i * 3 + 1] = (Math.random() - 0.5) * BOX;
      pos[i * 3 + 2] = (Math.random() - 0.5) * BOX;
      this.speed[i] = 0.8 + Math.random() * 0.9;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    // A soft round flake.
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.7)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 32, 32);
    const material = new THREE.PointsMaterial({ size: 0.17, map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, fog: false });
    this.flakes = new THREE.Points(geo, material);
    this.flakes.frustumCulled = false;
    this.flakes.name = 'snowfall';
  }

  get weather() {
    return this.current;
  }

  set(weather: Weather | null) {
    this.current = weather;
    const { renderer, scene, sun } = this.world;
    const fog = scene.fog as THREE.Fog;
    const sky = scene.getObjectByName('sky');
    renderer.toneMappingExposure = this.clear.exposure * (weather === 'hot' ? 1.22 : weather === 'snow' ? 0.95 : weather === 'cold' ? 0.97 : 1);
    sun.intensity = this.clear.sun * (weather === 'hot' ? 1.2 : weather === 'snow' ? 0.18 : 1);
    sun.color.set(weather === 'hot' ? '#fff0d0' : '#fff3e2');
    // Under cloud there is no blue sky to mirror: without this the glossy ice, and the apron round
    // the start at Junction, would glare against the dull snow about them.
    scene.environmentIntensity = this.clear.env * (weather === 'snow' ? 0.35 : 1);
    if (weather === 'snow') {
      fog.color.set('#d9dee5');
      fog.near = 12;
      fog.far = 230;
      (scene.background as THREE.Color).set('#d9dee5');
      if (sky) sky.visible = false;
      scene.add(this.flakes);
    } else {
      fog.color.copy(this.clear.background);
      [fog.near, fog.far] = this.clear.fog;
      (scene.background as THREE.Color).copy(this.clear.background);
      if (sky) sky.visible = true;
      this.flakes.removeFromParent();
    }
  }

  /** Snow drifts down and across, the box of it kept round the camera. */
  update(dt: number) {
    if (this.current !== 'snow') return;
    this.time += dt;
    const cam = this.world.camera.position;
    const pos = this.flakes.geometry.attributes.position as THREE.BufferAttribute;
    const a = pos.array as Float32Array;
    const half = BOX / 2;
    const wind = Math.sin(this.time * 0.3) * 0.5 + 0.7;
    for (let i = 0; i < FLAKES; i++) {
      a[i * 3 + 1] -= this.speed[i] * dt;
      a[i * 3] += (wind + Math.sin(this.time * 1.7 + i) * 0.3) * dt;
      a[i * 3 + 2] += Math.cos(this.time * 1.3 + i * 0.7) * 0.25 * dt;
      // Wrap round the camera so the flakes always fill the box about it.
      for (let k = 0; k < 3; k++) {
        const c = k === 0 ? cam.x : k === 1 ? cam.y : cam.z;
        const rel = a[i * 3 + k] - c;
        if (rel < -half || rel > half) a[i * 3 + k] = c + ((((rel + half) % BOX) + BOX) % BOX) - half;
      }
    }
    pos.needsUpdate = true;
  }
}
