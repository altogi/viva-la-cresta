"""
The club's trophies, for the trophy room: the Cresta Cup's flared silver vase, the Gunter Sachs
gold vase, the Grand National's lidded silver tankard, the Morgan Cup's tall flared cup, the
Brabazon Trophy's gold toboggan on its plinth, the Curzon Cup's gold lidded cup; the animals (the
Calisch Grischun's silver Steinbock, the Coppa d'Italia's silver boar, the Bartley Bear in carved
wood), the Willoughby Cup's silver kukri; and a few standard ornate cups for the other races.

Turned pieces are lathed from profiles (radius, height), handles swept along curves, animals grown
from skeletons with a skin modifier. Each trophy is one object, `trophy_<id>`, standing on the
ground at its origin. Exported to public/models/trophies.glb.
"""

import math

import bmesh
import bpy

import lib

lib.reset()
COLL = lib.collection("trophies")

M = {
    "silver": lib.material("tr_silver", (0.93, 0.93, 0.95), 0.1, 1.0),
    "gold": lib.material("tr_gold", (1.0, 0.76, 0.36), 0.13, 1.0),
    "ebony": lib.material("tr_ebony", (0.02, 0.018, 0.016), 0.22),
    "wood": lib.material("tr_wood", (0.2, 0.09, 0.035), 0.3),
    "oak": lib.material("tr_oak", (0.42, 0.24, 0.11), 0.38),
    "plaque": lib.material("tr_plaque", (0.85, 0.85, 0.88), 0.18, 1.0),
}
NAMES = list(M)


def finish(obj, key):
    obj.data.materials.clear()
    for m in M.values():
        obj.data.materials.append(m)
    for p in obj.data.polygons:
        p.material_index = NAMES.index(key)
        p.use_smooth = True
    return obj


def lathe(name, profile, key, seg=56):
    """A turned piece from (radius, z) points, bottom to top; radius 0 at an end closes it."""
    verts, faces = [], []
    rings = []
    for r, z in profile:
        if r <= 1e-6:
            verts.append((0, 0, z))
            rings.append([len(verts) - 1])
        else:
            start = len(verts)
            for k in range(seg):
                a = k / seg * math.tau
                verts.append((r * math.cos(a), r * math.sin(a), z))
            rings.append(list(range(start, start + seg)))
    for a, b in zip(rings, rings[1:]):
        if len(a) == 1 and len(b) == 1:
            continue
        if len(a) == 1:
            for k in range(seg):
                faces.append((a[0], b[k], b[(k + 1) % seg]))
        elif len(b) == 1:
            for k in range(seg):
                faces.append((a[k], b[0], a[(k + 1) % seg]))
        else:
            for k in range(seg):
                faces.append((a[k], b[k], b[(k + 1) % seg], a[(k + 1) % seg]))
    # Close an open end with a flat cap.
    if len(rings[0]) > 1:
        faces.append(tuple(reversed(rings[0])))
    if len(rings[-1]) > 1:
        faces.append(tuple(rings[-1]))
    obj = lib.mesh_object(name, verts, faces, coll=COLL)
    fix_normals(obj)
    return finish(obj, key)


def fix_normals(obj):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(obj.data)
    bm.free()


