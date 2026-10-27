"""
Trees of the Engadin in winter, for the game: snow-laden Norway spruces and bare larches.

Each tree is a tapering trunk with whorls of drooping branch cards, textured with branch images
drawn here (needles, twigs and clumps of snow, alpha-clipped). Exported to public/models/trees.glb
as spruce_0..2 and larch_0..1, each with its base at the origin and its real height.
"""

import math
import random

import numpy as np

import lib

rng = random.Random(7)


def spruce_branch_image(snow=0.5):
    """A spruce bough seen from above: a dense, nearly opaque spray of dark needles with a ragged edge,
    shaded darker towards the trunk, with snow lying along its upper half."""
    w, h = 512, 256
    img = np.zeros((h, w, 4), np.float32)
    cy = h * 0.5
    # The bough's outline: widest a third of the way out, tapering to the tip, slightly upturned.
    def half_width(x):
        u = x / w
        return h * 0.47 * (np.sin(np.clip(u, 0, 1) * math.pi) ** 0.6) * (1 - 0.35 * u)
    centre = lambda x: cy - 0.0002 * max(0, x - w * 0.4) ** 2
    for _ in range(9000):
        x = rng.random() * w * 0.98
        hw = half_width(x)
        y = centre(x) + (rng.random() * 2 - 1) * hw * (0.6 + 0.4 * rng.random())
        a = math.radians(30 + rng.random() * 30) * (1 if y > centre(x) else -1)
        nl = 7 + rng.random() * 9
        u = x / w
        shade = 0.6 + 0.6 * u + (rng.random() - 0.5) * 0.35
        col = (0.03 * shade, (0.075 + rng.random() * 0.04) * shade, (0.05 + rng.random() * 0.02) * shade, 1)
        lib.stroke(img, x, y, x + math.cos(a) * nl, y + math.sin(a) * nl, col, 2.2)
    # The twig showing through near the trunk.
    lib.stroke(img, 0, cy, w * 0.55, centre(w * 0.55), (0.2, 0.14, 0.1, 1), 4)
    # Snow on the upper half of the bough (y < centre), in drifts, thickest near the trunk.
    if snow > 0:
        for _ in range(int(700 * snow)):
            x = rng.random() * w * 0.85
            hw = half_width(x)
            if rng.random() > 1.05 - x / w * 0.8:
                continue
            y = centre(x) - rng.random() * hw * 0.85
            r = 4 + rng.random() * 9 * (1 - x / w * 0.6)
            v = 0.82 + rng.random() * 0.12
            lib.blob(img, x, y, r, (v, v + 0.02, min(1, v + 0.07), 1), soft=2.5)
    return img


def larch_branch_image():
    """A larch branch in early winter: fine grey-brown twigs, tufts of golden needles, a dusting of snow."""
    w, h = 512, 256
    img = np.zeros((h, w, 4), np.float32)
    cy = h * 0.5
    twig = (0.32, 0.27, 0.22, 1)
    lib.stroke(img, 4, cy, w - 8, cy - 18, twig, 3.5)
    for i in range(30):
        t = 0.05 + i * 0.031
        x0, y0 = t * w, cy - 18 * t
        for side in (-1, 1):
            if rng.random() < 0.1:
                continue
            length = (1 - t * 0.6) * h * 0.42 * (0.6 + rng.random() * 0.5)
            ang = math.radians(30 + rng.random() * 30)
            x1, y1 = x0 + math.cos(ang) * length, y0 + side * math.sin(ang) * length
            lib.stroke(img, x0, y0, x1, y1, twig, 1.6)
            # Short shoots with tufts of needles, golden to rust.
            for k in range(int(length / 8)):
                u = (k + 0.5) / (length / 8)
                px, py = x0 + (x1 - x0) * u, y0 + (y1 - y0) * u
                tone = rng.random()
                col = (0.55 + tone * 0.22, 0.3 + tone * 0.13, 0.1 + tone * 0.05, 1)
                for _ in range(24):
                    a = rng.random() * math.tau
                    nl = 5 + rng.random() * 9
                    lib.stroke(img, px, py, px + math.cos(a) * nl, py + math.sin(a) * nl, col, 2.3)
    covered = img[..., 3] > 0.3
    ys, xs = np.nonzero(covered)
    for _ in range(140):
        i = rng.randrange(len(xs))
        lib.blob(img, xs[i], ys[i], 2 + rng.random() * 4, (0.93, 0.95, 0.98, 1), soft=2)
    return img


