import { dealIntoGroups, isPowerOfTwo } from './groups';

// A counter-based generator keeps the shuffle deterministic, so a failure means the dealing is
// wrong rather than that this run drew an unlucky permutation.
function sequenceRandom(values: number[]): () => number {
  let index = 0;
  return () => values[index++ % values.length];
}

describe('isPowerOfTwo', () => {
  it('accepts powers of two', () => {
    for (const n of [1, 2, 4, 8, 16, 32]) expect(isPowerOfTwo(n)).toBe(true);
  });

  it('rejects everything else', () => {
    for (const n of [0, -2, 3, 5, 6, 7, 9, 12, 2.5]) expect(isPowerOfTwo(n)).toBe(false);
  });
});

describe('dealIntoGroups', () => {
  it('puts every team in exactly one group', () => {
    const teams = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const groups = dealIntoGroups(teams, 2, sequenceRandom([0.1, 0.9, 0.5]));

    const flat: string[] = [];
    for (const group of groups) for (const id of group) flat.push(id);

    expect(flat.slice().sort()).toEqual(teams.slice().sort());
    expect(flat).toHaveLength(teams.length);
  });

  it('produces the requested number of groups', () => {
    expect(dealIntoGroups(['a', 'b', 'c', 'd', 'e', 'f'], 3)).toHaveLength(3);
  });

  it('keeps group sizes within one of each other when the split is uneven', () => {
    const groups = dealIntoGroups(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'], 2);
    const sizes = groups.map((group) => group.length).sort();

    expect(sizes).toEqual([4, 5]);
  });

  it('splits evenly when it divides', () => {
    const groups = dealIntoGroups(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], 2);

    expect(groups.map((group) => group.length)).toEqual([4, 4]);
  });

  it('returns one group holding everyone when groupCount is 1', () => {
    const groups = dealIntoGroups(['a', 'b', 'c'], 1);

    expect(groups).toHaveLength(1);
    expect(groups[0].slice().sort()).toEqual(['a', 'b', 'c']);
  });

  it('returns empty groups rather than throwing when there are no teams', () => {
    expect(dealIntoGroups([], 2)).toEqual([[], []]);
  });

  it('tolerates more groups than teams', () => {
    const groups = dealIntoGroups(['a', 'b'], 4);

    expect(groups).toHaveLength(4);
    const filled = groups.filter((group) => group.length > 0);
    expect(filled).toHaveLength(2);
  });
});
