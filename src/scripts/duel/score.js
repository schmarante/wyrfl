// Duel scoring – pure logic (tested). Both players solve the same puzzles; per puzzle:
//   right on the first try 3 points, second try 2, later 1; using the hint costs 1 (never below 0)
//   whoever solved it faster gets +1 "lightning" point (only if both solved it)
// Results are kind: every player gets highlights of what went well, there is no "you lost" screen.

export const POINTS = [3, 2, 1];

/** @param {{ tries: number, hint: boolean, ms: number }} r */
export function basePoints(r) {
  if (!r) return 0;
  return Math.max(0, POINTS[Math.min(r.tries, POINTS.length) - 1] - (r.hint ? 1 : 0));
}

/**
 * @param {Array<{tries,hint,ms}|undefined>} mine
 * @param {Array<{tries,hint,ms}|undefined>} theirs
 */
export function compareResults(mine, theirs, rounds = Math.max(mine.length, theirs.length)) {
  const rows = [];
  const total = { mine: 0, theirs: 0 };
  for (let i = 0; i < rounds; i++) {
    const a = mine[i];
    const b = theirs[i];
    const row = { round: i, mine: basePoints(a), theirs: basePoints(b), faster: null };
    if (a && b && a.ms !== b.ms) {
      row.faster = a.ms < b.ms ? 'mine' : 'theirs';
      row[row.faster] += 1;
    }
    total.mine += row.mine;
    total.theirs += row.theirs;
    rows.push(row);
  }
  const winner = total.mine === total.theirs ? 'tie' : total.mine > total.theirs ? 'mine' : 'theirs';
  return { rows, total, winner, highlights: { mine: highlights(mine, rows, 'mine'), theirs: highlights(theirs, rows, 'theirs') } };
}

/** What went well – used for encouraging messages (most remarkable first). */
function highlights(results, rows, side) {
  const list = [];
  const firstTry = results.filter(r => r && r.tries === 1).length;
  const faster = rows.filter(r => r.faster === side).length;
  const solved = results.filter(Boolean);
  if (solved.length && firstTry === solved.length) list.push({ key: 'allFirstTry' });
  else if (firstTry) list.push({ key: 'firstTry', count: firstTry });
  if (faster) list.push({ key: 'faster', count: faster });
  if (solved.length) {
    const best = Math.min(...solved.map(r => r.ms));
    list.push({ key: 'fastest', seconds: Math.max(1, Math.round(best / 100) / 10) });
  }
  return list;
}