def card(verts, faces, uvs, base, yaw, length, width, droop, lift=0.0, fold=0.12, roll=0.0):
    """A folded branch card from `base`, pointing out at `yaw`, drooping by `droop` radians, tip turning up by `lift`."""
    ca, sa = math.cos(yaw), math.sin(yaw)
    rows = [0.0, 0.5, 1.0]
    idx = len(verts)
    for u in rows:
        # Along the branch: droops, then its tip turns back up a little.
        a = droop * (1 - u * 0.4) - lift * u * u
        x = length * u * math.cos(a)
        z = -length * u * math.sin(a)
        for v in (-1, 1):
            across = v * width / 2 * (0.6 + 0.4 * min(1, u * 1.6))
            # Rolled about the branch: crossed cards give the branch volume from any side.
            y = across * math.cos(roll)
            zz = z + across * math.sin(roll)
            px = base[0] + x * ca - y * sa
            py = base[1] + x * sa + y * ca
            verts.append((px, py, base[2] + zz))
            uvs_row = (u, (v + 1) / 2)
            uvs.append(uvs_row)
    for r in range(2):
        a = idx + r * 2
        faces.append((a, a + 1, a + 3, a + 2))


def build_tree(name, kind, height, seed, snowy=False):
    r = random.Random(seed)
    verts, faces, uv_points = [], [], []
    if kind == "spruce":
        first = 1.2 + r.random() * 0.8
        spread = height * (0.26 + r.random() * 0.05)  # longest branch, near the bottom
        step = 0.5
    else:
        first = 2.5 + r.random() * 1.5
        spread = height * (0.2 + r.random() * 0.05)
        step = 0.42
    z = first
    whorl = 0
    while z < height - 0.4:
        t = (z - first) / (height - first)
        length = spread * (1 - t) ** 0.95 + 0.25
        n = 7 if kind == "spruce" else 8
        offset = r.random() * math.tau
        for k in range(n):
            yaw = offset + k * math.tau / n + (r.random() - 0.5) * 0.5
            if kind == "spruce":
                droop = math.radians(10 + 25 * (1 - t) + r.random() * 10)
                lift = math.radians(18 + r.random() * 10)
            else:
                droop = math.radians(-5 + 20 * (1 - t) + r.random() * 12)
                lift = math.radians(5 + r.random() * 8)
            if kind == "larch" and r.random() < 0.12:
                continue
            # Irregular crowns: branches of uneven length, and here and there a gap.
            if r.random() < 0.1:
                continue
            ln = length * (0.65 + r.random() * 0.65)
            bz = z + r.random() * 0.15
            card(verts, faces, uv_points, (0, 0, bz), yaw, ln, ln * (0.85 if kind == "spruce" else 0.62), droop, lift)
            if r.random() < 0.6:
                card(verts, faces, uv_points, (0, 0, bz), yaw + 0.15, ln * 0.85, ln * 0.5, droop + 0.05, lift, roll=math.radians(65))
        z += step * (0.85 + r.random() * 0.3) * (0.75 + 0.35 * (1 - t))
        whorl += 1
    # The leader at the top: two crossed upright cards.
    for yaw in (0, math.pi / 2):
        ca, sa = math.cos(yaw), math.sin(yaw)
        idx = len(verts)
        w2 = 0.35
        top = height + 0.3
        base_z = height - 1.2
        for zz, ww in ((base_z, w2), (top, 0.05)):
            verts.append((-ww * ca, -ww * sa, zz))
            verts.append((ww * ca, ww * sa, zz))
        faces.append((idx, idx + 1, idx + 3, idx + 2))
        uv_points += [(0.05, 0.1), (0.05, 0.9), (0.95, 0.4), (0.95, 0.6)]
    foliage_uvs = []
    for f in faces:
        foliage_uvs += [uv_points[i] for i in f]
    image = (SNOWY_IMG if snowy else SPRUCE_IMG) if kind == "spruce" else LARCH_IMG
    foliage = lib.material(f"{kind}_branches{'_snowy' if snowy else ''}", (1, 1, 1), 0.85, image=image, alpha_clip=True)
    leaves = lib.mesh_object(f"{name}_branches", verts, faces, foliage_uvs, foliage, COLL)

    # Trunk: a tapering, slightly irregular cylinder.
    tv, tf = [], []
    seg = 9
    rings = 6
    r0 = height * (0.02 if kind == "spruce" else 0.015)
    for i in range(rings + 1):
        zz = height * 0.92 * i / rings
        rr = r0 * (1 - i / rings * 0.92)
        for k in range(seg):
            a = k / seg * math.tau
            jitter = 1 + (r.random() - 0.5) * 0.12
            tv.append((math.cos(a) * rr * jitter, math.sin(a) * rr * jitter, zz))
    for i in range(rings):
        for k in range(seg):
            a, b = i * seg + k, i * seg + (k + 1) % seg
            tf.append((a, b, b + seg, a + seg))
    bark_color = (0.2, 0.14, 0.1) if kind == "spruce" else (0.25, 0.18, 0.12)
    bark = lib.material(f"{kind}_bark", bark_color, 0.95)
    trunk = lib.mesh_object(f"{name}_trunk", tv, tf, None, bark, COLL, smooth=True)
    parts = [leaves, trunk]
    return lib.join(parts, name)