def sweep(name, path, radii, key, n=12):
    """A tube along a path of points, with a radius at each, capped at both ends. The rings are
    carried along the path by parallel transport, so the tube never twists at a bend."""
    from mathutils import Vector

    if isinstance(radii, (int, float)):
        radii = [radii] * len(path)
    pts = [Vector(p) for p in path]
    tangents = []
    for i in range(len(pts)):
        t = pts[min(len(pts) - 1, i + 1)] - pts[max(0, i - 1)]
        tangents.append(t.normalized() if t.length > 1e-9 else Vector((1, 0, 0)))
    ref = Vector((0, 0, 1)) if abs(tangents[0].z) < 0.9 else Vector((1, 0, 0))
    normal = tangents[0].cross(ref).normalized()
    verts, faces, starts = [], [], []
    for i, c in enumerate(pts):
        if i > 0:
            # Turn the normal by the rotation that takes the last tangent to this one.
            q = tangents[i - 1].rotation_difference(tangents[i])
            normal = (q @ normal).normalized()
        binormal = tangents[i].cross(normal).normalized()
        starts.append(len(verts))
        for k in range(n):
            a = k / n * math.tau
            v = c + (normal * math.cos(a) + binormal * math.sin(a)) * radii[i]
            verts.append(tuple(v))
    for i in range(len(starts) - 1):
        for k in range(n):
            a = starts[i] + k
            b = starts[i] + (k + 1) % n
            faces.append((a, b, b + n, a + n))
    faces.append(tuple(range(starts[0], starts[0] + n))[::-1])
    faces.append(tuple(range(starts[-1], starts[-1] + n)))
    obj = lib.mesh_object(name, verts, faces, coll=COLL)
    fix_normals(obj)
    return finish(obj, key)


def bezier(points, steps=24):
    """Points along a chain of cubic Bezier segments: p0, c1, c2, p1, c3, c4, p2..."""
    out = []
    for s in range(0, len(points) - 3, 3):
        p0, c1, c2, p1 = points[s:s + 4]
        for i in range(steps + (1 if s + 4 >= len(points) else 0)):
            t = i / steps
            u = 1 - t
            out.append(tuple(u ** 3 * p0[j] + 3 * u * u * t * c1[j] + 3 * u * t * t * c2[j] + t ** 3 * p1[j] for j in range(3)))
    return out


def mirrored(path):
    return [(-x, y, z) for x, y, z in path]


def scroll(cx, cz, r0, turns, y=0.0, side=1, steps=40):
    """A flat spiral (a scroll's curl) in the xz plane, winding inward from radius r0."""
    pts = []
    for i in range(steps + 1):
        t = i / steps
        a = t * turns * math.tau
        r = r0 * (1 - 0.75 * t)
        pts.append((cx + side * r * math.cos(a), y, cz + r * math.sin(a)))
    return pts


def box(name, size, loc, key, bevel=0.004):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = size
    bpy.ops.object.transform_apply(scale=True)
    if bevel:
        mod = obj.modifiers.new("bevel", "BEVEL")
        mod.width = bevel
        mod.segments = 2
        bpy.ops.object.modifier_apply(modifier="bevel")
    for c in obj.users_collection:
        c.objects.unlink(obj)
    COLL.objects.link(obj)
    finish(obj, key)
    for p in obj.data.polygons:
        p.use_smooth = False
    return obj


def torus(name, r, tube, z, key):
    pts = [(r * math.cos(a), r * math.sin(a), z) for a in (k / 48 * math.tau for k in range(49))]
    return sweep(name, pts, tube, key, n=10)


def assemble(tid, parts):
    obj = lib.join(parts, f"trophy_{tid}")
    return obj


trophies = []

# ---------- Turned cups and vases ----------

# The Curzon Cup: a gold lidded cup with dolphin-scroll handles, on a domed foot (no. 1).
curzon = [
    lathe("c_body", [(0, 0), (0.11, 0), (0.112, 0.012), (0.1, 0.022), (0.075, 0.035), (0.03, 0.07), (0.022, 0.1), (0.045, 0.12), (0.045, 0.13),
                     (0.02, 0.15), (0.02, 0.18), (0.05, 0.2), (0.1, 0.24), (0.125, 0.29), (0.13, 0.34), (0.122, 0.37), (0.13, 0.376),
                     (0.13, 0.382), (0.11, 0.4), (0.07, 0.425), (0.03, 0.44), (0.014, 0.455), (0.03, 0.47), (0.034, 0.49), (0.018, 0.51), (0, 0.535)], "gold"),
    torus("c_band", 0.128, 0.006, 0.31, "gold"),
]
for side in (-1, 1):
    h = bezier([(0.12, 0, 0.35), (0.2, 0, 0.38), (0.22, 0, 0.28), (0.16, 0, 0.24), (0.13, 0, 0.215), (0.12, 0, 0.23), (0.11, 0, 0.24)])
    curzon.append(sweep("c_handle", h if side > 0 else mirrored(h), [0.011 - 0.004 * i / len(h) for i in range(len(h))], "gold"))
    curzon.append(sweep("c_curl", scroll(side * 0.2, 0.36, 0.022, 1.1, side=side), 0.006, "gold"))
