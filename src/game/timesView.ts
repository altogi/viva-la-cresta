// "My times": every clean ride from Junction or from Top, fastest first, and above the list an
// aerial view of Shuttlecock, from the end of Battledore to the start of Stream, with the line the
// chosen ride took through it on the ice, coloured by speed.

import * as THREE from 'three';
import { dateOf, type Career, type RideRecord, type Start } from '../career/career';
import { LINE, lineS } from '../career/lines';
import { raceById } from '../career/races';
import { TOBOGGANS } from '../sim/rider';
import { surfaceAt } from '../sim/surface';
import type { Track } from '../sim/track';
import type { World } from '../render/world';
import { toThree } from '../render/util';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const MPH = 2.23694;
/**
 * The colour scales (mph) through this stretch, one for each start so a ride's slow and fast
 * stretches show: from Junction riders come through at 30-37, from Top at 34-45.
 */
const SCALE: Record<Start, [number, number]> = { junction: [28, 40], top: [30, 50] };

/** Blue (slow) through green and yellow to red (fast). */
export function speedColour(mph: number, [slow, fast]: [number, number], out = new THREE.Color()): THREE.Color {
  const k = THREE.MathUtils.clamp((mph - slow) / (fast - slow), 0, 1);
  return out.setHSL(0.66 * (1 - k), 0.9, 0.5);
}

export class TimesView {
  private start: Start = 'junction';
  private career: Career | null = null;
  private rows: RideRecord[] = [];
  private chosen = 0;
  private ribbon: THREE.Mesh | null = null;
  private readonly centre = new THREE.Vector3();
  private readonly along = new THREE.Vector3();
  private extent = 1;
  private visible = 0;
  private savedFov = 0;
  onClose: () => void = () => {};

