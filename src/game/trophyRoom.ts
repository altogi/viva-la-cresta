// The trophy room: the Sunny Bar's terrace above the frozen lake of St Moritz, a table by the iron
// railing, and on it what the rider has to show for the season. First their record, engraved on a
// board as on the clubhouse walls (rides, best times, the clubs of the banks they've come off at),
// then each trophy they've won. Swipe for the next. Over the mountains clouds drift by, now and then
// a biplane skims the lake or a balloon floats past, and for the colour races there are fireworks.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Career } from '../career/career';
import { CLUB_LORE, riderRecord, wins, type RiderRecord, type Win } from '../career/trophies';
import { RIDERS } from '../sim/rider';
import { buildArrows } from './selectMode';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const base = import.meta.env.BASE_URL;

/** Where the trophy stands: on the table by the railing. */
const TABLE_TOP = 0.78;
const SPOT = new THREE.Vector3(0, TABLE_TOP, -1.05);
const SWAP_TIME = 0.55;
/** The terrace above the lake. */
const LAKE = -24;

type Item = { kind: 'record'; record: RiderRecord } | { kind: 'win'; win: Win };

export class TrophyRoom {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.05, 20000);
  private items: Item[] = [];
  private index = 0;
  private time = 0;
  private visible = 0;
  private swap = 1;
  private swapDir = 1;
  private current: THREE.Object3D | null = null;
  private outgoing: THREE.Object3D | null = null;
  private models: Record<string, THREE.Object3D> | null = null;
  private loading: Promise<void> | null = null;
  private readonly arrows = buildArrows();
  private readonly sparkles: THREE.Sprite[] = [];
  private readonly fireworks = new Fireworks();
  private readonly sky = new SkyTraffic();
  private scrollTarget: number | null = null;
  private name = '';
  onClose: () => void = () => {};

  constructor(private readonly renderer: THREE.WebGLRenderer, balloon?: THREE.Object3D) {
    this.build(balloon);
    $('trophies-back').addEventListener('click', () => this.onClose());
    const list = $('trophy-cards');
    const settle = () => {
      if (this.scrollTarget !== null) {
        if (Math.abs(list.scrollLeft - this.scrollTarget) > 2) return;
        this.scrollTarget = null;
      }
      const i = Math.round(list.scrollLeft / Math.max(1, list.clientWidth));
      if (i !== this.index && i >= 0 && i < this.items.length) this.show(i, false);
    };
    list.addEventListener('scroll', settle, { passive: true });
    list.addEventListener('scrollend', settle);
    list.addEventListener('pointerdown', () => (this.scrollTarget = null), { passive: true });
    window.addEventListener('keydown', (e) => {
      if (!document.body.classList.contains('trophy-room')) return;
      if (e.key === 'ArrowLeft') this.step(-1);
      else if (e.key === 'ArrowRight') this.step(1);
    });
    this.listenOnScene();
  }

  // ---------- The terrace and the view ----------

  private build(balloon?: THREE.Object3D) {
    const scene = this.scene;
    scene.background = skyTexture();
    scene.fog = new THREE.Fog('#c9dbef', 1800, 9000);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.03).texture;
    scene.environmentIntensity = 0.9;
    scene.add(new THREE.HemisphereLight('#dceaff', '#9aa3ad', 1.1));
    // A bright late-morning sun from behind the terrace, a little to the right.
    const sun = new THREE.DirectionalLight('#fff4e2', 3.2);
    sun.position.set(2.5, 6, 4);
    sun.target.position.copy(SPOT);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = sun.shadow.camera.bottom = -2;
    sun.shadow.camera.right = sun.shadow.camera.top = 2;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 14;
    sun.shadow.bias = -0.0005;
    scene.add(sun, sun.target);
    // A small light that circles the trophy, so its highlights travel over the metal.
    const glint = new THREE.PointLight('#ffffff', 2.2, 3, 2);
    glint.name = 'glint';
    scene.add(glint);

    scene.add(terrace(), railing(), table(), lake(), shoreTrees(), tents(), backdrop());
    this.sky.build(scene, balloon);
    scene.add(this.fireworks.group);
    scene.add(this.arrows);
    const star = sparkleTexture();
    for (let i = 0; i < 5; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: star, color: '#ffffff', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      s.visible = false;
      s.userData = { life: 0, next: Math.random() * 2 };
      this.sparkles.push(s);
      scene.add(s);
    }
    // Badrutt's Palace at the lake's edge, below and to the right.
    void new GLTFLoader().loadAsync(`${base}models/sunnybar.glb`).then((gltf) => {
      const palace = gltf.scene;
      palace.position.set(150, LAKE - 2, -170);
      palace.rotation.y = -0.55;
      palace.traverse((o) => {
        if (o instanceof THREE.Mesh) (o.material as THREE.MeshStandardMaterial).envMapIntensity = 0.3;
      });
      scene.add(palace);
    });
  }

  private load(): Promise<void> {
    this.loading ??= new GLTFLoader().loadAsync(`${base}models/trophies.glb`).then((gltf) => {
      const models: Record<string, THREE.Object3D> = {};
      for (const child of [...gltf.scene.children]) {
        const id = child.name.replace(/^trophy_/, '');
        child.traverse((o) => {
          if (!(o instanceof THREE.Mesh)) return;
          o.castShadow = true;
          o.receiveShadow = true;
          const m = o.material as THREE.MeshStandardMaterial;
          // Polished: the metals mirror the room, gold and silver both.
          if (m.metalness > 0.5) {
            m.roughness = Math.min(m.roughness, 0.12);
            m.envMapIntensity = 1.6;
          } else m.envMapIntensity = 0.35; // varnished wood and ebony: a sheen, not a mirror
        });
        models[id] = child;
      }
      this.models = models;
    });
    return this.loading;
  }

  // ---------- Opening, the cards ----------

  open(c: Career) {
    this.name = RIDERS[c.rider].name;
    this.items = [{ kind: 'record', record: riderRecord(c) }, ...wins(c).map((win) => ({ kind: 'win' as const, win }))];
    this.index = 0;
    this.visible = 0;
    this.time = 0;
    this.fit.set(0, 0);
    this.buildCards(c);
    void this.load().then(() => this.show(this.index, false, true));
    requestAnimationFrame(() => this.scrollTo('instant'));
  }

  close() {
    this.current?.removeFromParent();
    this.outgoing?.removeFromParent();
    this.current = this.outgoing = null;
    this.fireworks.clear();
  }

  private buildCards(c: Career) {
    const list = $('trophy-cards');
    const dots = $('trophy-dots');
    list.replaceChildren();
    dots.replaceChildren();
    this.items.forEach((item, i) => {
      const card = document.createElement('div');
      card.className = 'trophy-card';
      card.innerHTML = item.kind === 'record' ? recordHtml(this.name, c.season, item.record, this.items.length - 1) : winHtml(item.win);
      list.append(card);
      const dot = document.createElement('button');
      dot.setAttribute('aria-label', item.kind === 'record' ? 'Record' : item.win.name);
      dot.addEventListener('click', () => this.show(i, true));
      dots.append(dot);
    });
  }

  private step(by: number) {
    const i = THREE.MathUtils.clamp(this.index + by, 0, this.items.length - 1);
    if (i !== this.index) this.show(i, true);
  }

  private scrollTo(behavior: ScrollBehavior) {
    const list = $('trophy-cards');
    const left = this.index * list.clientWidth;
    this.scrollTarget = Math.abs(list.scrollLeft - left) > 2 ? left : null;
    list.scrollTo({ left, behavior });
  }

  private show(i: number, scroll: boolean, first = false) {
    const from = this.index;
    this.index = i;
    document.querySelectorAll('#trophy-dots button').forEach((d, k) => d.classList.toggle('chosen', k === i));
    if (scroll) this.scrollTo('smooth');
    if (!this.models) return;
    const next = this.objectFor(this.items[i]);
    if (next === this.current && !first) return;
    this.outgoing?.removeFromParent();
    this.outgoing = first ? null : this.current;
    this.current = next;
    this.scene.add(next);
    this.swapDir = i >= from ? 1 : -1;
    this.swap = first ? 1 : 0;
    const item = this.items[i];
    this.fireworks.setOn(item.kind === 'win' && item.win.colours);
  }

  private readonly objects = new Map<string, THREE.Object3D>();

  /** The thing on the table: the engraved board for the record, else the trophy (built once each). */
  private objectFor(item: Item): THREE.Object3D {
    const key = item.kind === 'record' ? 'record' : item.win.model;
    let obj = this.objects.get(key);
    if (obj && item.kind === 'record') {
      obj.removeFromParent();
      this.objects.delete(key);
      obj = undefined;
    }
    if (!obj) {
      if (item.kind === 'record') obj = recordBoard(this.name, item.record);
      else {
        const holder = new THREE.Group();
        const model = (this.models![item.win.model] ?? this.models!.cup).clone();
        holder.add(model);
        obj = holder;
      }
      this.objects.set(key, obj);
    }
    return obj;
  }

  // ---------- Each frame ----------

  update(dt: number) {
    this.time += dt;
    this.frame(dt);
    this.slide(dt);
    this.turn();
    this.glint();
    this.sparkle(dt);
    this.sky.update(dt, this.time);
    this.fireworks.update(dt);
    this.placeArrows();
  }

  /** Framed in the space above the panel (or left of it on a wide screen), drifting a little. */
  private frame(dt: number) {
    const cam = this.camera;
    const canvas = this.renderer.domElement;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    cam.aspect = w / Math.max(1, h);
    const side = w >= 760 && w >= h;
    const panel = document.querySelector<HTMLElement>('#trophies .select-panel')?.offsetHeight ?? h * 0.5;
    const wanted = side ? 1 : THREE.MathUtils.clamp((h - panel) / h, 0.3, 1);
    this.visible = this.visible ? this.visible + (wanted - this.visible) * (1 - Math.exp(-dt * 6)) : wanted;
    if (side) cam.setViewOffset(w, h, 200, 0, w, h);
    else cam.setViewOffset(w, h, 0, h * (0.5 - this.visible / 2), w, h);
    cam.updateProjectionMatrix();
    // Fit what's on the table in the lower part of the view, with the mountains and sky above it,
    // easing between one trophy's fit and the next (a sudden jump makes the outgoing one balloon).
    const size = this.current ? sizeOf(this.current) : new THREE.Vector3(0.4, 0.55, 0.4);
    const height = Math.max(0.28, size.y) / 0.68;
    const width = Math.max(0.36, Math.max(size.x, size.z)) + 0.1;
    const tan = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * this.visible;
    const aspect = (side ? w - 400 : w) / (h * this.visible);
    const wantedDist = Math.max(height / 2 / tan, width / 2 / (tan * Math.min(1.4, aspect)));
    const wantedY = SPOT.y + Math.max(0.28, size.y) * 0.5;
    const k = this.fit.x ? 1 - Math.exp(-dt * 4) : 1;
    this.fit.x += (wantedDist - this.fit.x) * k;
    this.fit.y += (wantedY - this.fit.y) * k;
    const dist = this.fit.x;
    const centre = new THREE.Vector3(SPOT.x, this.fit.y, SPOT.z);
    this.arrowAt.set(centre.y, Math.max(0.36, Math.max(size.x, size.z)) / 2 + 0.1);
    const yaw = Math.sin(this.time * 0.18) * 0.12;
    cam.position.set(centre.x + Math.sin(yaw) * dist, centre.y + 0.05, centre.z + Math.cos(yaw) * dist);
    // Look above the trophy, so it stands a fifth of the view below the middle.
    cam.lookAt(centre.x, centre.y + dist * tan * 0.3, centre.z);
    cam.updateMatrixWorld();
  }

  /** The camera's distance and the height it frames, eased from trophy to trophy. */
  private readonly fit = new THREE.Vector2();

  private slide(dt: number) {
    this.swap = Math.min(1, this.swap + dt / SWAP_TIME);
    const e = this.swap * this.swap * (3 - 2 * this.swap);
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0).setY(0).normalize();
    const width = 1.4;
    if (this.current) this.current.position.copy(SPOT).addScaledVector(right, this.swapDir * (1 - e) * width);
    if (this.outgoing) {
      this.outgoing.position.copy(SPOT).addScaledVector(right, -this.swapDir * e * width);
      if (this.swap >= 1) {
        this.outgoing.removeFromParent();
        this.outgoing = null;
      }
    }
  }

  /** The trophy turns slowly back and forth on the table, so the light runs over it. */
  private turn() {
    if (!this.current) return;
    const item = this.items[this.index];
    const board = item?.kind === 'record';
    this.current.rotation.y = board ? Math.sin(this.time * 0.3) * 0.06 : Math.sin(this.time * 0.35) * 0.55;
  }

  private glint() {
    const light = this.scene.getObjectByName('glint') as THREE.PointLight;
    const a = this.time * 0.9;
    light.position.set(SPOT.x + Math.cos(a) * 0.7, SPOT.y + 0.55 + Math.sin(a * 0.7) * 0.15, SPOT.z + 0.35 + Math.sin(a) * 0.4);
  }

  /** Stars that flash on the metal here and there: on a vertex of the trophy, facing the camera. */
  private sparkle(dt: number) {
    const target = this.current;
    const item = this.items[this.index];
    const shiny = target && item?.kind === 'win' && this.swap >= 1;
    const meshes: THREE.Mesh[] = [];
    if (shiny) target.traverse((o) => o instanceof THREE.Mesh && (o.material as THREE.MeshStandardMaterial).metalness > 0.5 && meshes.push(o));
    for (const s of this.sparkles) {
      const d = s.userData as { life: number; next: number };
      if (d.life > 0) {
        d.life -= dt;
        const k = Math.max(0, d.life / 0.5);
        const pulse = Math.sin(k * Math.PI);
        s.scale.setScalar(0.07 * pulse + 0.005);
        s.material.rotation += dt * 2;
        s.material.opacity = pulse;
        if (d.life <= 0) s.visible = false;
        continue;
      }
      d.next -= dt;
      if (d.next > 0 || !meshes.length) continue;
      const mesh = meshes[Math.floor(Math.random() * meshes.length)];
      const pos = mesh.geometry.attributes.position;
      const v = new THREE.Vector3().fromBufferAttribute(pos, Math.floor(Math.random() * pos.count)).applyMatrix4(mesh.matrixWorld);
      // Only on the side facing the camera (nudged towards it, so it isn't hidden in the metal).
      const toCam = this.camera.position.clone().sub(v).normalize();
      v.addScaledVector(toCam, 0.02);
      s.position.copy(v);
      s.visible = true;
      d.life = 0.5;
      d.next = 0.4 + Math.random() * 1.6;
    }
  }

  /** Height of the middle of what's on the table, and how far out from it the arrows float. */
  private readonly arrowAt = new THREE.Vector2(1, 0.35);

  /** The arrows float either side of the trophy, level with its middle, pulsing outward. */
  private placeArrows() {
    const cam = this.camera;
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0).setY(0).normalize();
    const pulse = 0.015 * Math.sin(this.time * 4);
    // Beside the trophy, but never off the edge of a narrow screen.
    const depth = cam.position.distanceTo(new THREE.Vector3(SPOT.x, this.arrowAt.x, SPOT.z + 0.15));
    const halfWidth = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * cam.aspect * depth;
    const out = Math.min(this.arrowAt.y, halfWidth * 0.8);
    for (const arrow of this.arrows.children) {
      const side = arrow.userData.side as number;
      arrow.position.set(SPOT.x, this.arrowAt.x, SPOT.z + 0.15).addScaledVector(right, side * (out + pulse));
      arrow.quaternion.copy(cam.quaternion);
      arrow.scale.setScalar(0.32);
      arrow.visible = this.swap >= 1 && (side < 0 ? this.index > 0 : this.index < this.items.length - 1);
    }
  }

  /** Swipe across the view (or tap an arrow) for the next. */
  private listenOnScene() {
    const canvas = this.renderer.domElement;
    let start: { x: number; y: number } | null = null;
    canvas.addEventListener('pointerdown', (e) => {
      if (document.body.classList.contains('trophy-room')) start = { x: e.clientX, y: e.clientY };
    });
    canvas.addEventListener('pointerup', (e) => {
      if (!start || !document.body.classList.contains('trophy-room')) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      start = null;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) return this.step(dx < 0 ? 1 : -1);
      const rect = canvas.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      const ray = new THREE.Raycaster();
      ray.setFromCamera(ndc, this.camera);
      const hit = ray.intersectObjects(this.arrows.children, true)[0];
      let node: THREE.Object3D | null = hit?.object ?? null;
      while (node && node.userData.side === undefined) node = node.parent;
      if (node) this.step(node.userData.side as number);
    });
  }
}

