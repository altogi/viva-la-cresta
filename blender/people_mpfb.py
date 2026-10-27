"""
The visitors and spectators beside the run on real human bodies, made with MPFB (MakeHuman for
Blender) and the MakeHuman system assets (CC0): each kind of person generated from the sliders
(age, sex, weight), with a MakeHuman skin, eyes, eyebrows and hair, a base outfit and boots from
the pack, and over them the winter layer made here on the body itself:

  man      - puffer jacket (quilted), beanie, scarf, gloves, jeans and boots;
  gent     - long dark wool coat, scarf, fedora;
  mother   - wool coat to the knee, beanie, long hair;
  child    - puffer jacket, beanie, gloves;
  oldLady  - long wool coat, beret, scarf, grey bob (and her stick, in the game);
  furGirl  - long fur coat, fur hat, sunglasses, long blonde hair.

The low-poly MakeHuman body is used (about 1,600 vertices) and everything is decimated and the
textures shrunk, as there are dozens of them on screen at once. Coats, hats, scarves and gloves
carry plain materials named pp_coat, pp_hat, pp_scarf, pp_gloves for the game to colour.

Rigged like the riders, on the game's sixteen bones (MakeHuman's weights folded in). Exported to
public/models/people.glb as person_<kind> (armature) with pbody_<kind>, A pose, facing -Y, feet on
z = 0; plus the dog's parts from blender/people.py.
"""

import math
import os

import bmesh
import bpy
from mathutils import Vector, kdtree

import lib

RIDERS_LIBRARY = True
exec(open(os.path.join(lib.ROOT, "blender", "riders.py")).read())

from bl_ext.user_default.mpfb.services.humanservice import HumanService  # noqa: E402
from bl_ext.user_default.mpfb.services.locationservice import LocationService  # noqa: E402
from bl_ext.user_default.mpfb.services.targetservice import TargetService  # noqa: E402

DATA = LocationService.get_user_data()
asset = lambda *p: os.path.join(DATA, *p)
WHITE = {"asian": 0.0, "caucasian": 1.0, "african": 0.0}

PEOPLE = {
    "man": dict(macro=dict(gender=1.0, age=0.56, muscle=0.55, weight=0.6, proportions=0.5), skin="middleage_caucasian_male", hair="short02", brows="eyebrow003",
                outfit="male_casualsuit01", shoes="shoes03", coat=("puffer", 0.0), hat="beanie", scarf=True, gloves=True),
    "gent": dict(macro=dict(gender=1.0, age=0.64, muscle=0.5, weight=0.5, proportions=0.6), skin="middleage_caucasian_male", hair="short04", brows="eyebrow004",
                 outfit="male_elegantsuit01", shoes="shoes01", coat=("wool", 0.55), hat="fedora01", scarf=True, gloves=False),
    "mother": dict(macro=dict(gender=0.0, age=0.47, muscle=0.5, weight=0.5, proportions=0.6), skin="young_caucasian_female", hair="long01", brows="eyebrow001",
                   outfit="female_casualsuit01", shoes="shoes03", coat=("wool", 0.5), hat="beanie", scarf=False, gloves=True),
    "child": dict(macro=dict(gender=0.5, age=0.13, muscle=0.5, weight=0.55, proportions=0.5), skin="young_caucasian_male", hair="short01", brows="eyebrow002",
                  outfit="male_casualsuit06", shoes="shoes03", coat=("puffer", 0.0), hat="beanie", scarf=False, gloves=True),
    "oldLady": dict(macro=dict(gender=0.0, age=0.92, muscle=0.4, weight=0.62, proportions=0.4), skin="old_caucasian_female", hair="bob02", brows="eyebrow006",
                    outfit="female_elegantsuit01", shoes="shoes01", coat=("wool", 0.7), hat="beret", scarf=True, gloves=True),
    "furGirl": dict(macro=dict(gender=0.0, age=0.44, muscle=0.45, weight=0.35, proportions=0.8), skin="young_caucasian_female2", hair="long01", brows="eyebrow001",
                    outfit="female_casualsuit01", shoes="shoes03", coat=("fur", 0.75), hat="fur", scarf=False, gloves=False, sunglasses=True),
}

