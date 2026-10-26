# Viva la Cresta — Implementation Plan

A mobile 3D game about riding the Cresta Run, from first lying start on Beginner Day to winning the Grand National.

## Decisions so far

| Area | Decision |
|---|---|
| Stack | TypeScript + Three.js (WebGL), built with Vite — the Battle Drones stack |
| Delivery | PWA on GitHub Pages (installable, offline). Capacitor wrap for app stores is possible later |
| Repo | `altogi/viva-la-cresta`, public. Reference photos and `sample_data/` (times, results sheets) stay local (git-ignored) |
| Art | **Semi-realistic** (revised after Phase 1): believable proportions and materials, not cartoon low-poly. Rigged, skinned riders; textured pines; PBR ice and snow with procedural normal maps; image-based sky lighting. Landmarks (clubhouse and Tower, Top hut, bridges) modelled from photos, and everything laid out from satellite imagery. Geometry stays code-generated where it can; rider and tree assets may be imported glTF/textures under permissive licences |
| Physics | Calibrated simulation: real track profile; times must land in real ranges |
| Screen | Portrait, chase camera behind and above the rider |
| Controls | Hold-for-intensity touch zones; multi-touch (steer + rake at once) |
| Falls | Rider separates from toboggan → simple ragdoll into straw/snow → slow-mo replay → DQ |
| Audio | Procedural, Web Audio API, no audio files |
| Language | English only |
| Branding | Real names (SMTC, Kulm, Sunny Bar, Cresta Run) and the SMTC logo (`public/smtc-logo.svg`) |
| NPC riders | Fictional: initials and surnames shuffled from real results sheets, never a real combination (`src/data/npcNames.ts`, 186 names with nationality) |
| Deferred | Budget/economy, kit with performance effects, shop (America toboggan, suits), real-date races, on-screen splits |

## Calibration targets

From the brief:

| Start | Toboggan | Start style | Target |
|---|---|---|---|
| Junction | any | lying | ~80 s |
| Junction | traditional | running | ~49 s |
| Junction | flat-top | running | ~45 s |
| Top | any | lying | ~80 s |
| Top | traditional | running | ~60 s |
| Top | flat-top (very good) | running | ~55 s |

Records on the map serve as the ceiling of what a perfect ride can do: 40.94 s from Junction and 49.92 s from Top.

From `my-times.csv` (traditional, a solid Junction ride of about 48 s): Rise ≈ 12.7 s, Stream ≈ 28 s, Bulpetts ≈ 34.5 s, Finish ≈ 48 s, finish speed ≈ 62–65 mph. From Top (about 68 s): Junction split ≈ 25–26 s. The game won't show splits yet. The simulation still records them internally, so its speed profile along the run can be compared with real riding, not just the total time. The CSV also shows a typical learning curve: about 80–100 s rides in the first sessions, then 55–65 s, then the 48–50 s plateau. Bot riders can use that shape to check the progression pacing.

From the results sheets (`sample_data/`), which set the strength of NPC fields:
- **Curzon Cup field** (Junction, scratch): 42.3–47 s per run, finish speeds 66–74 mph. Elite splits: Rise ≈ 11.6 s, Stream ≈ 24.6 s, Bulpetts ≈ 30.4 s, Finish ≈ 42.3 s.
- **Minor Junction field**: 45–51 s. Supplementary List riders: 47–65 s.
- **Top handicap field** (Badrutt Trophy): 54–72 s per run, handicaps from Scr to 13.0 s. The fastest Grand National course quoted is 52.21 s.
- **Falls** are frequent and mostly at Shuttlecock: 10 of 58 starters in the handicap race fell, 9 at Shuttlecock (`Fall(S)`) and 1 at Thoma (`Fall(TH)`).

Winning a scratch major means beating these fields. The physics must therefore let an excellent player approach the records (about 42 s from Junction and 52 s from Top on a flat-top), well past the "good rider" targets above.

## Track model

Track data comes from the plan-and-profile map (positions are distance along the run in metres, to be refined while digitising):