  constructor(
    private readonly world: World,
    private readonly track: Track,
  ) {
    $('times-back').addEventListener('click', () => this.onClose());
    for (const b of document.querySelectorAll<HTMLButtonElement>('[data-times-start]')) {
      b.addEventListener('click', () => {
        this.start = b.dataset.timesStart as Start;
        this.refresh();
      });
    }
    $('times-list').addEventListener('click', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('[data-row]');
      if (!row) return;
      this.chosen = Number(row.dataset.row);
      this.markChosen();
      this.drawLine();
    });
    this.frameRegion();
  }

  /** The colour bar down the right of the view, for this start's scale. */
  private colourBar() {
    const scale = SCALE[this.start];
    const [slow, fast] = scale;
    const bar = $('times-colorbar');
    bar.querySelector<HTMLElement>('.bar')!.style.background = `linear-gradient(to top, ${[0, 0.25, 0.5, 0.75, 1].map((k) => `#${speedColour(slow + k * (fast - slow), scale).getHexString()}`).join(', ')})`;
    bar.querySelector('.hi')!.textContent = `${fast}`;
    bar.querySelector('.mid')!.textContent = `${(slow + fast) / 2}`;
    bar.querySelector('.lo')!.textContent = `${slow}`;
  }

  /** The stretch to show: its middle, the way the run goes through it, and how big it is. */
  private frameRegion() {
    const box = new THREE.Box3();
    for (let s = LINE.from; s <= LINE.to; s += 4) box.expandByPoint(toThree(this.track.frame(s).pos));
    box.getCenter(this.centre);
    const a = toThree(this.track.frame(LINE.from).pos);
    const b = toThree(this.track.frame(LINE.to).pos);
    this.along.copy(b).sub(a).setY(0).normalize();
    const size = box.getSize(new THREE.Vector3());
    // Generous: room round the run for its banks and the snow beside it.
    this.extent = Math.max(size.x, size.z) * 0.5 + 18;
  }

  open(c: Career) {
    this.career = c;
    // Open on the start the rider rides most.
    const top = c.rides.filter((r) => r.start === 'top' && r.time !== null).length;
    const junction = c.rides.filter((r) => r.start === 'junction' && r.time !== null).length;
    this.start = top > junction ? 'top' : 'junction';
    this.visible = 0;
    this.savedFov = this.world.camera.fov;
    this.refresh();
  }

  close() {
    this.ribbon?.removeFromParent();
    this.ribbon = null;
    const cam = this.world.camera;
    cam.clearViewOffset();
    cam.fov = this.savedFov || cam.fov;
    cam.updateProjectionMatrix();
  }

  private refresh() {
    const c = this.career!;
    for (const b of document.querySelectorAll<HTMLElement>('[data-times-start]')) b.classList.toggle('chosen', b.dataset.timesStart === this.start);
    this.colourBar();
    this.rows = c.rides.filter((r) => r.start === this.start && r.time !== null).sort((x, y) => x.time! - y.time!);
    this.chosen = 0;
    const list = $('times-list');
    if (!this.rows.length) {
      list.innerHTML = `<p class="muted">No clean rides from ${this.start === 'top' ? 'Top' : 'Junction'} yet.</p>`;
    } else {
      list.innerHTML = this.rows
        .map((r, i) => {
          const d = dateOf(r.day, r.season);
          const what = r.race ? raceById(r.race)?.name ?? 'Race' : 'Practice';
          return `<button class="times-row" data-row="${i}">
            <span class="rank">${i + 1}</span>
            <span class="when"><b>${what}</b><small>${d.label} ${d.year} · ${TOBOGGANS[r.toboggan].name}${r.style === 'lying' ? ' · lying' : ''}</small></span>
            <span class="time">${r.time!.toFixed(2)}</span>
          </button>`;
        })
        .join('');
    }
    this.markChosen();
    this.drawLine();
  }

  private markChosen() {
    document.querySelectorAll('#times-list .times-row').forEach((row, i) => row.classList.toggle('chosen', i === this.chosen));
  }

  /** The chosen ride's line on the ice: a ribbon along the surface it rode, coloured by speed. */
  private drawLine() {
    this.ribbon?.removeFromParent();
    this.ribbon = null;
    const ride = this.rows[this.chosen];
    $('times-note').textContent = !ride ? '' : ride.line?.length ? '' : 'No line recorded for this ride (it was ridden before lines were kept).';
    if (!ride?.line?.length) return;
    const positions: number[] = [];
    const colours: number[] = [];
    const index: number[] = [];
    const c = new THREE.Color();
    const v = new THREE.Vector3();
    const n = ride.line.length / 2;
    for (let i = 0; i < n; i++) {
      const s = lineS(i);
      const u = ride.line[i * 2];
      const mph = ride.line[i * 2 + 1] * MPH;
      const frame = this.track.frame(s);
      const sp = surfaceAt(this.track.section(s), u);
      // A little off the ice, either side of the line across the surface it was ridden on (wider
      // than a toboggan, to read from up here).
      for (const side of [-1, 1]) {
        const half = 0.45 * side;
        toThree(this.track.toWorld(frame, sp.y + sp.ty * half + sp.ny * 0.06, sp.z + sp.tz * half + sp.nz * 0.06), v);
        positions.push(v.x, v.y, v.z);
        speedColour(mph, SCALE[this.start], c);
        colours.push(c.r, c.g, c.b);
      }
      if (i > 0) {
        const k = i * 2;
        index.push(k - 2, k - 1, k, k - 1, k + 1, k);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
    geo.setIndex(index);
    this.ribbon = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 }));
    this.ribbon.renderOrder = 2;
    this.world.scene.add(this.ribbon);
  }

  /** From high above, the run going up the screen, the stretch filling the space above the list. */
  update(dt: number) {
    const cam = this.world.camera;
    const canvas = this.world.renderer.domElement;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const side = w >= 760 && w >= h;
    cam.fov = 40;
    const panel = document.querySelector<HTMLElement>('#times .select-panel')?.offsetHeight ?? h * 0.5;
    const wanted = side ? 1 : THREE.MathUtils.clamp((h - panel) / h, 0.3, 1);
    this.visible = this.visible ? this.visible + (wanted - this.visible) * (1 - Math.exp(-dt * 6)) : wanted;
    if (side) cam.setViewOffset(w, h, 200, 0, w, h);
    else cam.setViewOffset(w, h, 0, h * (0.5 - this.visible / 2), w, h);
    const tan = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    const aspect = (side ? w - 400 : w) / (h * this.visible);
    // Fit the stretch both ways (the visible slice is `visible` of the view's height).
    const height = Math.max(this.extent / (tan * this.visible), this.extent / (tan * this.visible * Math.min(1, aspect)));
    // Looking almost straight down, tipped a touch so the banks show their faces.
    cam.position.copy(this.centre).addScaledVector(this.along, -height * 0.12).add(new THREE.Vector3(0, height, 0));
    cam.up.copy(this.along);
    cam.lookAt(this.centre);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    this.world.followSun(this.centre);
  }
}
