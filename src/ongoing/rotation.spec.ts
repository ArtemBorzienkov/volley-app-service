import {
  applyPromotionRelegation,
  rankGroupPlayers,
  rotationFixtures,
  seedIntoGroups,
  type RotationGameResult,
} from './rotation';

describe('rotationFixtures', () => {
  const fixtures = rotationFixtures(['p1', 'p2', 'p3', 'p4']);

  it('produces the three pairings of a group of four', () => {
    expect(fixtures).toEqual([
      { side1: ['p1', 'p2'], side2: ['p3', 'p4'] },
      { side1: ['p1', 'p3'], side2: ['p2', 'p4'] },
      { side1: ['p1', 'p4'], side2: ['p2', 'p3'] },
    ]);
  });

  it('partners every player with every other exactly once', () => {
    const partnerships = fixtures
      .flatMap((fixture) => [fixture.side1, fixture.side2])
      .map((side) => side.slice().sort().join('+'));

    expect(partnerships.sort()).toEqual(['p1+p2', 'p1+p3', 'p1+p4', 'p2+p3', 'p2+p4', 'p3+p4']);
  });

  it('gives every player three games', () => {
    const appearances = new Map<string, number>();
    for (const fixture of fixtures) {
      for (const playerId of [...fixture.side1, ...fixture.side2]) {
        appearances.set(playerId, (appearances.get(playerId) ?? 0) + 1);
      }
    }

    expect([...appearances.values()]).toEqual([3, 3, 3, 3]);
  });

  it('rejects a group that is not exactly four players', () => {
    expect(() => rotationFixtures(['p1', 'p2', 'p3'])).toThrow(/exactly 4 players/);
    expect(() => rotationFixtures(['p1', 'p2', 'p3', 'p4', 'p5'])).toThrow(/exactly 4 players/);
  });
});

describe('seedIntoGroups', () => {
  const roster = (ratings: number[]) => ratings.map((rating, index) => ({ playerId: `p${index + 1}`, rating }));

  it('puts the strongest four in the strongest group', () => {
    const groups = seedIntoGroups(roster([1300, 1200, 1100, 1000, 900, 800, 700, 600]), 2);

    expect(groups).toEqual([
      ['p1', 'p2', 'p3', 'p4'],
      ['p5', 'p6', 'p7', 'p8'],
    ]);
  });

  it('seeds three groups by descending rating regardless of roster order', () => {
    const shuffled = [
      { playerId: 'weakest', rating: 100 },
      { playerId: 'strongest', rating: 2000 },
      ...roster([1000, 1000, 900, 800, 700, 600, 500, 400, 300, 200]),
    ];

    const groups = seedIntoGroups(shuffled, 3);

    expect(groups[0][0]).toBe('strongest');
    expect(groups[2][3]).toBe('weakest');
    expect(groups.flat()).toHaveLength(12);
  });

  it('breaks rating ties on playerId so the same roster always seeds the same way', () => {
    const tied = [
      { playerId: 'b', rating: 1000 },
      { playerId: 'a', rating: 1000 },
      { playerId: 'd', rating: 1000 },
      { playerId: 'c', rating: 1000 },
      ...roster([900, 900, 900, 900]),
    ];

    expect(seedIntoGroups(tied, 2)[0]).toEqual(['a', 'b', 'c', 'd']);
  });

  it('rejects a roster that does not fill the groups exactly', () => {
    expect(() => seedIntoGroups(roster([1, 2, 3, 4, 5, 6, 7]), 2)).toThrow(/exactly 8 players, got 7/);
  });
});

