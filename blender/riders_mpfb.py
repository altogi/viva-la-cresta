"""
The three riders on real human bodies, made with MPFB (MakeHuman for Blender): each body generated
from MakeHuman's sliders to match the character (Maximilian young, tall and thin; Adelaide; Remo
fifty and burly), scaled to the game's height for the rider, and given the kit from riders.py
(zones of colour, the back stripe, Cresta boots, Remo's cable-knit and lederhosen).

The head is the game's own (face, hair, helmet), so the body stops at the neck; the feet go into
the boots. MPFB's game rig (about fifty bones) is folded into the sixteen bones the game turns
(hips, spine, chest, neck, upperarm, forearm, hand, thigh, shin, foot), keeping MakeHuman's weights.

Exported to public/models/riders.glb as before: rider_<id> (armature) with body_<id>, A pose,
facing -Y, feet on z = 0.
"""

import math
import os

import bmesh
import bpy
from mathutils import Vector

import lib

RIDERS_LIBRARY = True
exec(open(os.path.join(lib.ROOT, "blender", "riders.py")).read())

from bl_ext.user_default.mpfb.services.humanservice import HumanService  # noqa: E402
from bl_ext.user_default.mpfb.services.targetservice import TargetService  # noqa: E402

CAUCASIAN = {"asian": 0.0, "caucasian": 1.0, "african": 0.0}
# Shape targets on top of the macros: Remo's belly, from a lifetime of afternoons with a beer.
DETAILS = {
    "adelaide": {"nipple-point-decr": 1.0, "nipple-size-decr": 1.0, "breast-point-decr": 0.6},
    "remo": {"stomach-pregnant-incr": 1.0, "stomach-tone-decr": 0.8, "stomach-navel-down": 0.5, "torso-vshape-decr": 0.6, "torso-scale-depth-incr": 0.45, "torso-scale-horiz-incr": 0.25},
}

MACROS = {
    # German, 20: thin and lanky.
    "maximilian": {"gender": 1.0, "age": 0.44, "muscle": 0.55, "weight": 0.3, "proportions": 0.7, "height": 0.5, "cupsize": 0.5, "firmness": 0.5, "race": CAUCASIAN},
    # English, 25: slim and athletic.
    "adelaide": {"gender": 0.0, "age": 0.5, "muscle": 0.55, "weight": 0.42, "proportions": 0.7, "height": 0.5, "cupsize": 0.28, "firmness": 0.7, "race": CAUCASIAN},
    # Swiss, 50: burly.
    "remo": {"gender": 1.0, "age": 0.69, "muscle": 0.75, "weight": 1.0, "proportions": 0.35, "height": 0.5, "cupsize": 0.5, "firmness": 0.5, "race": CAUCASIAN},
}


def our_bone(mpfb_bone):
    """The game bone an MPFB game-engine bone's weight goes to."""
    side = ""
    base = mpfb_bone
    if mpfb_bone.endswith("_l") or mpfb_bone.endswith("_r"):
        side = ".L" if mpfb_bone.endswith("_l") else ".R"
        base = mpfb_bone[:-2]
    base = base.rstrip("_0123456789")
    table = {
        "Root": "hips", "pelvis": "hips", "spine": "spine", "neck": "neck", "head": "neck",
        "clavicle": "chest", "upperarm": "upperarm", "lowerarm": "forearm", "hand": "hand",
        "index": "hand", "middle": "hand", "ring": "hand", "pinky": "hand", "thumb": "hand",
        "thigh": "thigh", "calf": "shin", "foot": "foot", "ball": "foot",
    }
    name = table.get(base)
    if name is None:
        return None
    if mpfb_bone == "spine_03":
        return "chest"
    return name + side if name not in ("hips", "spine", "chest", "neck") else name


