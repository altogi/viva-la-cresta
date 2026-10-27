"""
A Graubünden Steinbock (Alpine ibex, the canton's heraldic beast): a stocky billy, about 0.95 m
at the shoulder, in a grey-brown winter coat with a pale belly and dark legs, a short beard, and
the great ridged horns sweeping back over his shoulders.

The body is grown from a skeleton with a skin modifier and smoothed; the horns are swept rings
with the knobbly ridges ibex horns carry. Standing on the ground at the origin, facing +x.
Exported to public/models/steinbock.glb.
"""

import math

import bmesh
import bpy

import lib

lib.reset()
COLL = lib.collection("steinbock")

M = {
    "coat": lib.material("sb_coat", (0.36, 0.3, 0.23), 0.95),
    "head": lib.material("sb_head", (0.42, 0.36, 0.28), 0.95),
    "belly": lib.material("sb_belly", (0.72, 0.66, 0.55), 0.95),
    "leg": lib.material("sb_leg", (0.16, 0.12, 0.09), 0.9),
    "hoof": lib.material("sb_hoof", (0.05, 0.045, 0.04), 0.6),
    "horn": lib.material("sb_horn", (0.36, 0.31, 0.24), 0.7),
    "eye": lib.material("sb_eye", (0.02, 0.02, 0.02), 0.2),
    "beard": lib.material("sb_beard", (0.2, 0.16, 0.12), 0.95),
}

# ---------- The body: a skeleton of points with radii, skinned and smoothed ----------

pts, radii, edges = [], [], []


def p(x, y, z, r, link=None):
    pts.append((x, y, z))
    radii.append(r)
    i = len(pts) - 1
    if link is not None:
        edges.append((link, i))
    return i


hips = p(0.0, 0, 0.84, 0.24)
mid = p(0.34, 0, 0.86, 0.29, hips)
chest = p(0.64, 0, 0.88, 0.3, mid)
neck0 = p(0.86, 0, 1.0, 0.19, chest)
neck1 = p(0.98, 0, 1.13, 0.14, neck0)
skull = p(1.08, 0, 1.24, 0.1, neck1)
muzzle = p(1.28, 0, 1.16, 0.065, skull)
tail0 = p(-0.18, 0, 0.88, 0.05, hips)
p(-0.27, 0, 0.82, 0.03, tail0)
for side in (-1, 1):
    y = 0.12 * side
    s = p(0.66, y, 0.72, 0.09, chest)
    k = p(0.7, y, 0.42, 0.05, s)
    f = p(0.69, y, 0.12, 0.038, k)
    p(0.71, y, 0.03, 0.042, f)
    h = p(0.04, y, 0.7, 0.11, hips)
    hk = p(-0.1, y, 0.4, 0.052, h)
    hf = p(-0.03, y, 0.12, 0.038, hk)
    p(-0.01, y, 0.03, 0.042, hf)

me = bpy.data.meshes.new("steinbock_body")
me.from_pydata(pts, edges, [])
me.update()
body = bpy.data.objects.new("steinbock_body", me)
COLL.objects.link(body)
bpy.context.view_layer.objects.active = body
body.select_set(True)
skin = body.modifiers.new("skin", "SKIN")
skin.use_smooth_shade = True
for i, r in enumerate(radii):
    body.data.skin_vertices[""].data[i].radius = (r, r * (0.85 if i in (hips, mid, chest) else 1.0))
body.data.skin_vertices[""].data[hips].use_root = True
sub = body.modifiers.new("smooth", "SUBSURF")
sub.levels = 2
sub.render_levels = 2
bpy.ops.object.select_all(action="DESELECT")
body.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.modifier_apply(modifier="skin")
bpy.ops.object.modifier_apply(modifier="smooth")
for m in M.values():
    body.data.materials.append(m)
names = list(M)
# Colour by region: dark legs and black hooves, a pale belly, the head a touch lighter.
for poly in body.data.polygons:
    c = poly.center
    if c.z < 0.06:
        key = "hoof"
    elif c.z < 0.42:
        key = "leg"
    elif c.x > 1.0 and c.z > 1.0:
        key = "head"
    elif 0.56 < c.z < 0.7 and 0.08 < c.x < 0.6 and abs(c.y) < 0.2:
        key = "belly"
    else:
        key = "coat"
    poly.material_index = names.index(key)
for poly in body.data.polygons:
    poly.use_smooth = True

# ---------- The horns, beard, ears and eyes ----------

