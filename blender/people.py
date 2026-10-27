"""
The visitors and spectators beside the run, as parts the game can animate: for each kind of person
(man, mother, child, oldLady, furGirl) a torso, a leg, an arm and a head, plus hats, scarves and the
old lady's stick as separate pieces; and the dog's body, head, leg and tail. The game puts two legs
at the hips and two arms at the shoulders, swings them as people walk or run, and colours each
piece from its material name (pp_coat, pp_trousers, pp_boots, pp_skin, pp_hair, pp_hat, pp_scarf,
pp_dark): so every visitor wears their own colours.

All at the scale of a 1.75 m adult, facing +X, z up (the game scales them). Origins:
  <kind>_torso  at the hips (0.92 m up), the coat from its hem up to the neck;
  <kind>_leg    at the hip joint, hanging down to the boot sole (-0.92);
  <kind>_arm    at the shoulder, hanging down to the hand;
  <kind>_head   at the centre of the head (0.66 above the hips), with face and hair;
  <kind>_hat, <kind>_scarf, oldLady_stick  likewise on the head, the neck and the hand.
Exported to public/models/people.glb.
"""

import math

import bmesh
import bpy
from mathutils import Vector

import lib

lib.reset()
COLL = lib.collection("people")

ZONES = ["coat", "trousers", "boots", "skin", "hair", "hat", "scarf", "dark"]
M = {z: lib.material(f"pp_{z}", (0.7, 0.7, 0.7), 0.8) for z in ZONES}


def apply_all(obj, smooth=True):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    for m in list(obj.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)
    if smooth:
        bpy.ops.object.shade_smooth()


def chain(name, points, zone, sx=1.0, levels=1, edges=None):
    """A smooth tube along points [(x, y, z, radius)] (skin modifier), squashed front-to-back by sx;
    `edges` joins the points otherwise than in a line (branches)."""
    me = bpy.data.meshes.new(name)
    me.from_pydata([p[:3] for p in points], edges or [(i, i + 1) for i in range(len(points) - 1)], [])
    obj = bpy.data.objects.new(name, me)
    COLL.objects.link(obj)
    obj.modifiers.new("skin", "SKIN")
    for i, p in enumerate(points):
        obj.data.skin_vertices[0].data[i].radius = (p[3], p[3])
    obj.data.skin_vertices[0].data[0].use_root = True
    obj.modifiers.new("smooth", "SUBSURF").levels = levels
    apply_all(obj)
    if sx != 1.0:
        for v in obj.data.vertices:
            v.co.x *= sx
    obj.data.materials.append(M[zone])
    return obj


def ellipsoid(name, centre, size, zone, keep=None, segments=20, rings=12):
    """A UV sphere scaled to `size` radii; `keep(co)` (in the sphere's unit frame) trims it."""
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, radius=1.0, location=(0, 0, 0))
    obj = bpy.context.active_object
    obj.name = name
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    COLL.objects.link(obj)
    if keep:
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not keep(v.co)], context="VERTS")
        bm.to_mesh(obj.data)
        bm.free()
    for v in obj.data.vertices:
        v.co = Vector((v.co.x * size[0] + centre[0], v.co.y * size[1] + centre[1], v.co.z * size[2] + centre[2]))
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.shade_smooth()
    obj.data.materials.append(M[zone])
    return obj


def ring(name, centre, radius, tube, zone, scale_x=1.0):
    bpy.ops.mesh.primitive_torus_add(major_radius=radius, minor_radius=tube, major_segments=20, minor_segments=8, location=centre)
    obj = bpy.context.active_object
    obj.name = name
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    COLL.objects.link(obj)
    for v in obj.data.vertices:
        v.co.x = (v.co.x - centre[0]) * scale_x + centre[0]
    bpy.ops.object.shade_smooth()
    obj.data.materials.append(M[zone])
    return obj


