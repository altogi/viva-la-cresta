"""
The three riders' bodies, for the game: Maximilian, Adelaide and Remo, each one smooth, continuous,
rigged body built to the game's own proportions (blender/riders.json, from scripts/export-riders.ts).

A skeleton of joints with the game's segment lengths is fleshed out with a skin modifier (elliptical
cross-sections: chest, waist, thighs, calves, biceps), smoothed by subdivision, coloured by zone
(suit, gloves, boots, pads, leg stripes, Remo's sweater, lederhosen, braces and socks), given its
lettering and race number as real geometry, and bound to a named armature with automatic weights.
The game keeps working out the pose with its own IK, then turns these bones to match; the head
(face, hair, helmet) and the toboggan stay the game's.

Exported to public/models/riders.glb as rider_<id> (armature with its skinned body), standing in an
A pose facing -Y (Blender), feet on z = 0.
"""

import json
import math
import os

import bmesh
import bpy
from mathutils import Vector

import lib

LOOKS = json.load(open(os.path.join(lib.ROOT, "blender", "riders.json")))


def hex_rgb(h):
    h = h.lstrip("#")
    return tuple((int(h[i : i + 2], 16) / 255) ** 2.2 for i in (0, 2, 4))  # sRGB to linear


def skeleton(look):
    """Joint positions (Blender: z up, facing -y, the rider's left at +x) with the game's lengths."""
    s = look["scale"]
    build = look["build"]
    arms = look["arms"]
    hip_w = 0.095 * s * math.sqrt(build)
    sh_w = 0.19 * s * build
    thigh, shin = 0.44 * s, 0.43 * s
    upper, fore = 0.3 * s * arms, 0.28 * s * arms
    shoulder = 0.5 * s
    ankle_z = 0.075 * s
    pelvis_z = ankle_z + shin + thigh + 0.03
    j = {
        "pelvis": (0, 0, pelvis_z),
        "waist": (0, 0, pelvis_z + 0.14 * s),
        "chest": (0, 0, pelvis_z + 0.3 * s),
        "upper_chest": (0, 0, pelvis_z + 0.42 * s),
        "neck": (0, 0, pelvis_z + shoulder + 0.03 * s),
        "neck_top": (0, 0, pelvis_z + shoulder + 0.1 * s),
    }
    for side, sx in (("L", 1), ("R", -1)):
        hip = (sx * hip_w, 0, pelvis_z - 0.03)
        knee = (sx * hip_w, 0, hip[2] - thigh)
        ankle = (sx * hip_w, 0, knee[2] - shin)
        j[f"hip_{side}"] = hip
        j[f"thigh_{side}"] = (sx * hip_w, 0, hip[2] - thigh * 0.45)
        j[f"knee_{side}"] = knee
        j[f"calf_{side}"] = (sx * hip_w, 0.01 * s, knee[2] - shin * 0.32)
        j[f"ankle_{side}"] = ankle
        j[f"toe_{side}"] = (sx * hip_w, -0.17 * s, 0.035 * s)
        sh = (sx * sh_w, 0, pelvis_z + shoulder - 0.02)
        a = math.radians(38)
        d = (sx * math.sin(a), 0, -math.cos(a))
        elbow = tuple(sh[k] + d[k] * upper for k in range(3))
        wrist = tuple(elbow[k] + d[k] * fore for k in range(3))
        j[f"shoulder_{side}"] = sh
        j[f"bicep_{side}"] = tuple(sh[k] + d[k] * upper * 0.45 for k in range(3))
        j[f"elbow_{side}"] = elbow
        j[f"forearm_{side}"] = tuple(elbow[k] + d[k] * fore * 0.35 for k in range(3))
        j[f"wrist_{side}"] = wrist
        j[f"hand_{side}"] = tuple(wrist[k] + d[k] * 0.09 * s for k in range(3))
        j[f"fingers_{side}"] = tuple(wrist[k] + d[k] * 0.17 * s for k in range(3))
    return j


EDGES = [
    ("pelvis", "waist"), ("waist", "chest"), ("chest", "upper_chest"), ("upper_chest", "neck"), ("neck", "neck_top"),
    *[e for side in "LR" for e in (
        ("pelvis", f"hip_{side}"), (f"hip_{side}", f"thigh_{side}"), (f"thigh_{side}", f"knee_{side}"),
        (f"knee_{side}", f"calf_{side}"), (f"calf_{side}", f"ankle_{side}"), (f"ankle_{side}", f"toe_{side}"),
        ("upper_chest", f"shoulder_{side}"), (f"shoulder_{side}", f"bicep_{side}"), (f"bicep_{side}", f"elbow_{side}"),
        (f"elbow_{side}", f"forearm_{side}"), (f"forearm_{side}", f"wrist_{side}"), (f"wrist_{side}", f"hand_{side}"),
        (f"hand_{side}", f"fingers_{side}"),
    )],
]


