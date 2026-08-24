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
  config: OngoingEventConfigResponseDto;
  teams: OngoingTeamResponseDto[];
  games: OngoingGameResponseDto[];
}

export class OngoingEventListItemDto {
  id: string;
  name: string;
  date: Date;
  startTime: string | null;
  location: string | null;
  teamsCount: number;
  gamesCount: number;
  playedCount: number;
}

export class OngoingOpenEventDto {
  id: string;
  name: string;
  date: Date;
  startTime: string | null;
  location: string | null;
  maxTeams: number | null;
  teamsCount: number;
  teams: OngoingTeamResponseDto[];
}