def box(name, centre, half, zone, bevel=0.3):
    bpy.ops.mesh.primitive_cube_add(size=2, location=(0, 0, 0))
    obj = bpy.context.active_object
    obj.name = name
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    COLL.objects.link(obj)
    for v in obj.data.vertices:
        v.co = Vector((v.co.x * half[0] + centre[0], v.co.y * half[1] + centre[1], v.co.z * half[2] + centre[2]))
    b = obj.modifiers.new("bevel", "BEVEL")
    b.width = min(half) * bevel * 2
    b.segments = 3
    apply_all(obj)
    obj.data.materials.append(M[zone])
    return obj


def join(objs, name):
    obj = lib.join(objs, name)
    return obj


def person(kind, coat_length, fur=False, long_hair=False, hat="beanie", scarf=False, glasses=False, stick=False, puffy=False):
    out = []
    bulk = 1.12 if fur else 1.08 if puffy else 1.0
    # Leg: trousers to the ankle, a boot on the end. Long coats cover the top of it anyway.
    leg = chain(f"{kind}_leg_tr", [(0, 0, 0, 0.065), (0.012, 0, -0.43, 0.056), (0, 0, -0.8, 0.047)], "trousers")
    boot = box(f"{kind}_leg_boot", (0.035, 0, -0.865), (0.12, 0.052, 0.055), "boots", bevel=0.6)
    shaft = chain(f"{kind}_leg_shaft", [(0, 0, -0.84, 0.052), (0, 0, -0.7, 0.05)], "boots")
    out.append(join([leg, boot, shaft], f"{kind}_leg"))
    # Torso: the coat from its hem to the collar, flaring below the waist for a long coat.
    hem = -0.25 - coat_length * 0.38
    r = lambda x: x * bulk
    # Spine from the hem up to the collar, branching out to the shoulders.
    pts = [(0, 0, hem, r(0.15 + coat_length * 0.07)), (0, 0, -0.05, r(0.14)), (0, 0, 0.15, r(0.137)), (0, 0, 0.36, r(0.15)), (0, 0, 0.47, r(0.1)), (0, 0, 0.53, 0.055),
           (0, 0.15, 0.44, r(0.07)), (0, -0.15, 0.44, r(0.07))]
    edges = [(0, 1), (1, 2), (2, 3), (3, 4), (4, 5), (3, 6), (3, 7)]
    coat = chain(f"{kind}_coat", pts, "coat", sx=0.78, levels=2, edges=edges)
    parts = [coat]
    if puffy:
        for z in (0.0, 0.18, 0.33):
            parts.append(ring(f"{kind}_quilt{z}", (0, 0, z), r(0.138) * 1.0, 0.012, "coat", scale_x=0.78))
    if fur:
        parts.append(ring(f"{kind}_collar", (0, 0, 0.49), 0.1, 0.058, "coat", scale_x=0.9))
    # Buttons or a zip down the front.
    for k in range(4):
        z = 0.38 - k * 0.12
        if z > hem + 0.05:
            parts.append(ellipsoid(f"{kind}_button{k}", (0.115 * bulk * 0.78 + 0.005, 0, z), (0.012, 0.012, 0.012), "dark", segments=8, rings=6))
    neck = chain(f"{kind}_neck", [(0, 0, 0.5, 0.045), (0, 0, 0.6, 0.042)], "skin")
    parts.append(neck)
    out.append(join(parts, f"{kind}_torso"))
    if scarf:
        s1 = ring(f"{kind}_scarf_ring", (0, 0, 0.53), 0.075, 0.032, "scarf", scale_x=0.9)
        tail = box(f"{kind}_scarf_tail", (0.085, 0.04, 0.4), (0.012, 0.035, 0.11), "scarf", bevel=0.5)
        out.append(join([s1, tail], f"{kind}_scarf"))
    # Arm: sleeve to the wrist (cuffed), a gloved hand.
    arm_r = 0.05 * bulk
    sleeve = chain(f"{kind}_sleeve", [(0, 0, 0.02, arm_r * 1.05), (0.01, 0, -0.29, arm_r * 0.92), (0.03, 0, -0.55, arm_r * 0.85)], "coat")
    hand = chain(f"{kind}_hand", [(0.03, 0, -0.53, 0.034), (0.04, 0, -0.62, 0.031)], "skin")
    thumb = chain(f"{kind}_thumb", [(0.04, 0, -0.55, 0.013), (0.06, 0, -0.6, 0.011)], "skin")
    arm_parts = [sleeve, hand, thumb]
    if fur:
        arm_parts.append(ring(f"{kind}_armcuff", (0.03, 0, -0.52), arm_r * 0.9, 0.025, "coat"))
    out.append(join(arm_parts, f"{kind}_arm"))
    # Head: the face (nose, ears, eyes, brows), hair, glasses.
    head = ellipsoid(f"{kind}_skull", (0, 0, 0), (0.1, 0.095, 0.118), "skin")
    nose = ellipsoid(f"{kind}_nose", (0.098, 0, -0.01), (0.022, 0.016, 0.026), "skin", segments=10, rings=8)
    ears = [ellipsoid(f"{kind}_ear{s}", (0.0, s * 0.094, 0.0), (0.018, 0.012, 0.028), "skin", segments=10, rings=8) for s in (-1, 1)]
    eyes = [ellipsoid(f"{kind}_eye{s}", (0.088, s * 0.034, 0.02), (0.01, 0.013, 0.011), "dark", segments=8, rings=6) for s in (-1, 1)]
    brows = [box(f"{kind}_brow{s}", (0.093, s * 0.036, 0.045), (0.006, 0.02, 0.005), "hair", bevel=0.4) for s in (-1, 1)]
    mouth = box(f"{kind}_mouth", (0.094, 0, -0.05), (0.005, 0.022, 0.004), "dark", bevel=0.4)
    # Hair: a cap over the crown and back, leaving the face; longer hair falls down the back.
    hair = ellipsoid(f"{kind}_hair", (-0.01, 0, 0.012), (0.108, 0.102, 0.122), "hair", keep=lambda c: c.z > -0.25 and not (c.x > 0.3 and c.z < 0.55))
    parts = [head, nose, *ears, *eyes, *brows, mouth, hair]
    if long_hair:
        parts.append(ellipsoid(f"{kind}_fall", (-0.055, 0, -0.1), (0.07, 0.105, 0.17), "hair"))
    if glasses:
        parts.append(box(f"{kind}_glasses", (0.098, 0, 0.022), (0.01, 0.075, 0.018), "dark", bevel=0.4))
    out.append(join(parts, f"{kind}_head"))
    if hat == "beanie":
        cap = ellipsoid(f"{kind}_cap", (-0.005, 0, 0.03), (0.113, 0.108, 0.115), "hat", keep=lambda c: c.z > 0.15)
        rim = ring(f"{kind}_rim", (-0.005, 0, 0.045), 0.104, 0.018, "hat")
        bobble = ellipsoid(f"{kind}_bobble", (-0.005, 0, 0.15), (0.03, 0.03, 0.03), "hat", segments=10, rings=8)
        out.append(join([cap, rim, bobble], f"{kind}_hat"))
    elif hat == "beret":
        out.append(ellipsoid(f"{kind}_hat", (-0.02, 0.01, 0.1), (0.12, 0.115, 0.04), "hat"))
    elif hat == "fur":
        bpy.ops.mesh.primitive_cylinder_add(vertices=20, radius=0.122, depth=0.15, location=(0, 0, 0.1))
        cyl = bpy.context.active_object
        cyl.name = f"{kind}_hat"
        for c in list(cyl.users_collection):
            c.objects.unlink(cyl)
        COLL.objects.link(cyl)
        b = cyl.modifiers.new("bevel", "BEVEL")
        b.width = 0.03
        b.segments = 3
        apply_all(cyl)
        cyl.data.materials.append(M["hat"])
        out.append(cyl)
    if stick:
        out.append(chain(f"{kind}_stick", [(0.04, 0, -0.58, 0.012), (0.2, 0, -1.4, 0.011)], "dark"))
    return out


