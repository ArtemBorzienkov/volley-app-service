export class OngoingTeamPlayerDto {
  id: string;
  name: string;
  /** True when the account behind this player asked not to have their name published unmasked. */
  isAnonymous: boolean;
  avatar?: string;
}

export class OngoingTeamResponseDto {
  id: string;
  player1: OngoingTeamPlayerDto;
  player2: OngoingTeamPlayerDto;
  rating: number;
  groupIndex: number | null;
  /** When this entry was made — a real instant, unlike the tournament's date-only `date`. */
  registeredAt: Date;
}

export class OngoingSoloPlayerDto {
  id: string;
  player: OngoingTeamPlayerDto;
  rating: number;
  /** When this entry was made — a real instant, unlike the tournament's date-only `date`. */
  registeredAt: Date;
}

export class OngoingSoloPairDto {
  player1: OngoingTeamPlayerDto;
  player2: OngoingTeamPlayerDto;
  rating: number;
}

export class OngoingSoloPairPreviewDto {
  pairs: OngoingSoloPairDto[];
  unpaired: OngoingTeamPlayerDto[];
}

export class OngoingGameResponseDto {
  id: string;
  eventId: string;
  team1Id: string | null;
  team2Id: string | null;
  team1Points: number | null;
  team2Points: number | null;
  round: number;
  court: number;
  order: number;
  phase: string;
  bracketRound: number | null;
  bracketSlot: number | null;
  thirdPlace: boolean;
  /** fullRotation only: the group this fixture belongs to, and who was on each side of it. */
  groupIndex: number | null;
  side1Players: OngoingTeamPlayerDto[];
  side2Players: OngoingTeamPlayerDto[];
}

export class OngoingEventConfigResponseDto {
  gamesPerPair: number;
  courts: number;
  maxTeams: number | null;
  scheme: string;
  groupCount: number;
  qualifiersPerGroup: number | null;
  rotationRounds: number;
  visibility: string;
  allowSoloRegistration: boolean;
  soloOnlyRegistration: boolean;
  /** Rule keys the organiser switched off; everything not listed is shown on the Rules tab. */
  hiddenRules: string[];
}

export class OngoingRotationStandingDto {
  place: number;
  player: OngoingTeamPlayerDto;
  rating: number;
  played: number;
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
  pointsDiff: number;
}

export class OngoingRotationGroupDto {
  groupIndex: number;
  standings: OngoingRotationStandingDto[];
}

export class OngoingRotationRoundDto {
  round: number;
  isComplete: boolean;
  groups: OngoingRotationGroupDto[];
}

export class OngoingRotationStateDto {
  totalRounds: number;
  /** 0 until the first round is generated. */
  currentRound: number;
  /** True once the last round has every result — at which point finalStandings is the podium. */
  isFinished: boolean;
  rounds: OngoingRotationRoundDto[];
  /** Every player in final order: strongest group first, each group in its finishing order. */
  finalStandings: OngoingRotationStandingDto[];
}

export class OngoingEventResponseDto {
  id: string;
  name: string;
  date: Date;
  startTime: string | null;
  location: string | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  createdByUserId: string | null;
  config: OngoingEventConfigResponseDto;
  teams: OngoingTeamResponseDto[];
  soloPlayers: OngoingSoloPlayerDto[];
  games: OngoingGameResponseDto[];
  /** Present only for the fullRotation scheme; null for the other two. */
  rotation: OngoingRotationStateDto | null;
}

export class OngoingEventCreatorDto {
  id: string;
  name: string;
  /** The organiser is an account too, and may have opted out of being named publicly. */
  isAnonymous: boolean;
}

export class OngoingEventListItemDto {
  id: string;
  name: string;
  date: Date;
  startTime: string | null;
  location: string | null;
  createdByUserId: string | null;
  // The account, not the player: createdByUserId points at users, and a creator need not be linked
  // to a player at all. Null once that account is deleted (the FK is ON DELETE SET NULL).
  createdBy: OngoingEventCreatorDto | null;
  // 'public' | 'private' — who may register, the same field the config carries. Present here so the
  // list card can say it without fetching each tournament's detail.
  visibility: string;
  teamsCount: number;
  gamesCount: number;
  playedCount: number;
  teams: OngoingTeamResponseDto[];
  soloPlayers: OngoingSoloPlayerDto[];
}

export class OngoingOpenEventDto {
  id: string;
  name: string;
  date: Date;
  startTime: string | null;
  location: string | null;
  maxTeams: number | null;
  teamsCount: number;
  createdByUserId: string | null;
  // The account behind the tournament, so the calendar card can name the organiser without a
  // second request. Null once that account is deleted (the FK is ON DELETE SET NULL).
  createdBy: OngoingEventCreatorDto | null;
  teams: OngoingTeamResponseDto[];
  visibility: string;
  allowSoloRegistration: boolean;
  /** Pairs cannot register: the calendar's register control offers the solo path only. */
  soloOnlyRegistration: boolean;
  soloPlayers: OngoingSoloPlayerDto[];
  // fullRotation caps its roster at groupCount x 4 players rather than by maxTeams, so the calendar
  // needs both to work out whether a tournament still has room.
  scheme: string;
  groupCount: number;
  /** A result has been recorded, so the roster is locked — the calendar still lists it. */
  hasStarted: boolean;
  /** The registration deadline (end of the day before the tournament) has not passed yet. */
  registrationOpen: boolean;
}
