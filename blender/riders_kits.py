"""
Kit for the three riders to unlock, on their MPFB bodies (run from riders_mpfb.py, after riders.py):
Kletus's open leather vest, frayed denim shorts and machete; Mario's dungarees over a red sweater;
the Dark Lord's armour, chest box, belt and cape. Then what each wears on his head, riding too
(the head itself is the game's): the bush hat with its band of shark's teeth, the red cap, and the
helmet that hides the face.

Head pieces are built in the game head's own frame at scale 1 (Blender: the face looks -Y, the
crown +Z, the rider's left +X; the skull's centre at the origin) and exported as head_<id>.
"""

import math

import bmesh
import bpy
from mathutils import Vector

import lib

clamp01 = lambda x: max(0.0, min(1.0, x))


def along(p, j, bone):
    """How far along a bone (0 at its head, 1 at its tail) a point lies."""
    for name, a, b, _ in BONES:
        if name == bone:
            A, B = Vector(j[a]), Vector(j[b])
            ab = B - A
            return max(0, min(1, (p - A).dot(ab) / ab.length_squared))
    return 0.5


def vest_half(z, j, s, b):
    """Half the width of the open front of Kletus's vest at a height: narrow at the collar, wide over the belly."""
    top, bottom = j["neck"][2], shorts_top(j, s)
    k = clamp01((top - z) / (top - bottom))
    return (0.035 + 0.085 * k ** 0.8) * s * b


# How far down the thigh Kletus's shorts reach.
SHORTS_HEM = 0.48


def armhole(j, s):
    """Kletus's armholes: how far out (|x|) and down to the armpit (z)."""
    return abs(j["shoulder_L"][0]) - 0.01 * s, j["shoulder_L"][2] - 0.1 * s


def shorts_top(j, s):
    return j["pelvis"][2] + 0.075 * s


def kit_zone(p, normal, j, look, bone):
    """The kit's zone for a face, for the riders with their own kit; the others as before."""
    kit = look["outfit"].get("kit")
    s, b = look["scale"], look["build"]
    base = bone.split(".")[0] if bone else None
    if kit == "bush":
        # No sleeves: the armhole is where the arm meets the body, straight down from the shoulder.
        ax, az = armhole(j, s)
        if base in ("hips", "spine", "chest"):
            if p.z < shorts_top(j, s):
                return "pelvis"
            if abs(p.x) > ax and p.z > az:
                return "upperArm"
            if normal.y < 0.1 and p.y < j["chest"][1] and abs(p.x) < vest_half(p.z, j, s, b):
                return "skin"
            return "torso"
        if base == "upperarm":
            return "torso" if abs(p.x) < ax and p.z > az else "upperArm"
        if base == "forearm":
            return "forearm"
        if base == "thigh":
            ragged = 0.03 * math.sin(p.x * 190 + p.y * 260) + 0.02 * math.sin(p.y * 410)
            return "pelvis" if along(p, j, bone) < SHORTS_HEM + ragged else "skin"
    if kit == "dungarees":
        # The trousers up to the waist; the bib and braces over the sweater are made on their own.
        if base == "hips":
            return "pelvis"
        if base in ("spine", "chest"):
            return "pelvis" if p.z < j["waist"][2] + 0.02 * s else "torso"
        if base == "upperarm":
            return "torso" if along(p, j, bone) < 0.16 else "upperArm"
        if base == "forearm":
            return "forearm"
    return zone_of(p, normal, j, look, bone)


def path_on(surf, pts_from, direction, offset):
    """Surface points (point, normal) seen from each origin along a direction."""
    out = []
    for o in pts_from:
        h = surf.hit(o, direction, offset)
        if h:
            out.append(h)
    return out


def oriented_box(name, centre, u, v, w, half, mat, bevel=0.4):
    return rounded_box(name, centre, (u.normalized(), v.normalized(), w.normalized()), half, mat, bevel=bevel)


def rigid(obj, bone):
    """All of an object on one bone."""
    for g in list(obj.vertex_groups):
        obj.vertex_groups.remove(g)
    obj.vertex_groups.new(name=bone).add(list(range(len(obj.data.vertices))), 1.0, "REPLACE")
    return obj


# ---------- Kletus: the bush ----------


