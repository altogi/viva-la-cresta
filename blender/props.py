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
    "log": lib.material("p_log", (0.36, 0.23, 0.13), 0.88),
    "log_end": lib.material("p_log_end", (0.55, 0.4, 0.25), 0.85),
    "stone": lib.material("p_stone", (0.42, 0.41, 0.39), 0.95),
    "shutter": lib.material("p_shutter", (0.12, 0.27, 0.18), 0.7),
    "iron": lib.material("p_iron", (0.08, 0.08, 0.08), 0.5, metallic=0.6),
    "ice": lib.material("p_ice", (0.85, 0.92, 0.98), 0.1),
    "lamp": lib.material("p_lamp", (1.0, 0.85, 0.55), 0.3, emission=(1.0, 0.75, 0.4)),
    "sign": lib.material("p_sign", (0.56, 0.05, 0.04), 0.6),
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
    """The finish hut, built as the Engadin builds them: walls of horizontal logs on a stone plinth,
    the logs crossing and standing out at the corners; a steep roof deep in snow on rafters whose ends
    show under the eaves, icicles hanging from it, a stovepipe through it. On the front (-y) a plank
    door with a Z-brace and iron hinges, a sign board over it and a lantern beside it; a cross-barred
    window with green shutters and a window box; firewood stacked along one end; the bench by the door."""
    B = Builder()
    w, d, h = 2.6, 2.2, 2.3
    plinth = 0.3
    # Stone plinth.
    B.box(-w / 2 - 0.05, w / 2 + 0.05, -d / 2 - 0.05, d / 2 + 0.05, -0.2, plinth, "stone")
    # Log courses, alternately long on the front/back and on the ends, so the corners interlock and
    # stick out by turns.
    log = 0.19
    k = 0
    z = plinth
    while z < h - 0.05:
        z1 = min(h, z + log)
        over_x = 0.18 if k % 2 == 0 else 0.06
        over_y = 0.06 if k % 2 == 0 else 0.18
        for y0, y1 in ((-d / 2, -d / 2 + 0.14), (d / 2 - 0.14, d / 2)):
            B.box(-w / 2 - over_x, w / 2 + over_x, y0, y1, z + 0.006, z1 - 0.006, "log")
        for x0, x1 in ((-w / 2, -w / 2 + 0.14), (w / 2 - 0.14, w / 2)):
            B.box(x0, x1, -d / 2 - over_y, d / 2 + over_y, z + 0.006, z1 - 0.006, "log")
        # The lighter cut ends at the corners.
        for sx in (-1, 1):
            for sy in (-1, 1):
                if k % 2 == 0:
                    B.box(sx * (w / 2 + over_x) - (0.01 if sx > 0 else -0.01) - 0.005, sx * (w / 2 + over_x) + (0.005 if sx > 0 else -0.005), sy * d / 2 - 0.07 * sy - 0.06, sy * d / 2 - 0.07 * sy + 0.06, z + 0.02, z1 - 0.02, "log_end")
        z = z1
        k += 1
    # Gable ends (front and back, under the ridge that runs front to back): upright boards.
    ridge = h + 1.15
    for y in (-d / 2, d / 2):
        n = 9
        for i in range(n):
            x0 = -w / 2 + i * w / n
            x1 = x0 + w / n - 0.01
            top0 = h + (ridge - h) * (1 - abs(x0) / (w / 2))
            top1 = h + (ridge - h) * (1 - abs(x1) / (w / 2))
            yo = y + (0.07 if y > 0 else -0.07)
            B.poly([(x0, yo, h), (x1, yo, h), (x1, yo, top1), (x0, yo, top0)], "boards")
    # The door: planks, a Z-brace, iron strap hinges and a ring handle, in a frame.
    dx0, dx1 = -1.0, -0.2
    yf = -d / 2 - 0.15
    for i in range(5):
        x0 = dx0 + i * (dx1 - dx0) / 5
        B.box(x0 + 0.005, x0 + (dx1 - dx0) / 5 - 0.005, yf - 0.03, yf, plinth, 2.0, "timber_dark")
    B.box(dx0, dx1, yf - 0.06, yf - 0.03, 0.55, 0.65, "timber")
    B.box(dx0, dx1, yf - 0.06, yf - 0.03, 1.65, 1.75, "timber")
    B.poly([(dx0 + 0.05, yf - 0.061, 0.65), (dx0 + 0.15, yf - 0.061, 0.65), (dx1 - 0.05, yf - 0.061, 1.65), (dx1 - 0.15, yf - 0.061, 1.65)], "timber")
    for zz in (0.6, 1.7):
        B.box(dx0, dx0 + 0.45, yf - 0.075, yf - 0.06, zz - 0.025, zz + 0.025, "iron")
    B.tube((dx1 - 0.12, yf - 0.06, 1.05), (dx1 - 0.12, yf - 0.12, 1.05), 0.025, "iron")
    for x0, x1, z0, z1 in ((dx0 - 0.08, dx0, plinth, 2.08), (dx1, dx1 + 0.08, plinth, 2.08), (dx0 - 0.08, dx1 + 0.08, 2.0, 2.08)):
        B.box(x0, x1, yf - 0.02, yf + 0.05, z0, z1, "timber")
    # The window: dark glass behind a cross of bars in a white frame, green shutters, a window box.
    wx0, wx1, wz0, wz1 = 0.3, 1.0, 1.0, 1.6
    B.box(wx0, wx1, yf + 0.02, yf + 0.03, wz0, wz1, "window")
    for x0, x1, z0, z1 in ((wx0 - 0.05, wx0, wz0 - 0.05, wz1 + 0.05), (wx1, wx1 + 0.05, wz0 - 0.05, wz1 + 0.05), (wx0, wx1, wz0 - 0.05, wz0), (wx0, wx1, wz1, wz1 + 0.05),
                           (0.63, 0.67, wz0, wz1), (wx0, wx1, 1.28, 1.32)):
        B.box(x0, x1, yf - 0.02, yf + 0.04, z0, z1, "white")
    for x0, x1 in ((wx0 - 0.4, wx0 - 0.07), (wx1 + 0.07, wx1 + 0.4)):
        B.box(x0, x1, yf - 0.04, yf, wz0 - 0.03, wz1 + 0.03, "shutter")
        for zz in (wz0 + 0.12, wz0 + 0.3, wz0 + 0.48):
            B.box(x0 + 0.02, x1 - 0.02, yf - 0.05, yf - 0.04, zz, zz + 0.02, "timber_dark")
    B.box(wx0 - 0.05, wx1 + 0.05, yf - 0.24, yf, wz0 - 0.18, wz0 - 0.05, "timber")
    B.box(wx0 - 0.04, wx1 + 0.04, yf - 0.23, yf - 0.01, wz0 - 0.05, wz0 + 0.03, "snow")
    # A sign board over the door and a lantern beside it.
    B.box(-1.15, -0.05, yf - 0.06, yf - 0.02, 2.12, 2.38, "sign")
    B.box(-1.18, -0.02, yf - 0.065, yf - 0.055, 2.09, 2.12, "white")
    B.tube((-0.06, yf, 1.9), (-0.06, yf - 0.22, 1.9), 0.015, "iron")
    B.box(-0.12, 0.0, yf - 0.28, yf - 0.16, 1.68, 1.88, "lamp")
    B.box(-0.14, 0.02, yf - 0.3, yf - 0.14, 1.88, 1.92, "iron")
    # Roof: steep, overhanging, on rafters whose ends show; thick snow with a rounded front and icicles.
    over_y, over_x = 0.55, 0.4
    pitch_z = ridge
    for sx in (-1, 1):
        a = (0, -d / 2 - over_y, pitch_z)
        b = (sx * (w / 2 + over_x), -d / 2 - over_y, h - 0.3)
        c = (sx * (w / 2 + over_x), d / 2 + over_y, h - 0.3)
        e = (0, d / 2 + over_y, pitch_z)
        pts = [a, b, c, e] if sx > 0 else [a, e, c, b]
        B.poly(pts, "roof")
        lift = 0.24
        B.poly([(q[0], q[1], q[2] + lift) for q in pts], "snow")
        B.poly([(b[0], b[1], b[2]), (c[0], c[1], c[2]), (c[0], c[1], c[2] + lift), (b[0], b[1], b[2] + lift)] if sx > 0 else [(c[0], c[1], c[2]), (b[0], b[1], b[2]), (b[0], b[1], b[2] + lift), (c[0], c[1], c[2] + lift)], "snow")
        # A soft lip of snow curling over the eave.
        B.tube((b[0] * 0.98, b[1], b[2] + 0.12), (c[0] * 0.98, c[1], c[2] + 0.12), 0.14, "snow", sides=8)
        # Rafter ends under the eave, and icicles.
        for i in range(6):
            y = -d / 2 - over_y + 0.1 + i * (d + 2 * over_y - 0.2) / 5
            B.box(sx * (w / 2 + over_x) - 0.06 * sx - 0.05, sx * (w / 2 + over_x) - 0.06 * sx + 0.05, y - 0.05, y + 0.05, h - 0.42, h - 0.3, "timber_dark")
        for i in range(9):
            y = -d / 2 - over_y + 0.15 + i * (d + 2 * over_y - 0.3) / 8
            ln = 0.12 + 0.18 * ((i * 37) % 5) / 4
            B.tube((sx * (w / 2 + over_x - 0.02), y, h - 0.3), (sx * (w / 2 + over_x - 0.02), y, h - 0.3 - ln), 0.012, "ice", sides=4)
    # Fascia boards along the gable eaves.
    for y in (-d / 2 - over_y, d / 2 + over_y):
        for sx in (-1, 1):
            B.poly([(0, y, pitch_z), (sx * (w / 2 + over_x), y, h - 0.3), (sx * (w / 2 + over_x), y, h - 0.42), (0, y, pitch_z - 0.12)], "timber")
    # Stovepipe through the back slope, with a cap and snow on it.
    B.tube((0.7, 0.45, h + 0.4), (0.7, 0.45, ridge + 0.25), 0.07, "iron", sides=10)
    B.box(0.58, 0.82, 0.33, 0.57, ridge + 0.25, ridge + 0.3, "iron")
    B.box(0.6, 0.8, 0.35, 0.55, ridge + 0.3, ridge + 0.37, "snow")
    # Firewood stacked along the +x end under the eave: rows of log ends.
    for row in range(5):
        for i in range(7):
            yy = -d / 2 + 0.2 + i * 0.26 + (0.13 if row % 2 else 0)
            if yy > d / 2 - 0.15:
                continue
            zz = plinth + 0.1 + row * 0.2
            B.tube((w / 2 + 0.06, yy, zz), (w / 2 + 0.42, yy, zz), 0.1, "log", sides=7)
            B.tube((w / 2 + 0.42, yy, zz), (w / 2 + 0.425, yy, zz), 0.095, "log_end", sides=7)
    B.box(w / 2 + 0.04, w / 2 + 0.46, -d / 2 + 0.05, d / 2 - 0.05, plinth + 1.05, plinth + 1.12, "snow")
    # A bench by the door.
    B.box(-1.25, 1.25, -d / 2 - 0.55, -d / 2 - 0.2, 0.42, 0.47, "timber")
    for x in (-1.1, 1.1):
        B.box(x - 0.04, x + 0.04, -d / 2 - 0.5, -d / 2 - 0.25, 0, 0.42, "timber_dark")
    return B.build("finish_hut")


objs = [platform(), hut()]
objs[1].location = (8, -4, 0)
lib.preview("props.png", (6, -16, 6), (2, 0, 1.5), size=(1100, 700), lens=35, sky=(0.35, 0.55, 0.9))
objs[0].hide_render = True
lib.preview("finish_hut.png", (11.5, -9.5, 2.6), (8, -4, 1.6), size=(1000, 800), lens=35, sky=(0.35, 0.55, 0.9))
objs[0].hide_render = False
objs[1].location = (0, 0, 0)
result = {"export": lib.export_glb("props.glb", objs)}
