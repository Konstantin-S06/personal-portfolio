// Usage (from the repo root, PowerShell or bash):  node campfire-arc/apply-campfire-arc.mjs
// Optional: node apply-campfire-arc.mjs <repo-root>
// All-or-nothing: every edit is checked first; if any "find" text is missing or not unique, NOTHING is written.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.argv[2] ?? '.');
const src = (p) => path.join(root, 'src', p);

const edits = {
  'scene/world.ts': [
    [`import * as L from './look';`, `import * as L from './look';\nimport { createCampfireFx, FIRE_GAZE } from './fire';`],
    [
      `  const flameMat = new THREE.MeshStandardMaterial({
    color: L.CAMPFIRE_FLAME_COLOR,
    emissive: L.CAMPFIRE_FLAME_COLOR,
    emissiveIntensity: 2.2,
    roughness: 1,
    metalness: 0,
    flatShading: true,
  });
  disposables.push(flameMat);
`,
      '',
    ],
    [
      `  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.9, 5), flameMat);
  flame.position.set(campfire.x, 0.55, campfire.z);
  campGroup.add(flame);
  disposables.push(flame.geometry);`,
      `  const fireFx = createCampfireFx(campfire);
  campGroup.add(fireFx.group);
  disposables.push(fireFx);`,
    ],
    [`  const look = new THREE.Vector3();`, `  const look = new THREE.Vector3();\n  const gazeAim = new THREE.Vector3();`],
    [
      `    if (p < 0.92) {
      curve.getPointAt(Math.min(p + 0.02, 1), look);
    } else {
      const w = THREE.MathUtils.smoothstep(p, 0.92, 1);
      curve.getPointAt(Math.min(p + 0.02, 1), look);
      look.lerp(new THREE.Vector3(campfire.x, 0.7, campfire.z), w);
    }`,
      `    curve.getPointAt(Math.min(p + 0.02, 1), look);
    const wFire = THREE.MathUtils.smoothstep(p, FIRE_GAZE.start, 1);
    if (wFire > 0) {
      // Aim so the fire's base sits baseDeg below screen centre, then slide it left of centre for Contact.
      const dist = Math.max(Math.hypot(campfire.x - pos.x, campfire.z - pos.z), 0.5);
      const pitch = Math.atan2(pos.y, dist) - THREE.MathUtils.degToRad(FIRE_GAZE.baseDeg);
      const side = dist * Math.tan(THREE.MathUtils.degToRad(FIRE_GAZE.sideDeg)) * THREE.MathUtils.smoothstep(p, FIRE_GAZE.sideStart, 1);
      gazeAim.set(campfire.x - endTan.z * side, pos.y - dist * Math.tan(pitch), campfire.z + endTan.x * side);
      look.lerp(gazeAim, wFire);
    }`,
    ],
    [
      `      flame.scale.set(0.9 + 0.15 * flick, flick, 0.9 + 0.12 * flick);
      flameMat.emissiveIntensity = 1.6 + 1.1 * flick;`,
      `      fireFx.flicker = flick;`,
    ],
    [
      `      flame.scale.set(1, 1, 1);
      flameMat.emissiveIntensity = 2.0;`,
      `      fireFx.flicker = 1;`,
    ],
    [
      `    flyUniforms.uMotion.value = motion ? 1 : 0;`,
      `    flyUniforms.uMotion.value = motion ? 1 : 0;\n    fireFx.update(clock, flyUniforms.uPx.value);`,
    ],
  ],
  'components/ChapterContent.tsx': [
    [`import { ProjectPanel } from './ProjectPanel';`, `import { MoreArc } from './MoreArc';\nimport { ProjectPanel } from './ProjectPanel';`],
    [`  projectTotal: number;\n  onNavigate: (id: string) => void;`, `  projectTotal: number;\n  moreProjects?: Project[];\n  onNavigate: (id: string) => void;`],
    [`    case 'cta':`, `    case 'more':\n      return <MoreArc title={title} projects={actions.moreProjects ?? []} />;\n    case 'cta':`],
  ],
  'components/Stage.tsx': [
    [`import { pinLengthVh, type Chapter } from '../chapters';`, `import { pinLengthVh, remainingProjects, type Chapter } from '../chapters';`],
    [`  let projectNo = 0;\n  return (\n    <div className="stage-track"`, `  let projectNo = 0;\n  const moreProjects = remainingProjects(chapters, projects);\n  return (\n    <div className="stage-track"`],
    [
      "className={`panel${c.kind === 'project' ? ' panel-project' : ''}`}",
      "className={`panel${c.kind === 'project' ? ' panel-project' : ''}${c.kind === 'more' ? ' panel-more' : ''}`}",
    ],
    [`                    projectTotal,\n                    onNavigate: (id) => navRef.current?.(id),`, `                    projectTotal,\n                    moreProjects,\n                    onNavigate: (id) => navRef.current?.(id),`],
  ],
  'components/FlatSections.tsx': [
    [`import type { Chapter } from '../chapters';`, `import { remainingProjects, type Chapter } from '../chapters';`],
    [`  let projectNo = 0;\n`, `  let projectNo = 0;\n  const moreProjects = remainingProjects(chapters, projects);\n`],
    [`                projectTotal,\n                onNavigate: () => {},`, `                projectTotal,\n                moreProjects,\n                onNavigate: () => {},`],
  ],
  'App.tsx': [
    [`import { MoreProjects } from './components/ProjectPanel';\n`, ''],
    [
      `  // Projects that already have a chapter; everything else lands in the "More projects" grid.
  const shown = useMemo(
    () => new Set(chapters.flatMap((c) => (c.projectId !== undefined ? [c.projectId] : []))),
    [chapters],
  );

`,
      '',
    ],
    [`    { id: 'more-projects', label: 'More projects' },`, `    ...(chapters.some((c) => c.kind === 'more') ? [{ id: 'more-projects', label: 'More projects' }] : []),`],
    [
      `                  onClick={(e) => {
                    // "More projects" sits after the pin, so the browser scrolls to that section.
                    if (item.id === 'more-projects') return;
                    onChapterClick(e, item.id);
                  }}`,
      `                  onClick={(e) => onChapterClick(e, item.id)}`,
    ],
    [`        <MoreProjects projects={projects} shown={shown} />\n`, ''],
  ],
};