def bush_kit(rid, j, s, look, body, mats):
    surf = Surface(body)
    b = look["build"]
    leather = lib.material(f"{rid}_vestedge", hex_rgb("#3e2a18"), 0.7)
    belt = lib.material(f"{rid}_belt", hex_rgb("#2e2016"), 0.55)
    brass = lib.material(f"{rid}_brass", (0.55, 0.38, 0.12), 0.35, metallic=0.9)
    fray = lib.material(f"{rid}_fray", hex_rgb("#c9d3dc"), 0.9)
    steel = lib.material(f"{rid}_blade", (0.62, 0.63, 0.64), 0.32, metallic=0.95)
    wood = lib.material(f"{rid}_handle", hex_rgb("#4a2c18"), 0.6)
    strap = lib.material(f"{rid}_strap", hex_rgb("#3a2716"), 0.65)
    parts, rigid_parts = [], []
    top = j["neck"][2] - 0.01 * s
    bottom = shorts_top(j, s)
    # The vest's open front, its edges rolled leather.
    for sx in (-1, 1):
        pts = []
        for k in range(26):
            z = bottom + 0.01 * s + (top - bottom) * k / 25
            h = surf.hit((sx * vest_half(z, j, s, b), -1, z), (0, 1, 0), 0.003)
            if h:
                pts.append(h[0])
        if len(pts) > 3:
            parts.append(tube_along(f"vestedge_{rid}_{sx}", pts, 0.011 * s, leather))
        # A chest pocket with its flap and stud.
        zc = j["chest"][2] + 0.05 * s
        h = surf.hit((sx * (vest_half(zc, j, s, b) + 0.05 * s), -1, zc), (0, 1, 0), 0.006)
        if h:
            p, nrm = h
            u = Vector((1, 0, 0)) - nrm * nrm.x
            parts.append(oriented_box(f"pocket_{rid}_{sx}", p, u, nrm.cross(u), nrm, (0.04 * s, 0.022 * s, 0.004 * s), mats["torso"], 0.5))
            parts.append(sphere_at(f"stud_{rid}_{sx}", p + nrm * 0.006 - Vector((0, 0, 0.012 * s)), 0.0055 * s, brass))
    # Armholes: no sleeves, a rolled edge round each shoulder, from the armpit at the front, over
    # the top and down to the armpit at the back.
    ax, az = armhole(j, s)
    for side, sx in (("L", 1), ("R", -1)):
        c = Vector((sx * ax, j["shoulder_L"][1], j["shoulder_L"][2] - 0.03 * s))
        pts = [p for p in ring_around(surf, c, (1, 0, 0), 0.003, n=48, reach=0.16) if p.z > az]
        pts.sort(key=lambda p: math.atan2(p.y - c.y, p.z - c.z))
        if len(pts) > 4:
            parts.append(tube_along(f"armhole_{rid}_{side}", pts, 0.01 * s, leather))
    # The collar round the back of the neck.
    pts = [p for p in ring_around(surf, Vector(j["neck"]) - Vector((0, 0, 0.012 * s)), (0, 0, 1), 0.004, reach=0.12) if p.y > j["neck"][1] - 0.02 * s]
    pts.sort(key=lambda p: math.atan2(p.x, p.y))
    if len(pts) > 4:
        parts.append(tube_along(f"collar_{rid}", pts, 0.011 * s, leather))
    # A broad belt with a brass buckle, holding up the shorts under the belly.
    pts = ring_around(surf, (0, 0, bottom - 0.005 * s), (0, 0, 1), 0.004, reach=0.5)
    if len(pts) > 8:
        parts.append(tube_along(f"belt_{rid}", pts, 0.016 * s, belt, closed=True))
    h = surf.hit((0, -1, bottom - 0.005 * s), (0, 1, 0), 0.02)
    if h:
        parts.append(oriented_box(f"buckle_{rid}", h[0], Vector((1, 0, 0)), Vector((0, 0, 1)), Vector((0, -1, 0)), (0.035 * s, 0.026 * s, 0.006 * s), brass, 0.3))
    # The shorts: denim cut loose round the legs (the body under them is denim too), wider towards
    # the frayed hems, but close on the inside of the thighs so the legs never meet through them.
    pel = [i for i, m in enumerate(body.data.materials) if m.name == f"{rid}_pelvis"][0]
    bm = bmesh.new()
    bm.from_mesh(body.data)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index != pel], context="FACES")
    bm.normal_update()
    crotch = j["pelvis"][2] - 0.04 * s
    moves = []
    for v in bm.verts:
        push = 0.006 * s
        if v.co.z < crotch + 0.06 * s and abs(v.co.x) > 0.004:
            side = "L" if v.co.x > 0 else "R"
            hip, knee = Vector(j[f"hip_{side}"]), Vector(j[f"knee_{side}"])
            d = knee - hip
            t = clamp01((v.co - hip).dot(d) / d.length_squared)
            radial = v.co - (hip + d * t)
            radial.z = 0
            inner = radial.length > 1e-6 and radial.normalized().x * (1 if side == "L" else -1) < -0.35
            loose = clamp01(t / SHORTS_HEM) ** 1.2 * clamp01((crotch + 0.06 * s - v.co.z) / (0.06 * s))
            push = (0.006 + 0.024 * loose) * s * (0.3 if inner else 1)
        moves.append((v, v.normal.copy() * push))
    for v, m in moves:
        v.co += m
    # Denim doesn't follow the cleft at the seat or between the legs: smooth across it.
    seat = [v for v in bm.verts if abs(v.co.x) < 0.065 * s and crotch - 0.03 * s < v.co.z < j["pelvis"][2] + 0.1 * s]
    for _ in range(14):
        bmesh.ops.smooth_vert(bm, verts=seat, factor=0.7, use_axis_x=True, use_axis_y=True, use_axis_z=False)
    hem = [(v.co.copy(), "L" if v.co.x > 0 else "R") for v in bm.verts if v.is_boundary and v.co.z < crotch - 0.05 * s]
    me = bpy.data.meshes.new(f"shorts_{rid}")
    bm.to_mesh(me)
    bm.free()
    shorts = bpy.data.objects.new(f"shorts_{rid}", me)
    bpy.context.scene.collection.objects.link(shorts)
    shorts.data.materials.clear()
    shorts.data.materials.append(mats["pelvis"])
    for poly in shorts.data.polygons:
        poly.material_index = 0
    sol = shorts.modifiers.new("thick", "SOLIDIFY")
    sol.thickness = 0.004 * s
    apply_all(shorts)
    parts.append(shorts)
    # Frayed hems: loose white threads hanging from the cut-off denim.
    for k, (p, side) in enumerate(hem):
        d = (Vector(j[f"knee_{side}"]) - Vector(j[f"hip_{side}"])).normalized()
        length = (0.01 + 0.016 * ((k * 7) % 5) / 4) * s
        parts.append(tube_along(f"fray_{rid}_{k}", [p - d * 0.006 * s, p + d * length], 0.0022 * s, fray))
    # The machete on his back: the handle up over the right shoulder, the blade down to the left hip,
    # in a pair of leather loops, on a strap across the chest.
    a0 = surf.hit((-0.11 * s, 1, j["neck"][2] - 0.03 * s), (0, -1, 0), 0.0)
    a1 = surf.hit((0.14 * s, 1, j["pelvis"][2] + 0.04 * s), (0, -1, 0), 0.0)
    if a0 and a1:
        A, B = a0[0], a1[0]
        # Clear of the back all the way along.
        lift = 0.0
        for k in range(21):
            q = A.lerp(B, k / 20)
            h = surf.hit((q.x, 1, q.z), (0, -1, 0), 0.0)
            if h:
                lift = max(lift, h[0].y + 0.03 * s - q.y)
        A, B = A + Vector((0, lift, 0)), B + Vector((0, lift, 0))
        u = (B - A).normalized()
        out = Vector((0, 1, 0))
        w = u.cross(out).normalized()  # across the blade, in the plane of the back
        handle_top = A - u * 0.12 * s
        parts_m = []
        parts_m.append(tube_along(f"grip_{rid}", [handle_top, A + u * 0.01 * s], 0.0145 * s, wood))
        parts_m.append(sphere_at(f"pommel_{rid}", handle_top, 0.017 * s, wood))
        for k in range(3):
            parts_m.append(sphere_at(f"rivet_{rid}_{k}", handle_top + u * (0.025 + 0.035 * k) * s + out * 0.013 * s, 0.004 * s, brass))
        # The blade: straight back, the edge widening to a broad, raked tip.
        length = 0.5 * s
        verts = []
        prof = [(0.0, 0.019, -0.019), (0.25, 0.021, -0.024), (0.6, 0.022, -0.032), (0.86, 0.022, -0.038), (0.96, 0.02, -0.028), (1.0, 0.012, 0.004)]
        for t, back, edge in prof:
            c = A + u * (0.012 * s + length * t)
            verts += [tuple(c + w * back * s), tuple(c + w * edge * s)]
        faces = [(2 * i, 2 * i + 1, 2 * i + 3, 2 * i + 2) for i in range(len(prof) - 1)]
        blade = lib.mesh_object(f"blade_{rid}", verts, faces, None, steel)
        sol = blade.modifiers.new("thick", "SOLIDIFY")
        sol.thickness = 0.004 * s
        apply_all(blade)
        parts_m.append(blade)
        parts_m.append(oriented_box(f"guard_{rid}", A + u * 0.01 * s, w, u, out, (0.03 * s, 0.006 * s, 0.009 * s), steel, 0.3))
        for t in (0.15, 0.62):
            c = A + u * (0.012 * s + length * t)
            parts_m.append(oriented_box(f"loop_{rid}_{t}", c + w * -0.002 * s, w, u, out, (0.034 * s, 0.014 * s, 0.009 * s), strap, 0.4))
        rigid_parts.append(rigid(lib.join(parts_m, f"machete_{rid}"), "chest"))
        # The strap: from the top loop over the right shoulder, across the chest to the left hip and
        # round the back to the bottom loop.
        sh = Vector(j["shoulder_R"])
        front = path_on(surf, [Vector((-0.07 * s + (0.16 * s) * k / 12 * 1.3, -1, sh.z + 0.02 * s - (sh.z - j["pelvis"][2] - 0.02 * s) * k / 12)) for k in range(13)], (0, 1, 0), 0.006)
        over = path_on(surf, [Vector((-0.07 * s, 0.12 * s - 0.24 * s * k / 6, sh.z + 0.6)) for k in range(7)], (0, 0, -1), 0.006)
        if front and over:
            parts.append(ribbon(f"strap_{rid}", over + front, 0.03 * s, strap, 0.005))
    return parts, rigid_parts


