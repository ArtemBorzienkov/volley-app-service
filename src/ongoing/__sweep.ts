import { generateSchedule, packIntoRounds, buildGroupPairings } from './schedule';
const worst = (m: any[]) => {
  const b = new Map<string, number[]>();
  for (const x of m) for (const t of [x.team1Id, x.team2Id]) b.set(t, [...(b.get(t) ?? []), x.round]);
  let w = 0;
  for (const r of b.values()) {
    r.sort((a, c) => a - c);
    let p = 0;
    for (const q of r) {
      w = Math.max(w, q - p - 1);
      p = q;
    }
  }
  return w;
};
const T = (n: number) => Array.from({ length: n }, (_, i) => `t${i}`);
const rows: string[] = [];
for (const g of [1, 2])
  for (const [n, c] of [
    [4, 1],
    [4, 2],
    [5, 1],
    [5, 2],
    [6, 2],
    [6, 3],
    [7, 2],
    [7, 3],
    [8, 2],
    [8, 3],
    [8, 4],
    [9, 3],
    [10, 3],
    [10, 4],
    [12, 3],
    [12, 4],
    [16, 4],
  ]) {
    let bad = 0,
      maxR = 0,
      minR = 1e9,
      ms = 0;
    const runs = 100;
    const t0 = Date.now();
    for (let i = 0; i < runs; i++) {
      const m = generateSchedule(T(n), g, c);
      if (worst(m) > 1) bad++;
      const r = Math.max(...m.map((x) => x.round));
      maxR = Math.max(maxR, r);
      minR = Math.min(minR, r);
    }
    ms = (Date.now() - t0) / runs;
    const fewest = Math.ceil((((n * (n - 1)) / 2) * g) / c);
    rows.push(
      `${String(n).padStart(2)} teams ${c} courts x${g}: rest-rule broken ${String(bad).padStart(
        3,
      )}%  rounds ${minR}-${maxR} (fewest ${fewest})  ${ms.toFixed(1)}ms`,
    );
  }
let gb = 0;
for (let i = 0; i < 100; i++) {
  const m = packIntoRounds(buildGroupPairings([T(12).slice(0, 4), T(12).slice(4, 8), T(12).slice(8)], 1), 4);
  if (worst(m) > 1) gb++;
}
rows.push(`3 groups of 4 on 4 courts: rest-rule broken ${gb}%`);
console.log(rows.join('\n'));
