"""
The mountains round St Moritz and Celerina in winter, as one ring for the game's horizon.

A heightfield in polar coordinates round the run (valley floor, then massifs roughly where the real
peaks stand: Piz Nair and Corviglia to the north-west, Rosatsch and Corvatsch to the south, the big
massif down the valley ahead of the run), with ridged noise for crags. Its texture is painted from
the same heightfield at a finer scale: larch and spruce forest up to the treeline with snow between
the trees and clearings, snowfields above, bare rock where it is too steep for snow.

Exported to public/models/mountains.glb, centred on the middle of the run (game coordinates: x east,
y north, z up, metres; heights relative to the finish).
"""

import math

import numpy as np

import lib

CENTRE = (445.0, 455.0)  # middle of the run, game x/y
R0, R1 = 1150.0, 11000.0
NA, NR = 768, 72  # mesh: around, outwards
TA, TR = 4096, 512  # texture: around, outwards
rng = np.random.default_rng(3)
LATTICE = rng.random((512, 512))


def noise(x, y):
    """Smooth value noise on a wrapping lattice."""
    xi, yi = np.floor(x).astype(int), np.floor(y).astype(int)
    fx, fy = x - xi, y - yi
    fx, fy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
    a = LATTICE[yi & 511, xi & 511]
    b = LATTICE[yi & 511, (xi + 1) & 511]
    c = LATTICE[(yi + 1) & 511, xi & 511]
    d = LATTICE[(yi + 1) & 511, (xi + 1) & 511]
    return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy


def fbm(x, y, octaves=6, ridged=False):
    total, amp, freq, norm = 0.0, 1.0, 1.0, 0.0
    for o in range(octaves):
        n = noise(x * freq + o * 17.3, y * freq - o * 9.1)
        if ridged:
            n = 1 - abs(n * 2 - 1)
            n = n * n
        total = total + n * amp
        norm += amp
        amp *= 0.5
        freq *= 2.03
    return total / norm


# Massifs: azimuth (degrees from east, counter-clockwise), distance, height above the valley, spread.
MASSIFS = [
    (40, 4800, 1350, 26),  # down the valley, ahead of the run
    (12, 5600, 1050, 16),
    (72, 5600, 1000, 18),
    (108, 6800, 1400, 24),  # Languard, far
    (158, 5200, 1450, 22),  # Rosatsch
    (198, 6200, 1350, 24),  # Corvatsch
    (238, 5800, 1200, 20),  # Julier side
    (276, 3900, 1300, 20),  # Piz Nair
    (308, 4300, 1150, 22),  # Corviglia, Padella
    (344, 5200, 1250, 20),
]


def valley(x, y):
    """The valley floor: high at St Moritz (round Top), falling to Celerina past the finish."""
    along = (x * 0.697 + y * 0.717)  # along the run, from Top
    return 157 * np.clip(1 - along / 1270, -0.3, 1) - 10


def height(az, r):
    x = CENTRE[0] + np.cos(az) * r
    y = CENTRE[1] + np.sin(az) * r
    h = valley(x, y)
    rise = np.clip((r - 1800) / 1600, 0, 1) ** 1.5
    mountains = np.zeros_like(r)
    for deg, dist, peak, spread in MASSIFS:
        d_az = np.angle(np.exp(1j * (az - math.radians(deg))))
        mountains = np.maximum(mountains, peak * np.exp(-np.abs(np.degrees(d_az) / spread) ** 1.6) * np.exp(-np.abs((r - dist) / 1900) ** 1.6))
    # A continuous chain behind, so no gaps in the skyline.
    # (Behind the massifs and uneven, so it never shows as a level shelf in front of them.)
    chain = 950 * np.clip((r - 5200) / 2600, 0, 1) * (0.35 + 0.65 * fbm(x / 2200, y / 2200, 4))
    crags = fbm(x / 1300, y / 1300, 5, ridged=True)
    # Steep, craggy massifs like Rosatsch from the Sunny Bar: tall, with rock ribs and cirques.
    m = np.maximum(mountains * 1.25, chain) * (0.74 + 0.46 * crags)
    # Beyond the peaks the chain falls away again.
    m *= np.clip(1.25 - r / 10000, 0.35, 1)
    # Under the terrain's edge at the inner rim.
    tuck = -25 * np.clip(1 - (r - R0) / 300, 0, 1)
    return h + rise * m + tuck


def radius(v):
    return R0 * (R1 / R0) ** v


# ---------- Mesh ----------
az = np.linspace(0, 2 * math.pi, NA, endpoint=False)
vs = np.linspace(0, 1, NR)
A, V = np.meshgrid(az, vs)
R = radius(V)
H = height(A, R)
verts = []
for j in range(NR):
    for i in range(NA):
        verts.append((math.cos(az[i]) * R[j, i], math.sin(az[i]) * R[j, i], float(H[j, i])))
faces, uvs = [], []
for j in range(NR - 1):
    for i in range(NA):
        i2 = (i + 1) % NA
        a, b, c, d = j * NA + i, j * NA + i2, (j + 1) * NA + i2, (j + 1) * NA + i
        faces.append((a, b, c, d))
        u0, u1 = i / NA, (i + 1) / NA
        uvs += [(u0, vs[j]), (u1, vs[j]), (u1, vs[j + 1]), (u0, vs[j + 1])]