# ---------- Mario: dungarees ----------


def dungarees_kit(rid, j, s, look, body, mats):
    surf = Surface(body)
    b = look["build"]
    gold = lib.material(f"{rid}_buttons", (0.85, 0.62, 0.12), 0.3, metallic=0.9)
    stitch = lib.material(f"{rid}_stitch", hex_rgb("#5d7fd6"), 0.7)
    parts = []
    waist = j["waist"][2] + 0.02 * s
    bib_top = j["chest"][2] + 0.09 * s
    half = 0.085 * s * b
    # The bib: a panel of denim laid over the front of the sweater, from the waist up the chest.
    rows, cols = 9, 10
    grid = []
    for r in range(rows + 1):
        z = waist - 0.03 * s + (bib_top - waist + 0.03 * s) * r / rows
        line = []
        for c in range(cols + 1):
            x = -half + 2 * half * c / cols
            h = surf.hit((x, -1, z), (0, 1, 0), 0.005)
            line.append(h[0] if h else Vector((x, -0.15, z)))
        grid.append(line)
    verts = [tuple(p) for line in grid for p in line]
    faces = [(r * (cols + 1) + c, r * (cols + 1) + c + 1, (r + 1) * (cols + 1) + c + 1, (r + 1) * (cols + 1) + c) for r in range(rows) for c in range(cols)]
    bib = lib.mesh_object(f"bib_{rid}", verts, faces, None, mats["braces"])
    sol = bib.modifiers.new("thick", "SOLIDIFY")
    sol.thickness = 0.005 * s
    apply_all(bib)
    parts.append(bib)
    parts.append(tube_along(f"bibstitch_{rid}", [p + Vector((0, -0.004, 0)) for p in [grid[r][0] for r in range(1, rows + 1)] + grid[rows][1:] + [grid[r][cols] for r in range(rows - 1, 0, -1)]], 0.0035 * s, stitch))
    # A pocket on the bib.
    p = grid[rows // 2][cols // 2]
    parts.append(oriented_box(f"bibpocket_{rid}", p + Vector((0, -0.006, 0)), Vector((1, 0, 0)), Vector((0, 0, 1)), Vector((0, -1, 0)), (0.045 * s, 0.035 * s, 0.003 * s), mats["braces"], 0.4))
    # The braces: from the top corners of the bib over the shoulders and down the back to the waist,
    # with a gold button at the front of each.
    for sx in (-1, 1):
        x = sx * 0.07 * s * b
        path = path_on(surf, [Vector((x, -1, bib_top - 0.01 * s + (j["neck"][2] - bib_top + 0.03 * s) * k / 5)) for k in range(6)], (0, 1, 0), 0.006)
        path += path_on(surf, [Vector((x, -0.06 * s + 0.12 * s * k / 6, j["neck"][2] + 0.6)) for k in range(1, 6)], (0, 0, -1), 0.006)
        path += path_on(surf, [Vector((x * 0.9, 1, j["neck"][2] - (j["neck"][2] - waist) * k / 10)) for k in range(11)], (0, -1, 0), 0.006)
        if len(path) > 4:
            parts.append(ribbon(f"brace_{rid}_{sx}", path, 0.034 * s, mats["braces"], 0.005))
        h = surf.hit((x, -1, bib_top - 0.012 * s), (0, 1, 0), 0.012)
        if h:
            parts.append(sphere_at(f"button_{rid}_{sx}", h[0], 0.014 * s, gold))
    # The waistband round the back, where the trousers end under the sweater.
    pts = [p for p in ring_around(surf, (0, 0, waist), (0, 0, 1), 0.004, n=40, reach=0.5) if p.y > -0.02 * s]
    pts.sort(key=lambda p: math.atan2(p.x, p.y))
    if len(pts) > 4:
        parts.append(tube_along(f"waistband_{rid}", pts, 0.008 * s, mats["pelvis"]))
    return parts, []


# ---------- The Dark Lord: armour and cape ----------


def armour_kit(rid, j, s, look, body, mats):
    surf = Surface(body)
    b = look["build"]
    gloss = lib.material(f"{rid}_gloss", (0.012, 0.012, 0.014), 0.14, metallic=0.4)
    plate = lib.material(f"{rid}_plate", (0.03, 0.03, 0.034), 0.22, metallic=0.5)
    silver = lib.material(f"{rid}_silver", (0.72, 0.73, 0.75), 0.25, metallic=1.0)
    grey = lib.material(f"{rid}_greybox", (0.08, 0.08, 0.09), 0.4, metallic=0.3)
    cape = lib.material(f"{rid}_cape", (0.008, 0.008, 0.009), 0.92)
    lights = {
        "red": lib.material(f"{rid}_light_red", (0.8, 0.02, 0.02), 0.3, emission=(1.0, 0.05, 0.03)),
        "blue": lib.material(f"{rid}_light_blue", (0.05, 0.15, 0.9), 0.3, emission=(0.1, 0.3, 1.0)),
        "white": lib.material(f"{rid}_light_white", (0.85, 0.85, 0.85), 0.3, emission=(0.8, 0.8, 0.8)),
        "green": lib.material(f"{rid}_light_green", (0.05, 0.7, 0.1), 0.3, emission=(0.1, 0.9, 0.2)),
    }
    parts, rigid_parts = [], []
    # The armour over the shoulders and the top of the chest: a shell over the body, with ribbed
    # plates down the front under the neck.
    up = j["upper_chest"][2] - 0.05 * s
    bm = bmesh.new()
    bm.from_mesh(body.data)
    keep = [f for f in bm.faces if f.calc_center_median().z > up and f.normal.z > -0.35 and abs(f.calc_center_median().x) < 0.26 * s * b]
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f not in set(keep)], context="FACES")
    for v in bm.verts:
        v.co += v.normal * 0.012 * s
    me = bpy.data.meshes.new(f"mantle_{rid}")
    bm.to_mesh(me)
    bm.free()
    mantle = bpy.data.objects.new(f"mantle_{rid}", me)
    bpy.context.scene.collection.objects.link(mantle)
    mantle.data.materials.clear()
    mantle.data.materials.append(gloss)
    for poly in mantle.data.polygons:
        poly.material_index = 0
    sol = mantle.modifiers.new("thick", "SOLIDIFY")
    sol.thickness = 0.008 * s
    apply_all(mantle)
    parts.append(mantle)
    neck = Vector(j["neck"])
    for k in range(7):
        x = (k - 3) * 0.028 * s
        h = surf.hit((x, -1, neck.z - 0.05 * s - abs(k - 3) * 0.006 * s), (0, 1, 0), 0.024 * s)
        if h:
            p, nrm = h
            u = Vector((0, 0, 1)) - nrm * nrm.z
            u = (u + Vector((x * 2.2, 0, 0))).normalized()
            parts.append(oriented_box(f"rib_{rid}_{k}", p, nrm.cross(u), u, nrm, (0.011 * s, 0.038 * s, 0.005 * s), plate, 0.6))
    # The chest box: a dark panel with rows of lit buttons and two slots of lights at the sides.
    h = surf.hit((0, -1, j["chest"][2] + 0.02 * s), (0, 1, 0), 0.012 * s)
    if h:
        p, nrm = h
        u = Vector((1, 0, 0))
        v = nrm.cross(u).normalized()
        if v.z < 0:
            v = -v
        parts.append(oriented_box(f"chestbox_{rid}", p, u, v, nrm, (0.06 * s, 0.05 * s, 0.01 * s), grey, 0.3))
        layout = [("red", -0.025, 0.026), ("blue", 0.0, 0.026), ("white", 0.025, 0.026), ("red", -0.025, 0.004), ("green", 0.0, 0.004), ("blue", 0.025, 0.004), ("white", -0.02, -0.024), ("white", 0.0, -0.024), ("red", 0.022, -0.024)]
        for k, (c, x, z) in enumerate(layout):
            parts.append(oriented_box(f"button_{rid}_{k}", p + u * x * s + v * z * s + nrm * 0.011 * s, u, v, nrm, (0.008 * s, 0.006 * s, 0.003 * s), lights[c], 0.3))
        for sx in (-1, 1):
            parts.append(oriented_box(f"slot_{rid}_{sx}", p + u * sx * 0.048 * s + nrm * 0.011 * s, u, v, nrm, (0.004 * s, 0.04 * s, 0.002 * s), plate, 0.3))
            for k in range(6):
                parts.append(sphere_at(f"led_{rid}_{sx}_{k}", p + u * sx * 0.048 * s + v * (k - 2.5) * 0.013 * s + nrm * 0.013 * s, 0.0025 * s, lights["white"]))
    # The belt: a broad band with a silver buckle and a box at each side, the hilt at the left hip.
    zb = j["pelvis"][2] + 0.05 * s
    pts = ring_around(surf, (0, 0, zb), (0, 0, 1), 0.004, reach=0.5)
    if len(pts) > 8:
        parts.append(tube_along(f"belt_{rid}", pts, 0.022 * s, gloss, closed=True))
    h = surf.hit((0, -1, zb), (0, 1, 0), 0.024 * s)
    if h:
        p, nrm = h
        parts.append(oriented_box(f"buckle_{rid}", p, Vector((1, 0, 0)), Vector((0, 0, 1)), nrm, (0.045 * s, 0.028 * s, 0.006 * s), silver, 0.3))
        for k in range(4):
            parts.append(oriented_box(f"buckleslot_{rid}_{k}", p + Vector((-0.024 * s + k * 0.016 * s, 0, 0)) + nrm * 0.006 * s, Vector((1, 0, 0)), Vector((0, 0, 1)), nrm, (0.004 * s, 0.018 * s, 0.002 * s), plate, 0.3))
    for sx in (-1, 1):
        h = surf.hit((sx * 0.1 * s * b, -1, zb), (0, 1, 0), 0.024 * s)
        if h:
            p, nrm = h
            u = Vector((1, 0, 0)) - nrm * nrm.x
            parts.append(oriented_box(f"beltbox_{rid}_{sx}", p, u, Vector((0, 0, 1)), nrm, (0.022 * s, 0.024 * s, 0.01 * s), grey, 0.3))
    h = surf.hit((1, -0.02, zb - 0.02 * s), (-1, 0, 0), 0.03 * s)
    if h:
        p = h[0]
        top = p + Vector((0, 0, 0.02 * s))
        bot = p - Vector((0, 0, 0.21 * s))
        hilt = [tube_along(f"hilt_{rid}", [top, bot], 0.016 * s, silver)]
        for k in range(5):
            z = 0.04 + 0.022 * k
            hilt.append(tube_along(f"grip_{rid}_{k}", [top - Vector((0, 0, z * s)), top - Vector((0, 0, (z + 0.012) * s))], 0.0185 * s, gloss))
        hilt.append(tube_along(f"emitter_{rid}", [top, top + Vector((0, 0, 0.025 * s))], 0.019 * s, silver))
        rigid_parts.append(rigid(lib.join(hilt, f"hiltall_{rid}"), "hips"))
    # The cape: from the shoulders behind the collar, falling to the calves and spreading.
    sh = Vector(j["shoulder_L"])
    z0 = j["neck"][2] - 0.015 * s
    z1 = 0.3 * s
    rows, cols = 16, 22
    verts, faces, weights = [], [], []
    for r in range(rows + 1):
        v = r / rows
        z = z0 + (z1 - z0) * v
        spread = 1 + 0.15 * v ** 1.3
        for c in range(cols + 1):
            # Hanging close behind, so that lying on the toboggan it lies over the back and legs.
            a = math.radians(-82 + 164 * c / cols)  # 0 straight behind
            wx = math.sin(a) * (0.18 * s * b * spread + 0.02 * v)
            wy = math.cos(a) * (0.09 * s * b + 0.025 * s * v) + 0.02 * s
            if v < 0.25:
                # Round the shoulders: out over the top of the arms.
                k = 1 - v / 0.25
                wx = math.sin(a) * (abs(sh.x) + 0.04 * s) * (1 - 0.3 * k * (1 - abs(math.sin(a))))
            hit = surf.hit((wx * 3, wy * 3 + 0.0, z), (-wx, -wy, 0), 0.0)
            p = Vector((wx, wy, z))
            if hit and (hit[0].x ** 2 + hit[0].y ** 2) > (p.x ** 2 + p.y ** 2) - 0.0004:
                p = hit[0] + Vector((math.sin(a), math.cos(a), 0)) * 0.02 * s
            verts.append(tuple(p))
            weights.append(z)
        if r:
            for c in range(cols):
                i = r * (cols + 1) + c
                faces.append((i - cols - 1, i - cols, i + 1, i))
    capemesh = lib.mesh_object(f"cape_{rid}", verts, faces, None, cape)
    sol = capemesh.modifiers.new("thick", "SOLIDIFY")
    sol.thickness = 0.006 * s
    capemesh.modifiers.new("smooth", "SUBSURF").levels = 1
    apply_all(capemesh)
    # On the chest at the top, the spine and then the hips further down: it swings with the back.
    zc, zw, zp = j["chest"][2], j["waist"][2], j["pelvis"][2]
    groups = {n: capemesh.vertex_groups.new(name=n) for n in ("chest", "spine", "hips")}
    for vtx in capemesh.data.vertices:
        z = vtx.co.z
        if z > zc:
            w = {"chest": 1.0}
        elif z > zw:
            k = (z - zw) / (zc - zw)
            w = {"chest": k, "spine": 1 - k}
        elif z > zp:
            k = (z - zp) / (zw - zp)
            w = {"spine": k, "hips": 1 - k}
        else:
            w = {"hips": 1.0}
        for n, x in w.items():
            if x > 0:
                groups[n].add([vtx.index], x, "REPLACE")
    rigid_parts.append(capemesh)
    return parts, rigid_parts


