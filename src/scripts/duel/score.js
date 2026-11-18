// Duel scoring – pure logic (tested). 2–4 players solve the same puzzles; per puzzle:
//   right on the first try 3 points, second try 2, later 1; using the hint costs 1 (never below 0)
//   whoever solved it fastest gets +1 "lightning" point (only if at least two solved it and nobody tied for fastest)
// Results are kind: every player gets highlights of what went well, there is no "you lost" screen.

export const POINTS = [3, 2, 1];

/** @param {{ tries: number, hint: boolean, ms: number } | undefined} r */
export function basePoints(r) {
  if (!r) return 0;
  return Math.max(0, POINTS[Math.min(r.tries, POINTS.length) - 1] - (r.hint ? 1 : 0));
}

/**
 * @param {Record<string, Array<{tries,hint,ms}|undefined>>} results  per player id (insertion order = player order)
 * @param {number} [rounds]
 * @returns {{ rows: Array<{ round: number, points: Record<string, number>, fastest: string | null }>,
 *             total: Record<string, number>, ranking: string[], winners: string[], highlights: Record<string, object[]> }}
 */
export function scoreGame(results, rounds) {
  const ids = Object.keys(results);
  rounds ??= Math.max(0, ...ids.map(id => results[id].length));
  const total = Object.fromEntries(ids.map(id => [id, 0]));
  const rows = [];
  for (let round = 0; round < rounds; round++) {
    const points = Object.fromEntries(ids.map(id => [id, basePoints(results[id][round])]));
    const solved = ids.filter(id => results[id][round]);
    let fastest = null;
    if (solved.length >= 2) {
      const best = Math.min(...solved.map(id => results[id][round].ms));
      const holders = solved.filter(id => results[id][round].ms === best);
      if (holders.length === 1) {
        fastest = holders[0];
        points[fastest] += 1;
      }
    }
    for (const id of ids) total[id] += points[id];
    rows.push({ round, points, fastest });
  }
  const ranking = [...ids].sort((a, b) => total[b] - total[a]);   // stable: same points keep the player order
  const top = Math.max(...ids.map(id => total[id]));
  const winners = ids.filter(id => total[id] === top);
  const highlights = Object.fromEntries(ids.map(id => [id, highlightsFor(results[id], rows, id)]));
  return { rows, total, ranking, winners, highlights };
}

/** What went well – used for encouraging messages (most remarkable first). */
function highlightsFor(results, rows, id) {
  const list = [];
  const solved = results.filter(Boolean);
  const firstTry = solved.filter(r => r.tries === 1).length;
  const fastest = rows.filter(r => r.fastest === id).length;
  if (solved.length && firstTry === solved.length) list.push({ key: 'allFirstTry' });
  else if (firstTry) list.push({ key: 'firstTry', count: firstTry });
  if (fastest) list.push({ key: 'faster', count: fastest });
  if (solved.length) {
    const best = Math.min(...solved.map(r => r.ms));
    list.push({ key: 'fastest', seconds: Math.max(1, Math.round(best / 100) / 10) });
  }
  return list;
}
