// Writes src/data/stops.generated.json from src/data/layout.json.
// Run with `npm run gen-stops` (also runs before `dev` and `build`).
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parsePlan } from '../src/scene/plan';
import { buildJourney } from '../src/scene/journey';

const journey = buildJourney(parsePlan());
const out = fileURLToPath(new URL('../src/data/stops.generated.json', import.meta.url));
writeFileSync(out, JSON.stringify(journey.stops, null, 2) + '\n');

console.log(`stops.generated.json: path ${journey.length.toFixed(1)} units`);
for (const s of journey.stops) console.log(`  ${s.chapterId.padEnd(10)} progress ${s.progress.toFixed(4)}  anchor ${s.anchor.join(', ')}`);