/** An object's size standing square to the view (measured once, so a turning trophy doesn't pump the zoom). */
function sizeOf(obj: THREE.Object3D): THREE.Vector3 {
  if (!obj.userData.size) {
    const turn = obj.rotation.y;
    const at = obj.position.clone();
    obj.rotation.y = 0;
    obj.position.set(0, 0, 0);
    obj.updateMatrixWorld(true);
    obj.userData.size = new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3());
    obj.rotation.y = turn;
    obj.position.copy(at);
    obj.updateMatrixWorld(true);
  }
  return obj.userData.size as THREE.Vector3;
}

// ---------- The cards ----------

const fmt = (t: number | null) => (t === null ? '—' : `${t.toFixed(2)} s`);

function recordHtml(name: string, season: number, r: RiderRecord, trophies: number): string {
  const clubs = r.clubs.length
    ? r.clubs.map((club) => `<li><b>The ${club} Club</b><span>${CLUB_LORE[club]}</span></li>`).join('')
    : '<li><span>No clubs yet: you have never come off at a bank. Long may it last.</span></li>';
  return `
    <div class="trophy-kicker">Season ${season} · Record</div>
    <div class="trophy-title">${name}</div>
    <div class="trophy-kpis">
      <div><span>Rides from Junction</span><b>${r.junctionRides}</b></div>
      <div><span>Rides from Top</span><b>${r.topRides}</b></div>
      <div><span>Best from Junction</span><b>${fmt(r.bestJunction)}</b></div>
      <div><span>Best from Top</span><b>${fmt(r.bestTop)}</b></div>
    </div>
    <h3>Clubs</h3>
    <ul class="trophy-clubs">${clubs}</ul>
    <p class="trophy-hint">${trophies ? `${trophies} troph${trophies > 1 ? 'ies' : 'y'} won. Swipe to see ${trophies > 1 ? 'them' : 'it'}.` : 'No trophies yet. Win a race and it will stand here.'}</p>`;
}

