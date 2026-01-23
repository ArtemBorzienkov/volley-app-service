export class PlayerStatsResponseDto {
  playerId: string;
  totalGames: number;
  totalWins: number;
  totalLosses: number;
  winRate: number;
  setsWon: number;
  setsLost: number;
  pointsScored: number;
  pointsConceded: number;
  pointsDifference: number;
}
