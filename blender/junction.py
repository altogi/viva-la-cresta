"""
Junction, as in the photographs: the SMTC clubhouse (Annibale Fiocchi, 1962), the walkway over the run
and the Junction hut opposite, built in place from blender/junction.json (scripts/export-junction.ts).

  clubhouse    - white plaster, two storeys on its mapped footprint with the rounded corners on the run
                 side: deep-set windows on the ground floor, a continuous band of blue glass on the first,
                 "CRESTA RUN" on the fascia, a roof terrace behind a tubular steel railing; the Tower over
                 the south-west wing with its glazed cab overhanging the terrace, and the aerial on top.
  walkway      - a white concrete deck with steel railings, square across the run at first-floor level.
  junction_hut - white, long and round-ended on its footprint at the run's edge: the door the riders come
                 out of with their toboggans, the timing board over it, windows, the red crash pad under
                 the end window, and a roof terrace level with the walkway.

Coordinates are the game's (x east, y north, z up), so the game adds the model as it is.
Exported to public/models/junction.glb.
"""

import json
import math
import os

import bpy

import lib

D = json.load(open(os.path.join(lib.ROOT, "blender", "junction.json")))
FLOOR = 3.4

lib.reset()
COLL = lib.collection("junction")

M = {
    "plaster": lib.material("j_plaster", (0.9, 0.9, 0.88), 0.92),
    "reveal": lib.material("j_reveal", (0.8, 0.8, 0.79), 0.92),
    "trim": lib.material("j_trim", (0.96, 0.96, 0.95), 0.6),
    "glass": lib.material("j_glass", (0.035, 0.09, 0.3), 0.06, metallic=0.5),
    "interior": lib.material("j_interior", (0.05, 0.05, 0.06), 1.0),
    "steel": lib.material("j_steel", (0.78, 0.8, 0.82), 0.3, metallic=0.85),
    "navy": lib.material("j_navy", (0.06, 0.09, 0.22), 0.5),
    "flag_red": lib.material("j_flag_red", (0.62, 0.12, 0.06), 0.6),
    "flag_gold": lib.material("j_flag_gold", (0.85, 0.6, 0.12), 0.6),
    "pad": lib.material("j_pad", (0.72, 0.05, 0.04), 0.45),
    "board": lib.material("j_board", (0.03, 0.03, 0.035), 0.4),
    "digits": lib.material("j_digits", (1.0, 0.15, 0.05), 0.4, emission=(1.0, 0.12, 0.04)),
    "snow": lib.material("j_snow", (0.93, 0.95, 0.98), 0.85),
    "concrete": lib.material("j_concrete", (0.7, 0.7, 0.69), 0.95),
    "toboggan_red": lib.material("j_tob_red", (0.6, 0.06, 0.05), 0.5),
    "toboggan_gold": lib.material("j_tob_gold", (0.8, 0.55, 0.1), 0.5),
}


class Builder:
    """Faces collected by material, then made into one object."""

    def __init__(self):
        self.v, self.f, self.mi, self.mats = [], [], [], []

    def _m(self, key):
        mat = M[key]
        if mat not in self.mats:
            self.mats.append(mat)
        return self.mats.index(mat)

    def poly(self, pts, key):
        i = len(self.v)
        self.v += [tuple(p) for p in pts]
        self.f.append(tuple(range(i, i + len(pts))))
        self.mi.append(self._m(key))

    def quad(self, a, b, c, d, key):
        self.poly((a, b, c, d), key)

    def cap(self, ring, z, key, down=False):
        pts = [(x, y, z) for x, y in ring]
        self.poly(pts[::-1] if down else pts, key)

    def prism(self, ring, z0, z1, key, top=None, bottom=True):
        """A vertical prism over a counter-clockwise ring."""
        for i in range(len(ring)):
            a, b = ring[i], ring[(i + 1) % len(ring)]
            self.quad((*a, z0), (*b, z0), (*b, z1), (*a, z1), key)
        self.cap(ring, z1, top or key)
        if bottom:
            self.cap(ring, z0, key, down=True)

    def box(self, cx, cy, w, d, z0, z1, key, angle=0.0):
        ca, sa = math.cos(angle), math.sin(angle)
        ring = [(cx + ca * x - sa * y, cy + sa * x + ca * y) for x, y in ((-w / 2, -d / 2), (w / 2, -d / 2), (w / 2, d / 2), (-w / 2, d / 2))]
        self.prism(ring, z0, z1, key)

    def tube(self, p0, p1, r, key, sides=6):
        """A round bar from p0 to p1."""
        ax = [p1[k] - p0[k] for k in range(3)]
        length = math.sqrt(sum(c * c for c in ax)) or 1e-6
        ax = [c / length for c in ax]
        ref = (0, 0, 1) if abs(ax[2]) < 0.9 else (1, 0, 0)
        u = cross(ax, ref)
        un = math.sqrt(sum(c * c for c in u))
        u = [c / un for c in u]
        w = cross(ax, u)
        ring0, ring1 = [], []
        for k in range(sides):
            a = k / sides * math.tau
            off = [u[j] * math.cos(a) * r + w[j] * math.sin(a) * r for j in range(3)]
            ring0.append([p0[j] + off[j] for j in range(3)])
            ring1.append([p1[j] + off[j] for j in range(3)])
        for k in range(sides):
            n = (k + 1) % sides
            self.quad(ring0[k], ring0[n], ring1[n], ring1[k], key)

    def build(self, name, smooth=False):
        obj = lib.mesh_object(name, self.v, self.f, None, self.mats, COLL, smooth=smooth)
        for poly, m in zip(obj.data.polygons, self.mi):
            poly.material_index = m
        return obj