trophies.append(assemble("curzon", curzon))

# The Cresta Cup: a silver vase flaring to a wide, wavy rim, slender handles, on an ebony base (no. 2).
cresta = [
    lathe("cr_base", [(0, 0), (0.15, 0), (0.15, 0.05), (0.13, 0.065), (0, 0.065)], "ebony"),
    lathe("cr_body", [(0, 0.065), (0.11, 0.065), (0.11, 0.08), (0.08, 0.095), (0.05, 0.11), (0.04, 0.16), (0.032, 0.24), (0.045, 0.3),
                      (0.09, 0.38), (0.16, 0.44), (0.21, 0.47), (0.215, 0.485), (0.2, 0.48), (0.15, 0.46), (0, 0.44)], "silver"),
    torus("cr_rim", 0.212, 0.009, 0.483, "silver"),
]
for side in (-1, 1):
    h = bezier([(0.045, 0, 0.13), (0.14, 0, 0.16), (0.07, 0, 0.32), (0.17, 0, 0.44)])
    cresta.append(sweep("cr_handle", h if side > 0 else mirrored(h), 0.007, "silver"))
    cresta.append(sweep("cr_lion", [(side * 0.05, 0, 0.13), (side * 0.07, 0, 0.14)], 0.02, "silver"))
trophies.append(assemble("cresta", cresta))

# The Gunter Sachs Challenge Cup: a tall gold vase with high loop handles, on a banded base (no. 3).
gunter = [
    lathe("g_base", [(0, 0), (0.1, 0), (0.1, 0.055), (0.095, 0.06), (0, 0.06)], "wood"),
    lathe("g_bands", [(0.101, 0.008), (0.101, 0.02), (0.101, 0.032), (0.101, 0.044)], "plaque", seg=56),
    lathe("g_body", [(0, 0.06), (0.06, 0.06), (0.05, 0.07), (0.03, 0.08), (0.012, 0.1), (0.012, 0.13), (0.04, 0.2), (0.07, 0.3),
                     (0.085, 0.4), (0.095, 0.46), (0.098, 0.47), (0.088, 0.47), (0, 0.44)], "gold"),
]
for side in (-1, 1):
    h = bezier([(0.06, 0, 0.26), (0.16, 0, 0.3), (0.19, 0, 0.48), (0.095, 0, 0.465)])
    gunter.append(sweep("g_handle", h if side > 0 else mirrored(h), 0.007, "gold"))
trophies.append(assemble("gunter-sachs", gunter))