def radii(look):
    """Cross-section half-sizes (across, front-to-back) at each joint, from the rider's build."""
    s = look["scale"]
    b = look["build"]
    limb = 0.055 * s * look["limbs"]
    bulky = look["id"] == "remo"  # sweater and lederhosen
    r = {
        "pelvis": (0.15 * s * math.sqrt(b), 0.11 * s),
        "waist": (0.135 * s * b * (1.06 if bulky else 1), 0.1 * s * (1.25 if bulky else 1)),
        "chest": (0.155 * s * b, 0.115 * s * (1.15 if bulky else 1)),
        "upper_chest": (0.15 * s * b, 0.105 * s),
        "neck": (0.06 * s, 0.06 * s),
        "neck_top": (0.05 * s, 0.05 * s),
    }
    # Thighs stay narrower than the gap between the hips, so the legs never merge into one.
    hip_w = 0.095 * s * math.sqrt(b)
    cap = lambda x: min(x, hip_w * 0.74)
    for side in "LR":
        r.update({
            f"hip_{side}": (cap(limb * 1.85), cap(limb * 1.85) * 1.05),
            f"thigh_{side}": (cap(limb * 1.62), cap(limb * 1.62) * 1.08),
            f"knee_{side}": (limb * 1.2, limb * 1.25),
            f"calf_{side}": (limb * 1.28, limb * 1.42),
            f"ankle_{side}": (limb * 0.82, limb * 0.9),
            f"toe_{side}": (limb * 0.85, limb * 0.6),
            f"shoulder_{side}": (limb * 1.3, limb * 1.3),
            f"bicep_{side}": (limb * 1.08, limb * 1.12),
            f"elbow_{side}": (limb * 0.86, limb * 0.9),
            f"forearm_{side}": (limb * 0.95, limb * 0.85),
            f"wrist_{side}": (limb * 0.62, limb * 0.5),
            f"hand_{side}": (limb * 0.85, limb * 0.42),
            f"fingers_{side}": (limb * 0.6, limb * 0.32),
        })
    return r


# Bones: name, from joint, to joint, parent.
BONES = [
    ("hips", "pelvis", "waist", None),
    ("spine", "waist", "chest", "hips"),
    ("chest", "chest", "neck", "spine"),
    ("neck", "neck", "neck_top", "chest"),
    *[b for side in "LR" for b in (
        (f"upperarm.{side}", f"shoulder_{side}", f"elbow_{side}", "chest"),
        (f"forearm.{side}", f"elbow_{side}", f"wrist_{side}", f"upperarm.{side}"),
        (f"hand.{side}", f"wrist_{side}", f"fingers_{side}", f"forearm.{side}"),
        (f"thigh.{side}", f"hip_{side}", f"knee_{side}", "hips"),
        (f"shin.{side}", f"knee_{side}", f"ankle_{side}", f"thigh.{side}"),
        (f"foot.{side}", f"ankle_{side}", f"toe_{side}", f"shin.{side}"),
    )],
]


def zone_of(p, normal, j, look, bone=None):
    """Which part of the kit a point on the body belongs to (on `bone` if given, else the nearest)."""
    best, best_d = None, 1e9
    for name, a, b, _ in BONES:
        if bone and name != bone:
            continue
        A, B = Vector(j[a]), Vector(j[b])
        ab = B - A
        t = max(0, min(1, (p - A).dot(ab) / ab.length_squared))
        d = (A + ab * t - p).length
        if d < best_d:
            best, best_d = (name, t), d
    name, t = best
    o = look["outfit"]
    base = name.split(".")[0]
    side = 1 if name.endswith(".L") else -1
    stripe = o.get("backStripe")
    if stripe and base in ("hips", "spine", "chest") and normal.y > 0.25 and abs(p.x) < 0.05 * look["scale"] and j["waist"][2] - 0.06 * look["scale"] < p.z < j["neck"][2] - 0.02:
        return "backstripe"
    if look["id"] == "remo" and base in ("hips", "spine", "chest") and "belt" in j:
        # Lederhosen up to the belt, which sits under his belly; the sweater hangs over it.
        if p.z < j["belt"][2] + 0.004 * look["scale"]:
            return "pelvis"
        if base == "hips":
            return "torso"
    if base in ("hips",):
        return "pelvis"
    if base in ("spine", "chest"):
        if o.get("braces") and abs(abs(p.x) - 0.075 * look["scale"] * look["build"]) < 0.018 * look["scale"] and p.z > j["waist"][2]:
            return "braces"
        return "torso"
    if base == "neck":
        return "skin"
    if base == "upperarm":
        if t < 0.16:
            return "torso"  # the shoulder belongs to the body of the suit; the sleeve starts below
        if t > 0.88 and o.get("pads"):
            return "pads"
        return "upperArm"
    if base == "forearm":
        if t < 0.1 and o.get("pads"):
            return "pads"
        return "forearm"
    if base == "hand":
        return "hands"
    if base == "thigh":
        if t < 0.1:
            return "pelvis"  # the seam is at the leg, not up on the hip
        if t > 0.86:
            return "pads"
        if look["id"] == "remo" and t > 0.8:
            return "skin"  # bare knees between the lederhosen and the pads
        if o.get("legStripe") and normal.x * side > 0.82:
            return "stripe"
        return "thigh"
    if base == "shin":
        if t < 0.1:
            return "pads"
        if t > 0.86 and "belt" in j or (t > 0.86 and j.get("boots_from_feet")):
            return "boots"  # the boot's shaft, up over the ankle
        if o.get("legStripe") and normal.x * side > 0.82:
            return "stripe"
        return "shin"
    if base == "foot":
        return "boots"
    return "torso"