def cross(a, b):
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]


def edge(a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    length = math.hypot(dx, dy) or 1e-6
    t = (dx / length, dy / length)
    return length, t, (t[1], -t[0])  # outward normal of a counter-clockwise ring


def offset(ring, d):
    """Push a counter-clockwise ring outward by d (inward if negative), mitred."""
    out = []
    n = len(ring)
    for i, p in enumerate(ring):
        _, _, n1 = edge(ring[i - 1], p)
        _, _, n2 = edge(p, ring[(i + 1) % n])
        bx, by = n1[0] + n2[0], n1[1] + n2[1]
        bl = math.hypot(bx, by) or 1
        k = d / max(0.5, (bx * n1[0] + by * n1[1]) / bl)
        out.append((p[0] + bx / bl * k, p[1] + by / bl * k))
    return out


def wall(B, a, b, z0, z1, key, openings=(), depth=0.22):
    """One wall from a to b with openings (s0, s1, z_bottom, z_top, fill) cut into it: reveals, sill and
    head set back `depth`, and a pane of glass (or the dark of an open door) at the back."""
    length, t, n = edge(a, b)

    def P(s, d, z):
        return (a[0] + t[0] * s + n[0] * d, a[1] + t[1] * s + n[1] * d, z)

    x = 0.0
    for s0, s1, zb, zt, fill in sorted(openings):
        s0, s1 = max(s0, 0.0), min(s1, length)
        if s0 > x:
            B.quad(P(x, 0, z0), P(s0, 0, z0), P(s0, 0, z1), P(x, 0, z1), key)
        if zb > z0:
            B.quad(P(s0, 0, z0), P(s1, 0, z0), P(s1, 0, zb), P(s0, 0, zb), key)
        if zt < z1:
            B.quad(P(s0, 0, zt), P(s1, 0, zt), P(s1, 0, z1), P(s0, 0, z1), key)
        B.quad(P(s0, 0, zb), P(s1, 0, zb), P(s1, -depth, zb), P(s0, -depth, zb), "trim")  # sill
        B.quad(P(s0, 0, zt), P(s0, -depth, zt), P(s1, -depth, zt), P(s1, 0, zt), "reveal")  # head
        B.quad(P(s0, 0, zb), P(s0, -depth, zb), P(s0, -depth, zt), P(s0, 0, zt), "reveal")
        B.quad(P(s1, -depth, zb), P(s1, 0, zb), P(s1, 0, zt), P(s1, -depth, zt), "reveal")
        B.quad(P(s0, -depth, zb), P(s1, -depth, zb), P(s1, -depth, zt), P(s0, -depth, zt), fill)
        x = s1
    if x < length:
        B.quad(P(x, 0, z0), P(length, 0, z0), P(length, 0, z1), P(x, 0, z1), key)


def panes(length, pane, pier, margin):
    """Openings along an edge: as many panes of about `pane` metres as fit, `pier` apart."""
    usable = length - 2 * margin
    if usable < 0.5:
        return []
    count = max(1, round((usable + pier) / (pane + pier)))
    w = (usable - pier * (count - 1)) / count
    return [(margin + k * (w + pier), margin + k * (w + pier) + w) for k in range(count)]


def railing(B, pts, z, height=1.05, closed=True, spacing=1.6):
    """Tubular steel railing: posts and three rails along a polyline."""
    segs = list(zip(pts, pts[1:] + pts[:1])) if closed else list(zip(pts, pts[1:]))
    for a, b in segs:
        length = math.hypot(b[0] - a[0], b[1] - a[1])
        if length < 0.05:
            continue
        posts = max(1, round(length / spacing))
        for k in range(posts + (0 if closed else 1)):
            s = k / posts
            x, y = a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s
            B.tube((x, y, z), (x, y, z + height), 0.024, "steel")
        for h in (height, height * 0.66, height * 0.33):
            B.tube((a[0], a[1], z + h), (b[0], b[1], z + h), 0.022 if h < height else 0.03, "steel")


def text(body, size, at, normal, key, extrude=0.02):
    """Raised lettering standing on a wall, facing along `normal`."""
    curve = bpy.data.curves.new(f"txt_{body}", "FONT")
    curve.body = body
    curve.size = size
    curve.extrude = extrude
    curve.align_x = "CENTER"
    curve.align_y = "CENTER"
    obj = bpy.data.objects.new(f"txt_{body}", curve)
    COLL.objects.link(obj)
    obj.location = at
    obj.rotation_euler = (math.pi / 2, 0, math.atan2(normal[1], normal[0]) + math.pi / 2)
    obj.data.materials.append(M[key])
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.convert(target="MESH")
    return bpy.context.view_layer.objects.active


# ---------- The clubhouse ----------

ring = [tuple(p) for p in D["club"]["ring"]]
cx, cy = D["club"]["centre"]
F = D["club"]["floorZ"]
roofZ = F + 2 * FLOOR
run = D["club"]["runSide"]
B = Builder()
inner = offset(ring, -0.7)
for i in range(len(ring)):
    a, b = ring[i], ring[(i + 1) % len(ring)]
    length, t, n = edge(a, b)
    windows = n[0] * run[0] + n[1] * run[1] > -0.7  # none on the uphill side
    curved = length < 2.2
    # Ground floor: deep-set windows between broad piers (one per short edge round the curves).
    ops = []
    if windows:
        spans = [(0.06, length - 0.06)] if curved else panes(length, 1.5, 0.75, 0.6)
        ops = [(s0, s1, F + 0.9, F + 2.45, "glass") for s0, s1 in spans]
    wall(B, a, b, F - 1.5, F + FLOOR, "plaster", ops)
    # First floor: a continuous band of glass, slim white frames between the panes.
    ops = []
    if windows:
        spans = [(0.04, length - 0.04)] if curved else panes(length, 1.3, 0.1, 0.05)
        ops = [(s0, s1, F + FLOOR + 0.55, F + FLOOR + 2.4, "glass") for s0, s1 in spans]
    wall(B, a, b, F + FLOOR, roofZ, "plaster", ops, depth=0.14)
# Dark rooms seen through the glass.
B.prism(inner, F - 1.5, roofZ - 0.05, "interior", bottom=False)
# Roof slab with a crisp projecting edge, then the terrace (spectators stand on it at roofZ + 0.4).
slab = offset(ring, 0.18)
B.prism(slab, roofZ, roofZ + 0.4, "trim", top="snow")
railing(B, offset(ring, 0.06), roofZ + 0.4)

# The Tower over the south-west wing, and its glazed cab overhanging the terrace.
def rect(x0, y0, x1, y1):
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]

