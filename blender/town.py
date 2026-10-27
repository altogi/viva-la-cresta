"""
St Moritz and Celerina's buildings, modelled from their OpenStreetMap footprints (blender/buildings.json,
written by scripts/export-buildings.ts) in the styles of the photographs:

  engadin - white or cream plaster, deep-set windows with wooden shutters and painted surrounds,
            stacked timber balconies along the long sides, timber-boarded gables under deep eaves;
  pastel  - the salmon, yellow and peach blocks round Junction: plain white-framed windows, white trim;
  chalet  - small houses: plastered ground floor, timber boarding above, a wide roof;
  yellow  - the yellow house by the finish, with a hipped roof.

Facades are tiled with window bays rendered here from real geometry (reveal shadows, glass, shutters).
Every roof carries a thick layer of snow. Each building is one object, bld_<index>, with its local
x along the footprint's length, ground (its lowest corner) at z = 0; the game places them.
Exported to public/models/town.glb.
"""

import json
import math
import os
import random

import bpy

import lib

FLOOR = 3.0
CELL = 3.0  # one window bay per 3 m of wall and per storey
rng = random.Random(1906)


# ---------- Facade tiles, rendered ----------

def plaster(name, color):
    """Rough lime plaster: the colour broken up by fine noise."""
    mat = lib.material(name, color, 0.95)
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = next(n for n in nodes if n.type == "BSDF_PRINCIPLED")
    noise = nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 40
    noise.inputs["Detail"].default_value = 8
    ramp = nodes.new("ShaderNodeMixRGB")
    ramp.blend_type = "MULTIPLY"
    ramp.inputs["Fac"].default_value = 0.18
    ramp.inputs["Color1"].default_value = (*color, 1)
    links.new(noise.outputs["Fac"], ramp.inputs["Color2"])
    links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    return mat

def box(name, x0, x1, y0, y1, z0, z1, mat, coll):
    verts = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
    faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    return lib.mesh_object(name, verts, faces, None, mat, coll)