def text_mesh(body, size, color_mat, name):
    """Lettering as real geometry (a text object converted to a mesh), lying in the x-z plane."""
    curve = bpy.data.curves.new(name, "FONT")
    curve.body = body
    curve.size = size
    curve.align_x = "CENTER"
    curve.align_y = "CENTER"
    curve.extrude = 0.002
    obj = bpy.data.objects.new(name, curve)
    bpy.context.scene.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.ops.object.convert(target="MESH")
    obj = bpy.context.view_layer.objects.active
    obj.data.materials.append(color_mat)
    obj.rotation_euler = (math.pi / 2, 0, 0)
    return obj


# Hands and feet are modelled on their own (gloves with fingers and a thumb, boots with a heel,
# a sole and the toe rakes) and joined to the body: the body's skin skeleton stops at the wrists
# and ankles.
BODY_EDGES = [e for e in EDGES if not any(k in n for n in e for k in ("hand_", "fingers_", "toe_"))]


def skin_chains(name, chains, radius, mat):
    """Round tubes along chains of points (a skin modifier, smoothed)."""
    verts, edges = [], []
    for chain in chains:
        base = len(verts)
        verts += [tuple(p) for p, _ in chain]
        edges += [(base + i, base + i + 1) for i in range(len(chain) - 1)]
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, edges, [])
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    obj.modifiers.new("skin", "SKIN")
    k = 0
    for chain in chains:
        for i, (_, r) in enumerate(chain):
            obj.data.skin_vertices[0].data[k].radius = (r * radius, r * radius)
            if i == 0:
                obj.data.skin_vertices[0].data[k].use_root = True
            k += 1
    obj.modifiers.new("smooth", "SUBSURF").levels = 1
    apply_all(obj)
    obj.data.materials.append(mat)
    return obj


def rounded_box(name, centre, axes, half, mat, bevel=0.4):
    """A box on three axes (unit vectors) with half-sizes `half`, its edges rounded."""
    c = Vector(centre)
    a = [Vector(v) * h for v, h in zip(axes, half)]
    verts = [tuple(c + a[0] * sx + a[1] * sy + a[2] * sz) for sz in (-1, 1) for sy in (-1, 1) for sx in (-1, 1)]
    faces = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    obj = lib.mesh_object(name, verts, faces, None, mat)
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(obj.data)
    bm.free()
    bev = obj.modifiers.new("bevel", "BEVEL")
    bev.width = min(half) * bevel * 2
    bev.segments = 3
    obj.modifiers.new("smooth", "SUBSURF").levels = 1
    apply_all(obj)
    return obj


def apply_all(obj):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    for m in list(obj.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)
    bpy.ops.object.shade_smooth()