# The Grand National: a lidded silver tankard, chased bands, spout and scroll handle, on a stack of
# silver and ebony bands (no. 4).
gn = [
    lathe("gn_base", [(0, 0), (0.14, 0), (0.14, 0.035), (0, 0.035)], "ebony"),
    lathe("gn_band1", [(0, 0.035), (0.14, 0.035), (0.14, 0.085), (0, 0.085)], "silver"),
    lathe("gn_band2", [(0, 0.085), (0.128, 0.085), (0.128, 0.105), (0, 0.105)], "ebony"),
    lathe("gn_band3", [(0, 0.105), (0.12, 0.105), (0.12, 0.17), (0.105, 0.18), (0, 0.18)], "silver"),
    lathe("gn_body", [(0, 0.18), (0.095, 0.18), (0.09, 0.2), (0.09, 0.3), (0.1, 0.31), (0.1, 0.33), (0.088, 0.34), (0.084, 0.44),
                      (0.09, 0.45), (0.088, 0.5), (0.094, 0.505), (0.094, 0.515), (0.075, 0.535), (0.05, 0.555), (0.022, 0.565),
                      (0.028, 0.58), (0.016, 0.6), (0, 0.61)], "silver"),
    torus("gn_chase1", 0.092, 0.006, 0.25, "silver"),
    torus("gn_chase2", 0.088, 0.006, 0.39, "silver"),
    sweep("gn_spout", [(-0.08, 0, 0.48), (-0.11, 0, 0.5), (-0.13, 0, 0.52)], [0.022, 0.016, 0.009], "silver"),
]
h = bezier([(0.088, 0, 0.47), (0.17, 0, 0.5), (0.18, 0, 0.36), (0.13, 0, 0.32), (0.1, 0, 0.29), (0.1, 0, 0.26), (0.09, 0, 0.24)])
gn.append(sweep("gn_handle", h, [0.012 - 0.005 * i / len(h) for i in range(len(h))], "silver"))
gn.append(sweep("gn_curl", scroll(0.165, 0.47, 0.025, 1.2), 0.006, "silver"))
trophies.append(assemble("grand-national", gn))

# The Morgan Cup: a tall flared silver cup with scroll ears at the rim, on a black block (no. 6).
morgan = [
    box("m_block", (0.2, 0.2, 0.12), (0, 0, 0.06), "ebony"),
    lathe("m_body", [(0, 0.12), (0.075, 0.12), (0.075, 0.135), (0.06, 0.15), (0.035, 0.18), (0.028, 0.22), (0.045, 0.24),
                     (0.045, 0.25), (0.032, 0.27), (0.055, 0.3), (0.1, 0.45), (0.13, 0.58), (0.137, 0.6), (0.137, 0.61),
                     (0.128, 0.605), (0, 0.57)], "silver"),
    torus("m_rim", 0.135, 0.007, 0.607, "silver"),
]
for side in (-1, 1):
    morgan.append(sweep("m_ear", [(side * 0.13, 0, 0.6), (side * 0.17, 0, 0.61)] + scroll(side * 0.19, 0.585, 0.028, 1.15, side=side), 0.008, "silver"))
trophies.append(assemble("morgan", morgan))

# A silver lidded urn with tall handles (no. 5).
urn = [
    lathe("u_body", [(0, 0), (0.075, 0), (0.078, 0.012), (0.065, 0.02), (0.03, 0.05), (0.028, 0.07), (0.05, 0.085), (0.1, 0.15),
                     (0.115, 0.22), (0.105, 0.27), (0.08, 0.3), (0.07, 0.315), (0.085, 0.322), (0.085, 0.33), (0.065, 0.36),
                     (0.035, 0.38), (0.016, 0.39), (0.026, 0.41), (0.028, 0.43), (0.012, 0.455), (0, 0.47)], "silver"),
    torus("u_band", 0.112, 0.006, 0.19, "silver"),
]
for side in (-1, 1):
    h = bezier([(0.105, 0, 0.21), (0.2, 0, 0.24), (0.2, 0, 0.4), (0.12, 0, 0.38), (0.09, 0, 0.37), (0.085, 0, 0.34), (0.082, 0, 0.32)])
    urn.append(sweep("u_handle", h if side > 0 else mirrored(h), 0.008, "silver"))
trophies.append(assemble("urn", urn))

# A two-handled silver cup with scroll handles (no. 7).
cup = [
    lathe("cu_body", [(0, 0), (0.08, 0), (0.08, 0.012), (0.06, 0.025), (0.035, 0.045), (0.032, 0.06), (0.065, 0.08), (0.1, 0.13),
                      (0.105, 0.2), (0.11, 0.25), (0.115, 0.26), (0.105, 0.258), (0, 0.24)], "silver"),
    torus("cu_band", 0.104, 0.007, 0.15, "silver"),
]
for side in (-1, 1):
    h = bezier([(0.1, 0, 0.12), (0.15, 0, 0.12), (0.17, 0, 0.18), (0.16, 0, 0.24)])
    cup.append(sweep("cu_handle", h if side > 0 else mirrored(h), 0.009, "silver"))
    cup.append(sweep("cu_curl", scroll(side * 0.175, 0.26, 0.028, 1.2, side=side), 0.008, "silver"))
