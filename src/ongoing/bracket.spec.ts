import { buildSeedList, bracketSeedOrder, buildBracketGames, Qualifier } from './bracket';

const q = (teamId: string, groupIndex: number, place: number): Qualifier => ({ teamId, groupIndex, place });

describe('buildSeedList', () => {
  it('orders all first places before all second places', () => {
    const seeds = buildSeedList([q('a2', 0, 2), q('b1', 1, 1), q('a1', 0, 1), q('b2', 1, 2)]);

    expect(seeds).toEqual(['a1', 'b1', 'a2', 'b2']);
  });

  it('breaks ties within a placement by group index', () => {
    const seeds = buildSeedList([q('c1', 2, 1), q('a1', 0, 1), q('b1', 1, 1)]);

    expect(seeds).toEqual(['a1', 'b1', 'c1']);
  });

  it('does not mutate its input', () => {
    const input = [q('b1', 1, 1), q('a1', 0, 1)];
    buildSeedList(input);

    expect(input[0].teamId).toBe('b1');
  });
});

describe('bracketSeedOrder', () => {
  it('pairs the top and bottom seed for a two-team bracket', () => {
    expect(bracketSeedOrder(2)).toEqual([1, 2]);
  });

  it('expands to four so seeds 1 and 2 are on opposite halves', () => {
    expect(bracketSeedOrder(4)).toEqual([1, 4, 2, 3]);
  });

  it('expands to eight in the standard order', () => {
    expect(bracketSeedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
  });

  it('keeps seeds 1 and 2 apart until the final at every size', () => {
    for (const size of [2, 4, 8, 16]) {
      const order = bracketSeedOrder(size);
      const half = size / 2;
      expect(order.slice(0, half)).toContain(1);
      expect(order.slice(half)).toContain(2);
    }
  });
});

describe('buildBracketGames', () => {
  // The two cases below are the requested specification, expressed as seed lists.
  it('reproduces the 2 groups of 4 case: A1-B2 and A2-B1', () => {
    // seeds: 1=A1, 2=B1, 3=A2, 4=B2
    const games = buildBracketGames(['A1', 'B1', 'A2', 'B2']);
    const roundOne = games.filter((game) => game.bracketRound === 1);

    expect(roundOne).toHaveLength(2);
    expect(roundOne.map((game) => [game.team1Id, game.team2Id])).toEqual([
      ['A1', 'B2'],
      ['B1', 'A2'],
    ]);
  });

  it('reproduces the 2 groups of 5 case: A1-B4, A3-B2, B1-A4, A2-B3', () => {
    // seeds: 1=A1 2=B1 3=A2 4=B2 5=A3 6=B3 7=A4 8=B4
    const games = buildBracketGames(['A1', 'B1', 'A2', 'B2', 'A3', 'B3', 'A4', 'B4']);
    const roundOne = games.filter((game) => game.bracketRound === 1);

    expect(roundOne).toHaveLength(4);
    expect(roundOne.map((game) => [game.team1Id, game.team2Id])).toEqual([
      ['A1', 'B4'],
      ['B2', 'A3'],
      ['B1', 'A4'],
      ['A2', 'B3'],
    ]);
  });

  it('creates every later round with both slots empty', () => {
    const games = buildBracketGames(['A1', 'B1', 'A2', 'B2', 'A3', 'B3', 'A4', 'B4']);

    for (const game of games.filter((one) => one.bracketRound > 1)) {
      expect(game.team1Id).toBeNull();
      expect(game.team2Id).toBeNull();
    }
  });

  it('creates log2(size) rounds with halving game counts', () => {
    const games = buildBracketGames(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
    const perRound = new Map<number, number>();
    for (const game of games) perRound.set(game.bracketRound, (perRound.get(game.bracketRound) || 0) + 1);

    expect([...perRound.entries()].sort((one, two) => one[0] - two[0])).toEqual([
      [1, 4],
      [2, 2],
      [3, 1],
    ]);
  });

  it('numbers slots from zero within each round', () => {
    const games = buildBracketGames(['a', 'b', 'c', 'd']);

    expect(games.filter((game) => game.bracketRound === 1).map((game) => game.bracketSlot)).toEqual([0, 1]);
    expect(games.filter((game) => game.bracketRound === 2).map((game) => game.bracketSlot)).toEqual([0]);
  });

  it('builds a single final for a two-team bracket', () => {
    const games = buildBracketGames(['a', 'b']);

    expect(games).toHaveLength(1);
    expect([games[0].team1Id, games[0].team2Id]).toEqual(['a', 'b']);
  });

  it('rejects a seed list whose length is not a power of two', () => {
    expect(() => buildBracketGames(['a', 'b', 'c'])).toThrow();
  });
});
