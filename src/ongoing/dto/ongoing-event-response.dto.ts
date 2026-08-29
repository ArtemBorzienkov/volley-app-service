export class OngoingTeamPlayerDto {
  id: string;
  name: string;
  avatar?: string;
}

export class OngoingTeamResponseDto {
  id: string;
  player1: OngoingTeamPlayerDto;
  player2: OngoingTeamPlayerDto;
  rating: number;
  groupIndex: number | null;
}

export class OngoingSoloPlayerDto {
  id: string;
  player: OngoingTeamPlayerDto;
  rating: number;
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
}

export class OngoingEventConfigResponseDto {
  gamesPerPair: number;
  courts: number;
  maxTeams: number | null;
  scheme: string;
  groupCount: number;
  qualifiersPerGroup: number | null;
  visibility: string;
  allowSoloRegistration: boolean;
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
}

export class OngoingEventCreatorDto {
  id: string;
  name: string;
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
  soloPlayers: OngoingSoloPlayerDto[];
}
