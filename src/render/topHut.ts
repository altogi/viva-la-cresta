// The Top hut: the ornate octagonal pavilion beside the Top start, modelled on photographs.
// Mustard-yellow infill in a dark-brown timber frame; turned columns at the corners; tall
// yellow-framed windows with arched transoms over a dentil cornice; carved quatrefoil panels
// below; an X-cross panel over the door; a deep yellow soffit on carved scroll brackets with
// hanging finials; a snowy roof crowned by a ribbed, verdigris copper dome.

import * as THREE from 'three';

const SIDES = 8;
const RADIUS = 3.6; // to the corners, matching the OSM footprint
const PLINTH = 0.45;
const WALL = 3.7;

const BROWN = '#5a4840';
const YELLOW = '#e2b043';
const YELLOW_LIGHT = '#efc65e';
const YELLOW_DARK = '#b88a2c';

const brown = new THREE.MeshStandardMaterial({ color: BROWN, roughness: 0.75 });
const yellow = new THREE.MeshStandardMaterial({ color: YELLOW, roughness: 0.8 });
const copper = new THREE.MeshStandardMaterial({ color: '#5f8a7b', roughness: 0.55, metalness: 0.35 });
const snowMat = new THREE.MeshStandardMaterial({ color: '#f5f8fc', roughness: 0.95 });

/** Carved relief: a lighter edge on top-left and a darker one bottom-right. */
function relief(g: CanvasRenderingContext2D, draw: () => void, width: number) {
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.save();
  g.translate(2, 2);
  g.strokeStyle = YELLOW_DARK;
  g.lineWidth = width;
  draw();
  g.restore();
  g.save();
  g.translate(-1.5, -1.5);
  g.strokeStyle = YELLOW_LIGHT;
  g.lineWidth = width;
  draw();
  g.restore();
}

/**
 * One face, top to bottom: arched transom window, dentil cornice, tall mullioned window,
 * sill, carved quatrefoil panel. The door face gets an X-cross panel over an open doorway.
 */