V, F, MI = [], [], []


def ring(center, tangent, radius, n=10):
    """A ring of points round `center`, square to `tangent`."""
    tx, ty, tz = tangent
    ref = (0, 1, 0) if abs(ty) < 0.9 else (1, 0, 0)
    ux, uy, uz = ty * ref[2] - tz * ref[1], tz * ref[0] - tx * ref[2], tx * ref[1] - ty * ref[0]
    ul = math.sqrt(ux * ux + uy * uy + uz * uz)
    ux, uy, uz = ux / ul, uy / ul, uz / ul
    wx, wy, wz = ty * uz - tz * uy, tz * ux - tx * uz, tx * uy - ty * ux
    return [(center[0] + (ux * math.cos(a) + wx * math.sin(a)) * radius,
             center[1] + (uy * math.cos(a) + wy * math.sin(a)) * radius,
             center[2] + (uz * math.cos(a) + wz * math.sin(a)) * radius) for a in (k / n * math.tau for k in range(n))]


def sweep(path, radii_, key, cap=True):
    n = 10
    rings = []
    for i, c in enumerate(path):
        a = path[max(0, i - 1)]
        b = path[min(len(path) - 1, i + 1)]
        t = (b[0] - a[0], b[1] - a[1], b[2] - a[2])
        tl = math.sqrt(sum(x * x for x in t)) or 1
        rings.append(ring(c, (t[0] / tl, t[1] / tl, t[2] / tl), radii_[i], n))
    base = len(V)
    for r in rings:
        V.extend(r)
    for i in range(len(rings) - 1):
        for k in range(n):
            a = base + i * n + k
            b = base + i * n + (k + 1) % n
            F.append((a, b, b + n, a + n))
            MI.append(key)
    if cap:
        last = base + (len(rings) - 1) * n
        F.append(tuple(range(last, last + n)))
        MI.append(key)


for side in (-1, 1):
    # Each horn springs from the top of the skull and sweeps back over the shoulders in a wide
    # arc, spreading apart as it goes, knobbly ridges along its front.
    bx, bz = 1.07, 1.32
    R = 0.5
    a0 = math.radians(15)
    cx, cz = bx - R * math.cos(a0), bz - R * math.sin(a0)
    path, rs = [], []
    steps = 40
    for i in range(steps + 1):
        t = i / steps
        a = a0 + t * math.radians(112)
        r = 0.066 * (1 - t) + 0.016 * t
        if i % 3 == 0 and 0 < t < 0.85:
            r *= 1.18  # a ridge
        path.append((cx + R * math.cos(a), side * (0.05 + 0.1 * t * t), cz + R * 0.85 * math.sin(a)))
        rs.append(r)
    sweep(path, rs, "horn")
    # Ears, out to the sides behind the horns.
    ex, ez = 1.02, 1.3
    sweep([(ex, side * 0.07, ez), (ex - 0.02, side * 0.13, ez + 0.01), (ex - 0.03, side * 0.17, ez + 0.0)], [0.03, 0.028, 0.006], "head")
    # Eyes.
    sweep([(1.15, side * 0.075, 1.255), (1.16, side * 0.078, 1.26), (1.17, side * 0.075, 1.265)], [0.012, 0.018, 0.008], "eye")
# The beard under the chin.
sweep([(1.2, 0, 1.1), (1.19, 0, 1.06), (1.17, 0, 1.02)], [0.03, 0.022, 0.005], "beard")

extra = bpy.data.meshes.new("steinbock_horns")
extra.from_pydata(V, [], F)
extra.update()
horns = bpy.data.objects.new("steinbock_horns", extra)
COLL.objects.link(horns)
for m in M.values():
    extra.materials.append(m)
for poly, key in zip(extra.polygons, MI):
    poly.material_index = names.index(key)
    poly.use_smooth = True
bm = bmesh.new()
bm.from_mesh(extra)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
bm.to_mesh(extra)
bm.free()

goat = lib.join([body, horns], "steinbock")
lib.preview("steinbock.png", (1.0, -3.2, 1.2), (0.5, 0, 0.75), size=(900, 700), lens=45, sky=(0.5, 0.65, 0.9))
lib.preview("steinbock_front.png", (3.0, -1.6, 1.3), (0.6, 0, 0.9), size=(900, 700), lens=45, sky=(0.5, 0.65, 0.9))
result = {"export": lib.export_glb("steinbock.glb", [goat]), "faces": len(goat.data.polygons)}