def glove(rid, side, j, s, mat):
    """A leather glove: the palm, four fingers curling a little, and the thumb in front."""
    sx = 1 if side == "L" else -1
    a = math.radians(38)
    u = Vector((sx * math.sin(a), 0, -math.cos(a)))  # along the fingers
    w = Vector((-sx * math.cos(a), 0, -math.sin(a)))  # out of the palm, towards the thigh
    v = Vector((0, -1, 0))  # across the palm, thumb side (the rider faces -y)
    wrist = Vector(j[f"wrist_{side}"])
    palm = rounded_box(f"palm_{rid}_{side}", wrist + u * 0.05 * s, (u, v, w), (0.05 * s, 0.043 * s, 0.017 * s), mat, bevel=0.6)
    knuckles = wrist + u * 0.095 * s
    chains = []
    for off, length in ((0.03, 0.07), (0.01, 0.08), (-0.01, 0.076), (-0.029, 0.062)):
        k = knuckles + v * off * s
        chains.append([(k, 1.0), (k + u * length * 0.55 * s + w * 0.008 * s, 0.95), (k + u * length * s + w * 0.022 * s, 0.85)])
    t0 = wrist + u * 0.035 * s + v * 0.032 * s
    chains.append([(t0, 1.15), (t0 + u * 0.03 * s + v * 0.022 * s + w * 0.012 * s, 1.0), (t0 + u * 0.055 * s + v * 0.028 * s + w * 0.028 * s, 0.9)])
    cuff = [[(wrist - u * 0.03 * s, 3.1), (wrist + u * 0.015 * s, 2.9)]]
    fingers = skin_chains(f"fingers_{rid}_{side}", chains, 0.0105 * s, mat)
    cuffs = skin_chains(f"cuff_{rid}_{side}", cuff, 0.0105 * s, mat)
    return lib.join([palm, fingers, cuffs], f"glove_{rid}_{side}")


def boot(rid, side, j, s, mat, sole_mat, steel):
    """A Cresta boot: a laced shaft above the ankle, heel and toe box on a thick sole, and the steel
    rakes on the toe that the rider digs in to slow down."""
    sx = 1 if side == "L" else -1
    ankle = Vector(j[f"ankle_{side}"])
    x = ankle.x
    X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))
    shaft = skin_chains(f"shaft_{rid}_{side}", [[(ankle + Z * 0.15 * s, 0.95), (ankle + Z * 0.02 * s + Y * 0.005 * s, 1.08)]], 0.05 * s, mat)
    # The foot: from the heel (behind the ankle, +y) to the toe (-y), lower and narrower at the toe.
    foot = rounded_box(f"foot_{rid}_{side}", (x, -0.045 * s, 0.05 * s), (X, Y, Z), (0.047 * s, 0.13 * s, 0.04 * s), mat, bevel=0.75)
    toe = rounded_box(f"toebox_{rid}_{side}", (x, -0.15 * s, 0.037 * s), (X, Y, Z), (0.044 * s, 0.045 * s, 0.03 * s), mat, bevel=0.9)
    sole = rounded_box(f"sole_{rid}_{side}", (x, -0.05 * s, 0.009 * s), (X, Y, Z), (0.05 * s, 0.145 * s, 0.009 * s), sole_mat, bevel=0.5)
    parts = [shaft, foot, toe, sole]
    # Rakes: a steel plate over the toe with a row of teeth along its front edge.
    parts.append(rounded_box(f"rakeplate_{rid}_{side}", (x, -0.18 * s, 0.03 * s), (X, Y, Z), (0.04 * s, 0.022 * s, 0.004 * s), steel, bevel=0.3))
    for k in range(5):
        tx = x + (k - 2) * 0.017 * s
        parts.append(lib.mesh_object(f"tooth_{rid}_{side}_{k}", [(tx - 0.005 * s, -0.198 * s, 0.03 * s), (tx + 0.005 * s, -0.198 * s, 0.03 * s), (tx, -0.212 * s, 0.012 * s), (tx, -0.19 * s, 0.026 * s)], [(0, 1, 2), (1, 3, 2), (3, 0, 2), (0, 3, 1)], None, steel))
    return lib.join(parts, f"boot_{rid}_{side}")



# ---------- Remo's kit, in detail: a cable-knit sweater and real lederhosen ----------

from mathutils.bvhtree import BVHTree


class Surface:
    """Rays and nearest points on the body, to lay details on it."""

    def __init__(self, body):
        self.bvh = BVHTree.FromObject(body, bpy.context.evaluated_depsgraph_get())

    def hit(self, origin, direction, offset):
        loc, nor, _, _ = self.bvh.ray_cast(Vector(origin), Vector(direction).normalized())
        if loc is None:
            return None
        return loc + nor * offset, nor


def tube_along(name, pts, radius, mat, closed=False):
    """A round cord through surface points (skin modifier)."""
    me = bpy.data.meshes.new(name)
    edges = [(i, i + 1) for i in range(len(pts) - 1)] + ([(len(pts) - 1, 0)] if closed else [])
    me.from_pydata([tuple(p) for p in pts], edges, [])
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    obj.modifiers.new("skin", "SKIN")
    for i in range(len(pts)):
        obj.data.skin_vertices[0].data[i].radius = (radius, radius)
    obj.data.skin_vertices[0].data[0].use_root = True
    apply_all(obj)
    obj.data.materials.append(mat)
    return obj


