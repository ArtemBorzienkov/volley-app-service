import { getRankChangeByRankDifference, getRanksChangesByGameResult } from './utils';

/**
 * The rating engine's change table. The invariant these tests exist for is the one that broke in
 * production twice: **a team that lost the game always loses rating, and a team that won always
 * gains it** — regardless of who was favourite and how wide the gap was.
 *
 * Size is a separate question from sign: an expected win is worth little, an upset a lot.
 */

const AVG = 15;
const MAX_CHANGE = 30;
const MIN_CHANGE = 3;

/** A player whose rating and games-played are both explicit. */
const player = (id: string, rank: number, totalGames = 10) => ({ id, playerStats: { rank, totalGames } });

/**
 * `team1` and `team2` are rating pairs; the score decides the winner. Every player has 10+ games by
 * default so the newcomer multiplier stays out of the way.
 */
const game = (
  team1: [number, number],
  team2: [number, number],
  team1Points: number,
  team2Points: number,
  totalGames = 10,
) =>
  getRanksChangesByGameResult({
    id: 'game-1',
    team1Points,
    team2Points,
    team1Player1: player('t1p1', team1[0], totalGames),
    team1Player2: player('t1p2', team1[1], totalGames),
    team2Player1: player('t2p1', team2[0], totalGames),
    team2Player2: player('t2p2', team2[1], totalGames),
  });

/** Splits a result into the winning side's change and the losing side's, whichever team won. */
const sides = (team1: [number, number], team2: [number, number], team1Won: boolean, totalGames = 10) => {
  const result = game(team1, team2, team1Won ? 21 : 15, team1Won ? 15 : 21, totalGames)!;
  return team1Won
    ? { winner: result.team1Player1Change, loser: result.team2Player1Change }
    : { winner: result.team2Player1Change, loser: result.team1Player1Change };
};

describe('getRankChangeByRankDifference', () => {
  it('returns the average change for evenly matched teams', () => {
    expect(getRankChangeByRankDifference(0)).toEqual({ lowerChange: AVG, biggerChange: AVG });
    expect(getRankChangeByRankDifference(100)).toEqual({ lowerChange: AVG, biggerChange: AVG });
  });

  it.each([
    [101, 12, 18],
    [200, 12, 18],
    [201, 11, 19],
    [300, 11, 19],
    [301, 10, 20],
    [400, 10, 20],
    [401, 9, 21],
    [500, 9, 21],
    [501, 8, 22],
    [600, 8, 22],
    [601, 7, 23],
    [700, 7, 23],
    [701, 6, 24],
    [800, 6, 24],
    [801, 4, 26],
    [900, 4, 26],
    [901, 2, 28],
    [1000, 2, 28],
  ])('at a gap of %i the expected result is worth %i and the upset %i', (difference, lower, bigger) => {
    expect(getRankChangeByRankDifference(difference)).toEqual({
      lowerChange: lower,
      biggerChange: bigger,
    });
  });

  it('never returns a negative magnitude — the sign is the caller’s to apply', () => {
    for (let difference = 0; difference <= 1000; difference += 1) {
      const { lowerChange, biggerChange } = getRankChangeByRankDifference(difference)!;

      expect(lowerChange).toBeGreaterThan(0);
      expect(biggerChange).toBeGreaterThan(0);
    }
  });

  it('is defined for every gap it can be asked about, so the caller can always destructure it', () => {
    for (let difference = 0; difference <= 1000; difference += 1) {
      expect(getRankChangeByRankDifference(difference)).toBeDefined();
    }
  });

  it('pays the upset at least as much as the expected result, at every gap', () => {
    for (let difference = 0; difference <= 1000; difference += 1) {
      const { lowerChange, biggerChange } = getRankChangeByRankDifference(difference)!;

      expect(biggerChange).toBeGreaterThanOrEqual(lowerChange);
    }
  });

  it('pays the favourite less, and the underdog more, as the gap widens', () => {
    const gaps = [0, 150, 250, 350, 450, 550, 650, 750, 850, 950];
    const lower = gaps.map((gap) => getRankChangeByRankDifference(gap)!.lowerChange);
    const bigger = gaps.map((gap) => getRankChangeByRankDifference(gap)!.biggerChange);

    expect(lower).toEqual([...lower].sort((a, b) => b - a));
    expect(bigger).toEqual([...bigger].sort((a, b) => a - b));
  });
});