def dog():
    out = []
    body = chain("dog_trunk", [(-0.28, 0, 0.44, 0.1), (-0.05, 0, 0.45, 0.13), (0.2, 0, 0.47, 0.12), (0.3, 0, 0.53, 0.07)], "coat", levels=2)
    tail = chain("dog_tail", [(0, 0, 0, 0.03), (-0.08, 0, 0.12, 0.022), (-0.1, 0, 0.26, 0.012)], "coat")
    out.append(body)
    out.append(lib.join([tail], "dog_tail"))
    skull = ellipsoid("dog_skull", (0, 0, 0), (0.1, 0.085, 0.09), "coat")
    snout = chain("dog_snout", [(0.05, 0, -0.02, 0.05), (0.15, 0, -0.04, 0.035)], "coat")
    nose = ellipsoid("dog_nose", (0.175, 0, -0.035), (0.018, 0.02, 0.016), "dark", segments=8, rings=6)
    eyes = [ellipsoid(f"dog_eye{s}", (0.07, s * 0.045, 0.03), (0.012, 0.012, 0.012), "dark", segments=8, rings=6) for s in (-1, 1)]
    ears = [box(f"dog_ear{s}", (-0.01, s * 0.07, 0.03), (0.02, 0.012, 0.055), "coat", bevel=0.5) for s in (-1, 1)]
    for e, s in zip(ears, (-1, 1)):
        e.rotation_euler = (s * 0.5, 0, 0)
        e.location = (0, 0, 0)
        apply_rot(e)
    out.append(lib.join([skull, snout, nose, *eyes, *ears], "dog_head"))
    out.append(chain("dog_leg", [(0, 0, 0, 0.04), (0.01, 0, -0.18, 0.033), (0.0, 0, -0.33, 0.028), (0.03, 0, -0.36, 0.03)], "coat"))
    return out


