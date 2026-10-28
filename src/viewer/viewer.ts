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
import { frameAt, type DescentFrame } from './descent';
import type { RiderModel } from '../render/riderModel';
import { surfaceAt } from '../sim/surface';
import { trackSurfaceHeight } from '../render/trackMesh';
import type { TreeCrown } from '../render/scenery';

/** Front camera: how far ahead of the rider and how high above the run, tried in order until the view is clear. */
const FRONT_AHEAD = [9, 7.5, 6, 4.5];
const FRONT_HEIGHT = [3.6, 2.8, 2.1];
/** Trackside: one spectator's spot per this many metres of run. */
const TRACKSIDE_EVERY = 50;
/** Seconds each trackside spot is held at least (unless the rider has gone far past it). */
const TRACKSIDE_HOLD = 3;

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
/** The descent behind the title, relative to a real ride. */
const ATTRACT_SPEED = 2.5;
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
  private readonly people: THREE.Sphere[] = [];
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
    // The viewer's own ghost lies forward on its line, whatever the recording left it doing.
    this.riderModel?.setPose({ posture: 0, steer: 0, rakeLeft: 0, rakeRight: 0, mount: 1, runPhase: 0 });
    if (this.riderModel) this.riderModel.toboggan.position.x = 0;
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
  setRider(rider: THREE.Object3D, model: RiderModel | null = null) {
    this.rider = rider;
    this.riderModel = model;
    this.recording = null;
    this.placeRider();
  }

  /** The real descent shown behind the title, once recorded (see descent.ts). */
  setRecording(frames: DescentFrame[]) {
    this.recording = frames.length > 1 ? frames : null;
    this.recT = 0;
    this.recHint.i = 0;
  }

  private riderModel: RiderModel | null = null;
  private recording: DescentFrame[] | null = null;
  private recT = 0;
  private readonly recHint = { i: 0 };

  /** Pose and place the rider from a recorded frame, as the ride itself does. */
  private placeRecorded(f: DescentFrame) {
    const s = Math.min(f.s, this.track.length);
    const frame = this.track.frame(s);
    const sp = surfaceAt(this.track.section(s), f.u);
    this.riderModel?.castShadowOnSlope(sp.angle);
    toThree(this.track.toWorld(frame, sp.y, sp.z), this.riderPos);
    const up = toThree([frame.left[0] * sp.ny + frame.up[0] * sp.nz, frame.left[1] * sp.ny + frame.up[1] * sp.nz, frame.left[2] * sp.ny + frame.up[2] * sp.nz]).normalize();
    const across = toThree([frame.left[0] * sp.ty + frame.up[0] * sp.tz, frame.left[1] * sp.ty + frame.up[1] * sp.tz, frame.left[2] * sp.ty + frame.up[2] * sp.tz]);
    const heading = toThree(frame.forward).multiplyScalar(Math.max(f.v, 0.5)).addScaledVector(across, f.w).normalize();
    const right = new THREE.Vector3().crossVectors(heading, up).normalize();
    heading.crossVectors(up, right).normalize();
    this.rider.matrix.makeBasis(heading, up, right).setPosition(this.riderPos);
    this.rider.matrixAutoUpdate = false;
    this.rider.matrixWorldNeedsUpdate = true;
    if (this.riderModel) {
      this.riderModel.toboggan.position.x = -f.slidOff;
      this.riderModel.setPose({ posture: f.posture, steer: f.steer, rakeLeft: f.rakeLeft, rakeRight: f.rakeRight, mount: f.mount, runPhase: f.runPhase });
    }
  }

  /** Start or stop the background descent shown behind the menu. */
  setAttract(on: boolean) {
    this.attract = on;
    if (on) {
      // Behind the title: the rider seen going past from beside the run.
      this.setMode('trackside');
      this.startFrom(JUNCTION_S, true);
      this.recT = 0;
      this.recHint.i = 0;
    }
  }

  update(dt: number) {
    if (this.attract && this.recording) {
      // Behind the title: the recorded descent, played half as fast again and more as a real ride.
      const last = this.recording[this.recording.length - 1].t;
      this.recT += dt * ATTRACT_SPEED;
      if (this.recT > last) {
        this.recT = 0;
        this.snapCamera = true;
      }
      const f = frameAt(this.recording, this.recT, this.recHint);
      this.pace = (f.v * ATTRACT_SPEED + this.pace * 4) / 5;
      this.s = Math.min(TRACK_LENGTH, f.s);
      this.placeRecorded(f);
      this.updateCamera(dt);
      this.world.followSun(this.riderPos);
      return;
    }
    if (this.attract && (this.s >= TRACK_LENGTH - 0.01 || !this.playing)) this.startFrom(JUNCTION_S, true);
    if (this.playing) {
      const speed = this.ghost.state(this.s).speed;
      this.pace = speed * SPEEDS[this.speedIndex];
      // Behind the title it plays at half as fast again as a real ride, to show more of the run.
      this.s = Math.min(TRACK_LENGTH, this.s + speed * dt * (this.attract ? ATTRACT_SPEED : SPEEDS[this.speedIndex]));
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
      // Trackside: a spectator's spot every 50 m beside the run, chosen so that the rider can be seen
      // coming the whole way past it (no tree, bank or building in between).
      // The next spot is picked further ahead the faster the rider is going, so they come towards
      // it, and each spot is held a while: at the title's pace a spot every 50 m would mean a cut
      // every second.
      const lead = 20 + Math.min(80, this.pace * 1.1);
      const want = Math.floor((this.s + lead) / TRACKSIDE_EVERY);
      this.spotHeld += dt;
      const gone = this.spotK >= 0 && this.camPos.distanceTo(this.riderPos) > 75 && this.spotHeld > 0.6;
      if (this.spotK < 0 || want < this.spotK || (want !== this.spotK && (this.spotHeld > TRACKSIDE_HOLD || gone))) {
        this.spotK = want;
        this.spotHeld = 0;
      }
      desiredPos.copy(this.tracksideSpot(this.spotK));
      desiredLook.copy(this.riderPos).add(new THREE.Vector3(0, 0.4, 0));
    }
    const k = this.snapCamera ? 1 : 1 - Math.exp(-dt * (this.mode === 'trackside' ? 4 : 8));
    let cut = false;
    if (this.mode === 'trackside' && this.camPos.distanceTo(desiredPos) > 5) {
      // A cut to the next spot: look straight at the rider from it.
      this.camPos.copy(desiredPos);
      cut = true;
    } else this.camPos.lerp(desiredPos, k);
    this.camLook.lerp(desiredLook, this.snapCamera || cut ? 1 : 1 - Math.exp(-dt * (this.mode === 'trackside' ? 16 : 10)));
    // Trackside, the lens zooms to keep the rider about the same size however far off they are.
    const fov = this.mode === 'trackside' ? THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan(5 / Math.max(1, this.camPos.distanceTo(this.riderPos)))), 9, 55) : 62;
    if (Math.abs(cam.fov - fov) > 0.05) {
      cam.fov += (fov - cam.fov) * (cut || this.snapCamera ? 1 : 1 - Math.exp(-dt * 6));
      cam.updateProjectionMatrix();
    }
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

  private readonly spots = new Map<number, THREE.Vector3>();
  /** The trackside spot in use, and for how long it has been. */
  private spotK = -1;
  private spotHeld = 0;
  /** How fast the rider is moving down the run on screen (m/s). */
  private pace = 0;

  /**
   * The trackside camera for the stretch of run around k * 50 + 25 m: of spots either side of the
   * run (the outside of the bend first), close and low first, the first with a clear view of the
   * rider all the way past; else the one that sees most of it.
   */
  private tracksideSpot(k: number): THREE.Vector3 {
    const cached = this.spots.get(k);
    if (cached) return cached;
    const s0 = Math.min(TRACK_LENGTH - 5, k * TRACKSIDE_EVERY + 25);
    const sec = this.track.section(s0);
    const pts = this.track.crossSection(s0, sec);
    const sides = sec.outerSide === 'right' ? [-1, 1] : [1, -1];
    // Where the ghost actually is on its line (up the banks on the bends), at toboggan height.
    const rider = [-45, -26, -12, 0, 12, 22].map((d) => {
      const s = THREE.MathUtils.clamp(s0 + d, 0, TRACK_LENGTH);
      const g = this.ghost.state(s);
      return toThree(this.track.toWorld(this.track.frame(s), g.lateral, g.height + 0.25));
    });
    let best = { score: -1, pos: new THREE.Vector3() };
    search: for (const out of [8, 11, 15, 20, 27, 35]) {
      // High enough to see down into the run over its walls.
      for (const up of [6, 8.5, 4.5, 11, 15]) {
        for (const side of sides) {
          for (const along of [0, -10, 10, -20, 20]) {
            const s = THREE.MathUtils.clamp(s0 + along, 0, TRACK_LENGTH);
            const st = this.track.frame(s);
            const lateral = side > 0 ? pts[pts.length - 1].y + out : pts[0].y - out;
            const x = st.pos[0] + st.left[0] * lateral;
            const y = st.pos[1] + st.left[1] * lateral;
            // Up from the ground, or from the run's floor where the ground falls away below it.
            const pos = new THREE.Vector3(x, Math.max(this.terrain.height(x, y), st.pos[2]) + up, -y);
            const score = rider.filter((r) => this.clear(pos, r)).length;
            if (score > best.score) best = { score, pos };
            if (score === rider.length) break search;
          }
        }
      }
    }
    this.spots.set(k, best.pos);
    return best.pos;
  }

  /** The trees near the run, in 20 m cells. */
  private crowns: Map<number, TreeCrown[]> | null = null;

  /** Whether a tree stands in the way between a and b. */
  private treeInWay(a: THREE.Vector3, b: THREE.Vector3): boolean {
    if (!this.crowns) {
      this.crowns = new Map();
      const all = (this.world.scene.getObjectByName('trees')?.userData.crowns ?? []) as TreeCrown[];
      for (const c of all) {
        const key = Math.floor(c.x / 20) * 100003 + Math.floor(c.y / 20);
        if (!this.crowns.has(key)) this.crowns.set(key, []);
        this.crowns.get(key)!.push(c);
      }
    }
    const p = new THREE.Vector3();
    const n = Math.max(8, Math.ceil(a.distanceTo(b) / 1.5));
    for (let i = 1; i < n; i++) {
      p.lerpVectors(a, b, i / n);
      const x = p.x;
      const y = -p.z;
      const cx = Math.floor(x / 20);
      const cy = Math.floor(y / 20);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (const c of this.crowns.get((cx + dx) * 100003 + cy + dy) ?? []) {
            const rel = (p.y - c.base) / c.height;
            if (rel < 0 || rel > 1) continue;
            if (Math.hypot(c.x - x, c.y - y) < c.radius * (1 - rel) + 0.4) return true;
          }
        }
      }
    }
    return false;
  }

  /** Whether the line from a to b (three.js coordinates) passes clear of the ground, the run, the trees and the buildings. */
  private clear(a: THREE.Vector3, b: THREE.Vector3): boolean {
    if (this.treeInWay(a, b)) return false;
    const p = new THREE.Vector3();
    // Every half metre, so a wall's lip can't slip between two samples.
    const n = Math.max(12, Math.ceil(a.distanceTo(b) / 0.5));
    for (let i = 2; i < n - 1; i++) {
      p.lerpVectors(a, b, i / n);
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
      // The spectators too (their bounding boxes stand in for them).
      this.world.scene.getObjectByName('crowd')?.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        const geo = o.geometry as THREE.BufferGeometry;
        if (!geo.boundingSphere) geo.computeBoundingSphere();
        const sphere = geo.boundingSphere!.clone().applyMatrix4(o.matrixWorld);
        if (sphere.radius < 4) this.people.push(sphere);
      });
    }
    const dir = b.clone().sub(a);
    const far = dir.length();
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const near = this.obstacles.filter((o) => o.sphere.center.distanceTo(mid) < o.sphere.radius + far / 2 + 1).map((o) => o.mesh);
    this.ray.set(a, dir.clone().normalize());
    for (const p of this.people) if (p.center.distanceTo(mid) < p.radius + far / 2 && this.ray.ray.intersectsSphere(p) && p.center.distanceTo(b) > 1.5) return false;
    if (!near.length) return true;
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
