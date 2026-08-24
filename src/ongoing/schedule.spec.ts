import { buildPairings, buildGroupPairings, packIntoRounds, generateSchedule, ScheduledMatch } from './schedule';

// A counter-based generator keeps the shuffle deterministic, so a failure means the
// packing is wrong rather than that this run drew an unlucky permutation.
function sequenceRandom(values: number[]): () => number {
  let index = 0;
  return () => values[index++ % values.length];
}

describe('buildPairings', () => {
  it('produces every unordered pair exactly once for gamesPerPair 1', () => {
    const pairs = buildPairings(['a', 'b', 'c'], 1);

    expect(pairs).toHaveLength(3);
    expect(pairs).toEqual([
      ['a', 'b'],
      ['a', 'c'],
      ['b', 'c'],
    ]);
  });

  it('repeats every pair gamesPerPair times', () => {
    const pairs = buildPairings(['a', 'b', 'c'], 3);

    expect(pairs).toHaveLength(9);
    expect(pairs.filter(([one, two]) => one === 'a' && two === 'b')).toHaveLength(3);
  });

  it('returns nothing for fewer than two teams', () => {
    expect(buildPairings(['a'], 2)).toEqual([]);
  });
});

describe('packIntoRounds', () => {
  it('never schedules a team twice in the same round', () => {
    const matches = packIntoRounds(buildPairings(['a', 'b', 'c', 'd'], 1), 2);

    const teamsByRound = new Map<number, string[]>();
    for (const match of matches) {
      const teams = teamsByRound.get(match.round) || [];
      teams.push(match.team1Id, match.team2Id);
      teamsByRound.set(match.round, teams);
    }

    for (const teams of teamsByRound.values()) {
      expect(new Set(teams).size).toBe(teams.length);
    }
  });

  it('never puts more matches in a round than there are courts', () => {
    const matches = packIntoRounds(buildPairings(['a', 'b', 'c', 'd', 'e', 'f'], 1), 2);

    const sizeByRound = new Map<number, number>();
    for (const match of matches) {
      sizeByRound.set(match.round, (sizeByRound.get(match.round) || 0) + 1);
    }

    for (const size of sizeByRound.values()) {
      expect(size).toBeLessThanOrEqual(2);
    }
  });

  it('numbers courts from 1 and order from 0 within each round', () => {
    const matches = packIntoRounds(
      [
        ['a', 'b'],
        ['c', 'd'],
      ],
      2,
    );

    expect(matches.map((match) => [match.round, match.court, match.order])).toEqual([
      [1, 1, 0],
      [1, 2, 1],
    ]);
  });

  it('keeps every pair — packing drops nothing', () => {
    const pairs = buildPairings(['a', 'b', 'c', 'd'], 2);

    expect(packIntoRounds(pairs, 1)).toHaveLength(pairs.length);
  });

  it('gives each match its own round when there is one court', () => {
    const matches = packIntoRounds(buildPairings(['a', 'b', 'c'], 1), 1);

    expect(matches.map((match: ScheduledMatch) => match.round)).toEqual([1, 2, 3]);
  });
});

describe('generateSchedule', () => {
  it('produces one match per pairing regardless of shuffle order', () => {
    const matches = generateSchedule(['a', 'b', 'c', 'd'], 2, 2, sequenceRandom([0.1, 0.9, 0.5]));

    expect(matches).toHaveLength(12);
  });

  it('returns nothing when there are fewer than two teams', () => {
    expect(generateSchedule(['a'], 3, 2)).toEqual([]);
  });
});

describe('buildGroupPairings', () => {
  it('pairs only within each group', () => {
    const pairs = buildGroupPairings(
      [
        ['a', 'b', 'c'],
        ['x', 'y', 'z'],
      ],
      1,
    );

    expect(pairs).toHaveLength(6);
    for (const [one, two] of pairs) {
      const bothLeft = ['a', 'b', 'c'].includes(one) && ['a', 'b', 'c'].includes(two);
      const bothRight = ['x', 'y', 'z'].includes(one) && ['x', 'y', 'z'].includes(two);
      expect(bothLeft || bothRight).toBe(true);
    }
  });

  it('never pairs a team from one group with a team from another', () => {
    const pairs = buildGroupPairings(
      [
        ['a', 'b'],
        ['x', 'y'],
      ],
      1,
    );

    expect(pairs).toHaveLength(2);
    expect(pairs.some(([one, two]) => (one === 'a' && two === 'x') || (one === 'x' && two === 'a'))).toBe(false);
  });

  it('repeats each within-group pair gamesPerPair times', () => {
    const pairs = buildGroupPairings(
      [
        ['a', 'b'],
        ['x', 'y'],
      ],
      3,
    );

    expect(pairs).toHaveLength(6);
  });

  it('is equivalent to a flat round-robin when there is one group', () => {
    const grouped = buildGroupPairings([['a', 'b', 'c', 'd']], 1);

    expect(grouped).toHaveLength(6);
  });

  it('ignores empty groups', () => {
    expect(buildGroupPairings([['a', 'b'], []], 1)).toHaveLength(1);
  });

  it('yields nothing for a group of one', () => {
    expect(buildGroupPairings([['a'], ['x']], 1)).toEqual([]);
  });
});