def render_tile(name, wall, shutters=None, surround=None, boards=False, size=512):
    """Render one 3 m x 3 m window bay seen square on: wall (or timber boards), a deep-set window with a white
    frame, a sill, and optionally shutters and a painted surround. Returns a packed image."""
    lib.reset()
    coll = lib.collection("tile")
    wall_mat = plaster("t_wall", wall)
    frame = lib.material("t_frame", (0.93, 0.93, 0.9), 0.5)
    glass = lib.material("t_glass", (0.08, 0.12, 0.17), 0.08, metallic=0.6)
    reveal = lib.material("t_reveal", tuple(c * 0.86 for c in wall), 0.9)
    # Window opening (x across, z up), wall face at y = 0, the camera looking along +y.
    wx, wz0, wz1 = 0.52, 0.95, 2.35
    depth = 0.32
    if boards:
        for k in range(15):
            tone = 0.85 + rng.random() * 0.25
            col = tuple(min(1, c * tone) for c in wall)
            m = lib.material(f"t_board{k}", col, 0.85)
            z0 = k * 0.2
            for x0, x1 in ((-1.5, -wx), (wx, 1.5)):
                box(f"b{k}a", x0, x1, -0.02, 0, z0 + 0.008, z0 + 0.2, m, coll)
            if z0 + 0.2 <= wz0 or z0 >= wz1:
                box(f"b{k}c", -wx, wx, -0.02, 0, z0 + 0.008, z0 + 0.2, m, coll)
        box("back", -1.5, 1.5, 0.0, 0.05, 0, 3, lib.material("t_gap", tuple(c * 0.35 for c in wall), 1), coll)
    else:
        box("wl", -1.5, -wx, 0, 0.4, 0, 3, wall_mat, coll)
        box("wr", wx, 1.5, 0, 0.4, 0, 3, wall_mat, coll)
        box("wb", -wx, wx, 0, 0.4, 0, wz0, wall_mat, coll)
        box("wt", -wx, wx, 0, 0.4, wz1, 3, wall_mat, coll)
    # Reveal (the thick wall's inner faces), glass, frame and glazing bars.
    box("rv", -wx, wx, 0.0, depth, wz0 - 0.01, wz0, reveal, coll)
    box("glass", -wx, wx, depth, depth + 0.02, wz0, wz1, glass, coll)
    t = 0.06
    box("fl", -wx, -wx + t, depth - 0.04, depth, wz0, wz1, frame, coll)
    box("fr", wx - t, wx, depth - 0.04, depth, wz0, wz1, frame, coll)
    box("fb", -wx, wx, depth - 0.04, depth, wz0, wz0 + t, frame, coll)
    box("ft", -wx, wx, depth - 0.04, depth, wz1 - t, wz1, frame, coll)
    box("fm", -0.025, 0.025, depth - 0.04, depth, wz0, wz1, frame, coll)
    box("fh", -wx, wx, depth - 0.04, depth, 1.85, 1.89, frame, coll)
    box("sill", -wx - 0.08, wx + 0.08, -0.08, 0.1, wz0 - 0.06, wz0, lib.material("t_sill", (0.75, 0.73, 0.7), 0.7), coll)
    if surround:
        # A painted band round the window, sgraffito style.
        s = lib.material("t_surround", surround, 0.9)
        b = 0.14
        box("s1", -wx - b, -wx, -0.004, 0, wz0 - 0.1, wz1 + b, s, coll)
        box("s2", wx, wx + b, -0.004, 0, wz0 - 0.1, wz1 + b, s, coll)
        box("s3", -wx - b, wx + b, -0.004, 0, wz1, wz1 + b, s, coll)
    if shutters:
        sh = lib.material("t_shutter", shutters, 0.75)
        slat = lib.material("t_slat", tuple(c * 0.7 for c in shutters), 0.8)
        for side in (-1, 1):
            x0 = wx + 0.03 if side > 0 else -wx - 0.03 - 0.5
            box(f"sh{side}", x0, x0 + 0.5, -0.05, -0.02, wz0 - 0.03, wz1 + 0.03, sh, coll)
            for k in range(14):
                z = wz0 + 0.06 + k * 0.095
                box(f"sl{side}{k}", x0 + 0.04, x0 + 0.46, -0.065, -0.05, z, z + 0.035, slat, coll)
    # Render square on, lit from the upper left so the reveal and shutters cast shadows.
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = scene.render.resolution_y = size
    scene.render.film_transparent = False
    scene.view_settings.view_transform = "Standard"
    world = scene.world or bpy.data.worlds.new("World")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = (0.62, 0.72, 0.9, 1)
    bg.inputs["Strength"].default_value = 0.42
    cam_data = bpy.data.cameras.new("tcam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = 3.0
    cam = bpy.data.objects.new("tcam", cam_data)
    coll.objects.link(cam)
    cam.location = (0, -10, 1.5)
    cam.rotation_euler = (math.pi / 2, 0, 0)
    scene.camera = cam
    sun_data = bpy.data.lights.new("tsun", "SUN")
    sun_data.energy = 2.3
    sun_data.angle = math.radians(3)
    sun = bpy.data.objects.new("tsun", sun_data)
    sun.rotation_euler = (math.radians(55), math.radians(-25), math.radians(-20))
    coll.objects.link(sun)
    path = os.path.join(lib.PREVIEWS, f"tile_{name}.png")
    os.makedirs(lib.PREVIEWS, exist_ok=True)
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(path, check_existing=False)
    img.name = f"tile_{name}"
    img.pack()
    img.use_fake_user = True  # survives the scene resets between tiles
    return img


WHITE = (0.95, 0.94, 0.9)
CREAM = (0.93, 0.89, 0.8)
PASTELS = {"salmon": (0.9, 0.56, 0.44), "yellow": (0.96, 0.79, 0.4), "peach": (0.95, 0.7, 0.52), "ochre": (0.86, 0.64, 0.38)}
TIMBER = (0.42, 0.28, 0.17)
SHUTTER_GREEN = (0.3, 0.37, 0.3)
SHUTTER_BROWN = (0.4, 0.26, 0.15)

tiles = {
    "engadin_white": render_tile("engadin_white", WHITE, SHUTTER_GREEN, (0.72, 0.72, 0.7)),
    "engadin_cream": render_tile("engadin_cream", CREAM, SHUTTER_BROWN, (0.78, 0.72, 0.62)),
    "chalet_boards": render_tile("chalet_boards", TIMBER, SHUTTER_BROWN, boards=True),
}
for k, c in PASTELS.items():
    tiles[f"pastel_{k}"] = render_tile(f"pastel_{k}", c, None, (0.97, 0.96, 0.93))

# ---------- The buildings ----------

lib.reset()
COLL = lib.collection("town")
M = {name: lib.material(f"wall_{name}", (1, 1, 1), 0.9, image=img) for name, img in tiles.items()}
M["wood"] = lib.material("wood", (0.33, 0.21, 0.12), 0.85)
M["wood_light"] = lib.material("wood_light", (0.5, 0.34, 0.2), 0.85)
M["snow"] = lib.material("roof_snow", (0.93, 0.95, 0.99), 0.85)
M["trim"] = lib.material("trim", (0.95, 0.95, 0.93), 0.6)
M["plinth"] = lib.material("plinth", (0.55, 0.53, 0.5), 0.95)
M["roof_edge"] = lib.material("roof_edge", (0.28, 0.24, 0.22), 0.8)


class Builder:
    """Faces grouped by material for one building."""

    def __init__(self):
        self.verts, self.faces, self.uvs, self.mats = [], [], [], []
        self.names = []

    def mat(self, m):
        if m not in self.names:
            self.names.append(m)
        return self.names.index(m)

    def quad(self, a, b, c, d, m, uv=((0, 0), (1, 0), (1, 1), (0, 1))):
        i = len(self.verts)
        self.verts += [a, b, c, d]
        self.faces.append((i, i + 1, i + 2, i + 3))
        self.uvs += list(uv)
        self.mats.append(self.mat(m))

    def tri(self, a, b, c, m, uv=((0, 0), (1, 0), (0.5, 1))):
        i = len(self.verts)
        self.verts += [a, b, c]
        self.faces.append((i, i + 1, i + 2))
        self.uvs += list(uv)
        self.mats.append(self.mat(m))

    def box(self, x0, x1, y0, y1, z0, z1, m):
        p = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
        for f in ((0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7), (4, 5, 6, 7), (0, 3, 2, 1)):
            self.quad(*[p[k] for k in f], m)

    def wall(self, a, b, z0, z1, m, u_off=0.0):
        """A wall from corner a to b (x, y), tiled one window bay per 3 m."""
        length = math.hypot(b[0] - a[0], b[1] - a[1])
        u1 = length / CELL
        # Centre the bays on the wall.
        shift = (u1 % 1) / 2 + u_off
        self.quad((a[0], a[1], z0), (b[0], b[1], z0), (b[0], b[1], z1), (a[0], a[1], z1), m,
                  ((-shift, z0 / CELL), (u1 - shift, z0 / CELL), (u1 - shift, z1 / CELL), (-shift, z1 / CELL)))

    def build(self, name):
        obj = lib.mesh_object(name, self.verts, self.faces, self.uvs, [M[n] for n in self.names], COLL)
        for poly, mi in zip(obj.data.polygons, self.mats):
            poly.material_index = mi
        return obj


def roof(bld, hl, hw, top, kind, overhang, pitch_deg, gable_mat, edge_mat):
    """A gabled or hipped roof over a box (half-length hl, half-width hw) with walls up to `top`;
    a thick snow layer on top, timber soffits under the eaves, boarded gables."""
    pitch = math.tan(math.radians(pitch_deg))
    rise = hw * pitch
    eh = hl + overhang  # eaves beyond the walls
    ew = hw + overhang
    eave_z = top - overhang * pitch
    ridge_z = top + rise
    snow = 0.32
    inset = min(hw, hl - 0.5) if kind == "hipped" else -overhang
    r0, r1 = -(hl - inset) if kind == "hipped" else -eh, (hl - inset) if kind == "hipped" else eh
    # Under the eaves: timber soffit (slightly below the snow slab).
    for side in (-1, 1):
        a = (-eh, side * ew, eave_z - 0.18)
        b = (eh, side * ew, eave_z - 0.18)
        c = (r1, 0, ridge_z - 0.18)
        d = (r0, 0, ridge_z - 0.18)
        if side > 0:
            bld.quad(d, c, b, a, "wood")
        else:
            bld.quad(a, b, c, d, "wood")
    # Snow slabs on the slopes.
    for side in (-1, 1):
        a = (-eh, side * ew, eave_z)
        b = (eh, side * ew, eave_z)
        c = (r1, 0, ridge_z + snow)
        d = (r0, 0, ridge_z + snow)
        a2 = (-eh, side * ew, eave_z + snow)
        b2 = (eh, side * ew, eave_z + snow)
        if side < 0:
            bld.quad(a2, b2, c, d, "snow")
            bld.quad(a, b, b2, a2, edge_mat)
        else:
            bld.quad(b2, a2, d, c, "snow")
            bld.quad(b, a, a2, b2, edge_mat)
    if kind == "hipped":
        for end in (-1, 1):
            e0 = (end * eh, -ew, eave_z + snow)
            e1 = (end * eh, ew, eave_z + snow)
            r = (r1 if end > 0 else r0, 0, ridge_z + snow)
            if end > 0:
                bld.tri(e0, e1, r, "snow")
            else:
                bld.tri(e1, e0, r, "snow")
            bld.quad((end * eh, -ew, eave_z), (end * eh, ew, eave_z), (end * eh, ew, eave_z + snow), (end * eh, -ew, eave_z + snow), edge_mat)
    else:
        # Gable ends: boarded triangles above the walls, and the snow slab's end faces.
        for end in (-1, 1):
            x = end * hl
            a, b, c = (x, -hw, top), (x, hw, top), (x, 0, ridge_z)
            if end > 0:
                bld.tri(a, b, c, gable_mat, ((0, top / CELL), (2 * hw / CELL, top / CELL), (hw / CELL, ridge_z / CELL)))
            else:
                bld.tri(b, a, c, gable_mat, ((0, top / CELL), (2 * hw / CELL, top / CELL), (hw / CELL, ridge_z / CELL)))
            xe = end * eh
            for side in (-1, 1):
                p0, p1 = (xe, side * ew, eave_z), (xe, 0, ridge_z)
                q0, q1 = (xe, side * ew, eave_z + snow), (xe, 0, ridge_z + snow)
                if side * end > 0:
                    bld.quad(p0, p1, q1, q0, edge_mat)
                else:
                    bld.quad(p1, p0, q0, q1, edge_mat)
    return ridge_z


def balconies(bld, hl, hw, levels, base_z, span, mat="wood", every=1, sides=(-1, 1)):
    """Timber balconies stacked on the long sides: slab, plank railing, brackets."""
    for side in sides:
        y = side * hw
        for f in range(1, levels, every):
            z = base_z + f * FLOOR
            x0, x1 = -span, span
            d = 1.15 * side
            bld.box(x0, x1, min(y, y + d), max(y, y + d), z - 0.12, z, mat)
            # Railing: a solid plank front and ends.
            rail_y = y + d
            bld.box(x0, x1, min(rail_y, rail_y - 0.05 * side), max(rail_y, rail_y - 0.05 * side), z, z + 1.0, mat)
            for xe in (x0, x1):
                bld.box(xe - 0.03, xe + 0.03, min(y, rail_y), max(y, rail_y), z, z + 1.0, mat)
            bld.box(x0, x1, min(rail_y, rail_y + 0.1 * side), max(rail_y, rail_y + 0.1 * side), z + 1.0, z + 1.06, "wood_light")


def building(b):
    hl, hw = b["length"] / 2, b["width"] / 2
    style = b["style"]
    levels = max(1, int(b["levels"]))
    base_z = -0.5
    top = 0.6 + levels * FLOOR
    bld = Builder()
    corners = [(-hl, -hw), (hl, -hw), (hl, hw), (-hl, hw)]
    if style == "engadin":
        wall = "engadin_white" if rng.random() < 0.6 else "engadin_cream"
    elif style == "pastel":
        wall = "pastel_" + rng.choice(list(PASTELS))
    elif style == "yellow":
        wall = "pastel_yellow"
    else:
        wall = "engadin_white" if rng.random() < 0.5 else "engadin_cream"
    # A stone plinth, then the storeys.
    for i in range(4):
        a, c = corners[i], corners[(i + 1) % 4]
        bld.wall(a, c, base_z, 0.6, "plinth")
        if style == "chalet" and levels >= 1:
            ground_top = 0.6 + FLOOR
            bld.wall(a, c, 0.6, ground_top, wall)
            if top > ground_top:
                bld.wall(a, c, ground_top, top, "chalet_boards")
        else:
            bld.wall(a, c, 0.6, top, wall)
    # A trim band under the eaves on the plastered styles.
    if style in ("pastel", "yellow"):
        for i in range(4):
            a, c = corners[i], corners[(i + 1) % 4]
            bld.quad((a[0], a[1], top - 0.35), (c[0], c[1], top - 0.35), (c[0], c[1], top), (a[0], a[1], top), "trim")
    roof_kind = b["roof"]
    if style == "yellow":
        roof_kind = "hipped"
    if roof_kind == "flat":
        bld.box(-hl - 0.3, hl + 0.3, -hw - 0.3, hw + 0.3, top, top + 0.25, "roof_edge")
        bld.box(-hl - 0.2, hl + 0.2, -hw - 0.2, hw + 0.2, top + 0.25, top + 0.55, "snow")
    elif roof_kind == "canopy":
        bld.box(-hl, hl, -hw, hw, 2.4, 2.6, "wood")
        bld.box(-hl, hl, -hw, hw, 2.6, 2.9, "snow")
    else:
        overhang = {"engadin": 1.25, "chalet": 1.4, "pastel": 0.8, "yellow": 0.7}.get(style, 0.9)
        pitch = {"engadin": 26, "chalet": 24, "pastel": 28, "yellow": 30}.get(style, 26)
        gable = "chalet_boards" if style in ("engadin", "chalet") else wall
        roof(bld, hl, hw, top, roof_kind, overhang, pitch, gable, "roof_edge")
    if style == "engadin" and levels >= 2 and hl > 4:
        balconies(bld, hl, hw, levels, 0.6, hl * 0.62)
    elif style == "pastel" and levels >= 2 and hl > 5:
        balconies(bld, hl, hw, levels, 0.6, min(hl * 0.35, 4), "wood", every=1, sides=(1,))
    elif style == "chalet" and levels >= 2 and hw > 3:
        # A balcony across the gable end.
        for f in range(1, levels):
            z = 0.6 + f * FLOOR
            bld.box(hl, hl + 1.1, -hw * 0.7, hw * 0.7, z - 0.12, z, "wood")
            bld.box(hl + 1.05, hl + 1.1, -hw * 0.7, hw * 0.7, z, z + 1.0, "wood")
    return bld.build(f"bld_{b['i']}")


buildings = json.load(open(os.path.join(lib.ROOT, "blender", "buildings.json")))
objs = [building(b) for b in buildings if b["style"] != "church"]

# A look at a few of them together.
sample = {}
for o in objs:
    sample.setdefault(o.name, o)
picks = [o for o in objs][:0]
by_style = {}
for b, o in zip([b for b in buildings if b["style"] != "church"], objs):
    by_style.setdefault(b["style"], []).append(o)
row = []
for style in ("engadin", "pastel", "chalet", "yellow"):
    mid = [o for o in by_style.get(style, []) if 10 < o.dimensions.x < 30 and o.dimensions.z > 7] or by_style.get(style, [])
    row += mid[:2]
x = 0
for o in row:
    o.location = (x + o.dimensions.x / 2, 0, 0)
    o.rotation_euler = (0, 0, math.radians(-25))
    x += o.dimensions.x + 8
lib.preview("town.png", (x / 2, -80, 22), (x / 2, 0, 6), size=(1800, 700), lens=32)
for o in row:
    o.rotation_euler = (0, 0, 0)
for o in row:
    o.location = (0, 0, 0)
faces = sum(len(o.data.polygons) for o in objs)
result = {"buildings": len(objs), "faces": faces, "export": lib.export_glb("town.glb", objs)}
