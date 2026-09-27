import {
  buildPairings,
  buildGroupPairings,
  packIntoRounds,
  generateSchedule,
  shuffle,
  ScheduledMatch,
} from './schedule';

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

// A team "rests" in a round it sits out while it still has a game to come — so before its first
// game counts, and after its last does not (it is done, not waiting).
function longestRest(matches: ScheduledMatch[]): number {
  const roundsByTeam = new Map<string, number[]>();
  for (const match of matches) {
    for (const teamId of [match.team1Id, match.team2Id]) {
      roundsByTeam.set(teamId, [...(roundsByTeam.get(teamId) ?? []), match.round]);
    }
  }

  let longest = 0;
  for (const rounds of roundsByTeam.values()) {
    rounds.sort((a, b) => a - b);
    let previous = 0;
    for (const round of rounds) {
      longest = Math.max(longest, round - previous - 1);
      previous = round;
    }
  }
  return longest;
}

const roundCount = (matches: ScheduledMatch[]) => Math.max(0, ...matches.map((match) => match.round));

const teamsNamed = (count: number) => Array.from({ length: count }, (_, index) => `t${index + 1}`);

// Seeded, so a failure is reproducible: the scheduler's restarts draw from it.
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

describe('generateSchedule — nobody sits out two rounds in a row', () => {
  // [teams, courts, gamesPerPair, the fewest rounds the fixtures fit in]
  const CASES: Array<[number, number, number, number]> = [
    [8, 3, 1, 10],
    [5, 2, 1, 5],
    [6, 2, 1, 8],
    [5, 2, 2, 10],
    [6, 2, 2, 15],
    [7, 3, 1, 7],
    [4, 2, 1, 3],
    [6, 3, 1, 5],
    // Tight enough that a single pass often fails — these are what the restarts are for.
    [7, 2, 1, 11],
    [9, 3, 1, 12],
    [10, 3, 1, 15],
    [12, 4, 1, 17],
  ];

  describe.each(CASES)('%i teams on %i courts, %i game(s) per pair', (teams, courts, gamesPerPair, fewestRounds) => {
    const SEEDS = Array.from({ length: 25 }, (_, index) => index + 1);

    // Collected rather than asserted one by one, so a failure names every seed that broke the rule.
    it('never leaves a team resting two rounds in a row', () => {
      const failingSeeds = SEEDS.filter(
        (seed) => longestRest(generateSchedule(teamsNamed(teams), gamesPerPair, courts, seeded(seed))) > 1,
      );

      expect(failingSeeds).toEqual([]);
    });

    it('still schedules every fixture', () => {
      const matches = generateSchedule(teamsNamed(teams), gamesPerPair, courts, seeded(7));

      expect(matches).toHaveLength(((teams * (teams - 1)) / 2) * gamesPerPair);
    });

    // The rule must not be bought by stretching the day: the fixtures still fit in the fewest rounds.
    it('fits the fixtures in the fewest rounds the courts allow', () => {
      const stretchedSeeds = SEEDS.filter(
        (seed) => roundCount(generateSchedule(teamsNamed(teams), gamesPerPair, courts, seeded(seed))) !== fewestRounds,
      );

      expect(stretchedSeeds).toEqual([]);
    });

    it('never uses more courts than there are, nor puts a team on two at once', () => {
      const matches = generateSchedule(teamsNamed(teams), gamesPerPair, courts, seeded(3));

      for (let round = 1; round <= roundCount(matches); round += 1) {
        const inRound = matches.filter((match) => match.round === round);
        const playing = inRound.flatMap((match) => [match.team1Id, match.team2Id]);
        expect(inRound.length).toBeLessThanOrEqual(courts);
        expect(new Set(playing).size).toBe(playing.length);
      }
    });
  });

  // The restarts would hide a weak pass at these sizes, so one pass is checked on its own: taking the
  // teams that must play first, then the ones with the most games left, is what makes it succeed.
  it.each([
    [8, 3, 1],
    [5, 2, 1],
    [6, 2, 2],
    [8, 3, 2],
  ])('gets %i teams on %i courts (x%i) right in a single pass', (teams, courts, gamesPerPair) => {
    const fewest = Math.ceil((((teams * (teams - 1)) / 2) * gamesPerPair) / courts);
    const failingSeeds = Array.from({ length: 25 }, (_, index) => index + 1).filter((seed) => {
      const random = seeded(seed);
      const pairs = shuffle(buildPairings(teamsNamed(teams), gamesPerPair), random);
      const matches = packIntoRounds(pairs, courts, random, 1);
      return longestRest(matches) > 1 || roundCount(matches) !== fewest;
    });

    expect(failingSeeds).toEqual([]);
  });

  // Groups share the courts, so the rule holds across the whole day, not per group.
  it('holds for two groups of four sharing three courts', () => {
    const groups = [teamsNamed(8).slice(0, 4), teamsNamed(8).slice(4)];

    for (let seed = 1; seed <= 25; seed += 1) {
      const matches = packIntoRounds(buildGroupPairings(groups, 1), 3, seeded(seed));

      expect(longestRest(matches)).toBeLessThanOrEqual(1);
      expect(matches).toHaveLength(12);
    }
  });

  // With 8 teams on 2 courts four sit out every round, so two rounds' idle sets would have to be exact
  // complements and the two halves could never meet — the rule is impossible whenever teams >= 4 x
  // courts. The best that can be done is a rest of two, never three.
  it.each([
    [8, 2],
    [4, 1],
    [5, 1],
  ])('keeps rests to two rounds where %i teams on %i court(s) make one-round rests impossible', (teams, courts) => {
    for (let seed = 1; seed <= 10; seed += 1) {
      expect(longestRest(generateSchedule(teamsNamed(teams), 1, courts, seeded(seed)))).toBeLessThanOrEqual(2);
    }
  });

  // Ten teams on one court leave eight idle every round — two-round rests cannot be avoided. The
  // scheduler must still return a complete schedule, keeping the rests as short as it can.
  it('still returns a complete schedule when the rule cannot be met', () => {
    const matches = generateSchedule(teamsNamed(10), 1, 1, seeded(1));

    expect(matches).toHaveLength(45);
    expect(roundCount(matches)).toBe(45);
  });
});