function winHtml(w: Win): string {
  return `
    <div class="trophy-kicker">Winner · ${w.date}</div>
    <div class="trophy-title">${w.name}</div>
    ${w.note ? `<div class="trophy-note">${w.note}</div>` : ''}
    <div class="trophy-kpis">
      <div><span>Aggregate</span><b>${w.total.toFixed(2)} s</b></div>
      ${w.net !== null ? `<div><span>Net of handicap</span><b>${w.net.toFixed(2)} s</b></div>` : `<div><span>Field</span><b>${w.of} riders</b></div>`}
    </div>
    <p class="trophy-text">${w.text}</p>`;
}

// ---------- The terrace ----------

const mat = (color: string, roughness = 0.8, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });

/** The terrace's wooden deck, running out to the railing. */
function terrace(): THREE.Object3D {
  const deck = new THREE.Mesh(new THREE.PlaneGeometry(14, 6), mat('#8a7a68', 0.85));
  deck.rotation.x = -Math.PI / 2;
  deck.position.set(0, 0, 0.6);
  deck.receiveShadow = true;
  return deck;
}

/**
 * The black iron railing along the terrace's edge, as in the photographs: a flat top rail and a lower
 * one, plain bars between, and a ring set in every few bays.
 */
function railing(): THREE.Object3D {
  const g = new THREE.Group();
  const iron = mat('#1c1d1f', 0.45, 0.6);
  const z = -1.75;
  const top = new THREE.Mesh(new THREE.BoxGeometry(14, 0.05, 0.08), iron);
  top.position.set(0, 1.05, z);
  const low = new THREE.Mesh(new THREE.BoxGeometry(14, 0.03, 0.03), iron);
  low.position.set(0, 0.12, z);
  const mid = new THREE.Mesh(new THREE.BoxGeometry(14, 0.025, 0.025), iron);
  mid.position.set(0, 0.92, z);
  g.add(top, low, mid);
  const bars = new THREE.InstancedMesh(new THREE.BoxGeometry(0.018, 0.8, 0.018), iron, 120);
  const m = new THREE.Matrix4();
  let n = 0;
  for (let x = -7; x <= 7 && n < 120; x += 0.13, n++) bars.setMatrixAt(n, m.makeTranslation(x, 0.52, z));
  bars.count = n;
  g.add(bars);
  const ringGeo = new THREE.TorusGeometry(0.075, 0.009, 8, 28);
  for (let x = -6.5; x <= 6.5; x += 1.3) {
    const ring = new THREE.Mesh(ringGeo, iron);
    ring.position.set(x + 0.065, 0.52, z);
    g.add(ring);
  }
  for (let x = -7; x <= 7; x += 2.6) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.05, 0.05), iron);
    post.position.set(x, 0.53, z);
    g.add(post);
  }
  g.traverse((o) => (o.castShadow = true));
  return g;
}

