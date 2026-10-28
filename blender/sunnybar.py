"""
For the trophy room's view from the Sunny Bar's terrace: Badrutt's Palace, the hotel's stone tower
with its steep pointed roof and a wing either side, to stand at the lake's edge in 3D:
public/models/sunnybar.glb (object "palace"). The mountains across the lake are a photograph
(public/textures/sunnybar-rosatsch.webp).
"""

import math

import bpy

import lib

lib.reset()
COLL = lib.collection("sunnybar")

# ---------- Badrutt's Palace ----------

stone = lib.material("pal_stone", (0.62, 0.6, 0.56), 0.85)
render = lib.material("pal_render", (0.86, 0.84, 0.78), 0.85)
roof = lib.material("pal_roof", (0.2, 0.28, 0.24), 0.6)
window = lib.material("pal_window", (0.08, 0.09, 0.11), 0.25)
snowm = lib.material("pal_snow", (0.95, 0.96, 0.98), 0.9)
mats = [stone, render, roof, window, snowm]


def cube(size, loc, mat):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.active_object
    o.scale = size
    bpy.ops.object.transform_apply(scale=True)
    o.data.materials.append(mat)
    return o


def pyramid(w, d, h, z, mat, x=0.0, y=0.0):
    verts = [(x - w / 2, y - d / 2, z), (x + w / 2, y - d / 2, z), (x + w / 2, y + d / 2, z), (x - w / 2, y + d / 2, z), (x, y, z + h)]
    faces = [(0, 1, 4), (1, 2, 4), (2, 3, 4), (3, 0, 4), (3, 2, 1, 0)]
    return lib.mesh_object("pyr", verts, faces, mat=mat, coll=COLL)


def gable(w, d, h, z, mat, x=0.0, y=0.0):
    """A pitched roof along x."""
    verts = [(x - w / 2, y - d / 2, z), (x + w / 2, y - d / 2, z), (x + w / 2, y + d / 2, z), (x - w / 2, y + d / 2, z),
             (x - w / 2, y, z + h), (x + w / 2, y, z + h)]
    faces = [(0, 1, 5, 4), (2, 3, 4, 5), (1, 2, 5), (3, 0, 4), (3, 2, 1, 0)]
    return lib.mesh_object("gable", verts, faces, mat=mat, coll=COLL)


parts = []
# The tower: a square stone shaft, a band of arched windows near the top, a tall pointed roof.
parts.append(cube((9, 9, 44), (0, 0, 22), stone))
for z in range(6, 40, 5):
    for side in range(4):
        a = side * math.pi / 2
        parts.append(cube((1.4 if side % 2 == 0 else 0.25, 0.25 if side % 2 == 0 else 1.4, 2.2), (4.55 * math.sin(a), -4.55 * math.cos(a), z), window))
parts.append(cube((10.2, 10.2, 1.0), (0, 0, 44.5), stone))
parts.append(pyramid(10.4, 10.4, 17, 45, roof))
parts.append(cube((0.25, 0.25, 4), (0, 0, 63), stone))
# The hotel's wing beside it: rendered walls, rows of windows, a slate roof with snow on it.
wing_w, wing_d, wing_h = 46, 14, 26
parts.append(cube((wing_w, wing_d, wing_h), (wing_w / 2 + 4.5, 2, wing_h / 2), render))
for row in range(6):
    for col_ in range(14):
        parts.append(cube((1.4, 0.3, 2.0), (8 + col_ * 3.0, 2 - wing_d / 2 - 0.1, 3 + row * 3.8), window))
parts.append(gable(wing_w + 1, wing_d + 1.5, 8, wing_h, roof, x=wing_w / 2 + 4.5, y=2))
parts.append(gable(wing_w + 1.2, wing_d + 1.7, 7.4, wing_h + 0.35, snowm, x=wing_w / 2 + 4.5, y=2))
# A second, lower wing on the tower's other side.
parts.append(cube((24, 12, 18), (-16.5, 3, 9), render))
for row in range(4):
    for col_ in range(7):
        parts.append(cube((1.4, 0.3, 2.0), (-26 + col_ * 3.0, 3 - 6.1, 3 + row * 3.8), window))
parts.append(gable(25, 13.5, 6, 18, roof, x=-16.5, y=3))
for o in parts:
    for c in o.users_collection:
        c.objects.unlink(o)
    COLL.objects.link(o)
palace = lib.join(parts, "palace")
lib.preview("palace.png", (60, -140, 30), (10, 0, 25), size=(1200, 800), lens=50)
result = {"export": lib.export_glb("sunnybar.glb", [palace])}
