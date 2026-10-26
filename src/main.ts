import './style.css';
import * as THREE from 'three';
import { registerSW } from 'virtual:pwa-register';
import { Track } from './sim/track';
import { createWorld } from './render/world';
import { buildTrackMesh } from './render/trackMesh';
import { Terrain } from './render/terrain';
import { buildScenery } from './render/scenery';
import { buildRiderPlaceholder } from './render/riderPlaceholder';
import { Viewer } from './viewer/viewer';

registerSW({ immediate: true });

const debug = new URLSearchParams(location.search).has('debug');
if (debug) document.body.classList.add('debug');

// Let the loading screen paint before the heavy geometry work.
setTimeout(start, 50);

function start() {
  const t0 = performance.now();
  const lap = (label: string) => debug && console.info(`${label}: ${(performance.now() - t0).toFixed(0)} ms`);
  const world = createWorld(document.getElementById('scene') as HTMLCanvasElement);
  const track = new Track();
  lap('track');
  const trackMesh = buildTrackMesh(track);
  lap('track mesh');
  const terrain = new Terrain(track);
  lap('terrain');
  world.scene.add(trackMesh, terrain.mesh, buildScenery(track, terrain));
  lap('scenery');
  const rider = buildRiderPlaceholder();
  world.scene.add(rider);
  const viewer = new Viewer(world, track, terrain, rider);
  if (debug) Object.assign(window, { world, track, viewer });

  const clock = new THREE.Clock();
  const fps = document.getElementById('fps')!;
  let frames = 0;
  let fpsTime = 0;
  world.renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    viewer.update(dt);
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
