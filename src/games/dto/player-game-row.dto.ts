export class PlayerGameRowPlayerDto {
  id: string;
  name: string;
}

export class PlayerGameRowTeamDto {
  player1: PlayerGameRowPlayerDto;
  player2: PlayerGameRowPlayerDto;
  points: number;
}

export class PlayerGameRowDto {
  gameId: string;
  date: Date;
  team1: PlayerGameRowTeamDto; // page player's team; page player is player1
  team2: PlayerGameRowTeamDto;
  rankChange: number; // page player's rating change for this game
  newRating: number; // page player's rating after this game (post-change)
}

export class PlayerGamesResponseDto {
  games: PlayerGameRowDto[];
  total: number;
}
