"""
The view from the Sunny Bar's terrace, for the trophy room: across the frozen lake of St Moritz to
the mountains on its far side (Piz Rosatsch and its neighbours), in full sun.

1. The mountains: a range of snowy peaks with dark forest on their lower slopes and rock where it's
   too steep for snow, rendered wide (100 degrees across, 48 high, the horizon a quarter of the way up) on a transparent sky, as a backdrop image:
   public/textures/sunnybar-mountains.webp.
2. Badrutt's Palace: the hotel's stone tower with its steep pointed roof and a wing beside it, to
   stand at the lake's edge in 3D: public/models/sunnybar.glb (object "palace").
"""

import math
import os

import bpy
import numpy as np

import lib

lib.reset()
COLL = lib.collection("sunnybar")
rng = np.random.default_rng(7)

# ---------- 1. The mountains ----------

NX, NY = 1500, 520
X0, X1 = -9000.0, 9000.0
Y0, Y1 = 3200.0, 8500.0
xs = np.linspace(X0, X1, NX)
ys = np.linspace(Y0, Y1, NY)
X, Y = np.meshgrid(xs, ys)


def noise(x, y, scale, octaves=5, seed=0):
    """Smooth fractal noise from summed sines at random angles (cheap and tileless), about -1..1."""
    r = np.random.default_rng(seed)
    out = np.zeros_like(x)
    amp = 1.0
    total = 0.0
    for o in range(octaves):
        for _ in range(3):
            a = r.uniform(0, math.tau)
            f = (2 ** o) / scale
            ph = r.uniform(0, math.tau)
            out += amp * np.sin((x * math.cos(a) + y * math.sin(a)) * f + ph)
        total += amp * 3
        amp *= 0.5
    return out / total * 2.2


def ridged(x, y, scale, octaves=6, seed=0):
    """Ridged fractal noise: sharp crests where the noise crosses zero (aretes, gullies between)."""
    r = np.random.default_rng(seed)
    out = np.zeros_like(x)
    amp = 1.0
    total = 0.0
    for o in range(octaves):
        n = 0.0 * x
        for _ in range(3):
            a = r.uniform(0, math.tau)
            f = (2 ** o) / scale
            n = n + np.sin((x * math.cos(a) + y * math.sin(a)) * f + r.uniform(0, math.tau))
        out += amp * (1 - np.abs(n / 3)) ** 2.2
        total += amp
        amp *= 0.52
    return out / total


# The range: massifs across the view, rising from the lake's far shore, cut into ridges and gullies.
massif = 0.0 * X
for px, py, h, w in [(-5200, 5800, 1700, 1700), (-1500, 5400, 1900, 1500), (1800, 5700, 1800, 1600), (4800, 5500, 1600, 1500),
                     (-3300, 6800, 2100, 2200), (3300, 7100, 2200, 2400), (7600, 6400, 1800, 1900), (-7800, 6200, 1700, 1800)]:
    massif = np.maximum(massif, h * np.exp(-(((X - px) / (w * 1.3)) ** 2 + ((Y - py) / w) ** 2)))
rise = np.clip((Y - Y0) / 1600, 0, 1)
shape = ridged(X, Y, 2600, 8, 1)
Z = (massif * (0.55 + 0.7 * shape) + rise ** 1.4 * 600) * rise ** 0.35 + noise(X, Y, 400, 3, 2) * 40
Z = np.maximum(Z, 0) * 0.78