KITS = {"bush": bush_kit, "dungarees": dungarees_kit, "armour": armour_kit}


# ---------- What they wear on the head ----------


def surface_grid(name, nu, nv, at, mat, closed_u=True):
    """A grid surface: at(u, v) for u round (closed) and v along."""
    verts, faces = [], []
    cols = nu if closed_u else nu + 1
    for r in range(nv + 1):
        for c in range(cols):
            verts.append(tuple(at(c / nu, r / nv)))
    for r in range(nv):
        for c in range(nu):
            a = r * cols + c
            b = r * cols + (c + 1) % cols if closed_u else a + 1
            faces.append((a, b, b + cols, a + cols))
    obj = lib.mesh_object(name, verts, faces, None, mat)
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in bm.faces:
        f.smooth = True
    bm.to_mesh(obj.data)
    bm.free()
    return obj


def bush_hat(rid):
    felt = lib.material(f"{rid}_hatfelt", hex_rgb("#5a5034"), 0.88)
    band = lib.material(f"{rid}_hatband", hex_rgb("#33251a"), 0.6)
    tooth = lib.material(f"{rid}_tooth", hex_rgb("#efe6cf"), 0.35)
    rx, ry = 0.106, 0.122  # the crown's half width and depth at the band
    z0, z1 = 0.035, 0.168

    def crown(u, v):
        a = u * math.tau
        ca, sa = math.cos(a), math.sin(a)
        if v < 0.7:
            k = v / 0.7
            z = z0 + (z1 - z0) * k
            r = 1 - 0.07 * k
        else:
            k = (v - 0.7) / 0.3
            r = 0.93 * max(0.0, 1 - k) ** 0.7
            # A crease down the middle of the top, pinched in at the front.
            z = z1 + 0.012 * math.sin(k * math.pi) - 0.022 * k ** 1.5
        front = max(0.0, -sa)
        z -= 0.018 * front ** 3 * (v > 0.55) * min(1, (v - 0.55) / 0.15)
        return Vector((rx * r * ca * (1 - 0.12 * front ** 2 * (v > 0.6)), ry * r * sa, z))

    parts = [surface_grid(f"crown_{rid}", 40, 14, crown, felt)]

    def brim(u, v):
        a = u * math.tau
        ca, sa = math.cos(a), math.sin(a)
        r = 1 + v * 0.95
        side = ca ** 2
        z = z0 + 0.004 + (0.04 * side - 0.014 * sa ** 2) * v ** 1.8
        return Vector((rx * r * ca, ry * r * sa * (1 - 0.06 * v), z))

    b = surface_grid(f"brim_{rid}", 48, 6, brim, felt)
    sol = b.modifiers.new("thick", "SOLIDIFY")
    sol.thickness = 0.006
    apply_all(b)
    parts.append(b)
    # The band, and the shark's teeth stuck round it, points up.
    bandmesh = surface_grid(f"band_{rid}", 40, 1, lambda u, v: Vector((rx * 1.03 * math.cos(u * math.tau), ry * 1.03 * math.sin(u * math.tau), z0 + 0.006 + 0.022 * v)), band)
    sol = bandmesh.modifiers.new("thick", "SOLIDIFY")
    sol.thickness = 0.003
    apply_all(bandmesh)
    parts.append(bandmesh)
    n = 24
    for k in range(n):
        a = (k + 0.5) / n * math.tau
        ca, sa = math.cos(a), math.sin(a)
        out = Vector((ca / rx, sa / ry, 0)).normalized()
        base = Vector((rx * 1.06 * ca, ry * 1.06 * sa, z0 + 0.016))
        along = Vector((-sa * rx, ca * ry, 0)).normalized()
        size = 0.85 + 0.3 * ((k * 5) % 3) / 2
        tip = base + Vector((0, 0, 0.034 * size)) + out * 0.004 - along * 0.006 * size
        w = 0.0085 * size
        verts = [tuple(base - along * w), tuple(base + along * w), tuple(base + out * 0.006), tuple(tip)]
        parts.append(lib.mesh_object(f"tooth_{rid}_{k}", verts, [(0, 2, 1), (0, 1, 3), (1, 2, 3), (2, 0, 3)], None, tooth))
    return lib.join(parts, f"head_{rid}")


