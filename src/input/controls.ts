// Ride controls. Portrait touch zones around the rider (hold for intensity, multi-touch),
// with keyboard equivalents for desktop:
//   front:        tap to go back on the knives / forward again      (↑ or W)
//   left, right:  hold to steer                                      (← → or A D)
//   bottom row:   hold to rake left foot / both / right foot         (Z X C)
//   run button:   tap rhythmically for a running start               (Space)

import type { RideInput } from '../sim/physics';

type Zone = 'front' | 'left' | 'right' | 'rakeLeft' | 'rakeBoth' | 'rakeRight' | 'run';

const RAMP_UP = 0.3; // seconds to full intensity while held
const RAMP_DOWN = 0.08;

export class Controls {
  private knives = false;
  private runTaps = 0;
  private readonly held = new Map<number | string, Zone>();
  private readonly level = { left: 0, right: 0, rakeLeft: 0, rakeRight: 0 };
  readonly root: HTMLElement;
  /** Fired on each knives toggle and run tap, for feedback (haptics, sound). */
  onTap: (zone: Zone) => void = () => {};

  constructor(root: HTMLElement) {
    this.root = root;
    root.addEventListener('pointerdown', (e) => this.press(e));
    root.addEventListener('pointerup', (e) => this.release(e.pointerId));
    root.addEventListener('pointercancel', (e) => this.release(e.pointerId));
    root.addEventListener('pointerleave', (e) => this.release(e.pointerId));
    window.addEventListener('keydown', (e) => this.key(e, true));
    window.addEventListener('keyup', (e) => this.key(e, false));
  }

  reset(knives = false) {
    this.knives = knives;
    this.runTaps = 0;
    this.held.clear();
    this.level.left = this.level.right = this.level.rakeLeft = this.level.rakeRight = 0;
    this.render();
  }

  get onKnives() {
    return this.knives;
  }

  /** Set whether the run button is shown (running start) instead of the middle rake zone. */
  setRunning(running: boolean) {
    this.root.classList.toggle('running', running);
  }

  private zoneAt(e: PointerEvent): Zone | null {
    const el = (e.target as HTMLElement).closest('[data-zone]') as HTMLElement | null;
    return (el?.dataset.zone as Zone) ?? null;
  }

  private press(e: PointerEvent) {
    const zone = this.zoneAt(e);
    if (!zone) return;
    e.preventDefault();
    this.root.setPointerCapture?.(e.pointerId);
    this.tap(zone);
    this.held.set(e.pointerId, zone);
    this.render();
  }

  private release(id: number | string) {
    if (this.held.delete(id)) this.render();
  }

  private tap(zone: Zone) {
    if (zone === 'front') this.knives = !this.knives;
    if (zone === 'run') this.runTaps++;
    if (zone === 'front' || zone === 'run') {
      this.onTap(zone);
      navigator.vibrate?.(8);
    }
  }

  private key(e: KeyboardEvent, down: boolean) {
    const map: Record<string, Zone> = {
      ArrowUp: 'front', KeyW: 'front',
      ArrowLeft: 'left', KeyA: 'left',
      ArrowRight: 'right', KeyD: 'right',
      KeyZ: 'rakeLeft', KeyX: 'rakeBoth', KeyC: 'rakeRight',
      Space: 'run',
    };
    const zone = map[e.code];
    if (!zone) return;
    e.preventDefault();
    if (down && !e.repeat) {
      this.tap(zone);
      this.held.set(e.code, zone);
    } else if (!down) {
      this.held.delete(e.code);
    }
    this.render();
  }

  private isHeld(...zones: Zone[]) {
    for (const z of this.held.values()) if (zones.includes(z)) return true;
    return false;
  }

  /** Current input, with held zones ramped towards full intensity. */
  read(dt: number): RideInput {
    const ramp = (value: number, on: boolean) =>
      on ? Math.min(1, value + dt / RAMP_UP) : Math.max(0, value - dt / RAMP_DOWN);
    const l = this.level;
    l.left = ramp(l.left, this.isHeld('left'));
    l.right = ramp(l.right, this.isHeld('right'));
    l.rakeLeft = ramp(l.rakeLeft, this.isHeld('rakeLeft', 'rakeBoth'));
    l.rakeRight = ramp(l.rakeRight, this.isHeld('rakeRight', 'rakeBoth'));
    const input: RideInput = {
      knives: this.knives,
      steer: l.left - l.right,
      rakeLeft: l.rakeLeft,
      rakeRight: l.rakeRight,
      runTaps: this.runTaps,
    };
    this.runTaps = 0;
    return input;
  }

  private render() {
    this.root.classList.toggle('knives', this.knives);
    for (const el of this.root.querySelectorAll<HTMLElement>('[data-zone]')) {
      el.classList.toggle('held', this.isHeld(el.dataset.zone as Zone));
    }
  }
}
