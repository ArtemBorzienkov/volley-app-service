import { PlayerResponseDto } from './player-response.dto';

export class MedalCounts {
  gold: number;
  silver: number;
  bronze: number;
}

export class FullPlayerResponseDto extends PlayerResponseDto {
  totalEvents: number;
  medals: MedalCounts;
  totalGames: number;
  winRate: number;
  recentGames: string[]; // Array of 'win' or 'lose' strings (max 5, most recent first)
}
