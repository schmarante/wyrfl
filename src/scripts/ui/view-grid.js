// Draws a 2D view (boolean grid) as small CSS squares.
// `marks` (same size, true = marked) gets a dashed outline – a shape cue, not color alone.

const FILL = {
  cube: 'bg-cube',
  front: 'bg-front',
  muted: 'bg-muted/70',
};

export function renderViewGrid(el, grid, { fill = 'cube', marks = null } = {}) {
  el.style.gridTemplateColumns = `repeat(${grid[0].length}, minmax(0, 1fr))`;
  el.replaceChildren(
    ...grid.flatMap((row, r) =>
      row.map((filled, c) => {
        const cell = document.createElement('span');
        cell.className = `aspect-square rounded-[3px] ${filled ? FILL[fill] : 'bg-line/50'}`;
        if (marks?.[r][c]) cell.classList.add('view-mark');
        return cell;
      }),
    ),
  );
}