tower = rect(cx - 8.7, cy - 6.5, cx - 3.2, cy - 0.7)
cabZ = roofZ + 3.2
for i in range(4):
    a, b = tower[i], tower[(i + 1) % 4]
    length, t, n = edge(a, b)
    ops = [(length / 2 - 0.6, length / 2 + 0.6, roofZ + 1.4, roofZ + 2.6, "glass")] if n[0] > 0.5 or n[1] < -0.5 else []
    wall(B, a, b, roofZ + 0.4, cabZ, "plaster", ops)
cab = rect(cx - 8.5, cy - 6.3, cx - 0.8, cy - 0.9)
B.cap(cab, cabZ, "plaster", down=True)
for i in range(4):
    a, b = cab[i], cab[(i + 1) % 4]
    length, t, n = edge(a, b)
    spans = panes(length, 1.25, 0.1, 0.12)
    wall(B, a, b, cabZ, cabZ + 2.5, "plaster", [(s0, s1, cabZ + 0.6, cabZ + 2.05, "glass") for s0, s1 in spans], depth=0.12)
B.prism(offset(cab, -0.5), cabZ + 0.01, cabZ + 2.45, "interior", bottom=False)
cab_roof = offset(cab, 0.4)
B.prism(cab_roof, cabZ + 2.5, cabZ + 2.8, "trim", top="snow")
# Aerial and its cross-arm above the cab.
ax, ay = cx - 7.8, cy - 5.6
B.tube((ax, ay, cabZ + 2.8), (ax, ay, cabZ + 9.5), 0.05, "steel")
B.tube((ax - 1.6, ay, cabZ + 8.2), (ax + 1.6, ay, cabZ + 8.2), 0.03, "steel")