/** A table by the railing in the club's deep red cloth (white would vanish against the snow). */
function table(): THREE.Object3D {
  const g = new THREE.Group();
  const cloth = mat('#6e0f14', 0.85);
  const top = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.03, 0.8), cloth);
  top.position.set(0, TABLE_TOP - 0.015, SPOT.z);
  const drape = new THREE.Mesh(new THREE.BoxGeometry(1.32, 0.3, 0.82), cloth);
  drape.position.set(0, TABLE_TOP - 0.17, SPOT.z);
  const legs = mat('#3b2a1e', 0.6);
  for (const x of [-0.6, 0.6])
    for (const zz of [-0.35, 0.35]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, TABLE_TOP - 0.32, 0.05), legs);
      leg.position.set(x, (TABLE_TOP - 0.32) / 2, SPOT.z + zz);
      g.add(leg);
    }
  top.receiveShadow = drape.receiveShadow = true;
  top.castShadow = drape.castShadow = true;
  g.add(top, drape);
  return g;
}

// ---------- The view ----------

/** The frozen lake below, snow over the ice, with the tracks of the races on it. */
function lake(): THREE.Object3D {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d')!;
  g.fillStyle = '#eef2f7';
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 900; i++) {
    g.fillStyle = `rgba(${150 + Math.random() * 60},${170 + Math.random() * 50},${200 + Math.random() * 40},${0.04 + Math.random() * 0.05})`;
    g.fillRect(Math.random() * 512, Math.random() * 512, 6 + Math.random() * 40, 1 + Math.random() * 3);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(20, 20);
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(8000, 5000), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }));
  plane.rotation.x = -Math.PI / 2;
  plane.position.set(0, LAKE, -2400);
  // The slope down from the terrace to the shore, in snow.
  const bank = new THREE.Mesh(new THREE.PlaneGeometry(300, 60), mat('#f3f6fa', 0.95));
  bank.rotation.x = -Math.PI / 2 - Math.atan2(-LAKE, 60);
  bank.position.set(0, LAKE / 2 - 0.5, -32);
  return new THREE.Group().add(plane, bank);
}