describe('getRanksChangesByGameResult — the losing team always loses rating', () => {
  // The bug this file was written for: a losing favourite gained rating and the winning underdog
  // lost it. These cases sweep the whole gap range on both sides of the favourite/underdog split.
  const gaps: Array<[string, [number, number], [number, number]]> = [
    ['identical teams', [1000, 1000], [1000, 1000]],
    ['a 1-point gap', [1000, 1001], [1000, 1000]],
    ['a 100-point gap', [1050, 1050], [1000, 1000]],
    ['a 101-point gap', [1050, 1051], [1000, 1000]],
    ['a 300-point gap', [1150, 1150], [1000, 1000]],
    ['a 500-point gap', [1250, 1250], [1000, 1000]],
    ['a 700-point gap', [1350, 1350], [1000, 1000]],
    ['a 900-point gap', [1450, 1450], [1000, 1000]],
    ['a 917-point gap (the reported case)', [1250, 1114], [886, 561]],
    ['a 1000-point gap', [1500, 1500], [1000, 1000]],
    ['a 1001-point gap', [1500, 1501], [1000, 1000]],
    ['a 2000-point gap', [2000, 2000], [1000, 1000]],
  ];

  describe.each(gaps)('with %s', (_label, team1, team2) => {
    it('the winner gains and the loser loses when team1 wins', () => {
      const { winner, loser } = sides(team1, team2, true);

      expect(winner).toBeGreaterThan(0);
      expect(loser).toBeLessThan(0);
    });

    it('the winner gains and the loser loses when team1 loses', () => {
      const { winner, loser } = sides(team1, team2, false);

      expect(winner).toBeGreaterThan(0);
      expect(loser).toBeLessThan(0);
    });

    it('moves both sides by the same amount, in opposite directions', () => {
      const result = game(team1, team2, 21, 15)!;

      expect(result.team1Player1Change).toBe(-result.team2Player1Change);
    });

    it('gives both players of a team the same change', () => {
      const result = game(team1, team2, 15, 21)!;

      expect(result.team1Player1Change).toBe(result.team1Player2Change);
      expect(result.team2Player1Change).toBe(result.team2Player2Change);
    });
  });
});

describe('getRanksChangesByGameResult — the reported game', () => {
  // Artem 1250 + Egor 1114 (2364) lost 6-15 to Oleksandr 886 + Alina 561 (1447): a 917-point gap,
  // so the widest bucket. The favourites used to come out of this at +2 and the winners at -2.
  const result = game([1250, 1114], [886, 561], 6, 15)!;

  it('takes 28 from each losing favourite', () => {
    expect(result.team1Player1Change).toBe(-28);
    expect(result.team1Player2Change).toBe(-28);
  });

  it('gives 28 to each winning underdog', () => {
    expect(result.team2Player1Change).toBe(28);
    expect(result.team2Player2Change).toBe(28);
  });
});

describe('getRanksChangesByGameResult — expected results versus upsets', () => {
  it('pays a favourite little for winning', () => {
    const { winner } = sides([1450, 1450], [1000, 1000], true);

    expect(winner).toBe(4);
  });

  it('pays an underdog a lot for winning the same fixture', () => {
    const { winner } = sides([1450, 1450], [1000, 1000], false);

    expect(winner).toBe(26);
  });

  it('costs a favourite a lot for losing, and an underdog little', () => {
    expect(sides([1450, 1450], [1000, 1000], false).loser).toBe(-26);
    expect(sides([1450, 1450], [1000, 1000], true).loser).toBe(-4);
  });

  it('treats evenly matched teams symmetrically, whoever wins', () => {
    expect(sides([1000, 1000], [1000, 1000], true)).toEqual({ winner: AVG, loser: -AVG });
    expect(sides([1000, 1000], [1000, 1000], false)).toEqual({ winner: AVG, loser: -AVG });
  });

  it('rewards the upset most, and the formality least, beyond the widest bucket', () => {
    // Gap over 1000: the table stops and the flat MIN/MAX pair takes over.
    expect(sides([2000, 2000], [1000, 1000], false).winner).toBe(MAX_CHANGE);
    expect(sides([2000, 2000], [1000, 1000], true).winner).toBe(MIN_CHANGE);
    expect(sides([2000, 2000], [1000, 1000], false).loser).toBe(-MAX_CHANGE);
    expect(sides([2000, 2000], [1000, 1000], true).loser).toBe(-MIN_CHANGE);
  });

  it('is unaffected by which side is listed first', () => {
    const asTeam1 = sides([1450, 1450], [1000, 1000], false);
    const asTeam2 = sides([1000, 1000], [1450, 1450], true);

    expect(asTeam1).toEqual(asTeam2);
  });
});

describe('getRanksChangesByGameResult — the margin does not matter, only the winner', () => {
  it.each([
    [21, 19],
    [21, 15],
    [21, 0],
    [15, 6],
    [1, 0],
  ])('a %i-%i win moves the rating the same amount', (winnerPoints, loserPoints) => {
    const result = game([1000, 1000], [1000, 1000], winnerPoints, loserPoints)!;

    expect(result.team1Player1Change).toBe(AVG);
    expect(result.team2Player1Change).toBe(-AVG);
  });

  it('reverses cleanly when the same scoreline goes the other way', () => {
    const won = game([1000, 1000], [1000, 1000], 21, 15)!;
    const lost = game([1000, 1000], [1000, 1000], 15, 21)!;

    expect(lost.team1Player1Change).toBe(-won.team1Player1Change);
  });
});

