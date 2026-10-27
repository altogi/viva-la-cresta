"""
The Top hut: the ornate octagonal pavilion beside the Top start, from the photographs.

Mustard-yellow infill in a dark-brown timber frame on a grey stone plinth; turned columns at the
eight corners; on each face a tall yellow-framed window (mullion and transom, set back in the
wall) over a sill and a carved quatrefoil panel, a dentil cornice above it and an arched transom
window over that; the door face has an arched doorway and an X-cross panel over it. Carved scroll
brackets with hanging finials carry a deep yellow soffit; a brown fascia, a snow-laden roof, and a
ribbed verdigris copper dome on a drum, with a lantern finial. A loudspeaker horn under the eave.

Built round the origin, base at z = 0, the door facing -x (as src/render/topHut.ts had it: the
game turns it to face the start). Exported to public/models/tophut.glb.
"""

import math

import bmesh

import lib

SIDES = 8
RADIUS = 3.6  # to the corners, matching the OSM footprint
PLINTH = 0.45
WALL = 3.7
TOP = PLINTH + WALL
APOTHEM = RADIUS * math.cos(math.pi / SIDES)
SIDE = 2 * RADIUS * math.sin(math.pi / SIDES)

lib.reset()
COLL = lib.collection("tophut")

M = {
    "brown": lib.material("th_brown", (0.2, 0.13, 0.1), 0.7),
    "yellow": lib.material("th_yellow", (0.76, 0.45, 0.07), 0.8),
    "yellow_light": lib.material("th_yellow_light", (0.86, 0.58, 0.15), 0.7),
    "yellow_dark": lib.material("th_yellow_dark", (0.5, 0.27, 0.04), 0.8),
    "stone": lib.material("th_stone", (0.3, 0.28, 0.26), 0.9),
    "glass": lib.material("th_glass", (0.03, 0.05, 0.07), 0.08, metallic=0.6),
    "interior": lib.material("th_interior", (0.05, 0.035, 0.03), 1.0),
    "copper": lib.material("th_copper", (0.14, 0.3, 0.24), 0.5, metallic=0.4),
    "snow": lib.material("th_snow", (0.93, 0.95, 0.98), 0.85),
    "horn": lib.material("th_horn", (0.75, 0.74, 0.7), 0.4),
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

    def hexa(self, p, key):
        """A six-sided solid from its 8 corners (bottom 4 then top 4, each counter-clockwise)."""
        for face in ((0, 3, 2, 1), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7), (4, 5, 6, 7)):
            self.poly([p[k] for k in face], key)

    def lathe(self, profile, key, sides=12, cx=0.0, cy=0.0, cap_top=True, cap_bottom=False):
        """Surface of revolution of (radius, z) pairs, bottom to top."""
        rings = [[(cx + r * math.cos(k / sides * math.tau), cy + r * math.sin(k / sides * math.tau), z) for k in range(sides)] for r, z in profile]
        for a, b in zip(rings, rings[1:]):
            for k in range(sides):
                n = (k + 1) % sides
                self.poly((a[k], a[n], b[n], b[k]), key)
        if cap_top and profile[-1][0] > 1e-4:
            self.poly(rings[-1], key)
        if cap_bottom and profile[0][0] > 1e-4:
            self.poly(rings[0][::-1], key)

    def build(self, name):
        obj = lib.mesh_object(name, self.v, self.f, None, self.mats, COLL)
        for poly, m in zip(obj.data.polygons, self.mi):
            poly.material_index = m
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(obj.data)
        bm.free()
        return obj


B = Builder()


def octagon(r, z, phase=math.pi / SIDES):
    return [(r * math.cos(phase + k * math.tau / SIDES), r * math.sin(phase + k * math.tau / SIDES), z) for k in range(SIDES)]


def prism(r0, r1, z0, z1, key, top=None):
    """An octagonal frustum, corners on the hut's corners."""
    a, b = octagon(r0, z0), octagon(r1, z1)
    for k in range(SIDES):
        n = (k + 1) % SIDES
        B.poly((a[k], a[n], b[n], b[k]), key)
    B.poly(b, top or key)
    B.poly(a[::-1], key)


