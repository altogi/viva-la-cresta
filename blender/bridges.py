"""
The bridges over the run, from blender/bridges.json (scripts/export-bridges.ts), and the red train
of the Rhaetian Railway that crosses near Bulpetts:

  stable_junction - the low road bridge above Church Leap (photographed from the run): a concrete
                    slab faced with weathered grey boards, snow banked along its parapets;
  hanis_bridge    - a timber footbridge with braced railings;
  road_bridge     - near Bulpetts, low over the run: a road with the railway laid in it, steel
                    railings, and the overhead line on masts at both ends;
  railway_bridge  - steel plate girders carrying the track on ballast;
  rhb_train       - a red locomotive and three red coaches (metre gauge), rail top at z = 0, running
                    along +x from its front.

Each bridge is built in the run's frame: x along the run (downhill), y across it, z up from the
run's floor, centred on the run. Exported to public/models/bridges.glb; the game places them.
"""

import json
import math
import os

import bmesh
import bpy

import lib

BRIDGES = json.load(open(os.path.join(lib.ROOT, "blender", "bridges.json")))

lib.reset()
COLL = lib.collection("bridges")

M = {
    "concrete": lib.material("b_concrete", (0.62, 0.61, 0.58), 0.95),
    "concrete_dark": lib.material("b_concrete_dark", (0.42, 0.42, 0.41), 0.95),
    "boards": lib.material("b_boards", (0.36, 0.35, 0.33), 0.9),
    "timber": lib.material("b_timber", (0.45, 0.32, 0.2), 0.85),
    "timber_dark": lib.material("b_timber_dark", (0.3, 0.21, 0.13), 0.85),
    "steel": lib.material("b_steel", (0.55, 0.57, 0.6), 0.4, metallic=0.8),
    "girder": lib.material("b_girder", (0.32, 0.36, 0.34), 0.6, metallic=0.4),
    "asphalt": lib.material("b_asphalt", (0.16, 0.16, 0.17), 0.9),
    "rail": lib.material("b_rail", (0.5, 0.48, 0.46), 0.35, metallic=0.9),
    "sleeper": lib.material("b_sleeper", (0.28, 0.24, 0.2), 0.9),
    "ballast": lib.material("b_ballast", (0.4, 0.38, 0.36), 1.0),
    "snow": lib.material("b_snow", (0.93, 0.95, 0.98), 0.85),
    "trodden": lib.material("b_trodden", (0.78, 0.8, 0.84), 0.95),
    "red": lib.material("b_rhb_red", (0.62, 0.04, 0.04), 0.35),
    "red_dark": lib.material("b_rhb_red_dark", (0.35, 0.03, 0.03), 0.5),
    "window": lib.material("b_window", (0.04, 0.06, 0.09), 0.08, metallic=0.5),
    "roof": lib.material("b_roof", (0.35, 0.35, 0.36), 0.6),
    "under": lib.material("b_under", (0.08, 0.08, 0.09), 0.8),
    "white": lib.material("b_white", (0.9, 0.9, 0.88), 0.6),
}