def cap(rid):
    red = lib.material(f"{rid}_capred", hex_rgb("#c8202a"), 0.62)
    white = lib.material(f"{rid}_capwhite", hex_rgb("#f4f2ec"), 0.6)
    rx, ry, rz = 0.104, 0.126, 0.142

    def rim(a):
        front = (1 - math.sin(a)) / 2  # 1 at the front (-y)
        return -0.03 + 0.085 * front ** 1.5

    def crown(u, v):
        a = u * math.tau
        z = rim(a) + (rz * 0.985 - rim(a)) * v
        h = math.sqrt(max(0.0, 1 - (z / rz) ** 2))
        puff = 1 + 0.07 * math.sin(v * math.pi) * max(0.0, -math.sin(a))
        return Vector((rx * h * math.cos(a) * puff, ry * h * math.sin(a) * puff, z))

    parts = [surface_grid(f"cap_{rid}", 44, 12, crown, red)]
    # The top button.
    parts.append(sphere_at(f"capbutton_{rid}", (0, 0, rz * 0.99), 0.012, red))
    # The peak, out over the eyes and turned down a little.

    def peak(u, v):
        a = math.radians(-160 + 140 * u)
        z = rim(a)
        h = math.sqrt(max(0.0, 1 - (z / rz) ** 2))
        p = Vector((rx * h * math.cos(a), ry * h * math.sin(a), z))
        out = Vector((math.cos(a) * 0.6, math.sin(a), 0)).normalized()
        reach = 0.075 * math.sin(math.pi * u) ** 0.6 * v
        return p + out * reach - Vector((0, 0, 0.18 * reach ** 1.4 * 4))

    pk = surface_grid(f"peak_{rid}", 20, 5, peak, red, closed_u=False)
    sol = pk.modifiers.new("thick", "SOLIDIFY")
    sol.thickness = 0.005
    apply_all(pk)
    parts.append(pk)
    # The white badge with the red M on the front.
    zc = 0.088
    h = math.sqrt(1 - (zc / rz) ** 2)
    centre = Vector((0, -ry * h * 1.07, zc))
    nrm = Vector((0, -1, 0.5)).normalized()
    bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=0.034, depth=0.004, location=tuple(centre))
    disc = bpy.context.active_object
    disc.name = f"badge_{rid}"
    disc.rotation_euler = Vector((0, 0, 1)).rotation_difference(nrm).to_euler()
    disc.data.materials.append(white)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    parts.append(disc)
    m = text_mesh("M", 0.05, red, f"emblem_{rid}")
    bpy.context.view_layer.update()
    m.rotation_euler = (math.pi / 2 - math.atan2(nrm.z, -nrm.y), 0, 0)
    m.location = tuple(centre + nrm * 0.0035)
    bpy.ops.object.select_all(action="DESELECT")
    m.select_set(True)
    bpy.context.view_layer.objects.active = m
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    parts.append(m)
    return lib.join(parts, f"head_{rid}")