lib.reset()
COLL = lib.collection("trees")
SPRUCE_IMG = lib.image_from_array("spruce_branch", spruce_branch_image())
SNOWY_IMG = lib.image_from_array("spruce_branch_snowy", spruce_branch_image(snow=1.6))
LARCH_IMG = lib.image_from_array("larch_branch", larch_branch_image())
trees = [
    build_tree("spruce_0", "spruce", 17, 1),
    build_tree("spruce_1", "spruce", 13, 2),
    build_tree("spruce_2", "spruce", 21, 3, snowy=True),
    build_tree("larch_0", "larch", 18, 4),
    build_tree("larch_1", "larch", 14, 5),
]
# Far away: a billboard of two crossed cards with a picture of the tree.
far = []
for src, name in ((trees[0], "spruce_far"), (trees[3], "larch_far")):
    for o in trees:
        o.hide_render = o is not src
    img = lib.render_impostor(src, f"{name}.png", 1024)
    h = src.dimensions.z * 1.04
    w = h / 2
    verts, faces, uvs = [], [], []
    for k, yaw in enumerate((0, math.pi / 2)):
        ca, sa = math.cos(yaw), math.sin(yaw)
        i = len(verts)
        verts += [(-w / 2 * ca, -w / 2 * sa, 0), (w / 2 * ca, w / 2 * sa, 0), (w / 2 * ca, w / 2 * sa, h), (-w / 2 * ca, -w / 2 * sa, h)]
        faces.append((i, i + 1, i + 2, i + 3))
        uvs += [(0, 0), (1, 0), (1, 1), (0, 1)]
    mat = lib.material(f"{name}_card", (1, 1, 1), 0.9, image=img, alpha_clip=True)
    far.append(lib.mesh_object(name, verts, faces, uvs, mat, COLL))
for o in trees:
    o.hide_render = False
for i, t in enumerate(trees):
    t.location = (i * 9 - 18, 0, 0)
lib.preview("trees.png", (0, -46, 9), (0, 0, 9), size=(1200, 700), lens=40, sky=(0.35, 0.55, 0.9))
lib.preview("trees_far.png", (0, -120, 6), (0, 0, 8), size=(1200, 500), lens=50, sky=(0.35, 0.55, 0.9))
stats = {t.name: len(t.data.polygons) for t in trees}
for t in trees:
    t.location = (0, 0, 0)
result = {"export": lib.export_glb("trees.glb", trees + far), "faces": stats}
