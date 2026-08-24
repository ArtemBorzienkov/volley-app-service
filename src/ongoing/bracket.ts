import { isPowerOfTwo } from './groups';

export interface Qualifier {
  teamId: string;
  groupIndex: number;
  place: number;
}

export interface BracketGame {
  bracketRound: number;
  bracketSlot: number;
  team1Id: string | null;
  team2Id: string | null;
}

// All first places, then all second places, and so on — within a placement, by group order.
// This ordering is what makes the standard bracket below reproduce the requested pairings.
export const buildSeedList = (qualifiers: Qualifier[]): string[] =>
  qualifiers
    .slice()
    .sort((one, two) => (one.place !== two.place ? one.place - two.place : one.groupIndex - two.groupIndex))
    .map((qualifier) => qualifier.teamId);

// Classic recursive expansion: [1,2] -> [1,4,2,3] -> [1,8,4,5,2,7,3,6]. Guarantees the top two
// seeds sit in opposite halves and can only meet in the final.
export const bracketSeedOrder = (size: number): number[] => {
  let order = [1, 2];

  while (order.length < size) {
    const next = order.length * 2;
    const expanded: number[] = [];
    for (const seed of order) {
      expanded.push(seed);
      expanded.push(next + 1 - seed);
    }
    order = expanded;
  }

  return order;
};

export interface GroupGameResult {
  team1Id: string | null;
  team2Id: string | null;
  team1Points: number | null;
  team2Points: number | null;
}

// Mirrors volleyball-management-ui/lib/ongoing-standings.ts computeStandings' comparator exactly:
// wins desc, then point difference desc, then points-for desc. This must not drift from the
// frontend, or the bracket seeding would contradict the group table the user is looking at.
export const rankGroupTeams = (teamIds: string[], games: GroupGameResult[]): string[] => {
  const rows = new Map<string, { teamId: string; wins: number; pointsFor: number; pointsAgainst: number }>();

  for (const teamId of teamIds) {
    rows.set(teamId, { teamId, wins: 0, pointsFor: 0, pointsAgainst: 0 });
  }

  for (const game of games) {
    if (game.team1Id === null || game.team2Id === null) continue;
    if (game.team1Points === null || game.team2Points === null) continue;

    const team1 = rows.get(game.team1Id);
    const team2 = rows.get(game.team2Id);
    if (!team1 || !team2) continue;

    team1.pointsFor += game.team1Points;
    team1.pointsAgainst += game.team2Points;
    team2.pointsFor += game.team2Points;
    team2.pointsAgainst += game.team1Points;

    if (game.team1Points > game.team2Points) {
      team1.wins += 1;
    } else {
      team2.wins += 1;
    }
  }

  return Array.from(rows.values())
    .sort((one, two) => {
      if (two.wins !== one.wins) return two.wins - one.wins;
      const diffOne = one.pointsFor - one.pointsAgainst;
      const diffTwo = two.pointsFor - two.pointsAgainst;
      if (diffTwo !== diffOne) return diffTwo - diffOne;
      return two.pointsFor - one.pointsFor;
    })
    .map((row) => row.teamId);
};

export const buildBracketGames = (seedList: string[]): BracketGame[] => {
  if (!isPowerOfTwo(seedList.length)) {
    throw new Error(`A bracket needs a power-of-two number of teams, got ${seedList.length}`);
  }

  const order = bracketSeedOrder(seedList.length);
  const games: BracketGame[] = [];

  for (let slot = 0; slot < order.length / 2; slot += 1) {
    games.push({
      bracketRound: 1,
      bracketSlot: slot,
      team1Id: seedList[order[slot * 2] - 1],
      team2Id: seedList[order[slot * 2 + 1] - 1],
    });
  }

  let remaining = seedList.length / 2;
  let round = 2;
  while (remaining > 1) {
    remaining = remaining / 2;
    for (let slot = 0; slot < remaining; slot += 1) {
      games.push({ bracketRound: round, bracketSlot: slot, team1Id: null, team2Id: null });
    }
    round += 1;
  }

  return games;
};
