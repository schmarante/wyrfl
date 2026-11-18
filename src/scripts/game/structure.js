// Cube structures (Würfelgebäude) and their 2D views.
//
// A structure is a height map: heights[z][x] = number of stacked cubes on that grid cell (no overhangs –
// cubes always stand on the ground or on another cube, just like in the Builder mode).
// Coordinates: x runs left → right, z runs back → front (z = size - 1 is the row closest to the viewer).
//
// Views are 2D boolean grids view[row][col], row 0 = top of the picture:
// - top:   looking down, front at the bottom      → size × size, col = x, row = z
// - front: looking from the front (+z)            → maxHeight × size, col = x
// - side:  looking from the right (+x), front on the left → maxHeight × size, col = size - 1 - z
//
// Several structures can share the same three views – always validate an answer by its views.

import { createRng } from './rng.js';

export const DIFFICULTIES = {
  easy: { size: 3, maxHeight: 3, fill: 0.6 },
  medium: { size: 4, maxHeight: 3, fill: 0.6 },
  hard: { size: 5, maxHeight: 4, fill: 0.55 },
  hardcore: { size: 6, maxHeight: 5, fill: 0.5 },
};

export const VIEWS = ['top', 'front', 'side'];

/** Random structure for a seed and difficulty. Never empty, and at least two columns differ in height. */
export function generateStructure(seed, difficulty = 'easy') {
  const { size, maxHeight, fill } = DIFFICULTIES[difficulty];
  const rng = createRng(`${seed}:${difficulty}`);
  for (;;) {
    const heights = Array.from({ length: size }, () =>
      Array.from({ length: size }, () => (rng() < fill ? rng.int(1, maxHeight) : 0)),
    );
    const flat = heights.flat();
    const used = flat.filter(h => h > 0);
    if (used.length >= 2 && new Set(used).size >= 2) return { size, maxHeight, heights };
  }
}

export function cubeCount({ heights }) {
  return heights.flat().reduce((sum, h) => sum + h, 0);
}

/** 2D view of a structure (see top of file). Front and side views are `maxHeight` rows tall. */
export function computeView({ size, maxHeight, heights }, view) {
  if (view === 'top') return heights.map(row => row.map(h => h > 0));
  const column = i =>
    view === 'front'
      ? Math.max(...heights.map(row => row[i]))          // x = i, highest cube over all depths
      : Math.max(...heights[size - 1 - i]);              // z = size - 1 - i, highest cube over all x
  const tallest = Array.from({ length: size }, (_, i) => column(i));
  return Array.from({ length: maxHeight }, (_, row) => tallest.map(h => h >= maxHeight - row));
}

export function viewsEqual(a, b) {
  return a.length === b.length && a.every((row, r) => row.length === b[r].length && row.every((v, c) => v === b[r][c]));
}

/** Cells where two views of the same size differ (true = differs). */
export function diffView(a, b) {
  return a.map((row, r) => row.map((v, c) => v !== b[r][c]));
}

/** Empty structure (Builder start). */
export function emptyStructure(size, maxHeight) {
  return { size, maxHeight, heights: Array.from({ length: size }, () => Array(size).fill(0)) };
}

/** True if `candidate` has exactly the same top, front and side views as `target` (Builder check). */
export function matchesViews(candidate, target) {
  return VIEWS.every(v => viewsEqual(computeView(candidate, v), computeView(target, v)));
}