def sphere_at(name, centre, radius, mat):
    """A small round stud (buttons, embroidery)."""
    bpy.ops.mesh.primitive_uv_sphere_add(segments=10, ring_count=6, radius=radius, location=tuple(centre))
    obj = bpy.context.active_object
    obj.name = name
    obj.data.materials.append(mat)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.shade_smooth()
    return obj


def ring_around(surf, centre, axis, offset, n=32, reach=0.16):
    """Points round a limb or the trunk: rays from a circle about `axis` in towards it."""
    axis = Vector(axis).normalized()
    u = axis.cross(Vector((0, 0, 1)) if abs(axis.z) < 0.9 else Vector((1, 0, 0))).normalized()
    v = axis.cross(u)
    pts = []
    for k in range(n):
        a = k / n * math.tau
        d = u * math.cos(a) + v * math.sin(a)
        h = surf.hit(Vector(centre) + d * reach, -d, offset)
        if h:
            pts.append(h[0])
    return pts


def ribbon(name, path, width, mat, thickness=0.004):
    """A flat strap following surface points [(point, normal)], `width` across."""
    verts, faces = [], []
    for i, (p, nrm) in enumerate(path):
        nxt = path[min(i + 1, len(path) - 1)][0]
        prv = path[max(i - 1, 0)][0]
        side = (nxt - prv).cross(nrm).normalized() * width / 2
        verts += [tuple(p - side), tuple(p + side)]
        if i:
            faces.append((2 * i - 2, 2 * i - 1, 2 * i + 1, 2 * i))
    obj = lib.mesh_object(name, verts, faces, None, mat)
    sol = obj.modifiers.new("thick", "SOLIDIFY")
    sol.thickness = thickness
    apply_all(obj)
    return obj


def weight_nearest(obj, j):
    """All of each vertex's weight on the nearest bone."""
    groups = {}
    mw = obj.matrix_world
    for v in obj.data.vertices:
        p = mw @ v.co
        best, best_d = None, 1e9
        for name, a, b, _ in BONES:
            A, B = Vector(j[a]), Vector(j[b])
            ab = B - A
            t = max(0, min(1, (p - A).dot(ab) / ab.length_squared))
            d = (A + ab * t - p).length
            if d < best_d:
                best, best_d = name, d
        groups.setdefault(best, []).append(v.index)
    for name, idx in groups.items():
        obj.vertex_groups.new(name=name).add(idx, 1.0, "REPLACE")