describe('rankGroupPlayers', () => {
  /** Equal ratings by default: a test that cares about the rating tiebreak sets them explicitly. */
  const roster = (ids: string[], ratings: number[] = []) =>
    ids.map((playerId, index) => ({ playerId, rating: ratings[index] ?? 1000 }));

  const game = (
    side1: string[],
    side2: string[],
    side1Points: number | null,
    side2Points: number | null,
  ): RotationGameResult => ({ side1PlayerIds: side1, side2PlayerIds: side2, side1Points, side2Points });

  it('ranks by wins first', () => {
    // p1 is on the winning side of all three. Each game crowns two winners, so the remaining three
    // wins land one each on p2, p3 and p4 — p1 leads on wins alone.
    const games = [
      game(['p1', 'p2'], ['p3', 'p4'], 21, 15),
      game(['p1', 'p3'], ['p2', 'p4'], 21, 15),
      game(['p1', 'p4'], ['p2', 'p3'], 21, 15),
    ];

    const ranked = rankGroupPlayers(roster(['p1', 'p2', 'p3', 'p4']), games);

    expect(ranked[0]).toMatchObject({ playerId: 'p1', played: 3, wins: 3, losses: 0 });
    expect(ranked.slice(1).map((row) => row.wins)).toEqual([1, 1, 1]);
    expect(ranked.map((row) => row.playerId)).toEqual(['p1', 'p2', 'p3', 'p4']);
  });

  it('breaks a win tie on point difference', () => {
    const games = [
      game(['p1', 'p2'], ['p3', 'p4'], 21, 10),
      game(['p1', 'p3'], ['p2', 'p4'], 10, 21),
      game(['p1', 'p4'], ['p2', 'p3'], 21, 20),
    ];

    const ranked = rankGroupPlayers(roster(['p1', 'p2', 'p3', 'p4']), games);

    // p1, p2 and p4 all finish on two wins; p2's +21 outranks the +1 the other two share.
    expect(ranked.slice(0, 3).map((row) => row.wins)).toEqual([2, 2, 2]);
    expect(ranked[0]).toMatchObject({ playerId: 'p2', pointsDiff: 21 });
    expect(ranked.map((row) => row.pointsDiff)).toEqual([21, 1, 1, -23]);
  });

  it('breaks a difference tie in favour of the LOWER-rated player', () => {
    // Everyone ends level on wins and difference, so only the rating separates them.
    const games = [
      game(['p1', 'p2'], ['p3', 'p4'], 21, 11),
      game(['p3', 'p4'], ['p1', 'p2'], 21, 11),
      game(['p1', 'p3'], ['p2', 'p4'], 15, 15),
    ];

    const ranked = rankGroupPlayers(roster(['p1', 'p2', 'p3', 'p4'], [1400, 1100, 1300, 1200]), games);

    expect(ranked.every((row) => row.pointsDiff === 0)).toBe(true);
    expect(ranked.map((row) => row.playerId)).toEqual(['p2', 'p4', 'p3', 'p1']);
    expect(ranked.map((row) => row.rating)).toEqual([1100, 1200, 1300, 1400]);
  });

  it('puts the lower-rated player above on an equal difference, and only then', () => {
    // p1+p2 beat p3+p4 by 10; the return game reverses it, so all four sit on one win and zero
    // difference. p4 is rated below p1, so p4 finishes above.
    const games = [game(['p1', 'p3'], ['p2', 'p4'], 21, 11), game(['p2', 'p4'], ['p1', 'p3'], 21, 11)];

    const ranked = rankGroupPlayers(roster(['p1', 'p2', 'p3', 'p4'], [1500, 1000, 1400, 900]), games);

    expect(ranked.map((row) => row.playerId)).toEqual(['p4', 'p2', 'p3', 'p1']);
  });

  it('never lets the rating outrank a real result', () => {
    // p1 is the highest rated AND wins everything: wins and difference come first.
    const games = [
      game(['p1', 'p2'], ['p3', 'p4'], 21, 10),
      game(['p1', 'p3'], ['p2', 'p4'], 21, 10),
      game(['p1', 'p4'], ['p2', 'p3'], 21, 10),
    ];

    const ranked = rankGroupPlayers(roster(['p1', 'p2', 'p3', 'p4'], [2000, 900, 900, 900]), games);

    expect(ranked[0]).toMatchObject({ playerId: 'p1', wins: 3, rating: 2000 });
  });

  it('falls back to playerId when wins, difference and rating all tie', () => {
    // Nothing played, so every criterion above playerId is level for all four.
    const equal = roster(['p4', 'p3', 'p2', 'p1'], [1000, 1000, 1000, 1000]);

    expect(rankGroupPlayers(equal, []).map((row) => row.playerId)).toEqual(['p1', 'p2', 'p3', 'p4']);
  });

  it('treats a level score as a win for the second side, as the team table already does', () => {
    // Not reachable in a real beach volleyball game, but the ordering must still be defined.
    const ranked = rankGroupPlayers(roster(['p1', 'p2', 'p3', 'p4']), [game(['p1', 'p3'], ['p2', 'p4'], 15, 15)]);

    expect(ranked.slice(0, 2).map((row) => row.playerId)).toEqual(['p2', 'p4']);
    expect(ranked.slice(0, 2).every((row) => row.wins === 1)).toBe(true);
  });

  it('ignores games that have no result yet, so a partly played group still ranks', () => {
    const games = [
      game(['p1', 'p2'], ['p3', 'p4'], 21, 15),
      game(['p1', 'p3'], ['p2', 'p4'], null, null),
      game(['p1', 'p4'], ['p2', 'p3'], null, null),
    ];

    const ranked = rankGroupPlayers(roster(['p1', 'p2', 'p3', 'p4']), games);

    expect(ranked.map((row) => row.played)).toEqual([1, 1, 1, 1]);
    expect(
      ranked
        .slice(0, 2)
        .map((row) => row.playerId)
        .sort(),
    ).toEqual(['p1', 'p2']);
  });

  it('ignores games belonging to another group', () => {
    const games = [game(['p1', 'p2'], ['p3', 'p4'], 21, 15), game(['q1', 'q2'], ['q3', 'q4'], 21, 0)];

    const ranked = rankGroupPlayers(roster(['p1', 'p2', 'p3', 'p4']), games);

    expect(ranked).toHaveLength(4);
    expect(ranked.map((row) => row.played)).toEqual([1, 1, 1, 1]);
  });

  it('lists every player even when nothing has been played', () => {
    const ranked = rankGroupPlayers(roster(['p1', 'p2', 'p3', 'p4']), []);

    expect(ranked.map((row) => row.playerId)).toEqual(['p1', 'p2', 'p3', 'p4']);
    expect(ranked.every((row) => row.played === 0)).toBe(true);
  });
});