trophies.append(assemble("cup", cup))

# A big flared silver cup on a stepped plinth (the presentation cup on the Sunny Bar's terrace).
flared = [
    box("f_plinth", (0.22, 0.22, 0.1), (0, 0, 0.05), "wood"),
    box("f_plinth2", (0.18, 0.18, 0.03), (0, 0, 0.115), "wood"),
    lathe("f_body", [(0, 0.13), (0.085, 0.13), (0.085, 0.145), (0.07, 0.16), (0.04, 0.2), (0.03, 0.25), (0.05, 0.28), (0.09, 0.36),
                     (0.15, 0.55), (0.165, 0.6), (0.17, 0.615), (0.16, 0.61), (0, 0.58)], "silver"),
    torus("f_rim", 0.168, 0.008, 0.612, "silver"),
]
for side in (-1, 1):
    h = bezier([(0.12, 0, 0.47), (0.22, 0, 0.48), (0.24, 0, 0.6), (0.17, 0, 0.6)])
    flared.append(sweep("f_handle", h if side > 0 else mirrored(h), 0.008, "silver"))
trophies.append(assemble("flared", flared))

# ---------- The Brabazon Trophy: a gold toboggan on a plinth with silver plaques (no. 8) ----------

brab = [
    box("b_plinth", (0.5, 0.22, 0.08), (0, 0, 0.04), "wood"),
    box("b_plinth2", (0.44, 0.17, 0.04), (0, 0, 0.1), "wood"),
    box("b_plaque_mid", (0.14, 0.004, 0.05), (0, -0.112, 0.042), "plaque", 0.001),
    box("b_plaque_l", (0.12, 0.004, 0.05), (-0.17, -0.112, 0.042), "plaque", 0.001),
    box("b_plaque_r", (0.12, 0.004, 0.05), (0.17, -0.112, 0.042), "plaque", 0.001),
    box("b_seat", (0.22, 0.075, 0.02), (-0.03, 0, 0.165), "gold"),
    box("b_cushion", (0.13, 0.065, 0.025), (-0.07, 0, 0.187), "gold"),
]
for y in (-0.034, 0.034):
    run = [(-0.19, y, 0.13), (0.12, y, 0.13)] + [(0.12 + 0.04 * math.sin(a), y, 0.17 - 0.04 * math.cos(a)) for a in [k / 10 * math.pi for k in range(1, 11)]]
    brab.append(sweep("b_runner", run, 0.006, "gold"))
    rail = [(-0.2, y * 1.6, 0.17), (0.08, y * 1.6, 0.17), (0.15, y * 1.3, 0.15)]
    brab.append(sweep("b_rail", rail, 0.0045, "gold"))
    for x in (-0.15, -0.04, 0.07):
        brab.append(sweep("b_post", [(x, y, 0.13), (x, y, 0.16)], 0.004, "gold"))
trophies.append(assemble("brabazon", brab))

# ---------- The Willoughby Cup: a silver kukri on a wooden stand ----------