class Builder:
    """Faces collected by material, then made into one object."""

    def __init__(self):
        self.v, self.f, self.mi, self.mats = [], [], [], []

    def _m(self, key):
        if M[key] not in self.mats:
            self.mats.append(M[key])
        return self.mats.index(M[key])

    def poly(self, pts, key):
        i = len(self.v)
        self.v += [tuple(p) for p in pts]
        self.f.append(tuple(range(i, i + len(pts))))
        self.mi.append(self._m(key))

    def box(self, x0, x1, y0, y1, z0, z1, key, top=None):
        """An axis-aligned box (outward faces)."""
        p = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
        for face in ((0, 3, 2, 1), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
            self.poly([p[k] for k in face], key)
        self.poly([p[k] for k in (4, 5, 6, 7)], top or key)

    def cbox(self, cx, cy, cz, dx, dy, dz, key, top=None):
        self.box(cx - dx / 2, cx + dx / 2, cy - dy / 2, cy + dy / 2, cz - dz / 2, cz + dz / 2, key, top)

    def tube(self, p0, p1, r, key, sides=6):
        ax = [p1[k] - p0[k] for k in range(3)]
        length = math.sqrt(sum(c * c for c in ax)) or 1e-6
        ax = [c / length for c in ax]
        ref = (0, 0, 1) if abs(ax[2]) < 0.9 else (1, 0, 0)
        u = cross(ax, ref)
        un = math.sqrt(sum(c * c for c in u))
        u = [c / un for c in u]
        w = cross(ax, u)
        r0, r1 = [], []
        for k in range(sides):
            a = k / sides * math.tau
            off = [u[j] * math.cos(a) * r + w[j] * math.sin(a) * r for j in range(3)]
            r0.append([p0[j] + off[j] for j in range(3)])
            r1.append([p1[j] + off[j] for j in range(3)])
        for k in range(sides):
            n = (k + 1) % sides
            self.poly((r0[k], r0[n], r1[n], r1[k]), key)

    def build(self, name):
        obj = lib.mesh_object(name, self.v, self.f, None, self.mats, COLL)
        for poly, m in zip(obj.data.polygons, self.mi):
            poly.material_index = m
        return obj


def cross(a, b):
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]


def abutments(B, half, under, depth, key="concrete"):
    """Walls on the banks either side of the run, from below the snow up to the deck."""
    for side in (-1, 1):
        y0, y1 = sorted((side * (half + 0.35), side * (half + 3.6)))
        B.box(-depth / 2 - 0.3, depth / 2 + 0.3, y0, y1, -1.5, under, key)


def railing(B, x, y0, y1, z, height=1.05, spacing=1.6, key="steel"):
    """Posts and two rails along y at a fixed x."""
    n = max(1, round(abs(y1 - y0) / spacing))
    for k in range(n + 1):
        y = y0 + (y1 - y0) * k / n
        B.tube((x, y, z), (x, y, z + height), 0.03, key)
    for h in (height * 0.5, height):
        B.tube((x, y0, z + h), (x, y1, z + h), 0.028, key)


def track(B, x, y0, y1, z, ballast=False):
    """Metre-gauge track along y: sleepers and two rails, rail top at z + 0.17."""
    if ballast:
        B.box(x - 1.4, x + 1.4, y0, y1, z - 0.05, z + 0.02, "ballast")
    n = int(abs(y1 - y0) / 0.65)
    for k in range(n):
        y = y0 + (y1 - y0) * (k + 0.5) / n
        B.cbox(x, y, z + 0.06, 1.8, 0.22, 0.12, "sleeper")
    for off in (-0.5, 0.5):
        B.box(x + off - 0.035, x + off + 0.035, y0, y1, z + 0.12, z + 0.17, "rail")


def catenary(B, x, y, z, height=5.6, reach=1.0):
    """A steel mast with its bracket over the track."""
    B.tube((x + reach + 1.6, y, z), (x + reach + 1.6, y, z + height + 0.6), 0.09, "steel")
    B.tube((x + reach + 1.6, y, z + height + 0.3), (x - 0.2, y, z + height + 0.3), 0.04, "steel")


def snow_bank(B, x0, x1, y0, y1, z, h):
    """A low drift of snow along a parapet."""
    B.box(x0, x1, y0, y1, z, z + h, "snow")