class Face:
    """One wall face: u along it (left to right seen from outside), w outwards, z up."""

    def __init__(self, theta):
        self.c = (APOTHEM * math.cos(theta), APOTHEM * math.sin(theta))
        self.n = (math.cos(theta), math.sin(theta))
        self.t = (-math.sin(theta), math.cos(theta))

    def p(self, u, w, z):
        return (self.c[0] + self.t[0] * u + self.n[0] * w, self.c[1] + self.t[1] * u + self.n[1] * w, z)

    def box(self, u0, u1, w0, w1, z0, z1, key):
        B.hexa([self.p(u0, w0, z0), self.p(u1, w0, z0), self.p(u1, w1, z0), self.p(u0, w1, z0), self.p(u0, w0, z1), self.p(u1, w0, z1), self.p(u1, w1, z1), self.p(u0, w1, z1)], key)

    def flat(self, pts, w, key):
        """A flat shape in the face's plane at depth w, from (u, z) points counter-clockwise seen from outside."""
        B.poly([self.p(u, w, z) for u, z in pts], key)

    def disc(self, u, z, r, w, key, n=10):
        self.flat([(u + r * math.cos(k / n * math.tau), z + r * math.sin(k / n * math.tau)) for k in range(n)], w, key)

    def arch(self, u, z, r, n=10):
        """Points of a semicircular arch head, left to right."""
        return [(u - r * math.cos(k / n * math.pi), z + r * math.sin(k / n * math.pi)) for k in range(n + 1)]


HW = SIDE / 2 - 0.1  # half the face between the columns
WIN = 0.55  # half the window's width
Z_PANEL = (PLINTH + 0.15, PLINTH + 1.0)
Z_WIN = (PLINTH + 1.05, PLINTH + 2.7)
Z_CORNICE = (PLINTH + 2.72, PLINTH + 2.92)
Z_TRANSOM = PLINTH + 3.0  # springing line of the arched transom
Z_BEAM = (TOP - 0.15, TOP)


def window_face(f: Face):
    # Brown frame beams along the bottom and top.
    f.box(-HW - 0.05, HW + 0.05, -0.12, 0.05, PLINTH, PLINTH + 0.15, "brown")
    f.box(-HW - 0.05, HW + 0.05, -0.12, 0.05, *Z_BEAM, "brown")
    # Yellow infill, round the window and the transom (the back of the wall at w = -0.15).
    f.box(-HW, HW, -0.15, 0, PLINTH + 0.15, Z_WIN[0], "yellow")
    for u0, u1 in ((-HW, -WIN), (WIN, HW)):
        f.box(u0, u1, -0.15, 0, Z_WIN[0], Z_BEAM[0], "yellow")
    f.box(-WIN, WIN, -0.15, 0, Z_WIN[1], Z_CORNICE[0], "yellow")
    # Over the arched transom: the spandrels, front and back.
    arch = f.arch(0, Z_TRANSOM, WIN)
    for w in (0.0, -0.15):
        f.flat([(-WIN, Z_BEAM[0]), *arch[:6], (0, Z_BEAM[0])], w, "yellow")
        f.flat([(0, Z_BEAM[0]), *arch[5:], (WIN, Z_BEAM[0])], w, "yellow")
    f.box(-WIN, WIN, -0.15, 0, Z_CORNICE[1], Z_TRANSOM, "yellow")
    # Glass, set back, and the light yellow frames, mullion and transom bar.
    f.flat([(-WIN, Z_WIN[0]), (WIN, Z_WIN[0]), (WIN, Z_WIN[1]), (-WIN, Z_WIN[1])], -0.1, "glass")
    f.flat(arch, -0.1, "glass")
    fr = 0.07
    f.box(-WIN - fr, -WIN + 0.02, -0.11, 0.05, Z_WIN[0] - fr, Z_WIN[1] + fr, "yellow_light")
    f.box(WIN - 0.02, WIN + fr, -0.11, 0.05, Z_WIN[0] - fr, Z_WIN[1] + fr, "yellow_light")
    f.box(-WIN, WIN, -0.11, 0.05, Z_WIN[1] - 0.02, Z_WIN[1] + fr, "yellow_light")
    f.box(-0.03, 0.03, -0.11, -0.02, Z_WIN[0], Z_WIN[1], "yellow_light")
    f.box(-WIN, WIN, -0.11, -0.02, Z_WIN[0] + 1.15, Z_WIN[0] + 1.21, "yellow_light")
    # Arch frame: short boxes round the curve.
    for (u0, z0), (u1, z1) in zip(arch, arch[1:]):
        um, zm = (u0 + u1) / 2, (z0 + z1) / 2
        nx, nz = um, zm - Z_TRANSOM
        k = math.hypot(nx, nz) or 1
        o = (nx / k * fr, nz / k * fr)
        f.flat([(u0, z0), (u1, z1), (u1 + o[0], z1 + o[1]), (u0 + o[0], z0 + o[1])], 0.05, "yellow_light")
    # Sill.
    f.box(-WIN - 0.15, WIN + 0.15, -0.05, 0.13, Z_WIN[0] - 0.12, Z_WIN[0] - 0.05, "brown")
    # Dentil cornice: a moulding and a row of little blocks under it.
    f.box(-HW, HW, -0.05, 0.12, Z_CORNICE[1] - 0.07, Z_CORNICE[1], "brown")
    n = int(2 * HW / 0.13)
    for k in range(n):
        u = -HW + (k + 0.5) * 2 * HW / n
        f.box(u - 0.035, u + 0.035, 0, 0.08, Z_CORNICE[0], Z_CORNICE[1] - 0.07, "brown")
    # Carved panel below the window: a raised field with a quatrefoil on it.
    zc = (Z_PANEL[0] + Z_PANEL[1]) / 2
    f.box(-WIN, WIN, 0, 0.03, Z_PANEL[0] + 0.08, Z_PANEL[1] - 0.08, "yellow_dark")
    for du, dz in ((0.13, 0), (-0.13, 0), (0, 0.13), (0, -0.13)):
        f.disc(du, zc + dz, 0.13, 0.04, "yellow_light")
    f.disc(0, zc, 0.06, 0.05, "brown", 8)