const copies = [
  ['fire.ts', 'scene/fire.ts'],
  ['MoreArc.tsx', 'components/MoreArc.tsx'],
  ['chapters.ts', 'chapters.ts'],
  ['stops.ts', 'lib/stops.ts'],
];

const out = new Map(); // path -> new text (original line endings kept)
const problems = [];

for (const [file, list] of Object.entries(edits)) {
  const p = src(file);
  if (!fs.existsSync(p)) { problems.push(`missing file: ${p}`); continue; }
  const raw = fs.readFileSync(p, 'utf8');
  const crlf = raw.includes('\r\n');
  let text = raw.replace(/\r\n/g, '\n');
  list.forEach(([find, repl], i) => {
    const n = text.split(find).length - 1;
    if (n !== 1) { problems.push(`${file} edit #${i + 1}: found ${n} matches (need exactly 1): ${JSON.stringify(find.slice(0, 70))}`); return; }
    text = text.replace(find, () => repl);
  });
  out.set(p, crlf ? text.replace(/\n/g, '\r\n') : text);
}
for (const [from, to] of copies) {
  const d = src(to);
  if (!fs.existsSync(path.dirname(d))) problems.push(`missing folder for ${to}`);
  out.set(d, fs.readFileSync(path.join(here, 'drop-in', from), 'utf8'));
}
const cssPath = src('styles.css');
const css = fs.existsSync(cssPath) ? fs.readFileSync(cssPath, 'utf8') : null;
if (css === null) console.warn('! src/styles.css not found: append drop-in/more-arc.css to your stylesheet by hand.');
else if (!css.includes('More projects: cards curved around the campfire')) {
  out.set(cssPath, css + fs.readFileSync(path.join(here, 'drop-in', 'more-arc.css'), 'utf8'));
}

if (problems.length) {
  console.error('NOTHING WRITTEN. Problems:\n - ' + problems.join('\n - '));
  process.exit(1);
}
for (const [p, t] of out) fs.writeFileSync(p, t);
console.log('Applied. Files written:\n - ' + [...out.keys()].map((p) => path.relative(root, p)).join('\n - '));
