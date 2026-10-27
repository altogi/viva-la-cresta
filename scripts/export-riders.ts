// Writes blender/riders.json: each rider's proportions and kit colours, from the game's own
// definitions, for blender/riders.py to build their bodies to the same measurements.
// Run with: npx vite-node scripts/export-riders.ts

import { writeFileSync } from 'node:fs';
import { LOOKS } from '../src/render/riderLooks';

writeFileSync('blender/riders.json', JSON.stringify(LOOKS, null, 1));
console.info(`${Object.keys(LOOKS).length} riders`);
