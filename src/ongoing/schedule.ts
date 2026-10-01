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

/** When a court can be used, in 1-based rounds. A null `toRound` runs to the end of the tournament. */
export interface CourtWindow {
  fromRound: number;
  toRound: number | null;
}

/**
 * The courts cannot hold every fixture. The organiser's ranges are expected never to allow this; it
 * exists so that a mistake surfaces as an error rather than as fixtures silently left out.
 */
export class CourtsExhaustedError extends Error {
  constructor(readonly fixtures: number, readonly unscheduled: number) {
    super(`${unscheduled} of ${fixtures} matches do not fit on the courts; extend a court's rounds or add one`);
  }
}

/** Positions (1-based, in list order) of the courts open in a round — the order they fill in. */
export const openCourts = (courts: CourtWindow[], round: number): number[] =>
  courts.flatMap((court, index) =>
    court.fromRound <= round && (court.toRound === null || round <= court.toRound) ? [index + 1] : [],
  );

const allDayCourts = (count: number): CourtWindow[] =>
  Array.from({ length: Math.max(1, Math.floor(count)) }, () => ({ fromRound: 1, toRound: null }));

/** The last round any court is open in, or Infinity when one runs to the end. */
const lastOpenRound = (courts: CourtWindow[]): number =>
  courts.some((court) => court.toRound === null)
    ? Infinity
    : Math.max(0, ...courts.map((court) => court.toRound as number));

/** The earliest round by which the courts, fully used, have room for every fixture. */
const fewestRoundsFor = (fixtures: number, courts: CourtWindow[]): number => {
  const last = lastOpenRound(courts);
  let room = 0;
  for (let round = 1; round <= last; round += 1) {
    room += openCourts(courts, round).length;
    if (room >= fixtures) return round;
  }
  return Number.POSITIVE_INFINITY;
};

interface PendingMatch {
  team1Id: string;
  team2Id: string;
  /** Position in the (already shuffled) input — the last tie-break, so the shuffle still decides. */
  index: number;
}

interface Attempt {
  matches: ScheduledMatch[];
  /** Fixtures left over when the courts closed; anything above 0 means the courts ran out. */
  unscheduled: number;
  /** Rounds a team sat out on top of the one it is allowed; 0 means the rule held for everyone. */
  extraRests: number;
  rounds: number;
}

// Restarts are cheap at tournament sizes (a few dozen fixtures); stop early once a schedule is perfect.
const MAX_ATTEMPTS = 60;
// Per-round search budget, so a large field degrades to "good" rather than stalling the request.
const ROUND_SEARCH_BUDGET = 4000;

/**
 * Packs fixtures into rounds, no team twice in a round, so that no team sits out two rounds in a row
 * while it still has a game to play.
 *
 * `courts` is either a count of courts open all day or the organiser's court list. Each round uses
 * the courts open in it, in list order — so a court open only for rounds 1–4 adds a match to those
 * rounds and none after — and a match's `court` is that court's position in the list.
 *
 * Built round by round: a team that sat out the previous round must play in this one, and every
 * round is filled to as many courts as possible so the day is no longer than it has to be. Where
 * the rule cannot be met at all — ten teams on one court leave eight idle every round — the result
 * is still complete, with as few extra rests as the attempts found.
 *
 * The input order is the first attempt's tie-break, so a shuffled input still gives a varied
 * schedule; restarts reshuffle with `random`. Throws CourtsExhaustedError if no attempt fits every
 * fixture before the last court closes.
 */
export const packIntoRounds = (
  pairs: Array<[string, string]>,
  courts: number | CourtWindow[],
  random: () => number = Math.random,
  attempts: number = MAX_ATTEMPTS,
): ScheduledMatch[] => {
  if (!pairs.length) return [];
  const windows = typeof courts === 'number' ? allDayCourts(courts) : courts;
  const fewestRounds = fewestRoundsFor(pairs.length, windows);

  let best = scheduleAttempt(pairs, windows);
  for (let attempt = 1; attempt < attempts; attempt += 1) {
    if (best.unscheduled === 0 && best.extraRests === 0 && best.rounds === fewestRounds) break;
    const candidate = scheduleAttempt(shuffle(pairs, random), windows);
    if (isBetter(candidate, best)) best = candidate;
  }

  if (best.unscheduled > 0) throw new CourtsExhaustedError(pairs.length, best.unscheduled);
  return best.matches;
};

const isBetter = (candidate: Attempt, current: Attempt): boolean => {
  if (candidate.unscheduled !== current.unscheduled) return candidate.unscheduled < current.unscheduled;
  if (candidate.extraRests !== current.extraRests) return candidate.extraRests < current.extraRests;
  return candidate.rounds < current.rounds;
};