/** Spruces on the slope below the terrace and along the near shore. */
function shoreTrees(): THREE.Object3D {
  const g = new THREE.Group();
  const needles = mat('#1d3324', 0.9);
  const snow = mat('#e9eef4', 0.9);
  const trunk = mat('#3d2b1f', 0.9);
  const cone = new THREE.ConeGeometry(1, 1, 9);
  const rand = mulberry(11);
  const spots: [number, number][] = [];
  for (let i = 0; i < 70; i++) {
    const x = (rand() - 0.5) * 260;
    const z = -14 - rand() * 120;
    if (Math.abs(x) < 7 && z > -40) continue; // keep the view over the table clear
    spots.push([x, z]);
  }
  const count = spots.length * 3;
  const tiers = new THREE.InstancedMesh(cone, needles, count);
  const caps = new THREE.InstancedMesh(cone, snow, count);
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.15, 0.2, 1, 6), trunk, spots.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  let n = 0;
  spots.forEach(([x, z], i) => {
    const h = 9 + rand() * 9;
    // The ground falls from the terrace to the lake.
    const y = LAKE * Math.min(1, (-z - 6) / 60);
    trunks.setMatrixAt(i, m.compose(new THREE.Vector3(x, y + 0.8, z), q, new THREE.Vector3(1, 1.6, 1)));
    for (let k = 0; k < 3; k++) {
      const r = h * (0.24 - k * 0.06);
      const th = h * 0.42;
      const cy = y + 1.2 + k * h * 0.26 + th / 2;
      tiers.setMatrixAt(n, m.compose(new THREE.Vector3(x, cy, z), q, new THREE.Vector3(r, th, r)));
      caps.setMatrixAt(n, m.compose(new THREE.Vector3(x, cy + th * 0.08, z), q, new THREE.Vector3(r * 0.75, th * 0.85, r * 0.75)));
      n++;
    }
  });
  g.add(tiers, caps, trunks);
  return g;
}