function faceTexture(door: boolean): THREE.CanvasTexture {
  const w = 256;
  const h = 640;
  const px = h / WALL; // pixels per metre
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d')!;
  g.fillStyle = YELLOW;
  g.fillRect(0, 0, w, h);
  // Frame beams top and bottom of each band.
  const beam = (y: number, t = 10) => {
    g.fillStyle = BROWN;
    g.fillRect(0, y, w, t);
  };
  const topBand = 0.95 * px;
  const cornice = 0.22 * px;
  const windowH = 1.75 * px;
  const panelTop = topBand + cornice + windowH;
  beam(0, 14);

  if (door) {
    // X-cross relief over an arched doorway.
    relief(g, () => {
      g.beginPath();
      g.moveTo(26, 22);
      g.lineTo(w - 26, topBand - 14);
      g.moveTo(w - 26, 22);
      g.lineTo(26, topBand - 14);
      g.stroke();
    }, 16);
    g.fillStyle = YELLOW_DARK;
    g.beginPath();
    g.arc(w / 2, topBand / 2 + 4, 13, 0, Math.PI * 2);
    g.fill();
    beam(topBand, 12);
    const doorTop = topBand + 22;
    g.fillStyle = '#2b2420';
    g.beginPath();
    g.moveTo(34, h);
    g.lineTo(34, doorTop + 40);
    g.quadraticCurveTo(w / 2, doorTop - 8, w - 34, doorTop + 40);
    g.lineTo(w - 34, h);
    g.fill();
    g.strokeStyle = BROWN;
    g.lineWidth = 12;
    g.stroke();
  } else {
    // Arched transom under a brown segmental arch.
    g.fillStyle = '#7f95a3';
    g.beginPath();
    g.moveTo(18, topBand);
    g.lineTo(18, 46);
    g.quadraticCurveTo(w / 2, -6, w - 18, 46);
    g.lineTo(w - 18, topBand);
    g.fill();
    g.strokeStyle = BROWN;
    g.lineWidth = 14;
    g.beginPath();
    g.moveTo(10, 50);
    g.quadraticCurveTo(w / 2, -14, w - 10, 50);
    g.stroke();
    g.fillStyle = YELLOW_LIGHT;
    for (let c = 1; c < 3; c++) g.fillRect(18 + ((w - 36) * c) / 3 - 3, 30, 6, topBand - 30);
    // Dentil cornice.
    g.fillStyle = YELLOW_LIGHT;
    g.fillRect(0, topBand, w, cornice);
    g.fillStyle = YELLOW_DARK;
    for (let x = 6; x < w; x += 16) g.fillRect(x, topBand + cornice * 0.35, 8, cornice * 0.45);
    // Tall window: two lights of three panes, yellow frames and glazing bars.
    const wy = topBand + cornice;
    const glass = g.createLinearGradient(0, wy, w, wy + windowH);
    glass.addColorStop(0, '#c9d6de');
    glass.addColorStop(0.35, '#6d8291');
    glass.addColorStop(0.7, '#3d4c57');
    glass.addColorStop(1, '#5d6f7b');
    g.fillStyle = glass;
    g.fillRect(16, wy + 8, w - 32, windowH - 16);
    g.fillStyle = YELLOW;
    g.fillRect(w / 2 - 7, wy, 14, windowH);
    for (let r = 1; r < 3; r++) g.fillRect(16, wy + (windowH * r) / 3 - 4, w - 32, 8);
    g.fillStyle = YELLOW_LIGHT;
    for (const x of [16 + (w - 32) * 0.25, 16 + (w - 32) * 0.75]) g.fillRect(x - 3, wy + 8, 6, windowH - 16);
    g.strokeStyle = YELLOW_LIGHT;
    g.lineWidth = 10;
    g.strokeRect(16, wy + 8, w - 32, windowH - 16);
    // Sill.
    beam(panelTop, 10);
    g.fillStyle = YELLOW_LIGHT;
    g.fillRect(0, panelTop + 10, w, 10);
    // Carved quatrefoil panel below.
    const cy = panelTop + (h - panelTop) / 2 + 8;
    relief(g, () => {
      for (const cx of [w * 0.3, w * 0.7]) {
        g.beginPath();
        for (let i = 0; i < 4; i++) {
          const a = (i * Math.PI) / 2;
          g.moveTo(cx + Math.cos(a) * 30 + 22, cy + Math.sin(a) * 30);
          g.arc(cx + Math.cos(a) * 30, cy + Math.sin(a) * 30, 22, 0, Math.PI * 2);
        }
        g.stroke();
      }
    }, 7);
    g.strokeStyle = YELLOW_DARK;
    g.lineWidth = 4;
    g.strokeRect(14, panelTop + 30, w - 28, h - panelTop - 46);
  }
  beam(h - 12, 12);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** A turned timber column: base, swelling shaft, capital. */
function columnGeometry(height: number): THREE.BufferGeometry {
  const pts = [
    [0, 0], [0.16, 0], [0.16, 0.12], [0.11, 0.18], [0.12, 0.35],
    [0.1, height * 0.55], [0.12, height * 0.8], [0.1, height - 0.32],
    [0.16, height - 0.22], [0.13, height - 0.12], [0.2, height - 0.06], [0.2, height], [0, height],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  return new THREE.LatheGeometry(pts, 10);
}

/** A hanging turned finial below the eave. */
function finialGeometry(): THREE.BufferGeometry {
  const pts = [[0, 0], [0.09, 0.05], [0.07, 0.22], [0.12, 0.4], [0.06, 0.62], [0.09, 0.78], [0.08, 0.9], [0, 0.95]].map(
    ([r, y]) => new THREE.Vector2(r, -y),
  );
  return new THREE.LatheGeometry(pts, 10);
}

/** A carved scroll bracket: a curved arm from the post up and out to the eave. */
function bracketGeometry(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(0.14, 0);
  s.quadraticCurveTo(0.2, 0.75, 1.05, 0.95);
  s.lineTo(1.05, 1.1);
  s.quadraticCurveTo(0.05, 0.95, 0, 0);
  const hole = new THREE.Path();
  hole.absarc(0.32, 0.58, 0.1, 0, Math.PI * 2, true);
  s.holes.push(hole);
  return new THREE.ExtrudeGeometry(s, { depth: 0.12, bevelEnabled: false }).translate(0, 0, -0.06);
}

/** Ribbed onion-bell dome in verdigris copper. */
function domeGeometry(radius: number, height: number): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    // Bell profile: swells out, then curves in to a point.
    const r = radius * (t < 0.15 ? 0.82 + t * 1.2 : Math.sin((1 - t) * Math.PI * 0.62) * 1.05) * (1 - t * 0.05);
    pts.push(new THREE.Vector2(Math.max(0.02, r), t * height));
  }
  const geo = new THREE.LatheGeometry(pts, 48);
  // Standing-seam ribs: push the surface out along 16 meridians.
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let k = 0; k < pos.count; k++) {
    const x = pos.getX(k);
    const z = pos.getZ(k);
    const a = Math.atan2(z, x);
    const rib = 1 + 0.035 * Math.pow(Math.abs(Math.cos(a * 8)), 12);
    pos.setX(k, x * rib);
    pos.setZ(k, z * rib);
  }
  geo.computeVertexNormals();
  return geo;
}

