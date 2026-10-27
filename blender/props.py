"""
Smaller pieces beside the run, from the photographs:

  shuttlecock_platform - the wooden observers' stand just before Shuttlecock: a timber deck on steel
                         scaffold legs, braced timber railings and a stair at one end. Built with
                         its front edge (towards the run) along y = 0, the deck running along x,
                         the stand behind it at +y, deck top at DECK (2.6 m);
  finish_hut           - the small wooden hut by the finish mat: boarded walls, a door and window, a
                         snow-laden gable roof and a bench. Front (door) facing -y, base at z = 0.

Exported to public/models/props.glb; the game places them.
"""

import math

import bmesh

import lib

DECK = 2.6

lib.reset()
COLL = lib.collection("props")

M = {
    "timber": lib.material("p_timber", (0.5, 0.36, 0.22), 0.85),
    "timber_dark": lib.material("p_timber_dark", (0.33, 0.23, 0.14), 0.85),
    "boards": lib.material("p_boards", (0.42, 0.28, 0.16), 0.9),
    "scaffold": lib.material("p_scaffold", (0.6, 0.62, 0.64), 0.4, metallic=0.8),
    "snow": lib.material("p_snow", (0.93, 0.95, 0.98), 0.85),
    "red": lib.material("p_banner", (0.7, 0.06, 0.06), 0.6),
    "white": lib.material("p_white", (0.92, 0.92, 0.9), 0.6),
    "window": lib.material("p_window", (0.05, 0.07, 0.1), 0.1, metallic=0.4),
    "roof": lib.material("p_roof", (0.28, 0.2, 0.14), 0.8),
}