def dark_helmet(rid):
    """After the real thing: a dome with a crest from brow to back and a heavy brow over the eyes,
    the flare falling round the sides and back; under the brow the mask: big domed lenses in deep
    sockets, the nose bridge, cheeks swept down to a triangle of grille bars over the mouth with a
    stud at each corner, and below it the chin with its triangle of mesh."""
    gloss = lib.material(f"{rid}_helmet", (0.014, 0.014, 0.017), 0.12, metallic=0.55)
    lens = lib.material(f"{rid}_lens", (0.16, 0.16, 0.18), 0.04, metallic=1.0)
    cheek = lib.material(f"{rid}_cheeks", (0.05, 0.05, 0.056), 0.12, metallic=0.7)
    bars = lib.material(f"{rid}_grille", (0.3, 0.3, 0.32), 0.3, metallic=1.0)
    pale = lib.material(f"{rid}_studs", (0.75, 0.75, 0.74), 0.35)
    mesh_mat = lib.material(f"{rid}_mesh", (0.05, 0.05, 0.055), 0.55, metallic=0.6)
    rx, ry, rz = 0.126, 0.142, 0.152
    ss = lambda x, a, b: clamp01((x - a) / (b - a)) ** 2 * (3 - 2 * clamp01((x - a) / (b - a)))

    def front_of(a):
        return ss(-math.sin(a), 0.62, 0.86)

    def crest(x, z):
        """The raised ridge down the middle, a groove either side of it."""
        ax = abs(x)
        return (0.01 * math.exp(-((x / 0.013) ** 2)) - 0.005 * math.exp(-(((ax - 0.028) / 0.008) ** 2))) * ss(z, 0.0, 0.05)

    def dome(u, v):
        a = u * math.tau
        ca, sa = math.cos(a), math.sin(a)
        f = front_of(a)
        bottom = 0.036 * f
        z = rz * 0.995 - (rz * 0.995 - bottom) * v
        h = math.sqrt(max(0.0, 1 - (z / rz) ** 2))
        x, y = rx * h * ca, ry * h * sa
        out = crest(x, z)
        # The brow: a heavy lip over the eyes, standing out from the dome.
        out += 0.012 * f * ss(-(z - bottom - 0.03), 0.0, 0.03)
        n = Vector((ca / rx, sa / ry, 0)).normalized()
        return Vector((x, y, z)) + n * out

    parts = [surface_grid(f"dome_{rid}", 72, 22, dome, gloss)]

    # The flare: round the sides and back from cheek to cheek, straight down then out.
    def flare(u, v):
        a = math.radians(-48 + 276 * u)
        ca, sa = math.cos(a), math.sin(a)
        f = front_of(a)
        top = 0.036 * f
        z = top - (top + 0.215 - 0.03 * f) * v
        out = 0.008 * v + 0.085 * v ** 2.3
        return Vector((ca * (rx + out), sa * (ry + out), z))

    fl = surface_grid(f"flare_{rid}", 56, 12, flare, gloss, closed_u=False)
    sol = fl.modifiers.new("thick", "SOLIDIFY")
    sol.thickness = 0.006
    apply_all(fl)
    parts.append(fl)

    def mouth_half(z):
        return 0.042 * clamp01((-0.042 - z) / 0.073)

    def mask_y(x, z):
        ax = abs(x)
        chin = ss(-z, 0.118, 0.14)
        # Curving back at the sides under the flare; the lower face jutting forward to the mouth,
        # the chin stepping back under it.
        y = -0.12 + 6.5 * x * x - 0.024 * ss(-z, 0.0, 0.115) + chin * (0.03 - 2.5 * x * x)
        # Deep sockets for the eyes.
        socket = math.exp(-(((ax - 0.041) / 0.027) ** 4) - (((z - 0.006) / 0.021) ** 4))
        y += 0.016 * socket
        # The nose bridge between them, down to the nose.
        y -= 0.009 * math.exp(-((x / 0.011) ** 2)) * ss(z, -0.045, -0.035) * (1 - ss(z, 0.03, 0.04))
        # The cheeks: planes swept down and out from the nose, standing out round the mouth.
        m = mouth_half(z)
        band = ss(z, -0.12, -0.11) * (1 - ss(z, -0.026, -0.012))
        y -= 0.02 * band * ss(ax, m, m + 0.006) * (1 - ss(ax, 0.07, 0.088)) * (0.6 + 0.4 * ss(-z, 0.02, 0.1))
        # The mouth, set back behind its bars.
        y += 0.006 * band * (1 - ss(ax, m - 0.004, m + 0.002)) * (z < -0.042)
        return y

    def mask(u, v):
        z = 0.042 - 0.257 * v
        w = 0.09 - 0.022 * ss(-z, 0.115, 0.145)
        x = (u - 0.5) * 2 * w
        return Vector((x, mask_y(x, z), z))

    mk = surface_grid(f"mask_{rid}", 56, 64, mask, gloss, closed_u=False)
    # The cheek planes catch the light, as in the photographs: a lighter, silvery black.
    mk.data.materials.append(cheek)
    for poly in mk.data.polygons:
        c = poly.center
        m = mouth_half(c.z)
        if -0.118 < c.z < -0.02 and m + 0.004 < abs(c.x) < 0.075:
            poly.material_index = 1
    sol = mk.modifiers.new("thick", "SOLIDIFY")
    sol.thickness = 0.005
    apply_all(mk)
    parts.append(mk)
    # The lenses: domed, almost mirrors, the inner corners a little higher.
    for sx in (-1, 1):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=14, radius=1, location=(sx * 0.041, mask_y(0.041, 0.006) - 0.003, 0.006))
        e = bpy.context.active_object
        e.name = f"lens_{rid}_{sx}"
        e.scale = (0.027, 0.012, 0.02)
        e.rotation_euler = (0, sx * 0.12, -sx * 0.25)
        e.data.materials.append(lens)
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        bpy.ops.object.shade_smooth()
        parts.append(e)
    # Ridges across the bridge of the nose, and the pale nose piece below.
    for k, z in enumerate((0.022, 0.012, 0.002)):
        parts.append(tube_along(f"ridge_{rid}_{k}", [Vector((x, mask_y(x, z) - 0.0035, z)) for x in (-0.008, 0.0, 0.008)], 0.0018, gloss))
    parts.append(oriented_box(f"nose_{rid}", Vector((0, mask_y(0, -0.037) - 0.005, -0.037)), Vector((1, 0, 0)), Vector((0, 0, 1)), Vector((0, -1, 0)), (0.009, 0.008, 0.005), pale, 0.6))
    # The grille: bars down the mouth, a bar along the bottom with a stud at each end.
    for k in range(-3, 4):
        x = k * 0.0095
        top = -0.042 - 0.073 * abs(x) / 0.042 - 0.004
        pts = [Vector((x, mask_y(x, z) - 0.0065, z)) for z in (top + (-0.112 - top) * t / 4 for t in range(5))]
        parts.append(tube_along(f"bar_{rid}_{k}", pts, 0.0021, bars))
    parts.append(tube_along(f"barbottom_{rid}", [Vector((x, mask_y(x, -0.115) - 0.006, -0.115)) for x in (-0.05, -0.025, 0.0, 0.025, 0.05)], 0.003, bars))
    for sx in (-1, 1):
        parts.append(sphere_at(f"stud_{rid}_{sx}", Vector((sx * 0.052, mask_y(0.052, -0.116) - 0.007, -0.116)), 0.005, pale))
    # The chin: a triangle of mesh pointing down.
    tri = [(-0.044, -0.128), (0.044, -0.128), (0.0, -0.182)]
    verts = [tuple(Vector((x, mask_y(x, z) - 0.002, z))) for x, z in tri]
    chin = lib.mesh_object(f"chinmesh_{rid}", verts, [(0, 2, 1)], None, mesh_mat)
    sol = chin.modifiers.new("thick", "SOLIDIFY")
    sol.thickness = 0.002
    apply_all(chin)
    parts.append(chin)
    for k in range(1, 6):
        z = -0.128 - 0.054 * k / 6
        half = 0.044 * (1 - k / 6)
        parts.append(tube_along(f"meshline_{rid}_{k}", [Vector((x, mask_y(x, z) - 0.0035, z)) for x in (-half, 0.0, half)], 0.0009, bars))
    return lib.join(parts, f"head_{rid}")


HEADWEAR = {"bushhat": bush_hat, "cap": cap, "mask": dark_helmet}
