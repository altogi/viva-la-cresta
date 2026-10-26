import './style.css';
import * as THREE from 'three';
import { registerSW } from 'virtual:pwa-register';
import { Track } from './sim/track';
import { JUNCTION_S } from './track/cresta';
import { createWorld } from './render/world';
import { buildTrackMesh } from './render/trackMesh';
import { Terrain } from './render/terrain';
import { buildScenery } from './render/scenery';
import { buildRiderPlaceholder } from './render/riderPlaceholder';
import { Viewer } from './viewer/viewer';
import { RideMode, type RideSetup } from './game/rideMode';
import { Sound } from './audio/sound';
import { POLICIES } from './sim/autopilot';
import { createTuningPanel } from './ui/tuning';

registerSW({ immediate: true });

const params = new URLSearchParams(location.search);
const debug = params.has('debug');
if (debug) document.body.classList.add('debug');

const RIDES: Record<string, RideSetup> = {
  'junction-lying': { startS: JUNCTION_S, start: 'lying', label: 'Junction · lying start' },
  'junction-running': { startS: JUNCTION_S, start: 'running', steps: 7, label: 'Junction · running start' },
  'top-running': { startS: 0, start: 'running', steps: 7, label: 'Top · running start' },
};

// Let the loading screen paint before the heavy geometry work.
setTimeout(start, 50);

function start() {
  const t0 = performance.now();
  const lap = (label: string) => debug && console.info(`${label}: ${(performance.now() - t0).toFixed(0)} ms`);
  const world = createWorld(document.getElementById('scene') as HTMLCanvasElement);
  const track = new Track();
  const trackMesh = buildTrackMesh(track);
  const terrain = new Terrain(track);
  world.scene.add(trackMesh, terrain.mesh, buildScenery(track, terrain));
  lap('scene');

  const ghost = buildRiderPlaceholder();
  world.scene.add(ghost);
  const viewer = new Viewer(world, track, terrain, ghost);
  const sound = new Sound();
  const ride = new RideMode(world, track, terrain, sound);
  if (debug) {
    Object.assign(window, { world, track, viewer, ride });
    createTuningPanel();
  }
  const bot = params.get('autopilot');
  if (bot && POLICIES[bot]) ride.autopilot = POLICIES[bot];

  type Mode = 'menu' | 'ride' | 'viewer';
  let mode: Mode = 'menu';
  const setMode = (next: Mode) => {
    mode = next;
    document.body.classList.toggle('in-menu', next === 'menu');
    document.body.classList.toggle('viewing', next === 'viewer');
    ghost.visible = next !== 'ride';
    viewer.setAttract(next === 'menu');
  };
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-ride]')) {
    button.addEventListener('click', () => {
      sound.start();
      setMode('ride');
      ride.begin(RIDES[button.dataset.ride!]);
    });
  }
  document.getElementById('open-viewer')!.addEventListener('click', () => setMode('viewer'));
  document.getElementById('viewer-close')!.addEventListener('click', () => setMode('menu'));
  ride.onExit = () => setMode('menu');
  setMode(params.has('viewer') ? 'viewer' : 'menu');

  const clock = new THREE.Clock();
  const fps = document.getElementById('fps')!;
  let frames = 0;
  let fpsTime = 0;
  world.renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    if (mode === 'ride') ride.update(dt);
    else viewer.update(dt);
    world.renderer.render(world.scene, world.camera);
    if (debug) {
      frames++;
      fpsTime += dt;
      if (fpsTime > 0.5) {
        const info = world.renderer.info.render;
        fps.textContent = `${(frames / fpsTime).toFixed(0)} fps · ${info.calls} calls · ${(info.triangles / 1000).toFixed(0)}k tris`;
        frames = 0;
        fpsTime = 0;
      }
    }
  });
  document.body.classList.add('ready');
}
