/**
 * The fullRotation scheme: groups of four in which every player partners every other player once,
 * then promote/relegate between groups after each round.
 *
 * Pure functions only — the service supplies rosters and results and persists what comes back.
 */

/** Four players produce exactly three pairings, which is what makes the group size fixed. */
export const ROTATION_GROUP_SIZE = 4;

/** Promoted up and relegated down after each round. Half the group moves each way. */
export const ROTATION_MOVERS = 2;

export const ROTATION_MIN_GROUPS = 2;
export const ROTATION_MAX_GROUPS = 3;

export interface RotationFixture {
  side1: [string, string];
  side2: [string, string];
}

export interface RotationGameResult {
  side1PlayerIds: string[];
  side2PlayerIds: string[];
  side1Points: number | null;
  side2Points: number | null;
}

export interface RotationStandingRow {
  playerId: string;
  rating: number;
  played: number;
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
  pointsDiff: number;
}

/**
 * The three fixtures of a group: p1 partners p2, then p3, then p4, so every player shares a side
 * with every other exactly once and opposes every other exactly twice.
 */
export const rotationFixtures = (groupPlayerIds: string[]): RotationFixture[] => {
  if (groupPlayerIds.length !== ROTATION_GROUP_SIZE) {
    throw new Error(`A rotation group needs exactly ${ROTATION_GROUP_SIZE} players, got ${groupPlayerIds.length}`);
  }

  const [p1, p2, p3, p4] = groupPlayerIds;
  return [
    { side1: [p1, p2], side2: [p3, p4] },
    { side1: [p1, p3], side2: [p2, p4] },
    { side1: [p1, p4], side2: [p2, p3] },
  ];
};

/**
 * Strongest players into the strongest group. The promote/relegate rule only means anything if
 * group 0 starts as the strongest, so seeding is by rating rather than shuffled.
 *
 * Ties break on playerId so a re-seed of the same roster produces the same groups.
 */
export const seedIntoGroups = (
  players: Array<{ playerId: string; rating: number }>,
  groupCount: number,
): string[][] => {
  const expected = groupCount * ROTATION_GROUP_SIZE;
  if (players.length !== expected) {
    throw new Error(`${groupCount} rotation groups need exactly ${expected} players, got ${players.length}`);
  }

  const sorted = players.slice().sort((one, two) => {
    if (two.rating !== one.rating) return two.rating - one.rating;
    return one.playerId < two.playerId ? -1 : 1;
  });

  const groups: string[][] = [];
  for (let index = 0; index < groupCount; index += 1) {
    groups.push(sorted.slice(index * ROTATION_GROUP_SIZE, (index + 1) * ROTATION_GROUP_SIZE).map((p) => p.playerId));
  }
  return groups;
};

/**
 * A player's place inside their group, from that group's three games: wins first, then point
 * difference, then the LOWER rating — an equal margin is the stronger result for the player who was
 * rated below. playerId breaks a full tie so the order is deterministic.
 *
 * Games without both scores contribute nothing, so a partly played group still ranks.
 */
export const rankGroupPlayers = (
  groupPlayers: Array<{ playerId: string; rating: number }>,
  games: RotationGameResult[],
): RotationStandingRow[] => {
  const rows = new Map<string, RotationStandingRow>();
  for (const { playerId, rating } of groupPlayers) {
    rows.set(playerId, {
      playerId,
      rating,
      played: 0,
      wins: 0,
      losses: 0,
      pointsFor: 0,
      pointsAgainst: 0,
      pointsDiff: 0,
    });
  }

  for (const game of games) {
    if (game.side1Points === null || game.side2Points === null) continue;

    const side1Won = game.side1Points > game.side2Points;
    const sides: Array<{ playerIds: string[]; scored: number; conceded: number; won: boolean }> = [
      { playerIds: game.side1PlayerIds, scored: game.side1Points, conceded: game.side2Points, won: side1Won },
      { playerIds: game.side2PlayerIds, scored: game.side2Points, conceded: game.side1Points, won: !side1Won },
    ];

    for (const side of sides) {
      for (const playerId of side.playerIds) {
        const row = rows.get(playerId);
        // A game whose players are not in this group belongs to another one — skip, do not throw:
        // callers pass the event's whole game list.
        if (!row) continue;
        row.played += 1;
        row.pointsFor += side.scored;
        row.pointsAgainst += side.conceded;
        row.pointsDiff = row.pointsFor - row.pointsAgainst;
        if (side.won) row.wins += 1;
        else row.losses += 1;
      }
    }
  }

  return Array.from(rows.values()).sort((one, two) => {
    if (two.wins !== one.wins) return two.wins - one.wins;
    if (two.pointsDiff !== one.pointsDiff) return two.pointsDiff - one.pointsDiff;
    // Equal difference goes to the LOWER-rated player: matching the same margin against the same
    // opponents is the better result for whoever was expected to do worse.
    if (one.rating !== two.rating) return one.rating - two.rating;
    return one.playerId < two.playerId ? -1 : 1;
  });
};

/**
 * Next round's groups from this round's finishing order: the top two of each group go up, the
 * bottom two go down, and the ends of the ladder have nowhere to go so they stay.
 *
 * Every group still holds four afterwards. The strongest group keeps its top two and receives the
 * group below's top two; the weakest keeps its bottom two and receives the group above's bottom
 * two; a middle group is replaced entirely by the relegated pair from above and the promoted pair
 * from below.
 */
export const applyPromotionRelegation = (rankedGroups: string[][]): string[][] => {
  for (const group of rankedGroups) {
    if (group.length !== ROTATION_GROUP_SIZE) {
      throw new Error(`Every rotation group must hold ${ROTATION_GROUP_SIZE} players before advancing`);
    }
  }

  const promoted = (group: string[]) => group.slice(0, ROTATION_MOVERS);
  const relegated = (group: string[]) => group.slice(ROTATION_MOVERS);
  const last = rankedGroups.length - 1;

  return rankedGroups.map((group, index) => {
    const isStrongest = index === 0;
    const isWeakest = index === last;

    // One group is the whole ladder: there is nowhere to promote to and nowhere to relegate to, so
    // the group carries over intact rather than keeping only the half that would have moved.
    if (isStrongest && isWeakest) return group.slice();

    const downFromAbove = isStrongest ? [] : relegated(rankedGroups[index - 1]);
    const upFromBelow = isWeakest ? [] : promoted(rankedGroups[index + 1]);
    const stayingFromHere = isStrongest ? promoted(group) : isWeakest ? relegated(group) : [];

    // Strongest group reads [its stayers, then arrivals]; every other [arrivals from above, arrivals
    // from below, then its own stayers] — so a group's order always runs strongest-first.
    return isStrongest
      ? [...stayingFromHere, ...upFromBelow]
      : [...downFromAbove, ...upFromBelow, ...stayingFromHere];
  });
};