describe('applyPromotionRelegation', () => {
  const groupA = ['a1', 'a2', 'a3', 'a4'];
  const groupB = ['b1', 'b2', 'b3', 'b4'];
  const groupC = ['c1', 'c2', 'c3', 'c4'];

  it('swaps the two halves between two groups', () => {
    expect(applyPromotionRelegation([groupA, groupB])).toEqual([
      ['a1', 'a2', 'b1', 'b2'],
      ['a3', 'a4', 'b3', 'b4'],
    ]);
  });

  it('moves the top two up and the bottom two down across three groups', () => {
    expect(applyPromotionRelegation([groupA, groupB, groupC])).toEqual([
      ['a1', 'a2', 'b1', 'b2'],
      ['a3', 'a4', 'c1', 'c2'],
      ['b3', 'b4', 'c3', 'c4'],
    ]);
  });

  it('keeps every group at four players and loses nobody', () => {
    const next = applyPromotionRelegation([groupA, groupB, groupC]);

    expect(next.map((group) => group.length)).toEqual([4, 4, 4]);
    expect(next.flat().sort()).toEqual([...groupA, ...groupB, ...groupC].sort());
  });

  it('keeps the winners of the strongest group in it — they have nowhere higher to go', () => {
    const [strongest] = applyPromotionRelegation([groupA, groupB]);

    expect(strongest).toContain('a1');
    expect(strongest).toContain('a2');
  });

  it('keeps the losers of the weakest group in it — they have nowhere lower to go', () => {
    const next = applyPromotionRelegation([groupA, groupB]);

    expect(next[1]).toContain('b3');
    expect(next[1]).toContain('b4');
  });

  it('is stable for a single group: nobody has anywhere to move', () => {
    expect(applyPromotionRelegation([groupA])).toEqual([groupA]);
  });

  it('rejects a group that does not hold four players', () => {
    expect(() => applyPromotionRelegation([['a1', 'a2', 'a3'], groupB])).toThrow(/must hold 4 players/);
  });
});