def kukri():
    # The blade's outline (x along it, z across), bent forward at the belly, then extruded thin.
    top = [(0.0, 0.012), (0.08, 0.016), (0.16, 0.026), (0.22, 0.036), (0.27, 0.03), (0.3, 0.012), (0.31, 0.0)]
    bottom = [(0.31, 0.0), (0.28, -0.03), (0.22, -0.05), (0.15, -0.042), (0.08, -0.022), (0.0, -0.014)]
    outline = top + bottom[1:]
    verts, faces = [], []
    n = len(outline)
    for i, (x, z) in enumerate(outline):
        bend = 0.12 * (x / 0.31) ** 2
        verts.append((x, -0.003, z - bend))
        verts.append((x, 0.003, z - bend))
    for i in range(n):
        j = (i + 1) % n
        faces.append((2 * i, 2 * j, 2 * j + 1, 2 * i + 1))
    faces.append(tuple(2 * i for i in range(n))[::-1])
    faces.append(tuple(2 * i + 1 for i in range(n)))
    blade = lib.mesh_object("k_blade", verts, faces, coll=COLL)
    fix_normals(blade)
    finish(blade, "silver")
    for p in blade.data.polygons:
        p.use_smooth = False
    grip = sweep("k_grip", [(-0.12, 0, 0.0), (-0.06, 0, 0.004), (0.0, 0, 0.0)], [0.014, 0.017, 0.015], "silver")
    guard = sweep("k_guard", [(0.0, 0, -0.02), (0.0, 0, 0.022)], 0.008, "silver")
    pommel = sweep("k_pommel", [(-0.125, 0, -0.01), (-0.132, 0, 0.0), (-0.125, 0, 0.012)], 0.012, "silver")
    rings = [torus("k_ring", 0.0, 0.0, 0, "silver")] if False else []
    parts = [blade, grip, guard, pommel] + rings
    k = lib.join(parts, "k_kukri")
    k.location = (0.0, 0, 0.16)
    k.rotation_euler = (0, math.radians(-8), 0)
    bpy.ops.object.select_all(action="DESELECT")
    k.select_set(True)
    bpy.context.view_layer.objects.active = k
    bpy.ops.object.transform_apply(location=True, rotation=True)
    return k


will = [
    box("w_base", (0.34, 0.12, 0.04), (0.04, 0, 0.02), "wood"),
    box("w_plaque", (0.1, 0.004, 0.026), (0.04, -0.062, 0.02), "plaque", 0.001),
    kukri(),
]
for x in (-0.05, 0.15):
    will.append(sweep("w_fork", [(x, 0, 0.04), (x, 0, 0.13)], 0.008, "wood"))
    will.append(sweep("w_cradle", [(x, -0.015, 0.15), (x, -0.012, 0.13), (x, 0.012, 0.13), (x, 0.015, 0.15)], 0.005, "wood"))
trophies.append(assemble("willoughby", will))

# ---------- The animals, grown from skeletons ----------


def skinned(name, skeleton, key, smooth=2, flat_root=None):
    pts, radii, edges = [], [], []
    index = {}
    for label, (pos, r, link) in skeleton.items():
        index[label] = len(pts)
        pts.append(pos)
        radii.append(r)
    for label, (pos, r, link) in skeleton.items():
        if link:
            edges.append((index[link], index[label]))
    me = bpy.data.meshes.new(name)
    me.from_pydata(pts, edges, [])
    me.update()
    obj = bpy.data.objects.new(name, me)
    COLL.objects.link(obj)
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    obj.modifiers.new("skin", "SKIN")
    for i, r in enumerate(radii):
        rr = r if isinstance(r, tuple) else (r, r)
        obj.data.skin_vertices[""].data[i].radius = rr
    obj.data.skin_vertices[""].data[0].use_root = True
    sub = obj.modifiers.new("smooth", "SUBSURF")
    sub.levels = smooth
    bpy.ops.object.modifier_apply(modifier="skin")
    bpy.ops.object.modifier_apply(modifier="smooth")
    return finish(obj, key)


def plinth(prefix, w, d, h, key="wood"):
    return [box(f"{prefix}_plinth", (w, d, h), (0, 0, h / 2), key), box(f"{prefix}_plaque", (w * 0.45, 0.004, h * 0.45), (0, -d / 2 - 0.002, h / 2), "plaque", 0.001)]


S = 0.24  # the animals' scale: a little over 20 cm long