class Builder:
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
        p = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
        for face in ((0, 3, 2, 1), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
            self.poly([p[k] for k in face], key)
        self.poly([p[k] for k in (4, 5, 6, 7)], top or key)

    def tube(self, p0, p1, r, key, sides=6):
        ax = [p1[k] - p0[k] for k in range(3)]
        length = math.sqrt(sum(c * c for c in ax)) or 1e-6
        ax = [c / length for c in ax]
        ref = (0, 0, 1) if abs(ax[2]) < 0.9 else (1, 0, 0)
        u = [ax[1] * ref[2] - ax[2] * ref[1], ax[2] * ref[0] - ax[0] * ref[2], ax[0] * ref[1] - ax[1] * ref[0]]
        un = math.sqrt(sum(c * c for c in u))
        u = [c / un for c in u]
        w = [ax[1] * u[2] - ax[2] * u[1], ax[2] * u[0] - ax[0] * u[2], ax[0] * u[1] - ax[1] * u[0]]
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
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(obj.data)
        bm.free()
        return obj


def platform():
    B = Builder()
    length, depth = 9.0, 3.2
    # Scaffold: standards at the corners and every 3 m, ledgers and diagonal braces between them.
    xs = [-length / 2 + k * 3 for k in range(4)]
    for x in xs:
        for y in (0.15, depth - 0.15):
            B.tube((x, y, -0.5), (x, y, DECK - 0.15), 0.03, "scaffold")
            B.box(x - 0.12, x + 0.12, y - 0.12, y + 0.12, -0.5, -0.45, "timber_dark")
        B.tube((x, 0.15, 0.9), (x, depth - 0.15, 0.9), 0.025, "scaffold")
        B.tube((x, 0.15, 0.2), (x, depth - 0.15, DECK - 0.4), 0.022, "scaffold")
    for y in (0.15, depth - 0.15):
        B.tube((xs[0], y, DECK - 0.2), (xs[-1], y, DECK - 0.2), 0.025, "scaffold")
        B.tube((xs[0], y, 0.9), (xs[-1], y, 0.9), 0.025, "scaffold")
        for a, b in zip(xs, xs[1:]):
            B.tube((a, y, 0.15), (b, y, DECK - 0.35), 0.022, "scaffold")
    # Timber joists and deck boards, with a dusting of snow.
    for y in (0.15, depth / 2, depth - 0.15):
        B.box(-length / 2 - 0.1, length / 2 + 0.1, y - 0.07, y + 0.07, DECK - 0.3, DECK - 0.12, "timber_dark")
    n = int(length / 0.2)
    for k in range(n):
        x = -length / 2 + k * 0.2
        B.box(x + 0.01, x + 0.19, -0.1, depth + 0.1, DECK - 0.12, DECK - 0.04, "timber")
    B.box(-length / 2, length / 2, 0.6, depth - 0.3, DECK - 0.04, DECK - 0.01, "snow")
    # Railing: posts, a broad top rail and diagonal bracing in front; plain rails at the ends.
    top = DECK + 1.05
    for x in [-length / 2 + k * 1.5 for k in range(7)]:
        B.box(x - 0.06, x + 0.06, -0.06, 0.06, DECK - 0.3, top, "timber")
    B.box(-length / 2 - 0.1, length / 2 + 0.1, -0.1, 0.1, top - 0.06, top + 0.04, "timber")
    for k in range(6):
        x0 = -length / 2 + k * 1.5
        B.tube((x0, 0, DECK + 0.05), (x0 + 1.5, 0, top - 0.1), 0.045, "timber")
        B.tube((x0 + 1.5, 0, DECK + 0.05), (x0, 0, top - 0.1), 0.045, "timber")
    for x in (-length / 2, length / 2):
        for y in (depth / 2, depth - 0.1):
            B.box(x - 0.06, x + 0.06, y - 0.06, y + 0.06, DECK - 0.3, top, "timber")
        B.box(x - 0.05, x + 0.05, 0, depth, top - 0.06, top + 0.02, "timber")
        B.box(x - 0.04, x + 0.04, 0, depth, DECK + 0.5, DECK + 0.58, "timber")
    # A banner along the front.
    B.box(-1.8, 1.8, -0.14, -0.1, DECK + 0.3, DECK + 0.95, "red")
    # Stair down at the far end, behind.
    steps = 12
    for k in range(steps):
        z = DECK - (k + 1) * DECK / steps
        y = depth + 0.2 + k * 0.3
        B.box(length / 2 - 1.3, length / 2 - 0.1, y, y + 0.3, z - 0.04, z + 0.04, "timber")
    for x in (length / 2 - 1.3, length / 2 - 0.1):
        B.tube((x, depth + 0.2, DECK), (x, depth + 0.2 + steps * 0.3, 0), 0.05, "timber_dark")
        B.tube((x, depth + 0.2, DECK + 1.0), (x, depth + 0.2 + steps * 0.3, 1.0), 0.03, "timber")
    return B.build("shuttlecock_platform")


def hut():
    B = Builder()
    w, d, h = 2.6, 2.2, 2.3
    # Vertical boards all round.
    n = int(w / 0.16)
    for k in range(n):
        x = -w / 2 + k * w / n
        for y0, y1 in ((-d / 2, -d / 2 + 0.05), (d / 2 - 0.05, d / 2)):
            B.box(x + 0.005, x + w / n - 0.005, y0, y1, 0, h, "boards" if k % 3 else "timber")
    m = int(d / 0.16)
    for k in range(m):
        y = -d / 2 + k * d / m
        for x0, x1 in ((-w / 2, -w / 2 + 0.05), (w / 2 - 0.05, w / 2)):
            B.box(x0, x1, y + 0.005, y + d / m - 0.005, 0, h, "boards" if k % 3 else "timber")
    # Gable ends.
    for y in (-d / 2, d / 2):
        B.poly([(-w / 2, y, h), (w / 2, y, h), (0, y, h + 0.9)] if y > 0 else [(w / 2, y, h), (-w / 2, y, h), (0, y, h + 0.9)], "boards")
    # Door and window on the front, a frame round each.
    B.box(-0.95, -0.15, -d / 2 - 0.03, -d / 2, 0.05, 1.95, "timber_dark")
    B.box(0.3, 1.0, -d / 2 - 0.03, -d / 2, 1.0, 1.6, "window")
    for x0, x1, z0, z1 in ((0.25, 1.05, 0.95, 1.0), (0.25, 1.05, 1.6, 1.65), (0.25, 0.3, 0.95, 1.65), (1.0, 1.05, 0.95, 1.65), (0.6, 0.65, 1.0, 1.6)):
        B.box(x0, x1, -d / 2 - 0.05, -d / 2 - 0.01, z0, z1, "white")
    # Roof: two pitches with overhang, a thick layer of snow on each.
    over = 0.35
    for sx in (-1, 1):
        a = (0, -d / 2 - over, h + 0.9)
        b = (sx * (w / 2 + over), -d / 2 - over, h - 0.25)
        c = (sx * (w / 2 + over), d / 2 + over, h - 0.25)
        e = (0, d / 2 + over, h + 0.9)
        pts = [a, b, c, e] if sx > 0 else [a, e, c, b]
        B.poly(pts, "roof")
        lift = 0.18
        B.poly([(p[0], p[1], p[2] + lift) for p in pts], "snow")
        B.poly([(b[0], b[1], b[2]), (c[0], c[1], c[2]), (c[0], c[1], c[2] + lift), (b[0], b[1], b[2] + lift)] if sx > 0 else [(c[0], c[1], c[2]), (b[0], b[1], b[2]), (b[0], b[1], b[2] + lift), (c[0], c[1], c[2] + lift)], "snow")
    # A bench by the door.
    B.box(-1.25, 1.25, -d / 2 - 0.55, -d / 2 - 0.2, 0.42, 0.47, "timber")
    for x in (-1.1, 1.1):
        B.box(x - 0.04, x + 0.04, -d / 2 - 0.5, -d / 2 - 0.25, 0, 0.42, "timber_dark")
    return B.build("finish_hut")


objs = [platform(), hut()]
objs[1].location = (8, -4, 0)
lib.preview("props.png", (6, -16, 6), (2, 0, 1.5), size=(1100, 700), lens=35, sky=(0.35, 0.55, 0.9))
objs[1].location = (0, 0, 0)
result = {"export": lib.export_glb("props.glb", objs)}