function scheduleAttempt(pairs: Array<[string, string]>, courts: CourtWindow[]): Attempt {
  let remaining: PendingMatch[] = pairs.map(([team1Id, team2Id], index) => ({ team1Id, team2Id, index }));
  const gamesLeft = new Map<string, number>();
  for (const match of remaining) {
    for (const teamId of [match.team1Id, match.team2Id]) gamesLeft.set(teamId, (gamesLeft.get(teamId) ?? 0) + 1);
  }
  // 0 = not played yet, so a team idle in round 1 has to play in round 2.
  const lastPlayed = new Map<string, number>();

  const matches: ScheduledMatch[] = [];
  const closesAfter = lastOpenRound(courts);
  let extraRests = 0;
  let round = 0;
  // The last round that had a court. A round with none is a break for everyone, not a rest.
  let previousRound = 0;

  while (remaining.length && round < closesAfter) {
    round += 1;
    const open = openCourts(courts, round);
    if (!open.length) continue;

    const mustPlay = new Set(
      [...gamesLeft]
        .filter(([teamId, left]) => left > 0 && (lastPlayed.get(teamId) ?? 0) < previousRound)
        .map(([id]) => id),
    );
    previousRound = round;

    const chosen = pickRound(remaining, open.length, mustPlay, gamesLeft);
    const playing = new Set(chosen.flatMap((match) => [match.team1Id, match.team2Id]));
    for (const teamId of mustPlay) if (!playing.has(teamId)) extraRests += 1;

    chosen.forEach((match, order) => {
      matches.push({ team1Id: match.team1Id, team2Id: match.team2Id, round, court: open[order], order });
      for (const teamId of [match.team1Id, match.team2Id]) {
        gamesLeft.set(teamId, (gamesLeft.get(teamId) ?? 0) - 1);
        lastPlayed.set(teamId, round);
      }
    });
    const chosenIndexes = new Set(chosen.map((match) => match.index));
    remaining = remaining.filter((match) => !chosenIndexes.has(match.index));
  }

  return { matches, unscheduled: remaining.length, extraRests, rounds: previousRound };
}

/**
 * One round's matches: as many of the teams that must play as possible, then as many courts as
 * possible. Candidates are tried heaviest-first — teams with the most games still to play — because
 * leaving those for the end is what strands them in a tail of rounds everyone else sits out; trying
 * the must-play teams first only makes the search find its answer sooner.
 */
function pickRound(
  remaining: PendingMatch[],
  courts: number,
  mustPlay: Set<string>,
  gamesLeft: Map<string, number>,
): PendingMatch[] {
  const urgency = (match: PendingMatch) => Number(mustPlay.has(match.team1Id)) + Number(mustPlay.has(match.team2Id));
  const load = (match: PendingMatch) => (gamesLeft.get(match.team1Id) ?? 0) + (gamesLeft.get(match.team2Id) ?? 0);
  const ordered = remaining.slice().sort((a, b) => urgency(b) - urgency(a) || load(b) - load(a) || a.index - b.index);

  const teamCount = new Set(remaining.flatMap((match) => [match.team1Id, match.team2Id])).size;
  const mostMatches = Math.min(courts, Math.floor(teamCount / 2));

  const current: PendingMatch[] = [];
  const busy = new Set<string>();
  let best: PendingMatch[] = [];
  let bestScore = [-1, -1];
  let budget = ROUND_SEARCH_BUDGET;

  const scoreOf = (): number[] => [current.reduce((sum, match) => sum + urgency(match), 0), current.length];
  const beats = (a: number[], b: number[]) => {
    for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return a[i] > b[i];
    return false;
  };

  // Returns true to stop the whole search: the budget ran out or the round cannot be improved on.
  const search = (from: number): boolean => {
    budget -= 1;
    const score = scoreOf();
    if (beats(score, bestScore)) {
      bestScore = score;
      best = current.slice();
      if (score[0] === mustPlay.size && score[1] === mostMatches) return true;
    }
    if (budget <= 0 || current.length === courts) return budget <= 0;

    for (let i = from; i < ordered.length; i += 1) {
      const match = ordered[i];
      if (busy.has(match.team1Id) || busy.has(match.team2Id)) continue;
      current.push(match);
      busy.add(match.team1Id).add(match.team2Id);
      const stop = search(i + 1);
      current.pop();
      busy.delete(match.team1Id);
      busy.delete(match.team2Id);
      if (stop) return true;
    }
    return false;
  };

  search(0);
  return best;
}

export const generateSchedule = (
  teamIds: string[],
  gamesPerPair: number,
  courts: number,
  random: () => number = Math.random,
): ScheduledMatch[] => packIntoRounds(shuffle(buildPairings(teamIds, gamesPerPair), random), courts, random);