Top start ~10 · Stable Junction ~70 · Church Leap ~160 · Curzon (L) ~190 · Brabazon (R) ~240 · Thoma (L) ~290 · **Junction start ~330** · Junction Straight · Rise (R) ~420 · Battledore (R) ~520 · Shuttlecock (L) ~590 · Stream (R) ~690 · Bledisloe Straight ~700–880 · Bulpetts (R) ~900 · Scylla (L) ~1020 · Charybdis (R) ~1100 · Cresta Leap ~1140 · **Finish 1212.5**

Known drops: Top→Junction 55 m over 322 m; Junction→Stream 42 m (1 in 8.6); Stream→Finish 60 m (1 in 8.7). Total drop is 157 m.

Representation:
- **Centreline**: a 3D spline built from the plan view (x/y) and the elevation profile (z), sampled every ~0.5 m.
- **Cross-sections**: a 2D profile at each station (flat floor plus a curved wall rising on the outside of each bank, with a rim height and a lip). Bank parameters such as radius, wall height and wall curvature are estimated from the photos. The upper banks (Curzon, Thoma) are deep, tall and curved. Shuttlecock is wide and comparatively low, with straw beyond the lip and then red padded walls. Stream has a very high wall. The lower banks are shallow.
- One track data file (`track/cresta.ts`) drives both the physics surface and the mesh, so they never disagree.

## Physics model

The simulation runs at a fixed time step (e.g. 240 Hz), deterministic and independent of rendering. Determinism enables replays, slow-mo fall replays, ghosts later, and headless calibration.

The rider + toboggan is simulated **in track coordinates**: distance along the centreline `s` and position across the cross-section `u` (floor → up the wall), each with its velocity, plus heading relative to the track. This makes bank physics cheap and stable on a phone:
- **Gravity** along the slope and across the wall. **Centripetal demand** in a bank pushes the rider up the wall when they're too fast for their line: high line vs low line comes out naturally.
- **Runner friction**: low when forward, higher on the knives. **Lateral grip**: weak forward, strong on the knives, which is why steering on the knives works.
- **Aerodynamic drag**: depends on posture (forward and flat < knives < sitting up) and toboggan (flat-top shoulders-down is the slipperiest).
- **Rakes**: drag force scaled by intensity and mode (maximum on the knives); a single foot adds yaw. The effect grows with speed.
- **Steering**: on the knives, arm steering is a strong yaw torque. Forward, a head turn acts as an aerodynamic yaw that grows with speed².
- **Forward ↔ knives** is a timed weight transfer (cushion slide on a traditional, body slide on a flat-top). Its duration is set by rider agility. Mid-transition the rider has blended properties.
- **Ice friction** = base μ × weather curve × snow factor.

