export interface ScheduledMatch {
  team1Id: string;
  team2Id: string;
  round: number;
  court: number;
  order: number;
}

export const buildPairings = (teamIds: string[], gamesPerPair: number): Array<[string, string]> => {
  const pairs: Array<[string, string]> = [];

  for (let i = 0; i < teamIds.length; i += 1) {
    for (let j = i + 1; j < teamIds.length; j += 1) {
      for (let repeat = 0; repeat < gamesPerPair; repeat += 1) {
        pairs.push([teamIds[i], teamIds[j]]);
      }
    }
  }

  return pairs;
};

// Expresses buildPairings as the one-group case, so "pairs stay within a group" lives in one place.
export const buildGroupPairings = (groups: string[][], gamesPerPair: number): Array<[string, string]> => {
  const pairs: Array<[string, string]> = [];

  for (const group of groups) {
    for (const pair of buildPairings(group, gamesPerPair)) {
      pairs.push(pair);
    }
  }

  return pairs;
};

export const shuffle = <T>(items: T[], random: () => number = Math.random): T[] => {
  const shuffled = items.slice();

  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const swap = shuffled[i];
    shuffled[i] = shuffled[j];
    shuffled[j] = swap;
  }

  return shuffled;
};

export const packIntoRounds = (pairs: Array<[string, string]>, courts: number): ScheduledMatch[] => {
  const rounds: Array<{ teams: Set<string>; size: number }> = [];
  const matches: ScheduledMatch[] = [];

  for (const [team1Id, team2Id] of pairs) {
    let index = rounds.findIndex(
      (round) => round.size < courts && !round.teams.has(team1Id) && !round.teams.has(team2Id),
    );

    // A fresh round always accepts the match, so the loop cannot stall.
    if (index === -1) {
      rounds.push({ teams: new Set<string>(), size: 0 });
      index = rounds.length - 1;
    }

    const round = rounds[index];
    round.teams.add(team1Id);
    round.teams.add(team2Id);
    matches.push({ team1Id, team2Id, round: index + 1, court: round.size + 1, order: round.size });
    round.size += 1;
  }

  return matches;
};

export const generateSchedule = (
  teamIds: string[],
  gamesPerPair: number,
  courts: number,
  random: () => number = Math.random,
): ScheduledMatch[] => packIntoRounds(shuffle(buildPairings(teamIds, gamesPerPair), random), courts);
