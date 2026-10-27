// Track viewer: fly down the run with a ghost rider, switch cameras, scrub along the run,
// and inspect the elevation profile and the cross-section at the current point.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Track } from '../sim/track';
import { BENDS, JUNCTION_S, PROFILE, TRACK_LENGTH } from '../track/cresta';
import type { World } from '../render/world';
import { toThree } from '../render/util';
import type { Terrain } from '../render/terrain';
import { Ghost } from './ghost';
import { trackSurfaceHeight } from '../render/trackMesh';

/** Front camera: how far ahead of the rider and how high above the run, tried in order until the view is clear. */
const FRONT_AHEAD = [9, 7.5, 6, 4.5];
const FRONT_HEIGHT = [3.6, 2.8, 2.1];

type CameraMode = 'chase' | 'front' | 'helmet' | 'trackside' | 'orbit';
const MODES: CameraMode[] = ['chase', 'front', 'helmet', 'trackside', 'orbit'];
const MODE_LABELS: Record<CameraMode, string> = {
  chase: 'Chase',
  front: 'Front',
  helmet: 'Helmet',
  trackside: 'Trackside',
  orbit: 'Orbit',
};
const SPEEDS = [1, 0.5, 0.25, 2];
const MPH = 2.23694;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export class Viewer {
  private s = JUNCTION_S;
  private ghost: Ghost;
  private playing = false;
  private mode: CameraMode = 'chase';
  private speedIndex = 0;
  private readonly orbit: OrbitControls;
  private readonly camPos = new THREE.Vector3();
  private readonly camLook = new THREE.Vector3();
  private readonly riderPos = new THREE.Vector3();
  private snapCamera = true;
  /** Things the front camera must see past: bridges, buildings, props (with their world bounds). */
  private obstacles: { mesh: THREE.Mesh; sphere: THREE.Sphere }[] | null = null;
  private readonly ray = new THREE.Raycaster();
  /** Background mode behind the title menu: a slow, endless descent from Junction. */
  attract = false;
  private readonly profileCanvas = $<HTMLCanvasElement>('profile');
  private readonly sectionCanvas = $<HTMLCanvasElement>('section');

  constructor(
    private readonly world: World,
    private readonly track: Track,
    private readonly terrain: Terrain,
    private rider: THREE.Object3D,
  ) {
    this.ghost = new Ghost(track, JUNCTION_S);
    this.orbit = new OrbitControls(world.camera, world.renderer.domElement);
    this.orbit.enabled = false;
    this.orbit.enableDamping = true;
    this.orbit.maxDistance = 1500;
    this.bindUi();
    this.placeRider();
  }

  private bindUi() {
    const scrub = $<HTMLInputElement>('scrub');
    scrub.max = String(TRACK_LENGTH);
    scrub.addEventListener('input', () => {
      this.goTo(Number(scrub.value));
    });
    $('play').addEventListener('click', () => {
      if (this.s >= TRACK_LENGTH - 0.01) this.s = this.ghost.startS;
      this.playing = !this.playing;
    });
    $('from-top').addEventListener('click', () => this.startFrom(0, true));
    $('from-junction').addEventListener('click', () => this.startFrom(JUNCTION_S, true));
    $('camera').addEventListener('click', () => this.setMode(MODES[(MODES.indexOf(this.mode) + 1) % MODES.length]));
    $('speed').addEventListener('click', () => {
      this.speedIndex = (this.speedIndex + 1) % SPEEDS.length;
      $('speed').textContent = `${SPEEDS[this.speedIndex]}×`;
    });
    $('jump').addEventListener('change', (e) => {
      const sel = e.target as HTMLSelectElement;
      if (!sel.value) return;
      this.goTo(Number(sel.value));
      sel.value = '';
    });
    const jump = $<HTMLSelectElement>('jump');
    for (const b of BENDS) jump.add(new Option(b.name, String(Math.max(0, b.s0 - 25))));
    $('inspect').addEventListener('click', () => document.body.classList.toggle('inspecting'));
    this.setMode('chase');
  }

  /** Move to s, restarting the ghost from Top if s is above its start. */
  private goTo(s: number) {
    if (s < this.ghost.startS) this.ghost = new Ghost(this.track, s < JUNCTION_S ? 0 : JUNCTION_S);
    this.s = s;
    this.snapCamera = true;
  }

  private startFrom(s0: number, play: boolean) {
    this.ghost = new Ghost(this.track, s0);
    this.s = s0;
    this.playing = play;
    this.snapCamera = true;
  }

  private setMode(mode: CameraMode) {
    this.mode = mode;
    this.orbit.enabled = mode === 'orbit';
    $('camera').textContent = MODE_LABELS[mode];
    if (mode === 'orbit') {
      const cam = this.world.camera;
      cam.position.copy(this.riderPos).add(new THREE.Vector3(60, 45, 60));
      this.orbit.target.copy(this.riderPos);
    }
    this.snapCamera = true;
  }

  private placeRider() {
    const g = this.ghost.state(this.s);
    const frame = this.track.frame(this.s);
    const pos = this.track.toWorld(frame, g.lateral, g.height);
    toThree(pos, this.riderPos);
    // Surface normal and heading in world space.
    const [ny, nz] = g.normal;
    const up = toThree([
      frame.left[0] * ny + frame.up[0] * nz,
      frame.left[1] * ny + frame.up[1] * nz,
      frame.left[2] * ny + frame.up[2] * nz,
    ]).normalize();
    const forward = toThree(frame.forward).normalize();
    const right = new THREE.Vector3().crossVectors(forward, up).normalize();
    forward.crossVectors(up, right).normalize();
    this.rider.matrix.makeBasis(forward, up, right).setPosition(this.riderPos);
    this.rider.matrixAutoUpdate = false;
    this.rider.matrixWorldNeedsUpdate = true;
  }

  /** Swap the ghost rider's model (after choosing a different rider or toboggan). */
  setRider(rider: THREE.Object3D) {
    this.rider = rider;
    this.placeRider();
  }

  /** Start or stop the background descent shown behind the menu. */
  setAttract(on: boolean) {
    this.attract = on;
    if (on) {
      this.setMode('chase');
      this.startFrom(JUNCTION_S, true);
    }
  }

  update(dt: number) {
    if (this.attract && (this.s >= TRACK_LENGTH - 0.01 || !this.playing)) this.startFrom(JUNCTION_S, true);
    if (this.playing) {
      const speed = this.ghost.state(this.s).speed;
      this.s = Math.min(TRACK_LENGTH, this.s + speed * dt * (this.attract ? 0.6 : SPEEDS[this.speedIndex]));
      if (this.s >= TRACK_LENGTH) this.playing = false;
    }
    this.placeRider();
    this.updateCamera(dt);
    this.world.followSun(this.riderPos);
    this.updateHud();
  }

  private updateCamera(dt: number) {
    const cam = this.world.camera;
    if (this.mode === 'orbit') {
      const delta = this.riderPos.clone().sub(this.orbit.target);
      this.orbit.target.add(delta);
      cam.position.add(delta);
      this.orbit.update();
      return;
    }
    const g = this.ghost.state(this.s);
    const desiredPos = new THREE.Vector3();
    const desiredLook = new THREE.Vector3();
    if (this.mode === 'chase') {
      // Sit behind the rider on their own line, a little above and inside it.
      const sBack = Math.max(0, this.s - 6);
      const gb = this.ghost.state(sBack);
      const back = this.track.frame(sBack);
      const behind = this.track.toWorld(back, gb.lateral * 0.7, 2.0 + gb.height * 0.8);
      // Before the start there is no track behind: back off along the first frame.
      const extra = 6 - (this.s - sBack);
      toThree([behind[0] - back.forward[0] * extra, behind[1] - back.forward[1] * extra, behind[2] - back.forward[2] * extra], desiredPos);
      const ahead = this.track.frame(Math.min(TRACK_LENGTH, this.s + 4));
      const ga = this.ghost.state(Math.min(TRACK_LENGTH, this.s + 4));
      toThree(this.track.toWorld(ahead, (g.lateral + ga.lateral) / 2, 0.3 + g.height), desiredLook);
    } else if (this.mode === 'front') {
      this.frontView(g, desiredPos, desiredLook);
    } else if (this.mode === 'helmet') {
      const here = this.track.frame(Math.min(TRACK_LENGTH, this.s + 0.7));
      toThree(this.track.toWorld(here, g.lateral, g.height + 0.55), desiredPos);
      const sAhead = Math.min(TRACK_LENGTH, this.s + 20);
      const ahead = this.track.frame(sAhead);
      const ga = this.ghost.state(sAhead);
      toThree(this.track.toWorld(ahead, ga.lateral, ga.height + 0.3), desiredLook);
    } else {
      // Trackside: a fixed spectator spot every 60 m, on the outside of the bend ahead.
      const spot = Math.min(TRACK_LENGTH - 5, Math.floor((this.s + 20) / 60) * 60 + 25);
      const sec = this.track.section(spot);
      const pts = this.track.crossSection(spot, sec);
      const side = sec.outerSide === 'right' ? pts[0].y - 11 : pts[pts.length - 1].y + 11;
      const st = this.track.frame(spot);
      const x = st.pos[0] + st.left[0] * side;
      const y = st.pos[1] + st.left[1] * side;
      desiredPos.set(x, this.terrain.height(x, y) + 4.5, -y);
      desiredLook.copy(this.riderPos);
    }
    const k = this.snapCamera ? 1 : 1 - Math.exp(-dt * (this.mode === 'trackside' ? 4 : 8));
    if (this.mode === 'trackside' && this.camPos.distanceTo(desiredPos) > 5) this.camPos.copy(desiredPos);
    else this.camPos.lerp(desiredPos, k);
    this.camLook.lerp(desiredLook, this.snapCamera ? 1 : 1 - Math.exp(-dt * 10));
    this.snapCamera = false;
    cam.position.copy(this.camPos);
    cam.up.set(0, 1, 0);
    cam.lookAt(this.camLook);
  }

  /**
   * In front of the rider looking back at them, higher than the chase camera: the furthest and
   * highest spot down the run from which nothing (ground, the run's walls, a bridge) is in the way.
   */
  private frontView(g: ReturnType<Ghost['state']>, pos: THREE.Vector3, look: THREE.Vector3) {
    const head = this.riderPos.clone().add(new THREE.Vector3(0, 0.5, 0));
    look.copy(head);
    let chosen = false;
    for (const ahead of FRONT_AHEAD) {
      const sA = Math.min(TRACK_LENGTH, this.s + ahead);
      const frame = this.track.frame(sA);
      const extra = this.s + ahead - sA;
      const ga = this.ghost.state(sA);
      for (const up of FRONT_HEIGHT) {
        const w = this.track.toWorld(frame, (g.lateral + ga.lateral) * 0.35, up + ga.height);
        toThree([w[0] + frame.forward[0] * extra, w[1] + frame.forward[1] * extra, w[2]], pos);
        if (this.clear(head, pos)) {
          chosen = true;
          break;
        }
      }
      if (chosen) break;
    }
  }

  /** Whether the line from a to b (three.js coordinates) passes clear of the ground, the run and the buildings. */
  private clear(a: THREE.Vector3, b: THREE.Vector3): boolean {
    const p = new THREE.Vector3();
    for (let i = 2; i <= 12; i++) {
      p.lerpVectors(a, b, i / 12);
      const x = p.x;
      const y = -p.z;
      if (p.y < this.terrain.height(x, y) + 0.3) return false;
      const { station } = this.terrain.distanceToTrack(x, y);
      if (station) {
        const lateral = (x - station.pos[0]) * station.left[0] + (y - station.pos[1]) * station.left[1];
        const surface = trackSurfaceHeight(this.track, station.s, lateral);
        if (surface !== null && p.y < station.pos[2] + surface + 0.25) return false;
      }
    }
    if (!this.obstacles) {
      this.obstacles = [];
      this.world.scene.getObjectByName('scenery')?.traverse((o) => {
        if (!(o instanceof THREE.Mesh) || o instanceof THREE.InstancedMesh) return;
        const geo = o.geometry as THREE.BufferGeometry;
        if (!geo.boundingSphere) geo.computeBoundingSphere();
        const sphere = geo.boundingSphere!.clone().applyMatrix4(o.matrixWorld);
        if (sphere.radius < 150) this.obstacles!.push({ mesh: o, sphere });
      });
    }
    const dir = b.clone().sub(a);
    const far = dir.length();
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const near = this.obstacles.filter((o) => o.sphere.center.distanceTo(mid) < o.sphere.radius + far / 2 + 1).map((o) => o.mesh);
    if (!near.length) return true;
    this.ray.set(a, dir.normalize());
    this.ray.far = far + 0.6;
    return this.ray.intersectObjects(near, false).length === 0;
  }

  private updateHud() {
    const g = this.ghost.state(this.s);
    const grade = -this.track.grade(this.s);
    $('zone').textContent = this.track.zoneName(this.s);
    $('distance').textContent = `${this.s.toFixed(0)} m`;
    $('elevation').textContent = `${this.track.elevation(this.s).toFixed(1)} m`;
    $('gradient').textContent = grade > 0.005 ? `1 in ${(1 / grade).toFixed(1)}` : 'flat';
    $('mph').textContent = (g.speed * MPH).toFixed(0);
    $('clock').textContent = (g.time).toFixed(2);
    $('play').textContent = this.playing ? '❚❚' : '▶';
    ($('scrub') as HTMLInputElement).value = String(this.s);
    if (document.body.classList.contains('inspecting')) {
      this.drawProfile();
      this.drawSection(g.lateral, g.height);
    }
  }

  private drawProfile() {
    const c = this.profileCanvas;
    const g = fitCanvas(c);
    const w = c.width;
    const h = c.height;
    const pad = 10 * devicePixelRatio;
    const x = (s: number) => pad + (s / TRACK_LENGTH) * (w - 2 * pad);
    const zMax = PROFILE[0].z;
    const y = (z: number) => pad + (1 - z / zMax) * (h - 2 * pad);
    g.clearRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.lineWidth = 2 * devicePixelRatio;
    g.beginPath();
    for (let s = 0; s <= TRACK_LENGTH; s += 4) {
      const px = x(s);
      const py = y(this.track.elevation(s));
      if (s === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.65)';
    g.font = `${9 * devicePixelRatio}px system-ui, sans-serif`;
    for (const b of BENDS) {
      const s = (b.s0 + b.s1) / 2;
      g.fillRect(x(s) - 1, y(this.track.elevation(s)) - 4, 2, 8);
    }
    g.fillStyle = '#ff6a3d';
    g.beginPath();
    g.arc(x(this.s), y(this.track.elevation(this.s)), 5 * devicePixelRatio, 0, Math.PI * 2);
    g.fill();
  }

  private drawSection(riderLateral: number, riderHeight: number) {
    const c = this.sectionCanvas;
    const g = fitCanvas(c);
    const w = c.width;
    const h = c.height;
    const pts = this.track.crossSection(this.s);
    const scale = Math.min(w / 12, h / 6);
    // Looking down the run: the rider's left is on screen left.
    const x = (lat: number) => w / 2 - lat * scale;
    const y = (z: number) => h - 12 * devicePixelRatio - z * scale;
    g.clearRect(0, 0, w, h);
    g.fillStyle = 'rgba(200,225,245,0.35)';
    g.strokeStyle = 'rgba(255,255,255,0.95)';
    g.lineWidth = 2 * devicePixelRatio;
    g.beginPath();
    pts.forEach((p, i) => (i === 0 ? g.moveTo(x(p.y), y(p.z)) : g.lineTo(x(p.y), y(p.z))));
    g.stroke();
    g.fillStyle = '#ff6a3d';
    g.beginPath();
    g.arc(x(riderLateral), y(riderHeight + 0.2), 5 * devicePixelRatio, 0, Math.PI * 2);
    g.fill();
    const sec = this.track.section(this.s);
    g.fillStyle = 'rgba(255,255,255,0.8)';
    g.font = `${10 * devicePixelRatio}px system-ui, sans-serif`;
    g.fillText(`floor ${sec.floorWidth.toFixed(1)} m · walls L ${sec.left.height.toFixed(1)} / R ${sec.right.height.toFixed(1)} m`, 8 * devicePixelRatio, 14 * devicePixelRatio);
  }
}

function fitCanvas(c: HTMLCanvasElement) {
  const w = Math.round(c.clientWidth * devicePixelRatio);
  const h = Math.round(c.clientHeight * devicePixelRatio);
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  return c.getContext('2d')!;
}