describe('getRanksChangesByGameResult — a drawn score', () => {
  it('changes nothing at all', () => {
    expect(game([1000, 1000], [1000, 1000], 21, 21)).toBeUndefined();
    expect(game([1500, 1500], [1000, 1000], 0, 0)).toBeUndefined();
  });
});

describe('getRanksChangesByGameResult — the newcomer multiplier', () => {
  it('doubles the change for a player under 10 games', () => {
    const result = game([1000, 1000], [1000, 1000], 21, 15, 9)!;

    expect(result.team1Player1Change).toBe(AVG * 2);
    expect(result.team2Player1Change).toBe(-AVG * 2);
  });

  it('stops doubling at exactly 10 games', () => {
    expect(game([1000, 1000], [1000, 1000], 21, 15, 10)!.team1Player1Change).toBe(AVG);
    expect(game([1000, 1000], [1000, 1000], 21, 15, 11)!.team1Player1Change).toBe(AVG);
  });

  it('keeps the sign while doubling — a losing newcomer loses twice as much', () => {
    const result = game([1000, 1000], [1000, 1000], 15, 21, 3)!;

    expect(result.team1Player1Change).toBe(-AVG * 2);
  });

  it('doubles per player, so teammates with different histories move differently', () => {
    const result = getRanksChangesByGameResult({
      id: 'game-1',
      team1Points: 21,
      team2Points: 15,
      team1Player1: player('veteran', 1000, 40),
      team1Player2: player('newcomer', 1000, 2),
      team2Player1: player('t2p1', 1000, 40),
      team2Player2: player('t2p2', 1000, 40),
    })!;

    expect(result.team1Player1Change).toBe(AVG);
    expect(result.team1Player2Change).toBe(AVG * 2);
  });

  it('doubles the blowout change too', () => {
    expect(sides([2000, 2000], [1000, 1000], false, 0).winner).toBe(MAX_CHANGE * 2);
    expect(sides([2000, 2000], [1000, 1000], false, 0).loser).toBe(-MAX_CHANGE * 2);
  });
});

describe('getRanksChangesByGameResult — missing player stats', () => {
  const unrated = (id: string) => ({ id });

  it('treats a player with no stats row as rated 1000 with no games played', () => {
    const result = getRanksChangesByGameResult({
      id: 'game-1',
      team1Points: 21,
      team2Points: 15,
      team1Player1: unrated('t1p1'),
      team1Player2: unrated('t1p2'),
      team2Player1: unrated('t2p1'),
      team2Player2: unrated('t2p2'),
    })!;

    // Equal 1000s on both sides, and 0 games means every change is doubled.
    expect(result.team1Player1Change).toBe(AVG * 2);
    expect(result.team2Player1Change).toBe(-AVG * 2);
  });

  it('still gets the sign right when only the losing side is unrated', () => {
    const result = getRanksChangesByGameResult({
      id: 'game-1',
      team1Points: 15,
      team2Points: 21,
      team1Player1: unrated('t1p1'),
      team1Player2: unrated('t1p2'),
      team2Player1: player('t2p1', 1400),
      team2Player2: player('t2p2', 1400),
    })!;

    expect(result.team1Player1Change).toBeLessThan(0);
    expect(result.team2Player1Change).toBeGreaterThan(0);
  });
});

describe('getRanksChangesByGameResult — a wide sweep of ratings and results', () => {
  const ratings = [400, 700, 1000, 1300, 1600, 2200];

  it('never lets a losing player gain rating, over every rating pairing and both outcomes', () => {
    const offenders: string[] = [];

    for (const a of ratings) {
      for (const b of ratings) {
        for (const c of ratings) {
          for (const d of ratings) {
            for (const team1Won of [true, false]) {
              const result = game([a, b], [c, d], team1Won ? 21 : 15, team1Won ? 15 : 21)!;
              const winner = team1Won ? result.team1Player1Change : result.team2Player1Change;
              const loser = team1Won ? result.team2Player1Change : result.team1Player1Change;

              if (winner <= 0 || loser >= 0) {
                offenders.push(`[${a},${b}] vs [${c},${d}] team1Won=${team1Won} → +${winner}/${loser}`);
              }
            }
          }
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('produces a change of a sane size in every one of those games', () => {
    for (const a of ratings) {
      for (const b of ratings) {
        for (const c of ratings) {
          for (const d of ratings) {
            const result = game([a, b], [c, d], 21, 15)!;
            const size = Math.abs(result.team1Player1Change);

            expect(size).toBeGreaterThanOrEqual(MIN_CHANGE);
            expect(size).toBeLessThanOrEqual(MAX_CHANGE);
          }
        }
      }
    }
  });
});