def remo_kit(rid, j, s, look, body, mats):
    surf = Surface(body)
    b = look["build"]
    embroidery = lib.material(f"{rid}_embroidery", (0.93, 0.89, 0.78), 0.7)
    green = lib.material(f"{rid}_embroidery_green", (0.2, 0.42, 0.22), 0.7)
    horn = lib.material(f"{rid}_horn", (0.85, 0.8, 0.68), 0.4)
    dark_leather = lib.material(f"{rid}_leather_dark", (0.13, 0.07, 0.032), 0.6)  # linear: a deep brown
    parts = []
    waist = j["belt"][2] if "belt" in j else j["waist"][2] - 0.02 * s
    top = j["upper_chest"][2] + 0.02 * s
    half = 0.155 * s * b
    # Cable-knit: twisted ropes of wool up the front and back of the sweater, ribbed cuffs where
    # the sleeves are pushed up to the elbow, and a roll neck.
    for face, origin_y in (("f", -1.0), ("b", 1.0)):
        for f in (-0.62, -0.2, 0.2, 0.62):
            for phase in (0, math.pi):
                pts = []
                for k in range(34):
                    z = waist + 0.03 * s + (top - waist - 0.05 * s) * k / 33
                    x = f * half + 0.009 * s * math.sin((z - waist) / (0.075 * s) * math.tau + phase)
                    h = surf.hit((x, origin_y, z), (0, -origin_y, 0), 0.002)
                    if h:
                        pts.append(h[0])
                if len(pts) > 3:
                    parts.append(tube_along(f"cable_{rid}_{face}{f}_{phase:.0f}", pts, 0.0065 * s, mats["torso"]))
    neck = Vector(j["neck"])
    for dz, r in ((0.005, 0.013), (0.024, 0.012), (0.042, 0.011)):
        pts = ring_around(surf, neck + Vector((0, 0, dz * s)), (0, 0, 1), 0.004, reach=0.075 * s)
        if len(pts) > 8:
            parts.append(tube_along(f"rollneck_{rid}_{dz}", pts, r * s, mats["torso"], closed=True))
    for side in "LR":
        e = Vector(j[f"elbow_{side}"])
        d = (Vector(j[f"wrist_{side}"]) - e).normalized()
        for dt, r in ((0.0, 0.019), (0.03, 0.017)):
            pts = ring_around(surf, e + d * dt * s, d, 0.004, reach=0.14)
            if len(pts) > 8:
                parts.append(tube_along(f"sleeve_{rid}_{side}{dt}", pts, r * s, mats["torso"], closed=True))
    # Lederhosen: the waistband, the front flap with its embroidery and horn buttons, braces with
    # the embroidered chest bar, cuffs above the knees laced at the side, the knife pocket.
    for dz in (0.0, 0.016):
        pts = ring_around(surf, (0, 0, waist + dz * s), (0, 0, 1), 0.003, reach=0.45)
        if len(pts) > 8:
            parts.append(tube_along(f"waistband_{rid}_{dz}", pts, 0.011 * s, mats["pelvis"], closed=True))
    # The front flap (Hosenlatz): a panel of the same leather from the waistband down over the fly,
    # its top corners buttoned to the waistband with horn buttons, fine stitching round the edge and
    # an embroidered edelweiss in the middle.
    fz0, fz1, fx = j["pelvis"][2] - 0.03 * s, waist - 0.005 * s, 0.075 * s
    grid = []
    for row in range(6):
        z = fz0 + (fz1 - fz0) * row / 5
        line = []
        for col in range(7):
            x = (-fx + 2 * fx * col / 6) * (0.82 + 0.18 * row / 5)  # narrowing a little to the bottom
            h = surf.hit((x, -1, z), (0, 1, 0), 0.004)
            line.append(h[0] if h else Vector((x, -0.2, z)))
        grid.append(line)
    verts = [tuple(p) for line in grid for p in line]
    faces = [(r * 7 + c, r * 7 + c + 1, (r + 1) * 7 + c + 1, (r + 1) * 7 + c) for r in range(5) for c in range(6)]
    flap = lib.mesh_object(f"flap_{rid}", verts, faces, None, dark_leather)
    sol = flap.modifiers.new("thick", "SOLIDIFY")
    sol.thickness = 0.004
    apply_all(flap)
    parts.append(flap)
    border = [grid[r][0] for r in range(5, -1, -1)] + grid[0][1:] + [grid[r][6] for r in range(1, 6)]
    parts.append(tube_along(f"flapstitch_{rid}", [p + Vector((0, -0.003, 0)) for p in border], 0.0018 * s, embroidery))
    for p in (grid[5][1], grid[5][5]):
        parts.append(sphere_at(f"button_{rid}_{p.x:.2f}", p + Vector((0, -0.006, -0.008 * s)), 0.008 * s, horn))
    mid = grid[2][3] + Vector((0, -0.006, 0))
    for k in range(6):
        a = k / 6 * math.tau
        parts.append(sphere_at(f"petal_{rid}_{k}", mid + Vector((math.cos(a) * 0.011 * s, 0, math.sin(a) * 0.011 * s)), 0.0065 * s, embroidery))
    parts.append(sphere_at(f"heart_{rid}", mid + Vector((0, -0.002, 0)), 0.005 * s, green))
    bx = 0.075 * s * b
    for sx in (-1, 1):
        x = sx * bx
        path = []
        n = 14
        for k in range(n):
            z = waist + (top + 0.05 * s - waist) * k / (n - 1)
            h = surf.hit((x, -1, z), (0, 1, 0), 0.005)
            if h:
                path.append(h)
        for k in range(1, 6):
            y = -0.08 * s + 0.16 * s * k / 6
            h = surf.hit((x, y, top + 0.6), (0, 0, -1), 0.005)
            if h:
                path.append(h)
        for k in range(n):
            z = top + 0.05 * s - (top + 0.05 * s - waist) * k / (n - 1)
            h = surf.hit((x, 1, z), (0, -1, 0), 0.005)
            if h:
                path.append(h)
        parts.append(ribbon(f"brace_{rid}_{sx}", path, 0.04 * s, mats["braces"], 0.005))
    zc = j["chest"][2] + 0.06 * s
    bar = [surf.hit((-bx + 2 * bx * k / 10, -1, zc), (0, 1, 0), 0.009) for k in range(11)]
    bar = [h for h in bar if h]
    parts.append(ribbon(f"chestbar_{rid}", bar, 0.055 * s, embroidery, 0.004))
    for k, h in enumerate(bar[2:-2:2]):
        parts.append(tube_along(f"edelweiss_{rid}_{k}", [h[0] + h[1] * 0.004, h[0] + h[1] * 0.009], 0.009 * s, green))
    for side, sx in (("L", 1), ("R", -1)):
        hip, knee = Vector(j[f"hip_{side}"]), Vector(j[f"knee_{side}"])
        c = hip + (knee - hip) * 0.79
        pts = ring_around(surf, c, knee - hip, 0.003, reach=0.11)  # inside the gap to the other leg
        if len(pts) > 8:
            parts.append(tube_along(f"legcuff_{rid}_{side}", pts, 0.014 * s, mats["pelvis"], closed=True))
        for k in range(3):
            h = surf.hit((sx * 0.6, 0, c.z + (0.03 + k * 0.025) * s), (-sx, 0, 0), 0.004)
            if h:
                parts.append(tube_along(f"lace_{rid}_{side}{k}", [h[0] - Vector((0, 0.012, 0)), h[0] + Vector((0, 0.012, 0))], 0.0035 * s, embroidery))
        knee_c = knee + (Vector(j[f"ankle_{side}"]) - knee) * 0.14
        pts = ring_around(surf, knee_c, Vector(j[f"ankle_{side}"]) - knee, 0.003, reach=0.125)
        if len(pts) > 8:
            parts.append(tube_along(f"sockcuff_{rid}_{side}", pts, 0.017 * s, mats["shin"], closed=True))
    # The knife in its pocket on the right thigh, the horn handle showing.
    hip, knee = Vector(j["hip_R"]), Vector(j["knee_R"])
    zk = hip.z + (knee.z - hip.z) * 0.4
    pocket = [surf.hit((-0.6, 0.0, zk + dz), (1, 0, 0), 0.005) for dz in (-0.06 * s, -0.03 * s, 0.0, 0.03 * s)]
    pocket = [h for h in pocket if h]
    if len(pocket) > 1:
        parts.append(ribbon(f"knifepocket_{rid}", pocket, 0.035 * s, dark_leather, 0.006))
        handle = pocket[-1][0] + pocket[-1][1] * 0.008
        parts.append(tube_along(f"knife_{rid}", [handle, handle + Vector((0, 0, 0.045 * s))], 0.007 * s, horn))
    return parts