# External stair up the south side to the entrance, between steel railings.
steps = 14
for k in range(steps):
    s = k / steps
    x = cx + 2.5 - s * 8.0
    B.box(x, cy - 7.5, 0.6, 1.3, F - 1.5, F - 1.5 + (k + 1) * 0.26, "concrete")
railing(B, [(cx + 2.8, cy - 8.2), (cx - 5.8, cy - 8.2)], F - 1.5 + 0.2, height=1.0, closed=False)
club = B.build("clubhouse")

# "CRESTA RUN" on the fascia over the glass band, facing the run, between red and gold bars.
fascia_z = F + FLOOR + 2.95
longest = max(range(len(ring)), key=lambda i: edge(ring[i], ring[(i + 1) % len(ring)])[0] * max(0, edge(ring[i], ring[(i + 1) % len(ring)])[2][0] * run[0] + edge(ring[i], ring[(i + 1) % len(ring)])[2][1] * run[1]))
a, b = ring[longest], ring[(longest + 1) % len(ring)]
length, t, n = edge(a, b)
mid = (a[0] + t[0] * length * 0.5 + n[0] * 0.02, a[1] + t[1] * length * 0.5 + n[1] * 0.02)
letters = text("CRESTA RUN", 0.62, (mid[0], mid[1], fascia_z), n, "navy")
bars = Builder()
for side in (-1, 1):
    s = side * 2.75
    px, py = mid[0] + t[0] * s, mid[1] + t[1] * s
    ang = math.atan2(t[1], t[0])
    bars.box(px, py, 0.9, 0.04, fascia_z - 0.02, fascia_z + 0.1, "flag_gold", ang)
    bars.box(px, py, 0.9, 0.04, fascia_z + 0.1, fascia_z + 0.22, "flag_red", ang)
club = lib.join([club, letters, bars.build("bars")], "clubhouse")

# ---------- The walkway ----------

W = Builder()
wa, wb = D["walkway"]["a"], D["walkway"]["b"]
deck = D["walkway"]["deckZ"]
length, t, n = edge(wa, wb)
half = D["walkway"]["width"] / 2
# Run a little into each building so there's no gap at the walls.
p0 = (wa[0] - t[0] * 0.3, wa[1] - t[1] * 0.3)
p1 = (wb[0] + t[0] * 0.3, wb[1] + t[1] * 0.3)
deck_ring = [(p0[0] - n[0] * half, p0[1] - n[1] * half), (p1[0] - n[0] * half, p1[1] - n[1] * half), (p1[0] + n[0] * half, p1[1] + n[1] * half), (p0[0] + n[0] * half, p0[1] + n[1] * half)]
if (deck_ring[1][0] - deck_ring[0][0]) * (deck_ring[2][1] - deck_ring[0][1]) - (deck_ring[2][0] - deck_ring[0][0]) * (deck_ring[1][1] - deck_ring[0][1]) < 0:
    deck_ring.reverse()
W.prism(deck_ring, deck - 0.45, deck, "trim", top="concrete")
for k in (-1, 1):
    e0 = (wa[0] + n[0] * half * k * 0.95, wa[1] + n[1] * half * k * 0.95)
    e1 = (wb[0] + n[0] * half * k * 0.95, wb[1] + n[1] * half * k * 0.95)
    railing(W, [e0, e1], deck, closed=False, spacing=1.5)
walkway = W.build("walkway")

