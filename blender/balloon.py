"""
A hot-air balloon, as drifting over the valley in the photographs: a dark envelope with bands of
colour, a wicker basket and its burner frame. Exported to public/models/balloon.glb (basket at the
origin, about 26 m tall).
"""

import math

import lib

lib.reset()
coll = lib.collection("balloon")
# Envelope: a teardrop turned about Z, in 16 gores alternating two colours, with a band round the equator.
profile = [(0.0, 26.0), (5.5, 25.4), (8.8, 23.2), (10.2, 20.0), (10.4, 17.0), (9.4, 13.2), (7.2, 9.6), (4.6, 7.0), (2.6, 5.6), (1.8, 5.1)]
gores = 16
dark = lib.material("envelope_dark", (0.05, 0.06, 0.09), 0.6)
band_a = lib.material("envelope_red", (0.62, 0.08, 0.06), 0.6)
band_b = lib.material("envelope_gold", (0.85, 0.62, 0.12), 0.6)
verts, faces, mats = [], [], []
steps = 3  # subdivisions across each gore
seg = gores * steps
for r, z in profile:
    for k in range(seg):
        a = k / seg * math.tau
        # Gores bulge a little between their seams.
        bulge = 1 + 0.025 * math.sin((k % steps) / steps * math.pi)
        verts.append((math.cos(a) * r * bulge, math.sin(a) * r * bulge, z))
for i in range(len(profile) - 1):
    for k in range(seg):
        a, b = i * seg + k, i * seg + (k + 1) % seg
        faces.append((a, b, b + seg, a + seg))
        gore = k // steps
        if i in (3, 4):
            mats.append(1 if gore % 2 == 0 else 2)
        else:
            mats.append(0)
env = lib.mesh_object("envelope", verts, faces, None, [dark, band_a, band_b], coll, smooth=True)
for poly, m in zip(env.data.polygons, mats):
    poly.material_index = m

# Basket, burner frame and the cables up to the envelope's mouth.
wicker = lib.material("wicker", (0.45, 0.32, 0.18), 0.9)
steel = lib.material("burner", (0.6, 0.6, 0.62), 0.4, metallic=0.8)
bv = [(-0.7, -0.7, 0), (0.7, -0.7, 0), (0.7, 0.7, 0), (-0.7, 0.7, 0), (-0.7, -0.7, 1.1), (0.7, -0.7, 1.1), (0.7, 0.7, 1.1), (-0.7, 0.7, 1.1)]
bf = [(0, 3, 2, 1), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7), (4, 5, 6, 7)]
basket = lib.mesh_object("basket", bv, bf, None, wicker, coll)
cables = []
for k in range(4):
    a = k / 4 * math.tau + math.pi / 4
    x0, y0 = math.cos(a) * 0.95, math.sin(a) * 0.95
    x1, y1 = math.cos(a) * 1.8, math.sin(a) * 1.8
    w = 0.04
    cables.append(lib.mesh_object(f"cable{k}", [(x0 - w, y0, 1.1), (x0 + w, y0, 1.1), (x1 + w, y1, 5.1), (x1 - w, y1, 5.1)], [(0, 1, 2, 3)], None, steel, coll))
burner = lib.mesh_object("burner", [(-0.3, -0.3, 2.2), (0.3, -0.3, 2.2), (0.3, 0.3, 2.2), (-0.3, 0.3, 2.2), (-0.3, -0.3, 2.6), (0.3, -0.3, 2.6), (0.3, 0.3, 2.6), (-0.3, 0.3, 2.6)], bf, None, steel, coll)
balloon = lib.join([env, basket, burner, *cables], "balloon")
lib.preview("balloon.png", (0, -60, 14), (0, 0, 14), size=(700, 800), lens=50, ground=False)
result = {"export": lib.export_glb("balloon.glb", [balloon])}