**Falls** (losing the toboggan = DQ):
- *Fly-out*: `u` passes the lip with outward velocity → switch to free 3D ballistic + ragdoll (straw, snow, padded walls).
- *Fall-back-in / crash*: wall impact or lateral acceleration above a threshold (e.g. coming down Shuttlecock's wall too fast at the wrong angle, or slamming into Stream) → rider and toboggan separate inside the track.
- *Bankinas*: touching the walls in the lower banks costs speed and adds wobble, but doesn't separate the rider unless the hit is hard.

## Controls (portrait)

```
┌───────────────────────┐
│     FRONT: toggle     │  tap → forward ⇄ knives
│        knives         │
├──────┬────────┬───────┤
│ LEFT │ rider  │ RIGHT │  hold → steer (head turn forward / arms on knives)
│steer │        │ steer │
├──────┼────────┼───────┤
│ RAKE │  RAKE  │ RAKE  │  hold → rake (left foot / both / right foot)
│  L   │  both  │   R   │
└──────┴────────┴───────┘
Running start: RUN button below the rider, tap rhythmically.
```

Holding a zone ramps the intensity up over ~0.3 s, so a short tap still gives a light touch. Haptic feedback where supported. Optional subtle on-screen zone hints, shown during Beginner Day.

## Riders

| | Maximilian | Adelaide | Remo |
|---|---|---|---|
| Mass | light (~65 kg) | medium (~78 kg) | heavy (~105 kg) |
| Agility (transition time, steer response) | ★★★ | ★★ | ★ |
| Reach (arm steering strength) | ★★★ | ★★ | ★★ |
| Running start | ★★★ | ★★ | ★ |
| Straight-line speed (mass vs drag) | ★ | ★★ | ★★★ |
| Snow days | worse | neutral | better |
| Hangover chance | high | low | medium (beer) |

Each rider has a clear identity. Maximilian is forgiving in Shuttlecock but has to win the start. Remo is a rocket on the Bledisloe but needs to brake early and plan his line. Adelaide is the balanced all-rounder. All three must be able to win the Grand National; bot calibration checks this.

**Hangover** gives input latency, small random steering wobble, slower transitions and weaker running-start steps.

## Toboggans

- **Traditional**: cushion slide, moderate steering gain, stable. The starting toboggan.
- **Flat-top**: lower drag forward (shoulders down), much higher steering sensitivity (flex), quicker but twitchier. It's faster and less forgiving.
- **America**: deferred, as a later shop or traditional-event item.

## Progression rules

1. Beginner Day: 3 rides, lying start, traditional, from Junction. Tutorial overlays. The rider appears on sheets as **SL** (Supplementary List: non-members, who can't race).
2. Junction Practice: 3 rides, running-start conversion. The number of allowed steps grows ride by ride until it's a full running start.
3. Joins the SMTC ("the President took a liking to you"), skipping the usual years on the Supplementary List → the SL tag goes and the rider can enter races. Practice rides allowed between races.
4. **Unlock**: 3 of the last 5 Junction rides under 48 s on a traditional → choose: flat-top or Top.
5. Switching to a flat-top: 3 lying starts from Junction, then running conversion; 3 of the last 5 under 47 s → Top.
6. First Top ride: lying start, rake hard. Then running conversion from Top.
7. **Minor races are handicap races** (from Junction or Top), each 3 courses in one day. The handicap is **per course**: net total = sum of 3 times − 3 × handicap (verified against the Badrutt sheet). Any fall = DQ. The Tower sets handicaps with a deliberately opaque formula based on recent times, in steps of 0.1 s, from Scr up to about 13 s. Slower riders get a generous allowance; it shrinks as they improve. The real sheets show slow riders with big handicaps often winning on net time.
8. **Major races are scratch** (raw aggregate time, no handicap):

   | Race | Start | Format |
   |---|---|---|
   | Curzon Cup | Junction | 2 days × 3 courses |
   | Brabazon Trophy | Top | 2 days × 3 courses |
   | Morgan Cup | Top | 1 day × 3 courses |
   | Grand National | Top | 2 days × 3 courses |

   A fall on any course of a multi-day race disqualifies the rider from the whole race. Each day rolls its own weather. A rider can enter a major once qualified for its start: the Curzon right after joining, the Top majors only after unlocking Top.
9. **Career shape**: early wins come from handicap races. The majors are entered as soon as the rider qualifies, but at first they're about finishing and climbing the scratch board. **Winning the Grand National on scratch** is the ending (then free play).
10. Every race has a field of NPC riders: about 20 in a major and 30–60 in a handicap race. Their time distributions and fall rates come from the sheets above, and each has a handicap.
11. **Results sheets** are styled after the Tower's printouts: header, race and start, date, per-course times, total/net, `Fall(S)`/`Fall(TH)` markers, Fastest Time and Fastest Speed of the Day, Pilot Course, plus the next day's programme.

## Conditions

Each day is randomised:
- **Overnight temperature** −25…−2 °C → friction curve with its minimum at −13 °C, "sticky" toward −20 °C and slower above it.
- **Snow** (none/light/heavy) → extra resistance that heavy riders push through better.
- **Wind** → a head- or tailwind component on the straights, plus gusts.
- **Hangover** (rider-dependent probability).

These are revealed before the bell in a dramatic card ("It snowed all night. The Tower warns of a slow, heavy run." / "Drakula was a mistake.").

## Architecture

```
src/
  main.ts                 app bootstrap, PWA registration
  sim/                    deterministic simulation (no Three.js imports)
    track.ts              spline + cross-sections, queries (pos, normal, wall height at s,u)
    rider.ts              rider/toboggan state, stats
    physics.ts            fixed-step integrator, forces, fall detection
    ragdoll.ts            simple fall physics
    weather.ts            friction model, conditions
    fmath.ts              deterministic math (as in Battle Drones)
  track/cresta.ts         digitised track data (the single source of truth)
  render/
    trackMesh.ts          ice, walls, lips, straw, padding, snow terrain
    scenery.ts            Top hut, Junction hut, clubhouse, trees, bridges, St Moritz backdrop
    riderModel.ts         rigged, skinned riders + poses (forward, knives, steer, rake, run, jump-on)
    toboggans.ts          traditional, flat-top
    camera.ts             chase cam, start cam, fall replay cam
  input/touchZones.ts     hold-for-intensity zones, run button
  audio/                  procedural runners, rakes, wind, bell, crowd
  game/                   career state machine, progression rules, races, handicap, NPC field
  ui/                     menus, HUD, cards, results board (DOM overlay)
  save/                   per-rider save slots (localStorage/IndexedDB)
tools/
  track-viewer.html       fly-through + cross-section inspector
  tuning.html             live physics sliders (lil-gui)
  calibrate.ts            headless bot riders → time/split/fall-rate report
tests/                    Vitest: physics invariants, progression rules, handicap
```

**Bot riders**: a parametrised autopilot follows the "usual choreography" (when to go to the knives, rake amount, steering line through Shuttlecock). It runs headless in Node thousands of times and reports times, splits and fall rates per rider/toboggan/start/weather. This is how we keep the physics honest against the calibration targets. It's the same trick as Battle Drones' 1,000 AI-vs-AI playtests.

## Phases

### Phase 0 — Foundations ✅
Vite + TS + Three.js scaffold, PWA (manifest, service worker, icons), GitHub Pages deploy via Actions, Vitest, debug overlay (FPS, sim state), portrait lock and safe-area handling.
**Done when** an empty 3D scene installs to a phone home screen from the Pages URL.

### Phase 1 — The Run ✅ (awaiting your review)
*The run's alignment, buildings and woods now come from OpenStreetMap (bends refitted to within 1.5 m of the mapped centreline on average); the clubhouse and Tower are modelled on their OSM footprint and photos.* *Built for the whole run, Top included: Phase 4 keeps the Top-specific calibration and Top hut detail. The viewer's rough ghost descent already lands close to real splits (Junction 49.3 s: Rise 14.3, Stream 27.9, Bulpetts 36.2, 65 mph at the finish).*

Digitise the map into `cresta.ts` (Junction to Finish first). Cross-section generator for straights and banks. Track mesh: ice with subtle grooves/specular, curved walls, lips, straw beyond Shuttlecock, padded walls, bridges (Hanis, Road, Railway), snow terrain, trees. Track viewer tool.
**Done when** you can fly down the run in the viewer and recognise every bank from Junction to the finish. **Your review**: does it look like the Cresta?

### Phase 2 — Riding vertical slice ★ the crux — built, awaiting your playtest
*Physics in track coordinates (gravity, centrifugal climb, normal-force friction, drag, rakes, steering, grip); falls by flying over a lip, going over a wall, or crashing down one; bot calibration on a traditional from Junction: beginner lying start 80.7 s, solid rider 49.1 s at 66.7 mph, expert 47.1 s, no-brakes bot flies out of Shuttlecock. Debug: `?debug` (tuning panel), `?autopilot=good` (watch a bot ride).*

Physics model in track coordinates. Traditional toboggan. One placeholder rider (Adelaide). Touch zones, lying start and running start, chase camera, fly-out and crash detection with ragdoll + slow-mo replay, finish timing, minimal HUD (time, speed), basic procedural audio (runner hiss, rakes, bell). Tuning page. Bot calibration to the 80 s / 49 s Junction targets and the CSV split shape.
**Done when** a full Junction ride is playable on a phone and Shuttlecock is a real decision. **Your playtest**: as an actual rider, does it feel like the Cresta? Expect a few rounds of tuning here.

### Phase 3 — Riders & toboggans
Semi-realistic rigged models for Maximilian, Adelaide and Remo (proportions, hair, beard, skin suits, helmets, rakes on the boots) with pose blending: running, jump-on, forward, knives, arm steering, head turn, raking feet, fall tumble. Rider stats wired into the physics. Flat-top toboggan with its own handling. Agility-dependent transitions. Bot balance check across all rider × toboggan combinations.
**Done when** the three riders feel distinct and all can reach the targets.

### Phase 4 — From Top
Digitise Top → Junction: Church Leap's near free fall, Curzon, Brabazon, Thoma (first possible fly-out). Top hut scene with waiting riders and the St Moritz panorama. Calibration to the 80 s / 60 s / 55 s Top targets.
**Done when** a Top ride is playable and the Junction Straight braking decision matters.

### Phase 5 — Career
Rider select, save slots, Beginner Day tutorial, Junction Practice, progression engine (rules above), unlock choice screens, club-membership moment. Race flow: handicap races (3 courses, Tower handicap) and the scratch majors (1–2 days), NPC fields, Tower-style results sheets, DQ. Practice between races, the majors through to the Grand National, and an ending.
**Done when** you can play a full career from Beginner Day to winning the Grand National.

### Phase 6 — Conditions & drama
Weather generator and friction model, snow (visual snowfall + physics), wind, hangover effects, dramatic pre-race cards, the bell, a fuller soundscape (crowd at the finish, wind at speed, tannoy).
**Done when** two race days feel different and the cards land.

### Visual upgrade (runs alongside Phases 2–4)
Move the Phase 1 scene to the semi-realistic target: textured pine LODs, PBR ice/snow, sky lighting, and accurate landmark models.

### Accurate surroundings (alongside the visual upgrade)
Goal: the buildings and slopes around the run look like the real ones.

**Sources.** Street View is reference only: Google's terms don't allow extracting its imagery into another product.
- **Building shapes:** swisstopo *swissBUILDINGS3D 3.0*, free Swiss open data. It has every building as a 3D model with real heights and roof shapes, which is far better than OSM footprints.
- **Terrain:** *swissALTI3D* elevation at 0.5–2 m resolution replaces the noise hillside. It also lets us check the run's elevation profile against the real ground.
- **Roofs and ground:** *SWISSIMAGE* aerial photos at 10 cm, also free.
- **Facades:** our own photos taken on site in season, which is the best source, plus *Mapillary* street photos (CC BY-SA, with attribution) where they exist.

**Pipeline.** An offline build script would:
1. Download the swisstopo tiles around the run.
2. Clip them to about 400 m from the run, simplify them and convert them to compressed models with compressed textures, plus a terrain heightmap.
3. Generate a manifest the game loads at runtime.

Nothing is fetched while playing, and everything is cached offline by the app.

**Facades in three tiers:**
1. *Hero buildings*, hand-modelled with photo textures: the clubhouse and Tower, the Top hut, the Kulm, the churches and the hotels that face the run.
2. *Buildings within ~60 m of the ice*: the swisstopo shape plus facade textures from our photos or Mapillary, projected onto each wall.
3. *Everything else*: the swisstopo shape plus a procedural facade (colour, window grid, shutters, sgraffito bands), with per-building settings filled in by a review pass over reference photos.

**Performance:** levels of detail by distance, merged meshes and one texture atlas per tier.

**Licences:** OSM (ODbL) and swisstopo (open data with attribution) are credited in the app.

### Phase 7 — Polish & release
Menus and scenes (SMTC clubhouse, Sunny Bar at the Kulm for results), SMTC branding, performance pass on a mid-range phone (target a steady 60 fps, with a quality fallback), offline check, settings (sound, haptics, hint zones, left-handed mirror), first public release.

### Later (not in this plan)
Budget and economy, kit with performance effects, shop (America toboggan, suits, helmets), races on real calendar dates, splits display, ghost of your best run (the deterministic sim makes this cheap), online leaderboards, app-store wrap.

## Risks

- **Physics feel** is the biggest risk. Mitigation: track-coordinate model, tuning page, bot calibration, and early real-rider playtests (Phase 2 gate).
- **Track accuracy**: bank geometry is estimated from photos. Keep all of it in one data file so corrections are one-line edits.
- **Touch ergonomics** at high speed: evaluate zone sizes on real phones in Phase 2, with left-handed mirroring later.
- **Mobile performance**, now harder with the more realistic look: LODs (detailed near the rider, impostors far away), instanced trees, texture atlases, a single shadowed sun, a capped pixel ratio, and a quality setting.

## Open questions (non-blocking)

1. Where are the Rise, Stream and Bulpetts timing eyes? Default: positions inferred from the split timings.
2. Is a two-day major 3 courses per day (6 in total)? Default: yes, matching the Curzon sheet's "Total First Day" after 3 courses.

Later idea from the sheets: the Badrutt team competition (team names and aggregate times) would make a fun extra.
