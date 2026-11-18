// Mode A (View Guesser): a structure, one asked view, six answers – the correct view and five distractors.
// Distractors are the typical mistakes first (mirrored, other side, rotated), then near misses (one column /
// one cell off). Each carries a `kind` so the UI can explain *why* it is wrong.

import { createRng } from './rng.js';
import { generateStructure, computeView, VIEWS } from './structure.js';

export const OPTION_COUNT = 6;

const key = grid => grid.map(row => row.map(v => (v ? 1 : 0)).join('')).join('/');
const mirror = grid => grid.map(row => [...row].reverse());
const flip = grid => [...grid].reverse();
const rotate = grid => grid[0].map((_, c) => grid.map(row => row[c]).reverse()); // 90° clockwise (square grids)
const isEmpty = grid => grid.every(row => row.every(v => !v));

// front/side views are "gravity" grids: each column is filled from the bottom
const columnsOf = grid => grid[0].map((_, c) => grid.filter(row => row[c]).length);
const fromColumns = (columns, rows) => Array.from({ length: rows }, (_, r) => columns.map(h => h >= rows - r));

function shuffle(list, rng) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** A near miss: one column one cube higher/lower (front/side) or one cell toggled (top). */
function nearMiss(grid, view, rng, maxHeight) {
  if (view === 'top') {
    const g = grid.map(row => [...row]);
    const r = rng.int(0, g.length - 1);
    const c = rng.int(0, g[0].length - 1);
    g[r][c] = !g[r][c];
    return g;
  }
  const columns = columnsOf(grid);
  const i = rng.int(0, columns.length - 1);
  columns[i] = Math.min(maxHeight, Math.max(0, columns[i] + (rng() < 0.5 ? -1 : 1)));
  return fromColumns(columns, maxHeight);
}

/**
 * @returns {{ structure, view, options: { grid: boolean[][], kind: string, correct: boolean }[], answer: number }}
 */
export function createGuessPuzzle(seed, difficulty = 'easy') {
  const rng = createRng(`guess:${seed}:${difficulty}`);
  const structure = generateStructure(seed, difficulty);
  const view = rng.pick(VIEWS);
  const correct = computeView(structure, view);

  const classic = [];
  if (view === 'top') {
    let r = correct;
    for (let i = 0; i < 3; i++) classic.push({ grid: (r = rotate(r)), kind: 'rotated' });
    classic.push({ grid: mirror(correct), kind: 'mirrorTop' });
    classic.push({ grid: flip(correct), kind: 'flipped' });
  } else {
    const other = computeView(structure, view === 'front' ? 'side' : 'front');
    classic.push({ grid: mirror(correct), kind: view === 'front' ? 'fromBack' : 'fromLeft' });
    classic.push({ grid: other, kind: view === 'front' ? 'isSide' : 'isFront' });
    classic.push({ grid: mirror(other), kind: 'otherSide' });
  }

  const seen = new Set([key(correct)]);
  const distractors = [];
  const add = candidate => {
    const k = key(candidate.grid);
    if (seen.has(k) || isEmpty(candidate.grid) || distractors.length >= OPTION_COUNT - 1) return;
    seen.add(k);
    distractors.push(candidate);
  };

  // at most 3 typical mistakes, the rest are near misses (harder to spot)
  shuffle(classic, rng).slice(0, 3).forEach(add);
  for (let tries = 0; distractors.length < OPTION_COUNT - 1 && tries < 500; tries++) {
    // after many tries (tiny/symmetric views) allow two changes
    let grid = nearMiss(correct, view, rng, structure.maxHeight);
    if (tries > 100) grid = nearMiss(grid, view, rng, structure.maxHeight);
    add({ grid, kind: 'nearMiss' });
  }
  // last resort for odd cases: any remaining classic candidates
  classic.forEach(add);

  const options = shuffle([{ grid: correct, kind: 'correct', correct: true }, ...distractors.map(d => ({ ...d, correct: false }))], rng);
  return { structure, view, options, answer: options.findIndex(o => o.correct) };
}