def apply_rot(obj):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)


objs = []
objs += person("man", 0.1, hat="beanie", scarf=True)
objs += person("mother", 0.5, long_hair=True, hat="beanie")
objs += person("child", 0.1, hat="beanie", puffy=True)
objs += person("oldLady", 0.8, hat="beret", scarf=True, stick=True)
objs += person("furGirl", 0.85, fur=True, long_hair=True, hat="fur", glasses=True)
objs += dog()

# A preview: one of each, assembled, coloured.
preview_cols = {"coat": (0.2, 0.25, 0.35), "trousers": (0.12, 0.12, 0.14), "boots": (0.2, 0.13, 0.08), "skin": (0.9, 0.72, 0.6), "hair": (0.35, 0.22, 0.12), "hat": (0.6, 0.1, 0.1), "scarf": (0.8, 0.65, 0.2), "dark": (0.03, 0.03, 0.03)}
for z, c in preview_cols.items():
    M[z].node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (*c, 1)
temp = []
for i, kind in enumerate(("man", "mother", "child", "oldLady", "furGirl")):
    x = 0
    y = (i - 2) * 0.9
    k = 0.65 if kind == "child" else 1.0
    for name, loc in ((f"{kind}_torso", (0, 0, 0.92)), (f"{kind}_head", (0, 0, 0.92 + 0.66)), (f"{kind}_hat", (0, 0, 0.92 + 0.66)), (f"{kind}_scarf", (0, 0, 0.92)),
                      (f"{kind}_leg", (0, 0.09, 0.92)), (f"{kind}_leg", (0, -0.09, 0.92)), (f"{kind}_arm", (0, 0.19, 0.92 + 0.47)), (f"{kind}_arm", (0, -0.19, 0.92 + 0.47))):
        src = bpy.data.objects.get(name)
        if not src:
            continue
        dup = src.copy()
        COLL.objects.link(dup)
        dup.location = (x, y + loc[1] * k, loc[2] * k)
        dup.scale = (k, k, k)
        temp.append(dup)
for o in objs:
    if o.name.startswith("dog_"):
        o.location = (0, 3.5, 0)
lib.preview("people.png", (3.2, -1.2, 1.3), (0, 0, 1.0), size=(1200, 700), lens=40, sky=(0.35, 0.55, 0.9))
for d in temp:
    bpy.data.objects.remove(d)
for o in objs:
    o.location = (0, 0, 0)
for z in ZONES:
    M[z].node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.7, 0.7, 0.7, 1)
result = {"export": lib.export_glb("people.glb", objs), "objects": [o.name for o in objs]}
