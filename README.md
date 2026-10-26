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

Built with TypeScript, Three.js and Vite. Everything is generated in code: the track comes from `src/track/cresta.ts`, digitised from the 1906 plan and profile.

## Layout

- `src/track/cresta.ts` — the run: elevation profile, bends, bank shapes, landmarks
- `src/sim/` — track geometry (no Three.js), later the riding physics
- `src/render/` — track mesh, terrain, scenery, sky and light
- `src/viewer/` — the current track viewer and its ghost rider
