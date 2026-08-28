import { pairByRating, effectiveTeamCount, SoloEntry } from './pairing';

const entry = (playerId: string, rating: number): SoloEntry => ({ playerId, rating });

describe('pairByRating', () => {
  it('pairs the strongest with the weakest', () => {
    const result = pairByRating([entry('a', 1300), entry('b', 1200), entry('c', 1000), entry('d', 800)]);

    expect(result.pairs).toEqual([
      { player1Id: 'a', player2Id: 'd' },
      { player1Id: 'b', player2Id: 'c' },
    ]);
    expect(result.unpaired).toEqual([]);
  });

  it('is independent of the input order', () => {
    const shuffled = pairByRating([entry('c', 1000), entry('a', 1300), entry('d', 800), entry('b', 1200)]);

    expect(shuffled.pairs).toEqual([
      { player1Id: 'a', player2Id: 'd' },
      { player1Id: 'b', player2Id: 'c' },
    ]);
  });

  it('breaks rating ties by playerId so equal ratings pair deterministically', () => {
    const result = pairByRating([entry('d', 1000), entry('b', 1000), entry('c', 1000), entry('a', 1000)]);

    expect(result.pairs).toEqual([
      { player1Id: 'a', player2Id: 'd' },
      { player1Id: 'b', player2Id: 'c' },
    ]);
  });

  it('leaves the median player unpaired when the count is odd', () => {
    const result = pairByRating([entry('a', 1300), entry('b', 1200), entry('c', 1000)]);

    expect(result.pairs).toEqual([{ player1Id: 'a', player2Id: 'c' }]);
    expect(result.unpaired).toEqual(['b']);
  });

  it('handles an empty pool and a single entrant', () => {
    expect(pairByRating([])).toEqual({ pairs: [], unpaired: [] });
    expect(pairByRating([entry('a', 1000)])).toEqual({ pairs: [], unpaired: ['a'] });
  });

  it('does not mutate the caller array', () => {
    const entries = [entry('a', 800), entry('b', 1300)];
    pairByRating(entries);

    expect(entries.map((item) => item.playerId)).toEqual(['a', 'b']);
  });
});

describe('effectiveTeamCount', () => {
  it('counts two solo entrants as one slot and an odd one as a whole slot', () => {
    expect(effectiveTeamCount(0, 0)).toBe(0);
    expect(effectiveTeamCount(2, 0)).toBe(2);
    expect(effectiveTeamCount(0, 2)).toBe(1);
    expect(effectiveTeamCount(0, 3)).toBe(2);
    expect(effectiveTeamCount(3, 5)).toBe(6);
  });
});
