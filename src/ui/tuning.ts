// Debug-only physics tuning panel (?debug), for playtesting the feel of the ride.

import GUI from 'lil-gui';
import { ADELAIDE, PHYSICS, TRADITIONAL } from '../sim/rider';

export function createTuningPanel() {
  const gui = new GUI({ title: 'Physics', width: 260 });
  gui.close();
  // Keep clear of the ride HUD buttons in the top-right corner.
  Object.assign(gui.domElement.style, { top: 'auto', bottom: '0', right: 'auto', left: '0', zIndex: '10' });
  const ice = gui.addFolder('Ice & air');
  ice.add(TRADITIONAL, 'muForward', 0, 0.03, 0.001).name('runner μ forward');
  ice.add(TRADITIONAL, 'muKnives', 0, 0.1, 0.001).name('runner μ knives');
  ice.add(ADELAIDE, 'dragArea', 0.05, 0.3, 0.005).name('drag area');
  const control = gui.addFolder('Control');
  control.add(PHYSICS, 'rakeKnives', 0, 4, 0.1).name('rake on knives');
  control.add(PHYSICS, 'rakeForward', 0, 2, 0.1).name('rake forward');
  control.add(PHYSICS, 'steerKnives', 0, 8, 0.1).name('steer on knives');
  control.add(PHYSICS, 'steerForward', 0, 0.01, 0.0005).name('steer forward');
  control.add(PHYSICS, 'rakeSteer', 0, 0.3, 0.01).name('one-foot rake steer');
  control.add(PHYSICS, 'gripForward', 0, 5, 0.1).name('grip forward');
  control.add(PHYSICS, 'gripKnives', 0, 6, 0.1).name('grip knives');
  control.add(ADELAIDE, 'transitionTime', 0.1, 1.5, 0.05).name('knives transition s');
  const falls = gui.addFolder('Falls');
  falls.add(PHYSICS, 'crashSpeed', 2, 12, 0.5).name('crash speed m/s');
  return gui;
}