verts = [(float(X[j, i]), float(Y[j, i]), float(Z[j, i])) for j in range(NY) for i in range(NX)]
faces = [(j * NX + i, j * NX + i + 1, (j + 1) * NX + i + 1, (j + 1) * NX + i) for j in range(NY - 1) for i in range(NX - 1)]
mtn = lib.mesh_object("mountains", verts, faces, coll=COLL, smooth=True)
me = mtn.data
me.update()
# Colours: forest on the lower slopes (thinning upwards), snow above, bare rock wherever it's
# too steep for snow to lie, with a little variety everywhere.
# Steepness straight from the height grid (the slope's gradient, as a sine of its angle).
gy, gx = np.gradient(Z, ys, xs)
slope = np.hypot(gx, gy)
steep = (slope / np.sqrt(1 + slope ** 2)).ravel()
height = Z.ravel()
treeline = 600 + noise(X, Y, 600, 3, 3).ravel() * 140
mottle = np.clip((noise(X, Y, 90, 3, 4).ravel() + 1) / 2, 0, 1) ** 1.5
snow = np.array([0.95, 0.96, 0.99])
snow_shade = np.array([0.82, 0.86, 0.95])
rock = np.array([0.075, 0.07, 0.068])
rock_light = np.array([0.17, 0.15, 0.13])
forest = np.array([0.012, 0.025, 0.015])
forest_snow = np.array([0.12, 0.14, 0.13])
streaks = (noise(X, Y, 160, 3, 5).ravel() + 1) / 2
rocky = np.clip((steep - 0.79 + 0.12 * streaks) / 0.07, 0, 1)[:, None]
snowc = snow * (1 - 0.4 * mottle[:, None]) + snow_shade * 0.4 * mottle[:, None]
rockc = rock * (1 - mottle[:, None]) + rock_light * mottle[:, None]
upper = snowc * (1 - rocky) + rockc * rocky
treeness = np.clip((treeline - height) / 160, 0, 1)[:, None]
forestc = forest * (1 - 0.5 * mottle[:, None]) + forest_snow * 0.5 * mottle[:, None]
forestc = forestc * (1 - rocky * 0.6) + rockc * rocky * 0.6
c3 = upper * (1 - treeness) + forestc * treeness
col = np.concatenate([c3, np.ones((len(height), 1))], axis=1)
attr = me.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
attr.data.foreach_set("color", col.astype(np.float32).ravel())
mat = bpy.data.materials.new("mtn")
mat.use_nodes = True
nodes = mat.node_tree.nodes
bsdf = nodes["Principled BSDF"]
ca = nodes.new("ShaderNodeVertexColor")
ca.layer_name = "Col"
mat.node_tree.links.new(ca.outputs["Color"], bsdf.inputs["Base Color"])
bsdf.inputs["Roughness"].default_value = 0.9
me.materials.append(mat)

scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x, scene.render.resolution_y = 6144, 2304
scene.render.film_transparent = True
scene.view_settings.view_transform = "AgX"
scene.view_settings.look = "AgX - Medium High Contrast"
world = scene.world or bpy.data.worlds.new("World")
scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes.get("Background")
bg.inputs["Color"].default_value = (0.45, 0.62, 0.95, 1)
bg.inputs["Strength"].default_value = 1.0
cam_data = bpy.data.cameras.new("cam")
cam_data.sensor_fit = "HORIZONTAL"
cam_data.lens = 18 / math.tan(math.radians(50))  # 100 degrees across
cam_data.clip_end = 40000
cam = bpy.data.objects.new("cam", cam_data)
COLL.objects.link(cam)
cam.location = (0, 0, 40)
cam.rotation_euler = (math.radians(90 + 12), 0, 0)
scene.camera = cam
sun_data = bpy.data.lights.new("sun", "SUN")
sun_data.energy = 3.2
sun_data.angle = math.radians(1.5)
sun = bpy.data.objects.new("sun", sun_data)
# Late morning sun from behind the terrace (a little left): the faces in view sunlit, the ridges in relief.
sun.rotation_euler = lib.direction_to_euler(np.array([0.32, 0.8, -0.5]))
COLL.objects.link(sun)
out = os.path.join(lib.ROOT, "public", "textures", "sunnybar-mountains.png")
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.render.filepath = out
bpy.ops.render.render(write_still=True)
# Into a small WebP for the web (cwebp from Homebrew), dropping the PNG.
import shutil
import subprocess

cwebp = shutil.which("cwebp") or "/opt/homebrew/bin/cwebp"
subprocess.run([cwebp, "-q", "82", "-alpha_q", "90", "-resize", "4096", "1536", out, "-o", out.replace(".png", ".webp")], check=True)
os.remove(out)
out = out.replace(".png", ".webp")
bpy.data.objects.remove(mtn)
bpy.data.objects.remove(cam)
bpy.data.objects.remove(sun)
scene.render.film_transparent = False

# ---------- 2. Badrutt's Palace ----------

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
result = {"stats": {"steep": [float(np.percentile(steep, q)) for q in (10, 50, 90)], "rocky": float(rocky.mean()), "tree": float(treeness.mean()), "z": [float(Z.min()), float(np.percentile(Z, 50)), float(Z.max())], "col": [float(c) for c in col.mean(axis=0)]}, "mountains": out, "export": lib.export_glb("sunnybar.glb", [palace])}