def stable_junction(d):
    """The low bridge above Church Leap, a concrete slab faced with grey boards, as in the
    photograph from the run: the visitors' footpath crosses on it."""
    B = Builder()
    half = d["width"] / 2
    under = max(d["wall"], 0.75) + 1.65
    deep = 5.0
    span = half + 3.6
    B.box(-deep / 2, deep / 2, -span, span, under, under + 0.55, "concrete_dark")
    # Board-faced parapets on both edges, the boards in horizontal courses.
    for x in (-deep / 2, deep / 2 - 0.25):
        for k in range(4):
            z = under + 0.05 + k * 0.32
            B.box(x, x + 0.25, -span, span, z, z + 0.3, "boards")
        B.box(x - 0.02, x + 0.27, -span, span, under + 1.33, under + 1.42, "concrete")
    # A footpath across: packed snow, trodden down the middle, drifts against the parapets.
    B.box(-deep / 2 + 0.25, deep / 2 - 0.25, -span, span, under + 0.55, under + 0.6, "snow")
    B.box(-1.0, 1.0, -span, span, under + 0.6, under + 0.605, "trodden")
    for x0, x1 in ((-deep / 2 + 0.25, -deep / 2 + 0.9), (deep / 2 - 0.9, deep / 2 - 0.25)):
        snow_bank(B, x0, x1, -span, span, under + 0.6, 0.35)
    abutments(B, half, under, deep, "concrete_dark")
    return B.build("bridge_stable_junction")


def hanis_bridge(d):
    """Timber footbridge on log trestles, with braced railings."""
    B = Builder()
    half = d["width"] / 2
    under = max(d["wall"], 0.75) + 1.8
    deep = 2.4
    span = half + 3.6
    for x in (-0.8, 0.8):
        B.box(x - 0.15, x + 0.15, -span, span, under, under + 0.4, "timber_dark")
    for k in range(int(span * 2 / 0.25)):
        y = -span + k * 0.25
        B.box(-deep / 2, deep / 2, y + 0.01, y + 0.24, under + 0.4, under + 0.46, "timber")
    B.box(-deep / 2, deep / 2, -span, span, under + 0.46, under + 0.5, "snow")
    for x in (-deep / 2 + 0.06, deep / 2 - 0.06):
        n = round(span * 2 / 1.5)
        for k in range(n + 1):
            y = -span + 2 * span * k / n
            B.box(x - 0.06, x + 0.06, y - 0.06, y + 0.06, under + 0.4, under + 1.5, "timber_dark")
            if k < n:
                y2 = -span + 2 * span * (k + 1) / n
                B.tube((x, y, under + 0.5), (x, y2, under + 1.4), 0.035, "timber")
        B.box(x - 0.08, x + 0.08, -span, span, under + 1.45, under + 1.55, "timber")
    abutments(B, half, under, deep, "timber_dark")
    return B.build("bridge_hanis_bridge")


def road_bridge(d):
    """Near Bulpetts, low over the run: a road with the railway laid in it, and the overhead line."""
    B = Builder()
    half = d["width"] / 2
    under = max(d["wall"], 0.75) + 1.8
    deep = 9.0
    span = half + 3.6
    B.box(-deep / 2, deep / 2, -span, span, under, under + 0.7, "concrete")
    B.box(-deep / 2 + 0.3, deep / 2 - 0.3, -span - 1, span + 1, under + 0.7, under + 0.75, "asphalt")
    track(B, 1.6, -span - 1, span + 1, under + 0.6)
    for x in (-deep / 2 + 0.15, deep / 2 - 0.15):
        B.box(x - 0.15, x + 0.15, -span, span, under + 0.7, under + 0.95, "concrete")
        railing(B, x, -span, span, under + 0.95)
    for x0, x1 in ((-deep / 2 + 0.3, -deep / 2 + 1.0), (deep / 2 - 1.0, deep / 2 - 0.3)):
        snow_bank(B, x0, x1, -span, span, under + 0.75, 0.25)
    for y in (-span - 0.8, span + 0.8):
        catenary(B, 1.6, y, under + 0.75)
    B.tube((1.6, -span - 6, under + 0.75 + 5.9), (1.6, span + 6, under + 0.75 + 5.9), 0.012, "steel")
    abutments(B, half, under, deep)
    return B.build("bridge_road_bridge")


