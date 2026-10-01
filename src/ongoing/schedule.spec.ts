import {
  buildPairings,
  buildGroupPairings,
  packIntoRounds,
  generateSchedule,
  shuffle,
  CourtsExhaustedError,
  CourtWindow,
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

describe('packIntoRounds — named and partial courts', () => {
  const allDay: CourtWindow = { fromRound: 1, toRound: null };
  const between = (fromRound: number, toRound: number | null): CourtWindow => ({ fromRound, toRound });
  const SEEDS = Array.from({ length: 20 }, (_, index) => index + 1);

  const schedule = (teams: number, courts: CourtWindow[], seed: number) => {
    const random = seeded(seed);
    return packIntoRounds(shuffle(buildPairings(teamsNamed(teams), 1), random), courts, random);
  };
  const inRound = (matches: ScheduledMatch[], round: number) => matches.filter((match) => match.round === round);

  // The case this was built for: three courts all day, a fourth only for the first four rounds.
  describe('8 teams, three courts all day and a fourth for rounds 1–4', () => {
    const COURTS = [allDay, allDay, allDay, between(1, 4)];

    it('uses the fourth court in rounds 1–4 and never after', () => {
      for (const seed of SEEDS) {
        const matches = schedule(8, COURTS, seed);
        const onFourth = matches.filter((match) => match.court === 4).map((match) => match.round);

        expect(onFourth.sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
      }
    });

    // 4 rounds x 4 courts = 16, then the remaining 12 on three courts = 4 more rounds.
    it('fits the 28 fixtures in 8 rounds instead of the 10 three courts would take', () => {
      const stretched = SEEDS.filter((seed) => roundCount(schedule(8, COURTS, seed)) !== 8);

      expect(stretched).toEqual([]);
    });

    it('still schedules every fixture, none twice', () => {
      const matches = schedule(8, COURTS, 1);
      const keys = matches.map((match) => [match.team1Id, match.team2Id].sort().join('-'));

      expect(matches).toHaveLength(28);
      expect(new Set(keys).size).toBe(28);
    });

    it('keeps nobody sitting out two rounds in a row', () => {
      const failing = SEEDS.filter((seed) => longestRest(schedule(8, COURTS, seed)) > 1);

      expect(failing).toEqual([]);
    });

    it('never puts two matches on one court in a round', () => {
      const matches = schedule(8, COURTS, 2);
      for (let round = 1; round <= roundCount(matches); round += 1) {
        const courts = inRound(matches, round).map((match) => match.court);
        expect(new Set(courts).size).toBe(courts.length);
      }
    });
  });

  it('opens a court only from its first round', () => {
    for (const seed of SEEDS.slice(0, 10)) {
      const matches = schedule(8, [allDay, allDay, allDay, between(3, null)], seed);
      const rounds = matches.filter((match) => match.court === 4).map((match) => match.round);

      expect(Math.min(...rounds)).toBeGreaterThanOrEqual(3);
    }
  });

  it('keeps a court to a range in the middle of the day', () => {
    for (const seed of SEEDS.slice(0, 10)) {
      const rounds = schedule(8, [allDay, allDay, between(2, 5)], seed)
        .filter((match) => match.court === 3)
        .map((match) => match.round);

      expect(rounds.every((round) => round >= 2 && round <= 5)).toBe(true);
    }
  });

  // The first court in the list is the one the organiser wants used first — the main court.
  it('fills courts in list order when a round has fewer matches than courts', () => {
    // 5 teams on 4 courts: at most two matches a round, so courts 3 and 4 stay empty.
    for (const seed of SEEDS.slice(0, 10)) {
      const used = new Set(schedule(5, [allDay, allDay, allDay, allDay], seed).map((match) => match.court));

      expect([...used].sort()).toEqual([1, 2]);
    }
  });

  it('reports a court by its position in the list, not by its slot in the round', () => {
    // Court 1 is closed in round 2, so round 2's only-other-court match sits on court 2, order 0.
    const matches = packIntoRounds(
      [
        ['a', 'b'],
        ['c', 'd'],
        ['a', 'c'],
      ],
      [between(1, 1), allDay],
      seeded(1),
    );
    const secondRound = inRound(matches, 2);

    expect(secondRound.map((match) => [match.court, match.order])).toEqual([[2, 0]]);
  });

  // A safety net only: the organiser's ranges are expected to leave room for everything.
  it('refuses rather than dropping fixtures when every court closes too soon', () => {
    // 6 teams = 15 fixtures, but two courts for rounds 1–4 hold 8.
    expect(() => schedule(6, [between(1, 4), between(1, 4)], 1)).toThrow(CourtsExhaustedError);
    expect(() => schedule(6, [between(1, 4), between(1, 4)], 1)).toThrow(
      "7 of 15 matches do not fit on the courts; extend a court's rounds or add one",
    );
  });

  it('fits exactly when the closing courts hold just enough', () => {
    // 4 teams = 6 fixtures; two courts for rounds 1–3 hold 6, and a round robin of 4 packs perfectly.
    expect(schedule(4, [between(1, 3), between(1, 3)], 1)).toHaveLength(6);
  });

  // Not expected in practice, but a round with no court must not count as everyone resting.
  it('treats a round with no court open as a break, not a rest', () => {
    for (const seed of SEEDS.slice(0, 10)) {
      const matches = schedule(5, [between(1, 2), between(1, 2), between(4, null), between(4, null)], seed);

      expect(inRound(matches, 3)).toEqual([]);
      expect(matches).toHaveLength(10);
    }
  });

  it('behaves exactly as before for a bare count of courts', () => {
    const random = () => 0.5;
    const pairs = buildPairings(teamsNamed(6), 1);

    expect(packIntoRounds(pairs, 2, random)).toEqual(packIntoRounds(pairs, [allDay, allDay], random));
  });
});