def make_body(look):
    rid = look["id"]
    s = look["scale"]
    human = HumanService.create_human(macro_detail_dict=MACROS[rid])
    for target, weight in DETAILS.get(rid, {}).items():
        TargetService.load_target(human, TargetService.target_full_path(target), weight=weight, name=target)
    rig = HumanService.add_builtin_rig(human, "game_engine")
    bpy.ops.object.select_all(action="DESELECT")
    human.select_set(True)
    bpy.context.view_layer.objects.active = human
    TargetService.bake_targets(human)
    for m in list(human.modifiers):
        if m.type == "MASK":
            bpy.ops.object.modifier_apply(modifier=m.name)
        else:
            human.modifiers.remove(m)
    human.parent = None
    mw = human.matrix_world.copy()
    for v in human.data.vertices:
        v.co = mw @ v.co
    human.matrix_world.identity()
    bones = {b.name: (rig.matrix_world @ b.head_local, rig.matrix_world @ b.tail_local) for b in rig.data.bones}
    bpy.data.objects.remove(rig)

    # The game's height for the rider (head included), then the joints the game skeleton uses.
    top = max(v.co.z for v in human.data.vertices)
    k = 1.75 * s / top
    for v in human.data.vertices:
        v.co *= k
    head = lambda n: bones[n][0] * k
    tail = lambda n: bones[n][1] * k
    j = {
        "pelvis": head("pelvis"),
        "waist": head("spine_02"),
        "chest": head("spine_03"),
        "neck": head("neck_01"),
        "neck_top": head("head"),
    }
    j["upper_chest"] = j["chest"].lerp(j["neck"], 0.55)
    for side, sfx in (("L", "_l"), ("R", "_r")):
        j[f"shoulder_{side}"] = head("upperarm" + sfx)
        j[f"elbow_{side}"] = head("lowerarm" + sfx)
        j[f"wrist_{side}"] = head("hand" + sfx)
        j[f"hand_{side}"] = head("middle_01" + sfx)
        j[f"fingers_{side}"] = tail("middle_03" + sfx)
        j[f"hip_{side}"] = head("thigh" + sfx)
        j[f"knee_{side}"] = head("calf" + sfx)
        j[f"ankle_{side}"] = head("foot" + sfx)
        j[f"toe_{side}"] = tail("ball" + sfx)
    if rid == "remo":
        j["belt"] = j["pelvis"] + Vector((0, 0, 0.045 * s))  # under the belly
    j = {n: tuple(p) for n, p in j.items()}
    j["boots_from_feet"] = True

    # MakeHuman's weights, folded into the game's bones.
    names = {g.index: g.name for g in human.vertex_groups}
    nipples = set()
    for g in ("nipple", "nippleTip", "genitals"):
        if g in [n for n in names.values()]:
            gi = [i for i, n in names.items() if n == g][0]
            nipples |= {v.index for v in human.data.vertices if any(x.group == gi and x.weight > 0.1 for x in v.groups)}
    weights = [dict() for _ in human.data.vertices]
    for v in human.data.vertices:
        for g in v.groups:
            target = our_bone(names[g.group])
            if target and g.weight > 0:
                weights[v.index][target] = weights[v.index].get(target, 0) + g.weight
    head_weight = []
    foot_weight = []
    for v in human.data.vertices:
        w = {names[g.group]: g.weight for g in v.groups}
        head_weight.append(w.get("head", 0))
        foot_weight.append(w.get("foot_l", 0) + w.get("ball_l", 0) + w.get("foot_r", 0) + w.get("ball_r", 0))
    for g in list(human.vertex_groups):
        human.vertex_groups.remove(g)
    groups = {}
    for v in human.data.vertices:
        total = sum(weights[v.index].values()) or 1
        for name, w in weights[v.index].items():
            if name not in groups:
                groups[name] = human.vertex_groups.new(name=name)
            groups[name].add([v.index], w / total, "REPLACE")

    # The game's head goes on the neck; the feet go into the boots.
    neck_cut = j["neck_top"][2] - 0.01 * s
    doomed = {v.index for v in human.data.vertices if head_weight[v.index] > 0.45 or v.co.z > neck_cut}
    # The foot and the bottom of the shin, which the boot's shaft covers.
    feet = {v.index for v in human.data.vertices if (foot_weight[v.index] > 0.25 and v.co.z < j["ankle_L"][2] + 0.06 * s) or v.co.z < j["ankle_L"][2] + 0.11 * s}
    bm = bmesh.new()
    bm.from_mesh(human.data)
    bm.verts.ensure_lookup_table()
    # A suit lies flat over the chest.
    if nipples:
        grown = set(nipples)
        for _ in range(6):
            for i in list(grown):
                for e in bm.verts[i].link_edges:
                    grown.add(e.other_vert(bm.verts[i]).index)
        for _ in range(25):
            bmesh.ops.smooth_vert(bm, verts=[bm.verts[i] for i in grown], factor=1.0, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    # Nor does a racing suit show anything between the legs: smooth the front of the crotch.
    pz = j["pelvis"][2]
    crotch = [v for v in bm.verts if abs(v.co.x) < 0.075 * s and pz - 0.17 * s < v.co.z < pz + 0.01 * s and v.co.y < j["pelvis"][1] + 0.03 * s]
    for _ in range(20):
        bmesh.ops.smooth_vert(bm, verts=crotch, factor=0.7, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    # The boots: each foot wrapped in a smooth shell (its convex hull, rounded), so the boot follows
    # the real foot and ankle but has a toe box and a heel instead of toes. The foot inside goes.
    boots = {}
    for side, sx in (("L", 1), ("R", -1)):
        pts = [bm.verts[i].co.copy() for i in feet if bm.verts[i].co.x * sx > 0]
        hull_bm = bmesh.new()
        for p in pts:
            hull_bm.verts.new((p.x, p.y, max(p.z, 0.012 * s)))
        bmesh.ops.convex_hull(hull_bm, input=hull_bm.verts)
        loose = [v for v in hull_bm.verts if not v.link_faces]
        bmesh.ops.delete(hull_bm, geom=loose, context="VERTS")
        me = bpy.data.meshes.new(f"boot_{rid}_{side}")
        hull_bm.to_mesh(me)
        hull_bm.free()
        obj = bpy.data.objects.new(f"boot_{rid}_{side}", me)
        bpy.context.scene.collection.objects.link(obj)
        # Rounded off: remeshed to an even skin and smoothed, a little fuller than the foot.
        rem = obj.modifiers.new("even", "REMESH")
        rem.mode = "VOXEL"
        rem.voxel_size = 0.009 * s
        sm = obj.modifiers.new("round", "SMOOTH")
        sm.factor = 0.8
        sm.iterations = 12
        disp = obj.modifiers.new("fuller", "DISPLACE")
        disp.strength = 0.005 * s
        dec = obj.modifiers.new("lighter", "DECIMATE")
        dec.ratio = 0.35
        apply_all(obj)
        boots[side] = obj
    ankle_top = j["ankle_L"][2] + 0.09 * s
    doomed |= {i for i in feet if bm.verts[i].co.z < ankle_top}
    bmesh.ops.delete(bm, geom=[bm.verts[i] for i in doomed], context="VERTS")
    bm.to_mesh(human.data)
    bm.free()
    human.name = f"body_{rid}"
    human.data.name = f"body_{rid}"
    if human.data.shape_keys:
        human.shape_key_clear()
    for slot in list(human.data.materials):
        pass
    human.data.materials.clear()
    bpy.ops.object.select_all(action="DESELECT")
    human.select_set(True)
    bpy.context.view_layer.objects.active = human
    bpy.ops.object.shade_smooth()
    return human, j, boots


def smooth_zones(body, passes=4):
    """Straighten the seams: a face whose neighbours mostly wear another colour takes that one."""
    bm = bmesh.new()
    bm.from_mesh(body.data)
    for _ in range(passes):
        change = []
        for f in bm.faces:
            count = {}
            for e in f.edges:
                for g in e.link_faces:
                    if g is not f:
                        count[g.material_index] = count.get(g.material_index, 0) + 1
            if count:
                best = max(count, key=count.get)
                if best != f.material_index and count[best] > count.get(f.material_index, 0) + 1:
                    change.append((f, best))
        for f, m in change:
            f.material_index = m
    bm.to_mesh(body.data)
    bm.free()


def sole_and_rakes(rid, side, body, j, s, sole_mat, steel):
    """Under each boot, a sole following the foot's outline, and the steel rakes over the toe."""
    sx = 1 if side == "L" else -1
    ankle = Vector(j[f"ankle_{side}"])
    pts = [v.co for v in body.data.vertices if v.co.z < 0.04 * s]
    x0, x1 = min(p.x for p in pts), max(p.x for p in pts)
    y0, y1 = min(p.y for p in pts), max(p.y for p in pts)
    X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    parts = [rounded_box(f"sole_{rid}_{side}", (cx, cy, 0.009 * s), (X, Y, Z), ((x1 - x0) / 2 + 0.006, (y1 - y0) / 2 + 0.008, 0.009 * s), sole_mat, bevel=0.5)]
    toe = y0 - 0.004
    parts.append(rounded_box(f"rakeplate_{rid}_{side}", (cx, toe + 0.016 * s, 0.03 * s), (X, Y, Z), ((x1 - x0) * 0.4, 0.02 * s, 0.004 * s), steel, bevel=0.3))
    for k in range(5):
        tx = cx + (k - 2) * (x1 - x0) * 0.17
        parts.append(lib.mesh_object(f"tooth_{rid}_{side}_{k}", [(tx - 0.005 * s, toe, 0.03 * s), (tx + 0.005 * s, toe, 0.03 * s), (tx, toe - 0.014 * s, 0.012 * s), (tx, toe + 0.008 * s, 0.026 * s)], [(0, 1, 2), (1, 3, 2), (3, 0, 2), (0, 3, 1)], None, steel))
    return lib.join(parts, f"soles_{rid}_{side}")


def build_mpfb(look):
    rid = look["id"]
    s = look["scale"]
    body, j, boots = make_body(look)
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
    # Each face on the bone that moves it most (MakeHuman's weights), so the seams of the kit fall
    # along the joints: the shoulder, the top of the leg.
    gname = {g.index: g.name for g in body.vertex_groups}
    for poly in body.data.polygons:
        pull = {}
        for vi in poly.vertices:
            for g in body.data.vertices[vi].groups:
                pull[gname[g.group]] = pull.get(gname[g.group], 0) + g.weight
        bone = max(pull, key=pull.get) if pull else None
        poly.material_index = order.index(zone_of(body.matrix_world @ poly.center, poly.normal, j, look, bone))
    smooth_zones(body)

    parts = []
    surf = Surface(body)
    if o.get("lettering"):
        # "CRESTA RUN" across the chest, on the surface.
        z = j["upper_chest"][2] - 0.01 * s  # high across the chest, above the bust
        hit = surf.hit((0, -1, z), (0, 1, 0), 0.004)
        width = 0
        for x in (0.05, 0.1, 0.15, 0.2):
            if surf.hit((x, -1, z), (0, 1, 0), 0) and surf.hit((x, -1, z), (0, 1, 0), 0)[0].y < (hit[0].y + 0.04 if hit else 0):
                width = x
        letters = text_mesh("CRESTA RUN", min(0.05 * s, 0.85 * 2 * max(width, 0.08) / 6.2), lib.material(f"{rid}_lettering", hex_rgb(o["lettering"]), 0.5), f"letters_{rid}")
        if hit:
            letters.location = (0, hit[0].y - 0.002, z)
        parts.append(letters)
    sole_mat = lib.material(f"{rid}_sole", (0.05, 0.045, 0.04), 0.8)
    steel = lib.material(f"{rid}_rakes", (0.7, 0.72, 0.75), 0.3, metallic=0.9)
    extremities = []
    for side in "LR":
        boots[side].data.materials.append(mats["boots"])
        extremities.append((boots[side], f"foot.{side}"))
        extremities.append((sole_and_rakes(rid, side, boots[side], j, s, sole_mat, steel), f"foot.{side}"))
    kit = remo_kit(rid, j, s, look, body, mats) if rid == "remo" else []

    arm_data = bpy.data.armatures.new(f"rig_{rid}")
    rig = bpy.data.objects.new(f"rider_{rid}", arm_data)
    bpy.context.scene.collection.objects.link(rig)
    bpy.ops.object.select_all(action="DESELECT")
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    for name, a, b, parent in BONES:
        bone = arm_data.edit_bones.new(name)
        bone.head = j[a]
        bone.tail = j[b]
        if parent:
            bone.parent = arm_data.edit_bones[parent]
            bone.use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")
    for d in parts:
        d.vertex_groups.new(name="chest").add(list(range(len(d.data.vertices))), 1.0, "REPLACE")
    for obj, bone in extremities:
        obj.vertex_groups.new(name=bone).add(list(range(len(obj.data.vertices))), 1.0, "REPLACE")
    for obj in kit:
        weight_nearest(obj, j)
    mesh = lib.join([body, *parts, *(x for x, _ in extremities), *kit], f"body_{rid}")
    mesh.parent = rig
    mod = mesh.modifiers.new("Armature", "ARMATURE")
    mod.object = rig
    return rig, mesh


lib.reset()
rigs, meshes = [], []
for rid in ("maximilian", "adelaide", "remo"):
    rig, mesh = build_mpfb(LOOKS[rid])
    rigs.append(rig)
    meshes.append(mesh)
for i, rig in enumerate(rigs):
    rig.location = (i * 1.1 - 1.1, 0, 0)
lib.preview("riders.png", (2.2, -4.2, 1.3), (0, 0, 0.95), size=(1200, 900), lens=45, sky=(0.35, 0.55, 0.9))
lib.preview("riders_back.png", (-1.6, 4.4, 1.4), (0, 0, 0.95), size=(1200, 900), lens=45, sky=(0.35, 0.55, 0.9))
for rig in rigs:
    rig.location = (0, 0, 0)
result = {"export": lib.export_glb("riders.glb", rigs + meshes), "verts": {m.name: len(m.data.vertices) for m in meshes}, "groups": {m.name: sorted(g.name for g in m.vertex_groups) for m in meshes}}