def railway_bridge(d):
    """Steel plate girders carrying the track on ballast."""
    B = Builder()
    half = d["width"] / 2
    under = max(d["wall"], 0.75) + 1.6
    span = half + 3.6
    B.box(-1.6, 1.6, -span, span, under, under + 0.3, "girder")
    for x in (-1.75, 1.75):
        B.box(x - 0.12, x + 0.12, -span, span, under, under + 1.3, "girder")
        n = round(span * 2 / 1.2)
        for k in range(n + 1):
            y = -span + 2 * span * k / n
            B.box(x - 0.18, x + 0.18, y - 0.04, y + 0.04, under + 0.05, under + 1.25, "girder")
    track(B, 0, -span - 1, span + 1, under + 0.35, ballast=True)
    for y in (-span - 0.8, span + 0.8):
        catenary(B, 0, y, under + 0.35)
    abutments(B, half, under, 3.6)
    return B.build("bridge_railway_bridge")


def train():
    """The Rhaetian Railway's red train: a locomotive and three coaches, front at x = 0, running
    towards +x... built backwards from the front, so the train trails along -x."""
    parts = []
    width = 2.65
    x = 0.0
    for i, (length, loco) in enumerate(((15.5, True), (18.0, False), (18.0, False), (18.0, False))):
        B = Builder()
        x0, x1 = x - length, x
        hw = width / 2
        # Bogies and the dark underframe.
        B.box(x0 + 0.4, x1 - 0.4, -hw * 0.9, hw * 0.9, 0.35, 1.0, "under")
        for bx in (x0 + 2.6, x1 - 2.6):
            B.box(bx - 1.3, bx + 1.3, -1.0, 1.0, 0.0, 0.75, "under")
        # The body: red sides with a band of windows, a grey roof.
        B.box(x0, x1, -hw, hw, 1.0, 1.9, "red")
        B.box(x0, x1, -hw, hw, 3.15, 3.55, "red")
        B.box(x0 + 0.02, x1 - 0.02, -hw + 0.03, hw - 0.03, 1.9, 3.15, "window")
        n = int(length / 1.5)
        for k in range(n + 1):
            px = x0 + length * k / n
            B.box(px - 0.12, px + 0.12, -hw, hw, 1.9, 3.15, "red")
        B.box(x0 + 0.1, x1 - 0.1, -hw + 0.12, hw - 0.12, 3.55, 3.85, "roof")
        B.box(x0, x1, -hw - 0.01, hw + 0.01, 1.25, 1.33, "white")
        if loco:
            # Cab windows front and back, the pantograph on the roof.
            for cx in (x1 - 0.01, x0 + 0.01):
                B.box(cx - 0.02, cx + 0.02, -hw + 0.25, hw - 0.25, 2.2, 3.05, "window")
            px = x0 + length * 0.3
            B.tube((px - 0.6, -0.5, 3.85), (px, 0, 4.9), 0.03, "steel")
            B.tube((px - 0.6, 0.5, 3.85), (px, 0, 4.9), 0.03, "steel")
            B.box(px - 0.1, px + 0.1, -0.8, 0.8, 4.9, 4.95, "steel")
        parts.append(B.build(f"train_car_{i}"))
        x = x0 - 0.6
    return lib.join(parts, "rhb_train")


makers = {"stable_junction": stable_junction, "hanis_bridge": hanis_bridge, "road_bridge": road_bridge, "railway_bridge": railway_bridge}
objects = [makers[d["slug"]](d) for d in BRIDGES]
t = train()
for o in objects:
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(o.data)
    bm.free()
for i, o in enumerate(objects):
    o.location = (0, i * 22 - 33, 0)
t.location = (-30, 0, 0)
lib.preview("bridges.png", (38, -50, 18), (0, 0, 2), size=(1300, 800), lens=35, sky=(0.35, 0.55, 0.9))
for o in objects:
    o.location = (0, 0, 0)
t.location = (0, 0, 0)
result = {"export": lib.export_glb("bridges.glb", objects + [t]), "faces": {o.name: len(o.data.polygons) for o in objects + [t]}}