# ---------- The Junction hut ----------

H = Builder()
hring = [tuple(p) for p in D["hut"]["ring"]]
g = D["hut"]["ground"]
roof = D["hut"]["roof"]
to_run = D["hut"]["toRun"]
fascia = roof - 0.45
# The long side facing the run: the door near the start, two windows further down.
run_edge = max(range(len(hring)), key=lambda i: edge(hring[i], hring[(i + 1) % len(hring)])[0] * max(0, edge(hring[i], hring[(i + 1) % len(hring)])[2][0] * to_run[0] + edge(hring[i], hring[(i + 1) % len(hring)])[2][1] * to_run[1]))
# The end towards the clubhouse: the window over the crash pad.
end_edge = max(range(len(hring)), key=lambda i: edge(hring[i], hring[(i + 1) % len(hring)])[0] * max(0, -edge(hring[i], hring[(i + 1) % len(hring)])[2][1]))
door_at = None
for i in range(len(hring)):
    a, b = hring[i], hring[(i + 1) % len(hring)]
    length, t, n = edge(a, b)
    ops = []
    if i == run_edge:
        # Windows along the side facing the run.
        for k in range(4):
            ws = length - 3.0 - k * 3.2
            if ws > 1.0:
                ops.append((ws - 0.75, ws + 0.75, g + 1.6, g + 2.9, "glass"))
    elif i == end_edge:
        # The uphill end, where the riders wait: a window over the crash pad, and the door they come
        # out of with their toboggans, the timing board above it.
        ops.append((length * 0.27 - 0.75, length * 0.27 + 0.75, g + 1.5, g + 2.9, "glass"))
        ds = length * 0.7
        ops.append((ds - 0.85, ds + 0.85, g + 0.55, g + 2.95, "interior"))
        door_at = (a, t, n, ds)
    wall(H, a, b, g, fascia, "plaster", ops, depth=0.2)
    H.quad((*a, fascia), (*b, fascia), (*b, roof), (*a, roof), "trim")
H.prism(offset(hring, -1.0), g, fascia - 0.05, "interior", bottom=False)
H.prism(offset(hring, 0.12), roof, roof + 0.3, "trim", top="concrete")
railing(H, offset(hring, 0.02), roof + 0.3)
if door_at:
    a, t, n, ds = door_at
    ang = math.atan2(t[1], t[0])
    def at(s, d):
        return (a[0] + t[0] * s + n[0] * d, a[1] + t[1] * s + n[1] * d)
    # Timing board over the door.
    bx, by = at(ds, 0.06)
    H.box(bx, by, 1.9, 0.12, g + 3.05, g + 3.55, "board", ang)
    digits = text("00:52.41", 0.32, (*at(ds, 0.13), g + 3.32), n, "digits", extrude=0.01)
    # Toboggans racked just inside the door.
    for k in range(4):
        tx, ty = at(ds - 0.55 + k * 0.37, -0.12)
        H.box(tx, ty, 0.3, 0.05, g + 0.6, g + 1.95, "toboggan_red" if k % 2 == 0 else "toboggan_gold", ang + 0.1)
# The red crash pad under the end window: a thick mattress and a padded back against the wall.
a, b = hring[end_edge], hring[(end_edge + 1) % len(hring)]
length, t, n = edge(a, b)
ang = math.atan2(t[1], t[0])
px, py = a[0] + t[0] * length * 0.27 + n[0] * 0.75, a[1] + t[1] * length * 0.27 + n[1] * 0.75
pad_z = g + 0.55
H.box(px, py, 2.4, 1.3, pad_z, pad_z + 0.55, "pad", ang)
bx, by = a[0] + t[0] * length * 0.27 + n[0] * 0.18, a[1] + t[1] * length * 0.27 + n[1] * 0.18
H.box(bx, by, 2.4, 0.3, pad_z, pad_z + 1.05, "pad", ang)
hut = H.build("junction_hut")
hut = lib.join([hut, digits], "junction_hut") if door_at else hut

lib.preview("junction.png", (wb[0] + 3, wb[1] - 26, g + 1.7), (wb[0] - 7, wb[1] + 4, g + 4.5), size=(1170, 900), lens=24, ground=False)
result = {"export": lib.export_glb("junction.glb", [club, walkway, hut]), "faces": {o.name: len(o.data.polygons) for o in (club, walkway, hut)}}
