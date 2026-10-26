# Viva la Cresta

A mobile 3D game about riding the Cresta Run, from first lying start on Beginner Day to winning the Grand National. See [PLAN.md](PLAN.md) for the design and phases.

Play: https://altogi.github.io/viva-la-cresta/ (installable as an app from the browser's share/install menu).

## Develop

```bash
npm install
npm run dev      # http://localhost:5173/viva-la-cresta/  (add ?debug for FPS and console timings)
npm test
npm run build
```

Built with TypeScript, Three.js and Vite. Everything is generated in code: the track's elevation profile comes from the 1906 plan and profile (`src/track/cresta.ts`); its alignment, the buildings and the woods come from OpenStreetMap (`src/track/osm.ts`).

Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), available under the Open Database License. Clubhouse reference photo: Dennis G. Jarvis, [CC BY-SA 2.0](https://commons.wikimedia.org/wiki/File:Switzerland-01555_-_Cresta_Run_(22108784018).jpg).

## Layout

- `src/track/cresta.ts` — the run: elevation profile, bends, bank shapes, landmarks
- `src/sim/` — track geometry (no Three.js), later the riding physics
- `src/render/` — track mesh, terrain, scenery, sky and light
- `src/viewer/` — the current track viewer and its ghost rider