lib.reset()
class Plain(dict):
    """Garment materials, fetched fresh each time (MPFB tidies away unused materials as it builds)."""

    def __missing__(self, z):
        return self.get_fresh(z)

    def __getitem__(self, z):
        return self.get_fresh(z)

    def get_fresh(self, z):
        m = bpy.data.materials.get(f"pp_{z}") or lib.material(f"pp_{z}", (0.6, 0.6, 0.6), 0.85)
        m.use_fake_user = True
        return m

    def __iter__(self):
        return iter(("coat", "hat", "scarf", "gloves", "dark"))


PLAIN = Plain()


def mpfb_groups(obj):
    names = {g.index: g.name for g in obj.vertex_groups}
    return [{names[g.group]: g.weight for g in v.groups} for v in obj.data.vertices]


def weight_of(w, prefixes):
    return sum(x for n, x in w.items() if any(n.startswith(p) for p in prefixes))


def shell(name, coords, faces_src, keep, offset, mat, rim=0.006, quilt=0.0, fluff=0.0, smooth=3, radial=None):
    """A garment made from part of the body: the faces whose vertices are all in `keep`, pushed out
    along the normals by `offset` (and quilted or fluffed), given a little thickness at the edges."""
    bm = bmesh.new()
    index = {}
    for i in keep:
        index[i] = bm.verts.new(coords[i])
    for f in faces_src:
        if all(i in index for i in f):
            try:
                bm.faces.new([index[i] for i in f])
            except ValueError:
                pass
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bm.normal_update()
    for v in bm.verts:
        push = offset
        if quilt:
            push += quilt * max(0.0, math.sin(v.co.z * math.tau / 0.11))
        if fluff:
            push += fluff * (0.5 + 0.5 * math.sin(v.co.x * 91 + v.co.y * 57) * math.sin(v.co.z * 73))
        direction = (v.co - radial).normalized() if radial is not None else v.normal
        v.co += direction * push
    for _ in range(smooth):
        bmesh.ops.smooth_vert(bm, verts=bm.verts, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    if rim:
        sol = obj.modifiers.new("rim", "SOLIDIFY")
        sol.thickness = rim
        sol.offset = -1
    apply_all(obj)
    obj.data.materials.append(mat)
    return obj


def simplify_materials(obj, size):
    """Plain Principled materials the glTF exporter carries over: the diffuse texture (shrunk),
    with its alpha for hair and brows. Garments made here keep their pp_ materials."""
    for i, m in enumerate(obj.data.materials):
        if m is None or m.name.startswith("pp_"):
            continue
        images = []
        if m.use_nodes:
            stack = [m.node_tree]
            while stack:
                tree = stack.pop()
                for n in tree.nodes:
                    if n.bl_idname == "ShaderNodeTexImage" and n.image:
                        images.append(n.image)
                    if n.bl_idname == "ShaderNodeGroup" and n.node_tree:
                        stack.append(n.node_tree)
        diffuse = next((im for im in images if "diffuse" in im.name.lower()), images[0] if images else None)
        alpha = any(k in obj.name.lower() for k in ("hair", "brow", "long01", "bob", "short", "eyebrow"))
        new = bpy.data.materials.new(f"pt_{obj.name}_{i}")
        new.use_nodes = True
        nodes = new.node_tree.nodes
        bsdf = next(n for n in nodes if n.type == "BSDF_PRINCIPLED")
        bsdf.inputs["Roughness"].default_value = 0.75
        if diffuse:
            if diffuse.size[0] > size:
                diffuse.scale(size, size)
            tex = nodes.new("ShaderNodeTexImage")
            tex.image = diffuse
            new.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
            if alpha:
                new.node_tree.links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
                new.surface_render_method = "DITHERED"
        obj.data.materials[i] = new


ZONE_OF = {"pp_coat": 0.25, "pp_hat": 0.5, "pp_scarf": 0.75, "pp_gloves": 1.0}


def atlas_and_zones(mesh, kind, size=1024):
    """One material per person, for one draw call each: every texture packed into a single atlas
    (and a white and a black cell), and the garments the game colours tagged by a 'zone' colour
    attribute (0 none, 0.25 coat, 0.5 hat, 0.75 scarf, 1 gloves) on white."""
    import numpy as np
    mats = list(mesh.data.materials)
    textured = []
    for m in mats:
        img = None
        if m and m.use_nodes and not m.name.startswith("pp_"):
            img = next((n.image for n in m.node_tree.nodes if n.bl_idname == "ShaderNodeTexImage" and n.image), None)
        textured.append(img)
    cells = [im for im in textured if im is not None]
    n = len(cells) + 2
    grid = math.ceil(math.sqrt(n))
    cell = size // grid
    atlas = np.zeros((size, size, 4), dtype=np.float32)
    slot = {}
    for k, im in enumerate(cells + ["white", "black"]):
        cx, cy = (k % grid) * cell, (k // grid) * cell
        if im == "white":
            atlas[cy:cy + cell, cx:cx + cell] = (1, 1, 1, 1)
        elif im == "black":
            atlas[cy:cy + cell, cx:cx + cell] = (0.02, 0.02, 0.02, 1)
        else:
            small = im.copy()
            small.scale(cell, cell)
            px = np.array(small.pixels[:], dtype=np.float32).reshape(cell, cell, 4)
            atlas[cy:cy + cell, cx:cx + cell] = px
            bpy.data.images.remove(small)
        slot[id(im) if not isinstance(im, str) else im] = (cx / size, cy / size, cell / size)
    image = bpy.data.images.new(f"atlas_{kind}", size, size, alpha=True)
    image.pixels.foreach_set(atlas.ravel())
    image.pack()
    me = mesh.data
    if not me.uv_layers:
        me.uv_layers.new(name="UVMap")
    uv = me.uv_layers.active.data
    zone = me.color_attributes.new("zone", "BYTE_COLOR", "POINT")
    for poly in me.polygons:
        m = mats[poly.material_index] if poly.material_index < len(mats) else None
        img = textured[poly.material_index] if poly.material_index < len(textured) else None
        name = m.name if m else ""
        if img is not None:
            x0, y0, w = slot[id(img)]
            for li in poly.loop_indices:
                u, v = uv[li].uv
                uv[li].uv = (x0 + (u % 1.0) * w * 0.998, y0 + (v % 1.0) * w * 0.998)
        else:
            x0, y0, w = slot["black" if name == "pp_dark" else "white"]
            for li in poly.loop_indices:
                uv[li].uv = (x0 + w / 2, y0 + w / 2)
        z = ZONE_OF.get(name, 0.0)
        for vi in poly.vertices:
            zone.data[vi].color = (z, 0, 0, 1)
    atlas_mat = lib.material(f"pp_atlas_{kind}", (1, 1, 1), 0.8, image=image, alpha_clip=True)
    me.materials.clear()
    me.materials.append(atlas_mat)
    for poly in me.polygons:
        poly.material_index = 0


def build_person(kind, spec):
    macro = dict(spec["macro"], height=0.5, cupsize=0.5, firmness=0.5, race=WHITE)
    human = HumanService.create_human(macro_detail_dict=macro)
    rig = HumanService.add_builtin_rig(human, "game_engine")
    HumanService.set_character_skin(asset("skins", spec["skin"], spec["skin"] + ".mhmat"), human, skin_type="MAKESKIN")
    parts = []
    add = lambda path, kind_: parts.append(HumanService.add_mhclo_asset(path, human, asset_type=kind_, subdiv_levels=0, material_type="MAKESKIN"))
    add(asset("eyes", "low-poly", "low-poly.mhclo"), "Eyes")
    add(asset("eyebrows", spec["brows"], spec["brows"] + ".mhclo"), "Eyebrows")
    add(asset("hair", spec["hair"], spec["hair"] + ".mhclo"), "Hair")
    add(asset("clothes", spec["outfit"], spec["outfit"] + ".mhclo"), "Clothes")
    add(asset("clothes", spec["shoes"], spec["shoes"] + ".mhclo"), "Clothes")
    if spec["hat"] == "fedora01":
        add(asset("clothes", "fedora01", "fedora01.mhclo"), "Clothes")
    proxy_name = "male1591" if macro["gender"] > 0.5 else "female1605"
    proxy = HumanService.add_mhclo_asset(asset("proxymeshes", proxy_name, proxy_name + ".proxy"), human, asset_type="Proxymeshes", subdiv_levels=0, material_type="MAKESKIN")

    # The low-poly body wears the full body's skin.
    skin_mats = [m for m in human.data.materials if m]
    if skin_mats:
        proxy.data.materials.clear()
        proxy.data.materials.append(skin_mats[0])
        for poly in proxy.data.polygons:
            poly.material_index = 0
    # The base mesh, as shaped (targets baked), with all its helpers, for the winter layer.
    bpy.ops.object.select_all(action="DESELECT")
    human.select_set(True)
    bpy.context.view_layer.objects.active = human
    TargetService.bake_targets(human)
    coords = [human.matrix_world @ v.co for v in human.data.vertices]
    faces = [tuple(p.vertices) for p in human.data.polygons]
    weights = mpfb_groups(human)
    bones = {b.name: (rig.matrix_world @ b.head_local, rig.matrix_world @ b.tail_local) for b in rig.data.bones}
    hp = lambda n: bones[n][0]
    body_vert = lambda i: weights[i].get("body", 0) > 0.5 or not any(n.startswith("helper") or n.startswith("Joint") for n in weights[i])
    in_group = lambda i, g: weights[i].get(g, 0) > 0.5

    garments = []
    style, length = spec["coat"]
    hip_z = hp("pelvis").z - 0.12
    knee_z = hp("calf_l").z
    trunk = ("spine", "clavicle", "upperarm", "lowerarm", "pelvis", "neck")
    keep = [i for i in range(len(coords)) if body_vert(i) and weight_of(weights[i], trunk) > 0.5 and weight_of(weights[i], ("hand", "head")) < 0.2
            and coords[i].z > hip_z and coords[i].z < hp("neck_01").z + 0.02 and weight_of(weights[i], ("lowerarm",)) * 0 + 1
            and not (weight_of(weights[i], ("lowerarm",)) > 0.5 and (coords[i] - hp("hand_l" if coords[i].x > 0 else "hand_r")).length < 0.05)]
    if length > 0:
        # A long coat hangs from the hips over MakeHuman's skirt helper, to the knee or below.
        hem = hip_z - (hip_z - knee_z) * (0.4 + length)
        keep += [i for i in range(len(coords)) if in_group(i, "helper-skirt") and coords[i].z > hem]
        keep += [i for i in range(len(coords)) if body_vert(i) and weight_of(weights[i], ("thigh", "pelvis")) > 0.5 and hip_z - 0.02 < coords[i].z <= hip_z + 0.02]
    thickness = {"puffer": 0.045, "wool": 0.034, "fur": 0.055}[style]  # clear of the clothes beneath
    garments.append(shell(f"coat_{kind}", coords, faces, set(keep), thickness, PLAIN["coat"], rim=0.008,
                          quilt=0.012 if style == "puffer" else 0.0, fluff=0.014 if style == "fur" else 0.0, smooth=4 if style != "fur" else 2))
    head = [i for i in range(len(coords)) if body_vert(i) and weights[i].get("head", 0) > 0.5]
    brow = hp("head").z + 0.06  # about the tops of the ears
    if spec["hat"] in ("beanie", "fur", "beret"):
        lift = {"beanie": 0.0, "fur": -0.005, "beret": 0.03}[spec["hat"]]
        cap = [i for i in head if coords[i].z > brow + lift]
        off = {"beanie": 0.032, "fur": 0.05, "beret": 0.034}[spec["hat"]]  # over the hair
        centre = hp("head") + Vector((0, 0, 0.09))  # roughly the middle of the skull
        garments.append(shell(f"hat_{kind}", coords, faces, set(cap), off, PLAIN["hat"], rim=0.012, fluff=0.01 if spec["hat"] == "fur" else 0.0, radial=centre, smooth=2))
    if spec["scarf"]:
        neck = [i for i in range(len(coords)) if body_vert(i) and weights[i].get("neck_01", 0) > 0.4 and coords[i].z < hp("head").z + 0.01]
        garments.append(shell(f"scarf_{kind}", coords, faces, set(neck), 0.03, PLAIN["scarf"], rim=0.012, smooth=4))
    if spec["gloves"]:
        hands = [i for i in range(len(coords)) if body_vert(i) and weight_of(weights[i], ("hand", "index", "middle", "ring", "pinky", "thumb")) > 0.5]
        garments.append(shell(f"gloves_{kind}", coords, faces, set(hands), 0.005, PLAIN["gloves"], rim=0.0, smooth=1))
    if spec.get("sunglasses"):
        eye_l, eye_r = hp("head") + Vector((0.032, -0.09, 0.075)), hp("head") + Vector((-0.032, -0.09, 0.075))
        g = lib.mesh_object(f"glasses_{kind}", [tuple(eye_r + Vector((-0.03, 0, -0.015))), tuple(eye_l + Vector((0.03, 0, -0.015))), tuple(eye_l + Vector((0.03, 0, 0.015))), tuple(eye_r + Vector((-0.03, 0, 0.015)))], [(0, 1, 2, 3)], None, PLAIN["dark"])
        sol = g.modifiers.new("t", "SOLIDIFY")
        sol.thickness = 0.004
        apply_all(g)
        garments.append(g)

    # MakeHuman's weights for every garment, from the nearest body vertex.
    tree = kdtree.KDTree(len(coords))
    for i, c in enumerate(coords):
        if body_vert(i):
            tree.insert(c, i)
    tree.balance()
    for gmt in garments:
        groups = {}
        for v in gmt.data.vertices:
            _, idx, _ = tree.find(gmt.matrix_world @ v.co)
            for name, w in weights[idx].items():
                if w > 0 and name in bones:
                    if name not in groups:
                        groups[name] = gmt.vertex_groups.new(name=name)
                    groups[name].add([v.index], w, "REPLACE")

    # The low-poly body, minus what the clothes cover (MakeHuman's delete groups on the base mesh).
    hidden = [i for i in range(len(coords)) if any(n.startswith("Delete.") and w > 0.5 for n, w in weights[i].items())]
    hidden_set = set(hidden)
    meshes = [proxy, *parts, *garments]
    for obj in (proxy, *parts):
        for m in list(obj.modifiers):
            obj.modifiers.remove(m)
        mw = obj.matrix_world.copy()
        obj.parent = None
        for v in obj.data.vertices:
            v.co = mw @ v.co
        obj.matrix_world.identity()
    bm = bmesh.new()
    bm.from_mesh(proxy.data)
    doomed = [v for v in bm.verts if tree.find(v.co)[1] in hidden_set]
    bmesh.ops.delete(bm, geom=doomed, context="VERTS")
    bm.to_mesh(proxy.data)
    bm.free()
    bpy.data.objects.remove(human)

    # Joints for the game's skeleton, as the riders'.
    j = {"pelvis": hp("pelvis"), "waist": hp("spine_02"), "chest": hp("spine_03"), "neck": hp("neck_01"), "neck_top": bones["head"][1]}
    for side, sfx in (("L", "_l"), ("R", "_r")):
        j[f"shoulder_{side}"] = hp("upperarm" + sfx)
        j[f"elbow_{side}"] = hp("lowerarm" + sfx)
        j[f"wrist_{side}"] = hp("hand" + sfx)
        j[f"fingers_{side}"] = bones["middle_03" + sfx][1]
        j[f"hip_{side}"] = hp("thigh" + sfx)
        j[f"knee_{side}"] = hp("calf" + sfx)
        j[f"ankle_{side}"] = hp("foot" + sfx)
        j[f"toe_{side}"] = bones["ball" + sfx][1]
    bpy.data.objects.remove(rig)
    for obj in meshes:
        # Fold every MakeHuman bone's weight into the game's bones.
        names = {g.index: g.name for g in obj.vertex_groups}
        folded = []
        for v in obj.data.vertices:
            acc = {}
            for g in v.groups:
                t = our_bone(names[g.group])
                if t and g.weight > 0:
                    acc[t] = acc.get(t, 0) + g.weight
            folded.append(acc)
        for g in list(obj.vertex_groups):
            obj.vertex_groups.remove(g)
        made = {}
        for v in obj.data.vertices:
            total = sum(folded[v.index].values()) or 1
            for name, w in folded[v.index].items():
                if name not in made:
                    made[name] = obj.vertex_groups.new(name=name)
                made[name].add([v.index], w / total, "REPLACE")
        simplify_materials(obj, 512 if obj is proxy else 256)
        # A budget per piece: dozens of these are on screen at once, on phones.
        budget = 1600 if obj is proxy else 900 if obj in garments else 1000
        if len(obj.data.vertices) > budget:
            dec = obj.modifiers.new("lighter", "DECIMATE")
            dec.ratio = budget / len(obj.data.vertices)
            apply_all(obj)
    mesh = lib.join(meshes, f"pbody_{kind}")
    atlas_and_zones(mesh, kind)
    arm_data = bpy.data.armatures.new(f"prig_{kind}")
    arm = bpy.data.objects.new(f"person_{kind}", arm_data)
    bpy.context.scene.collection.objects.link(arm)
    bpy.ops.object.select_all(action="DESELECT")
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    for name, a, b, parent in BONES:
        bone = arm_data.edit_bones.new(name)
        bone.head = j[a]
        bone.tail = j[b]
        if parent:
            bone.parent = arm_data.edit_bones[parent]
            bone.use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")
    mesh.parent = arm
    mod = mesh.modifiers.new("Armature", "ARMATURE")
    mod.object = arm
    return arm, mesh


def our_bone(mpfb_bone):
    side = ""
    base = mpfb_bone
    if mpfb_bone.endswith("_l") or mpfb_bone.endswith("_r"):
        side = ".L" if mpfb_bone.endswith("_l") else ".R"
        base = mpfb_bone[:-2]
    base = base.rstrip("_0123456789")
    table = {"Root": "hips", "pelvis": "hips", "spine": "spine", "neck": "neck", "head": "neck", "clavicle": "chest",
             "upperarm": "upperarm", "lowerarm": "forearm", "hand": "hand", "index": "hand", "middle": "hand", "ring": "hand",
             "pinky": "hand", "thumb": "hand", "thigh": "thigh", "calf": "shin", "foot": "foot", "ball": "foot"}
    name = table.get(base)
    if name is None:
        return None
    if mpfb_bone == "spine_03":
        return "chest"
    return name if name in ("hips", "spine", "chest", "neck") else name + side


out = []
for kind, spec in PEOPLE.items():
    out += build_person(kind, spec)
# The dog, as before (blender/people.py builds its parts).
DOG_ONLY = True
exec(open(os.path.join(lib.ROOT, "blender", "people.py")).read())
rigs = [o for o in out if o.type == "ARMATURE"]
for i, r in enumerate(rigs):
    r.location = (i * 0.9 - 2.2, 0, 0)
preview_cols = {"coat": (0.12, 0.18, 0.35), "hat": (0.6, 0.08, 0.08), "scarf": (0.75, 0.6, 0.15), "gloves": (0.05, 0.05, 0.05), "dark": (0.02, 0.02, 0.02)}
for z, c in preview_cols.items():
    PLAIN[z].node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (*c, 1)
lib.preview("people_mpfb.png", (1.5, -5.2, 1.3), (0, 0, 0.9), size=(1400, 800), lens=40, sky=(0.35, 0.55, 0.9))
for z in PLAIN:
    PLAIN[z].node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.6, 0.6, 0.6, 1)
for r in rigs:
    r.location = (0, 0, 0)
export = out + DOG_PARTS
# Exported with the zone colours (the default exports only colours a material uses).
bpy.ops.object.select_all(action="DESELECT")
for o in export:
    o.select_set(True)
path = os.path.join(lib.MODELS, "people.glb")
bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_apply=True, export_yup=True, export_image_format="WEBP",
                          export_texcoords=True, export_normals=True, export_materials="EXPORT", export_vertex_color="ACTIVE")
result = {"export": {"file": path, "bytes": os.path.getsize(path)}, "verts": {o.name: len(o.data.vertices) for o in out if o.type == "MESH"}}