/** The white tents of the races on the lake, far out on the ice. */
function tents(): THREE.Object3D {
  const g = new THREE.Group();
  const canvas = mat('#fbfbfb', 0.7);
  for (let i = 0; i < 16; i++) {
    const x = -260 + i * 26 + (i % 3) * 4;
    const z = -420 - (i % 2) * 30;
    const body = new THREE.Mesh(new THREE.BoxGeometry(14, 4, 9), canvas);
    body.position.set(x, LAKE + 2, z);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(9, 4, 4), canvas);
    roof.rotation.y = Math.PI / 4;
    roof.scale.set(1, 1, 0.65);
    roof.position.set(x, LAKE + 6, z);
    g.add(body, roof);
  }
  return g;
}

/**
 * The view across the lake: a photograph of Piz Rosatsch from the shore (1880 x 918, cropped just
 * above the ice), on a plane far off, square to the view, pitched so the bottom of the picture (the
 * far shore, its forest and chalets) sits on the horizon.
 */
function backdrop(): THREE.Object3D {
  const tex = new THREE.TextureLoader().load(`${base}textures/sunnybar-rosatsch.webp`);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const W = 1880;
  const FULL_H = 1512;
  const CROP_H = 918;
  const D = 5200;
  // Spread over 42 degrees (narrower than the photo's own), so the whole mountain, forest to
  // peaks, fits in the band of view above the table.
  const focal = W / 2 / Math.tan(THREE.MathUtils.degToRad(42 / 2));
  // Heights on the plane of the crop's top and bottom, about the photo's optical axis.
  const top = (FULL_H / 2 / focal) * D;
  const bottom = ((FULL_H / 2 - CROP_H) / focal) * D;
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry((W / focal) * D, top - bottom),
    new THREE.MeshBasicMaterial({ map: tex, depthWrite: false, fog: false, toneMapped: false }),
  );
  plane.position.set(0, (top + bottom) / 2, -D);
  plane.renderOrder = -1;
  const holder = new THREE.Group();
  holder.position.set(0, LAKE + 4, 0);
  holder.rotation.x = Math.atan((CROP_H - FULL_H / 2) / focal);
  holder.add(plane);
  return holder;
}

/** A deep winter-blue sky, as dark as the photograph's at the top. */
function skyTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 2;
  c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 256);
  // The photograph's sky, where the view reaches above it.
  grad.addColorStop(0, '#0b2c5c');
  grad.addColorStop(0.6, '#163f78');
  grad.addColorStop(1, '#2a5c9e');
  g.fillStyle = grad;
  g.fillRect(0, 0, 2, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function sparkleTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.15, 'rgba(255,250,235,0.8)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  // The four-pointed star of a glint.
  g.fillStyle = 'rgba(255,255,255,0.95)';
  for (const [w, h] of [[2, 30], [30, 2]]) g.fillRect(32 - w, 32 - h, w * 2, h * 2);
  return new THREE.CanvasTexture(c);
}