def scaled(skel, s=S, lift=0.0):
    return {k: ((p[0] * s, p[1] * s, p[2] * s + lift), (r[0] * s, r[1] * s) if isinstance(r, tuple) else r * s, link) for k, (p, r, link) in skel.items()}


# The Calisch Grischun: the Graubünden Steinbock, in silver, horns swept back.
stein = {
    "hips": ((0.0, 0, 0.84), (0.24, 0.2), None),
    "mid": ((0.34, 0, 0.86), (0.29, 0.25), "hips"),
    "chest": ((0.64, 0, 0.88), (0.3, 0.26), "mid"),
    "neck0": ((0.86, 0, 1.0), 0.19, "chest"),
    "neck1": ((0.98, 0, 1.13), 0.14, "neck0"),
    "skull": ((1.08, 0, 1.24), 0.1, "neck1"),
    "muzzle": ((1.28, 0, 1.16), 0.065, "skull"),
    "beard": ((1.2, 0, 1.03), 0.025, "muzzle"),
    "tail": ((-0.22, 0, 0.88), 0.05, "hips"),
}
for side in (-1, 1):
    y = 0.12 * side
    s = f"{side}"
    stein.update({
        f"sh{s}": ((0.66, y, 0.72), 0.09, "chest"), f"kn{s}": ((0.7, y, 0.42), 0.05, f"sh{s}"), f"ft{s}": ((0.69, y, 0.05), 0.04, f"kn{s}"),
        f"hp{s}": ((0.04, y, 0.7), 0.11, "hips"), f"hk{s}": ((-0.1, y, 0.4), 0.052, f"hp{s}"), f"hf{s}": ((-0.03, y, 0.05), 0.04, f"hk{s}"),
    })
calisch = plinth("ca", 0.36, 0.14, 0.05) + [skinned("ca_body", scaled(stein, S, 0.05 - 0.01), "silver")]
for side in (-1, 1):
    path, rs = [], []
    R = 0.5
    a0 = math.radians(15)
    cx, cz = 1.07 - R * math.cos(a0), 1.32 - R * math.sin(a0)
    for i in range(31):
        t = i / 30
        a = a0 + t * math.radians(112)
        path.append(((cx + R * math.cos(a)) * S, side * (0.05 + 0.1 * t * t) * S, (cz + R * 0.85 * math.sin(a)) * S + 0.04))
        rs.append((0.066 * (1 - t) + 0.016 * t) * (1.18 if i % 3 == 0 and 0 < t < 0.85 else 1) * S)
    calisch.append(sweep("ca_horn", path, rs, "silver", n=10))
calisch_obj = assemble("calisch", calisch)
calisch_obj.location.x = -0.05
bpy.ops.object.select_all(action="DESELECT")
calisch_obj.select_set(True)
bpy.context.view_layer.objects.active = calisch_obj
bpy.ops.object.transform_apply(location=True)
trophies.append(calisch_obj)

# The Coppa d'Italia: a wild boar in silver, stocky and low, bristling ridge, tusks up.
boar = {
    "rump": ((0.0, 0, 0.62), (0.28, 0.25), None),
    "back": ((0.35, 0, 0.66), (0.33, 0.29), "rump"),
    "shoulder": ((0.7, 0, 0.7), (0.36, 0.3), "back"),
    "nape": ((0.95, 0, 0.66), (0.26, 0.23), "shoulder"),
    "head": ((1.15, 0, 0.56), (0.17, 0.15), "nape"),
    "snout": ((1.38, 0, 0.46), 0.085, "head"),
    "disc": ((1.46, 0, 0.44), 0.075, "snout"),
    "ridge0": ((0.55, 0, 0.98), 0.05, "shoulder"),
    "tail": ((-0.27, 0, 0.66), 0.03, "rump"),
}
for side in (-1, 1):
    y = 0.15 * side
    s = f"{side}"
    boar.update({
        f"sh{s}": ((0.72, y, 0.45), 0.13, "shoulder"), f"kn{s}": ((0.74, y, 0.22), 0.075, f"sh{s}"), f"ft{s}": ((0.75, y, 0.04), 0.06, f"kn{s}"),
        f"hp{s}": ((0.05, y, 0.45), 0.14, "rump"), f"hk{s}": ((-0.03, y, 0.22), 0.075, f"hp{s}"), f"hf{s}": ((0.0, y, 0.04), 0.06, f"hk{s}"),
        f"ear{s}": ((1.02, 0.12 * side, 0.82), 0.04, "nape"),
    })