def door_face(f: Face):
    f.box(-HW - 0.05, HW + 0.05, -0.12, 0.05, *Z_BEAM, "brown")
    door = 0.62
    spring = PLINTH + 2.25
    arch = f.arch(0, spring, door)
    for u0, u1 in ((-HW, -door), (door, HW)):
        f.box(u0, u1, -0.15, 0, PLINTH, Z_BEAM[0], "yellow")
    top = spring + door + 0.08
    for w in (0.0, -0.15):
        f.flat([(-door, top), *arch[:6], (0, top)], w, "yellow")
        f.flat([(0, top), *arch[5:], (door, top)], w, "yellow")
    # The dark of the open doorway, a step, and the frame round it.
    f.flat([(-door, PLINTH), (door, PLINTH), (door, spring), *arch[::-1][1:-1], (-door, spring)], -0.14, "interior")
    f.box(-door - 0.1, door + 0.1, -0.05, 0.25, PLINTH - 0.2, PLINTH + 0.02, "stone")
    f.box(-door - 0.08, -door + 0.01, -0.12, 0.05, PLINTH, spring, "brown")
    f.box(door - 0.01, door + 0.08, -0.12, 0.05, PLINTH, spring, "brown")
    # Over it, the X-cross panel between beams.
    f.box(-HW, HW, -0.15, 0, top, Z_BEAM[0], "yellow")
    f.box(-HW, HW, -0.05, 0.08, top - 0.08, top, "brown")
    z0, z1 = top + 0.06, Z_BEAM[0] - 0.06
    for (ua, za), (ub, zb) in (((-HW + 0.1, z0), (HW - 0.1, z1)), ((-HW + 0.1, z1), (HW - 0.1, z0))):
        d = math.hypot(ub - ua, zb - za)
        nu, nz = -(zb - za) / d * 0.07, (ub - ua) / d * 0.07
        f.flat([(ua - nu, za - nz), (ub - nu, zb - nz), (ub + nu, zb + nz), (ua + nu, za + nz)], 0.03, "yellow_light")


# Plinth, floor and the dark inside seen through the glass.
prism(RADIUS + 0.22, RADIUS + 0.14, 0, PLINTH, "stone")
prism(APOTHEM - 0.2, APOTHEM - 0.2, PLINTH, TOP, "interior")

for i in range(SIDES):
    theta = math.pi + i * math.tau / SIDES  # the door (i = 0) faces -x
    f = Face(theta)
    if i == 0:
        door_face(f)
    else:
        window_face(f)
    # The corner after this face: turned column, scroll bracket, hanging finial.
    ca = theta + math.pi / SIDES
    cx, cy = RADIUS * math.cos(ca), RADIUS * math.sin(ca)
    s = WALL
    B.lathe([(0.17, PLINTH), (0.17, PLINTH + 0.25), (0.12, PLINTH + 0.32), (0.11, PLINTH + 0.4), (0.13, PLINTH + 0.5), (0.1, PLINTH + 0.62),
             (0.09, PLINTH + s * 0.55), (0.12, PLINTH + s * 0.6), (0.09, PLINTH + s * 0.66), (0.09, TOP - 0.42), (0.13, TOP - 0.34),
             (0.15, TOP - 0.2), (0.17, TOP)], "brown", 10, cx, cy)
    # Scroll bracket: a carved quarter-curve in the corner's radial plane, out to the soffit's edge.
    out = (math.cos(ca), math.sin(ca))
    prof = []
    for k in range(9):
        a = k / 8 * math.pi / 2
        prof.append((0.1 + 1.0 * (1 - math.cos(a)), TOP - 1.0 + 1.0 * math.sin(a) * 0.95))
    prof += [(1.15, TOP + 0.02), (0.1, TOP + 0.02)]
    side = (-out[1] * 0.05, out[0] * 0.05)
    front = [(cx + out[0] * r + side[0], cy + out[1] * r + side[1], z) for r, z in prof]
    back = [(cx + out[0] * r - side[0], cy + out[1] * r - side[1], z) for r, z in prof]
    B.poly(front, "brown")
    B.poly(back[::-1], "brown")
    for k in range(len(prof)):
        n = (k + 1) % len(prof)
        B.poly((front[k], back[k], back[n], front[n]), "brown")
    # Hanging finial at the bracket's tip.
    fx, fy = cx + out[0] * 1.12, cy + out[1] * 1.12
    B.lathe([(0.0, TOP - 0.55), (0.06, TOP - 0.45), (0.08, TOP - 0.32), (0.04, TOP - 0.2), (0.06, TOP - 0.1), (0.05, TOP + 0.02)], "brown", 8, fx, fy)