function mulberry(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- The engraved board ----------

/** The rider's record, gilt lettering on a varnished board, as on the clubhouse walls. */
function recordBoard(name: string, r: RiderRecord): THREE.Object3D {
  const W = 900;
  const H = 1200;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  // Dark varnished wood with its grain.
  const grad = g.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, '#26130a');
  grad.addColorStop(1, '#120803');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  const rand = mulberry(5);
  for (let i = 0; i < 140; i++) {
    g.strokeStyle = `rgba(${rand() < 0.5 ? '6,2,0' : '70,36,16'},${0.06 + rand() * 0.1})`;
    g.lineWidth = 1 + rand() * 3;
    const y = rand() * H;
    g.beginPath();
    g.moveTo(0, y);
    for (let x = 0; x <= W; x += 60) g.lineTo(x, y + Math.sin(x / 140 + i) * 6 + (rand() - 0.5) * 3);
    g.stroke();
  }
  // A gilt border.
  g.strokeStyle = '#c99a3c';
  g.lineWidth = 6;
  g.strokeRect(34, 34, W - 68, H - 68);
  g.lineWidth = 2;
  g.strokeRect(48, 48, W - 96, H - 96);
  const gilt = (text: string, x: number, y: number, size: number, align: CanvasTextAlign = 'center', font = 'Georgia, serif') => {
    g.font = `bold ${size}px ${font}`;
    g.textAlign = align;
    // Cut into the wood, then gilded: a dark lower edge, a bright face.
    g.fillStyle = 'rgba(0,0,0,0.85)';
    g.fillText(text, x + 2, y + 3);
    const face = g.createLinearGradient(0, y - size, 0, y);
    face.addColorStop(0, '#fff2c4');
    face.addColorStop(0.5, '#f2c862');
    face.addColorStop(1, '#d09a32');
    g.fillStyle = face;
    g.fillText(text, x, y);
  };
  gilt('ST MORITZ', W / 2, 140, 48);
  gilt('TOBOGGANING CLUB', W / 2, 196, 48);
  gilt(name.toUpperCase(), W / 2, 306, 72);
  g.fillStyle = '#c99a3c';
  g.fillRect(W / 2 - 160, 330, 320, 3);
  const row = (label: string, value: string, y: number) => {
    gilt(label, 100, y, 40, 'left');
    gilt(value, W - 100, y, 40, 'right');
  };
  row('Rides from Junction', String(r.junctionRides), 420);
  row('Rides from Top', String(r.topRides), 480);
  row('Best from Junction', r.bestJunction === null ? '—' : r.bestJunction.toFixed(2), 560);
  row('Best from Top', r.bestTop === null ? '—' : r.bestTop.toFixed(2), 620);
  gilt('CLUBS', W / 2, 730, 44);
  g.fillRect(W / 2 - 90, 748, 180, 2);
  if (r.clubs.length) r.clubs.forEach((club, i) => gilt(`The ${club} Club`, W / 2, 812 + i * 52, 40));
  else gilt('— none yet —', W / 2, 810, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const group = new THREE.Group();
  const bw = 0.42;
  const bh = (bw * H) / W;
  // Matte, a little shaded, and the lettering faintly lit from within: readable in full sun.
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(bw, bh),
    new THREE.MeshStandardMaterial({ map: tex, color: '#9a9a9a', roughness: 0.85, envMapIntensity: 0.05, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.22 }),
  );
  const back = new THREE.Mesh(new THREE.BoxGeometry(bw + 0.03, bh + 0.03, 0.025), mat('#2a160a', 0.4));
  // Leaning back a little on its stand.
  const board = new THREE.Group();
  face.position.z = 0.0131;
  board.add(back, face);
  board.rotation.x = -0.14;
  board.position.set(0, bh / 2 + 0.01, 0);
  const foot = new THREE.Mesh(new THREE.BoxGeometry(bw * 0.8, 0.02, 0.12), mat('#2a160a', 0.4));
  foot.position.set(0, 0.01, 0.0);
  board.traverse((o) => (o.castShadow = true));
  group.add(board, foot);
  return group;
}

// ---------- Sky traffic: clouds, a biplane, a balloon ----------

class SkyTraffic {
  private clouds: THREE.Sprite[] = [];
  private plane: THREE.Group | null = null;
  private propeller: THREE.Object3D | null = null;
  private planeT = -1;
  private planeWait = 6;
  private balloon: THREE.Object3D | null = null;

  build(scene: THREE.Scene, balloon?: THREE.Object3D) {
    const tex = cloudTexture();
    for (let i = 0; i < 7; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, opacity: 0.85 }));
      const w = 900 + Math.random() * 900;
      s.scale.set(w, w * 0.32, 1);
      s.position.set(-4000 + Math.random() * 8000, 1700 + Math.random() * 1400, -4600 - Math.random() * 500);
      s.userData.speed = 18 + Math.random() * 22;
      s.renderOrder = -2;
      this.clouds.push(s);
      scene.add(s);
    }
    this.plane = biplane();
    this.plane.visible = false;
    scene.add(this.plane);
    this.propeller = this.plane.getObjectByName('prop') ?? null;
    if (balloon) {
      this.balloon = balloon.clone();
      this.balloon.scale.setScalar(1.6);
      scene.add(this.balloon);
    }
  }

  update(dt: number, time: number) {
    for (const s of this.clouds) {
      s.position.x += s.userData.speed * dt;
      if (s.position.x > 4600) s.position.x = -4600;
    }
    // Now and then a biplane, low over the lake, left to right.
    if (this.plane) {
      if (this.planeT < 0) {
        this.planeWait -= dt;
        if (this.planeWait <= 0) this.planeT = 0;
      } else {
        this.planeT += dt / 26;
        const t = this.planeT;
        this.plane.visible = true;
        this.plane.position.set(-900 + t * 1800, LAKE + 45 + Math.sin(t * 7) * 6, -620);
        this.plane.rotation.set(0, 0, Math.sin(t * 9) * 0.06);
        if (this.propeller) this.propeller.rotation.x += dt * 60;
        if (t >= 1) {
          this.plane.visible = false;
          this.planeT = -1;
          this.planeWait = 25 + Math.random() * 30;
        }
      }
    }
    // The balloon drifts slowly across, high over the far shore.
    if (this.balloon) {
      const t = (time * 0.006 + 0.3) % 1;
      this.balloon.position.set(-1500 + t * 3000, 420 + Math.sin(time * 0.1) * 30, -1900);
      this.balloon.rotation.y = time * 0.05;
    }
  }
}

function cloudTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 160;
  const g = c.getContext('2d')!;
  const rand = mulberry(3);
  for (let i = 0; i < 70; i++) {
    const x = 60 + rand() * 390;
    const y = 70 + (rand() - 0.5) * 50 * Math.sin((x / 512) * Math.PI);
    const r = 18 + rand() * 40 * Math.sin((x / 512) * Math.PI);
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A red biplane: fuselage, two wings and their struts, a tail, a spinning propeller. About 8 m long. */
function biplane(): THREE.Group {
  const g = new THREE.Group();
  const red = mat('#b3221c', 0.5);
  const cream = mat('#efe6d0', 0.6);
  const dark = mat('#222', 0.5);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.2, 7, 10), red);
  body.rotation.z = Math.PI / 2;
  g.add(body);
  for (const y of [-0.5, 0.9]) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.12, 9.5), cream);
    wing.position.set(1.0, y, 0);
    g.add(wing);
  }
  for (const z of [-3.6, -1, 1, 3.6]) {
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.4, 0.08), dark);
    strut.position.set(1.0, 0.2, z);
    g.add(strut);
  }
  const tail = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.08, 3), cream);
  tail.position.set(-3.2, 0.1, 0);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.2, 0.08), red);
  fin.position.set(-3.2, 0.6, 0);
  const prop = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.4, 0.2), dark);
  prop.position.set(3.6, 0, 0);
  prop.name = 'prop';
  g.add(tail, fin, prop);
  g.scale.setScalar(1.4);
  return g;
}

// ---------- Fireworks for the colour races ----------

class Fireworks {
  readonly group = new THREE.Group();
  private on = false;
  private wait = 0;
  private bursts: { points: THREE.Points; vel: Float32Array; age: number; life: number }[] = [];
  private readonly texture = sparkleTexture();

  setOn(on: boolean) {
    this.on = on;
    this.wait = 0.4;
  }

  clear() {
    for (const b of this.bursts) b.points.removeFromParent();
    this.bursts = [];
    this.on = false;
  }

  update(dt: number) {
    if (this.on) {
      this.wait -= dt;
      if (this.wait <= 0) {
        this.burst();
        this.wait = 0.7 + Math.random() * 1.6;
      }
    }
    for (const b of [...this.bursts]) {
      b.age += dt;
      const pos = b.points.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        b.vel[i * 3 + 1] -= 30 * dt;
        const drag = Math.exp(-dt * 1.4);
        b.vel[i * 3] *= drag;
        b.vel[i * 3 + 1] *= drag;
        b.vel[i * 3 + 2] *= drag;
        pos.setXYZ(i, pos.getX(i) + b.vel[i * 3] * dt, pos.getY(i) + b.vel[i * 3 + 1] * dt, pos.getZ(i) + b.vel[i * 3 + 2] * dt);
      }
      pos.needsUpdate = true;
      const m = b.points.material as THREE.PointsMaterial;
      m.opacity = Math.max(0, 1 - b.age / b.life) * (0.75 + 0.25 * Math.sin(b.age * 40));
      if (b.age >= b.life) {
        b.points.removeFromParent();
        b.points.geometry.dispose();
        this.bursts.splice(this.bursts.indexOf(b), 1);
      }
    }
  }

  /** One shell bursting over the lake: a sphere of sparks in the club's colours, falling and fading. */
  private burst() {
    // Saturated colours, drawn solid: in full sun over snow, additive sparks would wash out to nothing.
    const colours = ['#ffb300', '#e8141c', '#11a84e', '#1f5fe0', '#d4148c', '#ff6a00'];
    const colour = new THREE.Color(colours[Math.floor(Math.random() * colours.length)]);
    const n = 160;
    const positions = new Float32Array(n * 3);
    const vel = new Float32Array(n * 3);
    // Over the mountains, 7 to 16 degrees up: the band of the view above the trophy.
    const d = 1300 + Math.random() * 500;
    const up = THREE.MathUtils.degToRad(7 + Math.random() * 9);
    const across = THREE.MathUtils.degToRad((Math.random() - 0.5) * 34);
    const centre = new THREE.Vector3(Math.sin(across) * d, 1 + Math.tan(up) * d, -Math.cos(across) * d);
    const speed = 70 + Math.random() * 50;
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(speed * (0.8 + Math.random() * 0.25));
      positions.set([centre.x, centre.y, centre.z], i * 3);
      vel.set([v.x, v.y, v.z], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({ color: colour, size: 30, map: this.texture, transparent: true, depthWrite: false, fog: false, toneMapped: false });
    const points = new THREE.Points(geo, material);
    this.group.add(points);
    this.bursts.push({ points, vel, age: 0, life: 2.2 + Math.random() * 0.6 });
  }
}

