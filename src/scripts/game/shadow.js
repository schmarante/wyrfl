// Shadow mode: the sun (or the moon) shines from one side, a building casts its shadow on the wall behind it – which
// of four buildings is it? The shadow is exactly the building's silhouette from that side (computeView).
//
// Light from the front → shadow on the back wall (front view); light from the right → shadow on the left wall (side
// view). Not from above: the shadow would lie under the building and be hidden as soon as it stands there.
//
// Distractors are buildings with a different shadow – typical mistakes first (mirrored, the shadow it casts to the
// other side, same ground plan with other heights), then near misses (one cube more or less). Exactly one option
// casts the shadow; each wrong one carries a `kind` → explanation text shadow.why.<kind>.

import { createRng } from './rng.js';
import { generateStructure, computeView, viewsEqual } from './structure.js';

export const OPTION_COUNT = 4;   // buildings are big pictures (and can be turned) – four fit
export const SHADOW_VIEWS = ['front', 'side'];

const key = heights => heights.map(row => row.join(',')).join('/');
const mirrorX = heights => heights.map(row => [...row].reverse());           // left ↔ right
const mirrorZ = heights => [...heights].reverse();                           // front ↔ back
const turn = heights => heights[0].map((_, x) => heights.map(row => row[x]).reverse());   // 90° about the vertical axis
const cubes = heights => heights.flat().reduce((sum, h) => sum + h, 0);

function shuffle(list, rng) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** same ground plan, the tower heights swapped around */
function otherHeights(heights, rng) {
  const cells = [];
  heights.forEach((row, z) => row.forEach((h, x) => h && cells.push([z, x])));
  const values = shuffle(cells.map(([z, x]) => heights[z][x]), rng);
  const next = heights.map(row => [...row]);
  cells.forEach(([z, x], i) => (next[z][x] = values[i]));
  return next;
}

/** one cube more or less somewhere */
function nearMiss(heights, rng, maxHeight) {
  const next = heights.map(row => [...row]);
  const z = rng.int(0, next.length - 1);
  const x = rng.int(0, next.length - 1);
  next[z][x] = Math.min(maxHeight, Math.max(0, next[z][x] + (rng() < 0.5 ? -1 : 1)));
  return next;
}

/**
 * @returns {{ structure, view: 'front' | 'side', shadow: boolean[][],
 *             options: { structure, kind: string, correct: boolean }[], answer: number }}
 */
export function createShadowPuzzle(seed, difficulty = 'easy') {
  const rng = createRng(`shadow:${seed}:${difficulty}`);
  const structure = generateStructure(`shadow:${seed}`, difficulty);
  const { size, maxHeight, heights } = structure;
  const view = rng.pick(SHADOW_VIEWS);
  const shadow = computeView(structure, view);
  const build = h => ({ size, maxHeight, heights: h });

  const classic = [
    { heights: view === 'front' ? mirrorX(heights) : mirrorZ(heights), kind: view === 'front' ? 'mirroredLR' : 'mirroredFB' },
    { heights: turn(heights), kind: view === 'front' ? 'fromSide' : 'fromFront' },
    { heights: turn(turn(turn(heights))), kind: view === 'front' ? 'fromSide' : 'fromFront' },
    { heights: otherHeights(heights, rng), kind: 'heights' },
  ];

  const seen = new Set([key(heights)]);
  const distractors = [];
  const add = candidate => {
    if (distractors.length >= OPTION_COUNT - 1 || cubes(candidate.heights) < 2) return;
    const k = key(candidate.heights);
    // never a second building with the same shadow – there must be exactly one answer
    if (seen.has(k) || viewsEqual(computeView(build(candidate.heights), view), shadow)) return;
    seen.add(k);
    distractors.push({ structure: build(candidate.heights), kind: candidate.kind });
  };

  shuffle(classic, rng).slice(0, 3).forEach(add);
  for (let tries = 0; distractors.length < OPTION_COUNT - 1 && tries < 500; tries++) {
    let next = nearMiss(heights, rng, maxHeight);
    if (tries > 100) next = nearMiss(next, rng, maxHeight);   // tiny / symmetric buildings: two changes
    add({ heights: next, kind: 'nearMiss' });
  }
  classic.forEach(add);   // last resort

  const options = shuffle(
    [{ structure, kind: 'correct', correct: true }, ...distractors.map(d => ({ ...d, correct: false }))],
    rng,
  );
  return { structure, view, shadow, options, answer: options.findIndex(o => o.correct) };
}