# Architrave, the deep yellow soffit sloping up to a brown fascia, the roof under its snow.
prism(RADIUS + 0.14, RADIUS + 0.14, TOP, TOP + 0.24, "brown")
EAVE = RADIUS + 1.3
a, b = octagon(RADIUS + 0.14, TOP + 0.24), octagon(EAVE, TOP + 0.42)
for k in range(SIDES):
    n = (k + 1) % SIDES
    B.poly((a[k], b[k], b[n], a[n]), "yellow_light")
prism(EAVE, EAVE, TOP + 0.42, TOP + 0.68, "brown")
prism(EAVE - 0.05, 1.65, TOP + 0.68, TOP + 1.45, "yellow_dark", top="yellow_dark")
# Snow: a thick layer over the roof, rounded at the edge.
prism(EAVE + 0.06, 1.75, TOP + 0.72, TOP + 1.62, "snow")
B.lathe([(EAVE + 0.1, TOP + 0.62), (EAVE + 0.16, TOP + 0.72), (EAVE + 0.08, TOP + 0.84)], "snow", 16, cap_top=False)
# Drum and the ribbed copper dome, a lantern finial on top.
B.lathe([(1.7, TOP + 1.45), (1.7, TOP + 1.75), (1.78, TOP + 1.78), (1.78, TOP + 1.88), (1.68, TOP + 1.9)], "brown", 24)
dome = [(1.7 * math.cos(k / 12 * math.pi / 2) ** 0.85, TOP + 1.9 + 2.3 * math.sin(k / 12 * math.pi / 2)) for k in range(13)]
dome[-1] = (0.12, dome[-1][1])
B.lathe(dome, "copper", 32)
for k in range(16):
    ang = k / 16 * math.tau
    pts = [(r * math.cos(ang), r * math.sin(ang), z) for r, z in dome[:-1]]
    for p0, p1 in zip(pts, pts[1:]):
        g = 1.03
        B.poly([(p0[0] * g - math.sin(ang) * 0.04, p0[1] * g + math.cos(ang) * 0.04, p0[2]), (p0[0] * g + math.sin(ang) * 0.04, p0[1] * g - math.cos(ang) * 0.04, p0[2]),
                (p1[0] * g + math.sin(ang) * 0.04, p1[1] * g - math.cos(ang) * 0.04, p1[2]), (p1[0] * g - math.sin(ang) * 0.04, p1[1] * g + math.cos(ang) * 0.04, p1[2])], "copper")
top = dome[-1][1]
B.lathe([(0.14, top - 0.02), (0.2, top + 0.1), (0.2, top + 0.45), (0.24, top + 0.5), (0.05, top + 0.75), (0.09, top + 0.85), (0.0, top + 1.0)], "copper", 12)
# Snow banked round the drum's foot.
B.lathe([(2.3, TOP + 1.3), (1.9, TOP + 1.62), (1.72, TOP + 1.7)], "snow", 24, cap_top=False)
# Loudspeaker horn under the eave over the face opposite the door, pointing out (along +x).
for k in range(12):
    a0, a1 = k / 12 * math.tau, (k + 1) / 12 * math.tau
    ring = lambda r, x, a: (x, r * math.cos(a), TOP - 0.3 + r * math.sin(a))
    B.poly([ring(0.05, APOTHEM + 0.3, a0), ring(0.05, APOTHEM + 0.3, a1), ring(0.21, APOTHEM + 0.75, a1), ring(0.21, APOTHEM + 0.75, a0)], "horn")

hut = B.build("top_hut")
lib.preview("tophut.png", (-12, -6, 4.5), (0, 0, 3.0), size=(1000, 900), lens=40, sky=(0.45, 0.62, 0.92))
lib.preview("tophut_side.png", (8, 10, 6), (0, 0, 3.4), size=(1000, 900), lens=40, sky=(0.45, 0.62, 0.92))
result = {"export": lib.export_glb("tophut.glb", [hut]), "faces": len(hut.data.polygons)}
