import { PlayerResponseDto } from '../../players/dto/player-response.dto';

export class MedalCounts {
  gold: number;
  silver: number;
  bronze: number;
}

export class RankingResponseDto {
  rank: number;
  player: PlayerResponseDto;
  value: number | MedalCounts; // Number for most metrics, MedalCounts for eventsWon metric
  metric: string;
  totalEvents?: number; // Total events participated in (for eventsWon metric)
  eventsWon?: number; // Deprecated - use value.gold for eventsWon metric
}
