import { PlayerResponseDto } from '../../players/dto/player-response.dto';

export class TeamCombinationResponseDto {
  rank: number;
  player1: PlayerResponseDto;
  player2: PlayerResponseDto;
  gamesPlayed: number;
  wins: number;
  losses: number;
  winRate: number;
  setsWon: number;
  setsLost: number;
  pointsScored: number;
  pointsConceded: number;
}