def build(look):
    rid = look["id"]
    j = skeleton(look)
    rr = radii(look)
    names = [n for n in j if any(n in e for e in BODY_EDGES)]
    # Skin-modifier skeleton.
    me = bpy.data.meshes.new(f"skel_{rid}")
    me.from_pydata([j[n] for n in names], [(names.index(a), names.index(b)) for a, b in BODY_EDGES], [])
    me.update()
    body = bpy.data.objects.new(f"body_{rid}", me)
    bpy.context.scene.collection.objects.link(body)
    skin = body.modifiers.new("skin", "SKIN")
    skin.use_smooth_shade = True
    skin.branch_smoothing = 0.6
    for i, n in enumerate(names):
        body.data.skin_vertices[0].data[i].radius = rr[n]
    body.data.skin_vertices[0].data[names.index("pelvis")].use_root = True
    sub = body.modifiers.new("smooth", "SUBSURF")
    sub.levels = 2
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.select_all(action="DESELECT")
    body.select_set(True)
    bpy.ops.object.modifier_apply(modifier="skin")
    bpy.ops.object.modifier_apply(modifier="smooth")
    bpy.ops.object.shade_smooth()

    # Kit colours by zone.
    o = look["outfit"]
    colours = {
        "torso": o["torso"], "upperArm": o["upperArm"], "forearm": o["forearm"], "hands": o["hands"], "pelvis": o["pelvis"],
        "thigh": o["thigh"], "shin": o["shin"], "boots": o["boots"], "pads": o.get("pads", o["thigh"]),
        "stripe": o.get("legStripe", o["thigh"]), "braces": o.get("braces", o["torso"]), "skin": look["skin"],
        "backstripe": o.get("backStripe", o["torso"]),
    }
    rough = {"torso": 0.95 if rid == "remo" else 0.45, "pelvis": 0.7 if rid == "remo" else 0.45, "thigh": 0.7 if rid == "remo" else 0.45,
             "boots": 0.5, "hands": 0.6, "skin": 0.6, "shin": 0.95 if rid == "remo" else 0.45}
    mats = {}
    for zone, hexc in colours.items():
        mats[zone] = lib.material(f"{rid}_{zone}", hex_rgb(hexc), rough.get(zone, 0.5))
        body.data.materials.append(mats[zone])
    order = list(colours)
    for poly in body.data.polygons:
        zone = zone_of(body.matrix_world @ poly.center, poly.normal, j, look)
        poly.material_index = order.index(zone)

    parts = [body]
    s = look["scale"]
    chest_y = -0.115 * s * (1.15 if rid == "remo" else 1)
    if o.get("lettering"):
        # "CRESTA RUN" across the chest.
        # Sized to the chest, so it never wraps round the sides.
        letters = text_mesh("CRESTA RUN", min(0.055 * s, 0.8 * 2 * 0.155 * s * look["build"] / 6.2), lib.material(f"{rid}_lettering", hex_rgb(o["lettering"]), 0.5), f"letters_{rid}")
        letters.location = (0, chest_y - 0.012, j["chest"][2] + 0.06 * s)
        parts.append(letters)
    if False:
        # The race number on a white bib on the back.
        bib_mat = lib.material(f"{rid}_bib", (0.9, 0.9, 0.88), 0.7)
        bib = lib.mesh_object(f"bib_{rid}", [(-0.085 * s, 0, -0.1 * s), (0.085 * s, 0, -0.1 * s), (0.085 * s, 0, 0.1 * s), (-0.085 * s, 0, 0.1 * s)], [(0, 3, 2, 1)], None, bib_mat)
        bib.location = (0, -chest_y + 0.012, j["chest"][2] + 0.02 * s)
        num = text_mesh(o["bib"], 0.11 * s, lib.material(f"{rid}_number", (0.02, 0.02, 0.02), 0.5), f"number_{rid}")
        num.rotation_euler = (math.pi / 2, 0, math.pi)
        num.location = (0, -chest_y + 0.016, j["chest"][2] + 0.0)
        parts += [bib, num]
    decals = parts[1:]
    # Gloves and boots, each riding on its own bone.
    sole_mat = lib.material(f"{rid}_sole", (0.05, 0.045, 0.04), 0.8)
    steel = lib.material(f"{rid}_rakes", (0.7, 0.72, 0.75), 0.3, metallic=0.9)
    extremities = []
    for side in "LR":
        extremities.append((glove(rid, side, j, s, mats["hands"]), f"hand.{side}"))
        extremities.append((boot(rid, side, j, s, mats["boots"], sole_mat, steel), f"foot.{side}"))
    kit = remo_kit(rid, j, s, look, body, mats) if rid == "remo" else []
    mesh = body

    # Armature with named bones, the mesh bound with automatic weights.
    arm_data = bpy.data.armatures.new(f"rig_{rid}")
    rig = bpy.data.objects.new(f"rider_{rid}", arm_data)
    bpy.context.scene.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.select_all(action="DESELECT")
    rig.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    for name, a, b, parent in BONES:
        bone = arm_data.edit_bones.new(name)
        bone.head = j[a]
        bone.tail = j[b]
        if parent:
            bone.parent = arm_data.edit_bones[parent]
            bone.use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="DESELECT")
    mesh.select_set(True)
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")
    # Lettering and bib ride on the chest: all their weight on the chest bone, then into the body.
    for d in decals:
        group = d.vertex_groups.new(name="chest")
        group.add(list(range(len(d.data.vertices))), 1.0, "REPLACE")
    for obj, bone in extremities:
        group = obj.vertex_groups.new(name=bone)
        group.add(list(range(len(obj.data.vertices))), 1.0, "REPLACE")
    for obj in kit:
        weight_nearest(obj, j)
    mesh = lib.join([mesh, *decals, *(o for o, _ in extremities), *kit], f"body_{rid}")
    return rig, mesh


# blender/riders_mpfb.py borrows the kit from this file without building these bodies.
if not globals().get("RIDERS_LIBRARY"):
    lib.reset()
    rigs = []
    meshes = []
    for i, rid in enumerate(("maximilian", "adelaide", "remo")):
        rig, mesh = build(LOOKS[rid])
        rigs.append(rig)
        meshes.append(mesh)
    # A look at all three side by side, three-quarter front.
    for i, rig in enumerate(rigs):
        rig.location = (i * 1.1 - 1.1, 0, 0)
    lib.preview("riders.png", (2.2, -4.2, 1.3), (0, 0, 0.95), size=(1200, 900), lens=45, sky=(0.35, 0.55, 0.9))
    lib.preview("riders_back.png", (-1.6, 4.4, 1.4), (0, 0, 0.95), size=(1200, 900), lens=45, sky=(0.35, 0.55, 0.9))
    for rig in rigs:
        rig.location = (0, 0, 0)
    weights = {m.name: len(m.vertex_groups) for m in meshes}
    result = {"export": lib.export_glb("riders.glb", rigs + meshes), "vertex_groups": weights, "verts": {m.name: len(m.data.vertices) for m in meshes}}