export function buildTopHut(): THREE.Group {
  const hut = new THREE.Group();
  hut.name = 'top-hut';
  const windowFace = new THREE.MeshStandardMaterial({ map: faceTexture(false), roughness: 0.6 });
  const doorFace = new THREE.MeshStandardMaterial({ map: faceTexture(true), roughness: 0.7 });
  const apothem = RADIUS * Math.cos(Math.PI / SIDES);
  const side = 2 * RADIUS * Math.sin(Math.PI / SIDES);
  const add = (mesh: THREE.Object3D) => hut.add(mesh);

  // Grey stone plinth.
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(RADIUS + 0.12, RADIUS + 0.2, PLINTH, SIDES), new THREE.MeshStandardMaterial({ color: '#8f8a82', roughness: 0.9 }));
  plinth.position.y = PLINTH / 2;
  plinth.rotation.y = Math.PI / SIDES;
  add(plinth);
  // Dark interior so the windows read as glass.
  const core = new THREE.Mesh(new THREE.CylinderGeometry(apothem - 0.2, apothem - 0.2, WALL, SIDES), new THREE.MeshStandardMaterial({ color: '#2e2520', roughness: 1 }));
  core.position.y = PLINTH + WALL / 2;
  core.rotation.y = Math.PI / SIDES;
  add(core);

  const column = columnGeometry(WALL);
  const finial = finialGeometry();
  const bracket = bracketGeometry();
  for (let i = 0; i < SIDES; i++) {
    const a = (i / SIDES) * Math.PI * 2;
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(side * 0.97, WALL), i === 4 ? doorFace : windowFace);
    panel.position.set(Math.cos(a) * apothem, PLINTH + WALL / 2, Math.sin(a) * apothem);
    panel.rotation.y = Math.PI / 2 - a;
    add(panel);
    // Corner: turned column, carved bracket, hanging finial.
    const ca = a + Math.PI / SIDES;
    const cx = Math.cos(ca) * RADIUS;
    const cz = Math.sin(ca) * RADIUS;
    const col = new THREE.Mesh(column, brown);
    col.position.set(cx, PLINTH, cz);
    add(col);
    const br = new THREE.Mesh(bracket, brown);
    br.position.set(cx, PLINTH + WALL - 1.0, cz);
    br.rotation.y = -ca;
    add(br);
    const fin = new THREE.Mesh(finial, brown);
    fin.position.set(Math.cos(ca) * (RADIUS + 1.15), PLINTH + WALL + 0.15, Math.sin(ca) * (RADIUS + 1.15));
    add(fin);
  }

  // Architrave beam, deep yellow soffit, brown fascia, snowy roof.
  const top = PLINTH + WALL;
  const architrave = new THREE.Mesh(new THREE.CylinderGeometry(RADIUS + 0.12, RADIUS + 0.12, 0.28, SIDES), brown);
  architrave.position.y = top + 0.1;
  architrave.rotation.y = Math.PI / SIDES;
  const soffit = new THREE.Mesh(new THREE.CylinderGeometry(RADIUS + 1.25, RADIUS + 0.15, 0.3, SIDES, 1, true), new THREE.MeshStandardMaterial({ color: YELLOW_LIGHT, roughness: 0.8, side: THREE.DoubleSide }));
  soffit.position.y = top + 0.32;
  soffit.rotation.y = Math.PI / SIDES;
  const fascia = new THREE.Mesh(new THREE.CylinderGeometry(RADIUS + 1.3, RADIUS + 1.3, 0.26, SIDES, 1, true), brown);
  fascia.position.y = top + 0.5;
  fascia.rotation.y = Math.PI / SIDES;
  const roof = new THREE.Mesh(new THREE.CylinderGeometry(1.6, RADIUS + 1.32, 0.9, SIDES), yellow);
  roof.position.y = top + 1.05;
  roof.rotation.y = Math.PI / SIDES;
  const snow = new THREE.Mesh(new THREE.CylinderGeometry(1.75, RADIUS + 1.38, 0.55, SIDES * 2), snowMat);
  snow.position.y = top + 1.35;
  add(architrave);
  add(soffit);
  add(fascia);
  add(roof);
  add(snow);

  // Copper dome with a drum, snow round its foot and a small finial on top.
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(1.65, 1.7, 0.35, 24), brown);
  drum.position.y = top + 1.75;
  const dome = new THREE.Mesh(domeGeometry(1.75, 2.4), copper);
  dome.position.y = top + 1.9;
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), copper);
  tip.position.y = top + 4.35;
  add(drum);
  add(dome);
  add(tip);

  // Loudspeaker horn under the eave, facing the start.
  const horn = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.05, 0.45, 12, 1, true), new THREE.MeshStandardMaterial({ color: '#d9d6cf', roughness: 0.4, side: THREE.DoubleSide }));
  horn.rotation.z = Math.PI / 2;
  horn.position.set(RADIUS + 0.55, top - 0.3, 0);
  add(horn);

  hut.traverse((o) => {
    o.castShadow = true;
    o.receiveShadow = true;
  });
  return hut;
}