# ---------- Texture ----------
ta = np.linspace(0, 2 * math.pi, TA, endpoint=False)
tv = np.linspace(0, 1, TR)
TAz, TV = np.meshgrid(ta, tv)
TRr = radius(TV)
TH = height(TAz, TRr)
X = CENTRE[0] + np.cos(TAz) * TRr
Y = CENTRE[1] + np.sin(TAz) * TRr
# Slope from the heightfield (metres per metre).
dr = np.gradient(TH, axis=0) / np.gradient(TRr, axis=0)
da = np.gradient(TH, axis=1) / (TRr * (2 * math.pi / TA))
slope = np.hypot(dr, da)
rel = TH - valley(X, Y)  # height above the valley
# Ragged: higher on the spurs, lower in the gullies, never a level line across a slope.
# (fbm stays near 0.5, so the spread is scaled up well beyond its nominal range.)
treeline = 470 + 1000 * (fbm(X / 900, Y / 900, 4) - 0.5) + 350 * (fbm(X / 180, Y / 180, 3) - 0.5)
fine = fbm(X / 60, Y / 60, 4)
mottled = fbm(X / 25, Y / 25, 3)
clearings = fbm(X / 220, Y / 220, 4)

snow = np.array([0.97, 0.98, 1.0])
snow_shade = np.array([0.78, 0.83, 0.93])
rock = np.array([0.3, 0.3, 0.31])
rock_dark = np.array([0.13, 0.13, 0.14])
forest_dark = np.array([0.03, 0.045, 0.035])
larch = np.array([0.13, 0.1, 0.075])
meadow_snow = np.array([0.9, 0.92, 0.96])

img = np.zeros((TR, TA, 3))
# Above the treeline: snow, with rock on the steepest faces and ridges.
steep = np.clip((slope - 0.9) / 0.3, 0, 1) * np.clip((rel - treeline) / 80, 0, 1)
# Rock bands and outcrops showing through the snow on the upper slopes.
bands = np.clip((fbm(X / 160, Y / 160, 4, ridged=True) - 0.55) * 4, 0, 1) * np.clip((slope - 0.4) / 0.3, 0, 1)
steep = np.maximum(steep, bands * 0.55 * np.clip((rel - treeline) / 80, 0, 1))
snowy = snow * (0.9 + 0.1 * fine[..., None]) * (1 - 0.25 * np.clip(slope - 0.4, 0, 1)[..., None]) + snow_shade * 0.0
rocky = rock * (0.75 + 0.5 * mottled[..., None]) + (rock_dark - rock) * (fine[..., None] > 0.6)
alpine = snowy * (1 - steep[..., None]) + rocky * steep[..., None]
# Forest: dark spruce with patches of golden larch, snow between the trees, white gullies.
# Mostly closed canopy, opening into snowy clearings; trees thin out towards the treeline.
thin = np.clip((rel - (treeline - 140)) / 140, 0, 1)
canopy = np.clip((0.95 - 0.25 * thin) + (mottled - 0.5) * 0.6 - np.clip(clearings - 0.7, 0, 1) * 3, 0, 1)
larch_mix = np.clip((fbm(X / 300, Y / 300, 3) - 0.5) * 4, 0, 1) * 0.5
trees = forest_dark * (0.8 + 0.4 * fine[..., None]) * (1 - larch_mix[..., None]) + larch * (0.8 + 0.4 * fine[..., None]) * larch_mix[..., None]
forest = trees * canopy[..., None] + meadow_snow * 0.9 * (1 - canopy[..., None])
in_forest = np.clip((treeline - rel) / 110 + (fine - 0.5) * 0.8, 0, 1)
# The valley floor itself: snowy fields.
floor = np.clip(1 - rel / 40, 0, 1) * np.clip(1 - slope / 0.3, 0, 1)
# Above the treeline the last trees and boulders dot the snow, thinning out upwards.
scatter = np.clip(1 - (rel - treeline) / 220, 0, 1) * np.clip((mottled - 0.54) * 12, 0, 1) * np.clip((fine - 0.42) * 8, 0, 1)
alpine = alpine * (1 - 0.8 * scatter[..., None]) + forest_dark * 0.8 * scatter[..., None]
img = alpine * (1 - in_forest[..., None]) + forest * in_forest[..., None]
# The valley floor: snowy fields with woods, and here and there the roofs of a village.
woods = np.clip((fbm(X / 350, Y / 350, 4) - 0.52) * 5, 0, 1)
village = np.clip((fbm(X / 500 + 40, Y / 500, 3) - 0.6) * 6, 0, 1) * (fine > 0.5)
fields = meadow_snow * (1 - woods[..., None]) + trees * woods[..., None] * 0.9
fields = fields * (1 - village[..., None] * 0.6) + np.array([0.45, 0.4, 0.37]) * village[..., None] * 0.6
img = img * (1 - floor[..., None]) + fields * floor[..., None]
rgba = np.concatenate([np.clip(img, 0, 1), np.ones((TR, TA, 1))], axis=2)
# Images are stored with row 0 at the bottom in Blender, v = 0 at the inner rim.
lib.reset()
image = lib.image_from_array("mountains_albedo", rgba[::-1].astype(np.float32))
coll = lib.collection("mountains")
mat = lib.material("mountains", (1, 1, 1), 0.95, image=image)
obj = lib.mesh_object("mountains", verts, faces, uvs, mat, coll, smooth=True)

# A look from Junction, down the valley.
JUNCTION = (200 - CENTRE[0], 230 - CENTRE[1], 125)
lib.preview("mountains.png", JUNCTION, (math.cos(math.radians(45)) * 4500, math.sin(math.radians(45)) * 4500, 650), size=(1200, 600), lens=32, ground=False)
lib.preview("mountains_back.png", JUNCTION, (-math.cos(math.radians(60)) * 4500, -math.sin(math.radians(60)) * 4500, 700), size=(1200, 600), lens=32, ground=False)
result = {"export": lib.export_glb("mountains.glb", [obj]), "range": [float(H.min()), float(H.max())]}
