// The Top hut: the octagonal wooden pavilion beside the Top start, modelled on photographs.
// Dark aubergine timber frame, cream carved panels with star motifs under tall multi-pane windows,
// a broad eave carrying a deep layer of snow, and the loudspeaker horn under the eave.

import * as THREE from 'three';

const SIDES = 8;
const RADIUS = 3.4; // to the corners, matching the OSM footprint
const PLINTH = 0.6;
const PANEL = 1.1; // carved panels below the windows
const WINDOW = 2.1;
const FRIEZE = 0.45;

const timber = new THREE.MeshStandardMaterial({ color: '#4a3f52', roughness: 0.7 });
const cream = new THREE.MeshStandardMaterial({ color: '#d9c49a', roughness: 0.8 });

/** One face: carved panel below, a tall window of small panes above (canvas texture). */
function faceTexture(): THREE.CanvasTexture {
  const w = 256;
  const h = 512;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d')!;
  const panelH = (PANEL / (PANEL + WINDOW + FRIEZE)) * h;
  const friezeH = (FRIEZE / (PANEL + WINDOW + FRIEZE)) * h;
  // Frieze (top), window (middle), carved panel (bottom).
  g.fillStyle = '#d9c49a';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#4a3f52';
  g.fillRect(0, friezeH - 8, w, 8);
  // Window: dark glass with a hint of sky, divided into small panes by cream glazing bars.
  const winTop = friezeH;
  const winH = h - friezeH - panelH;
  const glass = g.createLinearGradient(0, winTop, 0, winTop + winH);
  glass.addColorStop(0, '#9fb6c9');
  glass.addColorStop(0.45, '#4f6577');
  glass.addColorStop(1, '#2a3540');
  g.fillStyle = glass;
  g.fillRect(14, winTop + 6, w - 28, winH - 12);
  g.fillStyle = '#efe4c8';
  for (let c = 1; c < 3; c++) g.fillRect(14 + ((w - 28) * c) / 3 - 3, winTop + 6, 6, winH - 12);
  for (let r = 1; r < 5; r++) g.fillRect(14, winTop + 6 + ((winH - 12) * r) / 5 - 3, w - 28, 6);
  g.strokeStyle = '#4a3f52';
  g.lineWidth = 10;
  g.strokeRect(14, winTop + 6, w - 28, winH - 12);
  // Carved panel with a star in a lozenge.
  const py = h - panelH;
  g.fillStyle = '#4a3f52';
  g.fillRect(0, py, w, 8);
  g.fillStyle = '#cdb68a';
  g.fillRect(18, py + 18, w - 36, panelH - 36);
  g.strokeStyle = '#8c7650';
  g.lineWidth = 4;
  g.strokeRect(18, py + 18, w - 36, panelH - 36);
  const cx = w / 2;
  const cy = py + panelH / 2;
  g.beginPath();
  g.moveTo(cx, cy - panelH * 0.32);
  g.lineTo(cx + w * 0.3, cy);
  g.lineTo(cx, cy + panelH * 0.32);
  g.lineTo(cx - w * 0.3, cy);
  g.closePath();
  g.stroke();
  g.fillStyle = '#8c7650';
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 ? 12 : 30;
    g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  g.closePath();
  g.fill();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function buildTopHut(): THREE.Group {
  const hut = new THREE.Group();
  hut.name = 'top-hut';
  const face = new THREE.MeshStandardMaterial({ map: faceTexture(), roughness: 0.75 });
  const apothem = RADIUS * Math.cos(Math.PI / SIDES);
  const side = 2 * RADIUS * Math.sin(Math.PI / SIDES);
  const wallH = PANEL + WINDOW + FRIEZE;

  // Snow-covered plinth.
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(RADIUS + 0.25, RADIUS + 0.45, PLINTH, SIDES), new THREE.MeshStandardMaterial({ color: '#efe9e0', roughness: 0.9 }));
  plinth.position.y = PLINTH / 2;
  plinth.rotation.y = Math.PI / SIDES;
  hut.add(plinth);

  for (let i = 0; i < SIDES; i++) {
    const a = (i / SIDES) * Math.PI * 2;
    // Face panel.
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(side * 0.98, wallH), face);
    panel.position.set(Math.cos(a) * apothem, PLINTH + wallH / 2, Math.sin(a) * apothem);
    panel.rotation.y = Math.PI / 2 - a;
    hut.add(panel);
    // Corner post.
    const ca = a + Math.PI / SIDES;
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.22, wallH + 0.15, 0.22), timber);
    post.position.set(Math.cos(ca) * RADIUS, PLINTH + wallH / 2, Math.sin(ca) * RADIUS);
    post.rotation.y = -ca;
    hut.add(post);
    // Carved brackets under the eave.
    const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.18, 0.14), timber);
    bracket.position.set(Math.cos(ca) * (RADIUS + 0.4), PLINTH + wallH - 0.05, Math.sin(ca) * (RADIUS + 0.4));
    bracket.rotation.y = -ca;
    bracket.rotation.z = 0.5;
    hut.add(bracket);
  }
  // Inner core so the windows read as glazing, not a hollow shell.
  const core = new THREE.Mesh(new THREE.CylinderGeometry(apothem - 0.15, apothem - 0.15, wallH, SIDES), new THREE.MeshStandardMaterial({ color: '#3a3026', roughness: 1 }));
  core.position.y = PLINTH + wallH / 2;
  core.rotation.y = Math.PI / SIDES;
  hut.add(core);

  // Broad eave: timber fascia, cream soffit, a thick blanket of snow on a low roof.
  const eaveY = PLINTH + wallH + 0.15;
  const fascia = new THREE.Mesh(new THREE.CylinderGeometry(RADIUS + 1.25, RADIUS + 1.25, 0.32, SIDES), timber);
  fascia.position.y = eaveY;
  fascia.rotation.y = Math.PI / SIDES;
  const soffit = new THREE.Mesh(new THREE.CylinderGeometry(RADIUS + 1.2, RADIUS + 0.2, 0.25, SIDES), cream);
  soffit.position.y = eaveY - 0.25;
  soffit.rotation.y = Math.PI / SIDES;
  const roof = new THREE.Mesh(new THREE.ConeGeometry(RADIUS + 1.3, 1.5, SIDES), timber);
  roof.position.y = eaveY + 0.9;
  roof.rotation.y = Math.PI / SIDES;
  const snow = new THREE.Mesh(new THREE.SphereGeometry(RADIUS + 1.3, SIDES * 2, 6, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#f6f9fc', roughness: 0.95 }));
  snow.scale.set(1, 0.26, 1);
  snow.position.y = eaveY + 0.15;
  hut.add(fascia, soffit, roof, snow);

  // Loudspeaker horn under the eave, facing the start.
  const horn = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.05, 0.5, 12, 1, true), new THREE.MeshStandardMaterial({ color: '#e8e8e8', roughness: 0.4, side: THREE.DoubleSide }));
  horn.rotation.z = Math.PI / 2;
  horn.position.set(RADIUS + 0.6, eaveY - 0.5, 0);
  hut.add(horn);

  hut.traverse((o) => {
    o.castShadow = true;
    o.receiveShadow = true;
  });
  return hut;
}