coppa = plinth("co", 0.4, 0.15, 0.05) + [skinned("co_body", scaled(boar, S, 0.05 - 0.008), "silver")]
for side in (-1, 1):
    coppa.append(sweep("co_tusk", [(1.34 * S, side * 0.07 * S, 0.43 * S + 0.05), (1.4 * S, side * 0.1 * S, 0.5 * S + 0.05), (1.38 * S, side * 0.1 * S, 0.57 * S + 0.05)], [0.035 * S, 0.026 * S, 0.008 * S], "silver", n=8))
coppa_obj = assemble("coppa-italia", coppa)
coppa_obj.location.x = -0.08
bpy.ops.object.select_all(action="DESELECT")
coppa_obj.select_set(True)
bpy.context.view_layer.objects.active = coppa_obj
bpy.ops.object.transform_apply(location=True)
trophies.append(coppa_obj)

# The Bartley Bear: a carved wooden bear sitting up, paws on his belly, on a round base.
bear = {
    "seat": ((0.0, 0, 0.3), (0.3, 0.27), None),
    "belly": ((0.03, 0, 0.58), (0.3, 0.27), "seat"),
    "chest": ((0.0, 0, 0.85), (0.25, 0.23), "belly"),
    "neck": ((0.02, 0, 1.0), 0.16, "chest"),
    "head": ((0.06, 0, 1.17), (0.22, 0.2), "neck"),
    "muzzle": ((0.28, 0, 1.12), 0.1, "head"),
    "nose": ((0.38, 0, 1.13), 0.045, "muzzle"),
}
for side in (-1, 1):
    y = side
    s = f"{side}"
    bear.update({
        f"ear{s}": ((0.0, 0.16 * y, 1.36), 0.075, "head"),
        f"arm{s}": ((0.05, 0.24 * y, 0.88), 0.1, "chest"), f"elb{s}": ((0.25, 0.27 * y, 0.62), 0.085, f"arm{s}"), f"paw{s}": ((0.42, 0.21 * y, 0.46), 0.08, f"elb{s}"),
        f"hip{s}": ((0.08, 0.2 * y, 0.25), 0.15, "seat"), f"knee{s}": ((0.38, 0.22 * y, 0.25), 0.12, f"hip{s}"), f"foot{s}": ((0.56, 0.2 * y, 0.16), 0.11, f"knee{s}"),
        f"sole{s}": ((0.62, 0.2 * y, 0.28), 0.09, f"foot{s}"),
    })
bart = [lathe("be_base", [(0, 0), (0.12, 0), (0.125, 0.01), (0.12, 0.035), (0.11, 0.04), (0, 0.04)], "oak"),
        skinned("be_body", scaled(bear, 0.22, 0.04 - 0.02), "wood")]
trophies.append(assemble("bartley-bear", bart))

# ---------- Lay them out, look, export ----------

for i, t in enumerate(trophies):
    t.location = (i * 0.55, 0, 0)
# Five at a time, from a little above, with the sun across them.
for k in range(4):
    x = (k * 4 + 1.5) * 0.55
    lib.preview(f"trophies_{k}.png", (x, -2.4, 0.8), (x, 0.0, 0.24), size=(1600, 700), lens=30, sky=(0.5, 0.62, 0.85), sun=(0.5, -0.6, 0.7))
for t in trophies:
    t.location = (0, 0, 0)
result = {"export": lib.export_glb("trophies.glb", trophies), "trophies": {t.name: len(t.data.polygons) for t in trophies}}
