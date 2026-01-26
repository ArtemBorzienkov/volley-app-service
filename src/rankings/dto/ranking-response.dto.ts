import { PlayerResponseDto } from '../../players/dto/player-response.dto';

export class RankingResponseDto {
  rank: number;
  player: PlayerResponseDto;
  value: number;
  metric: string;
  totalEvents?: number; // Total events participated in (for eventsWon metric)
  eventsWon?: number; // Events won (for eventsWon metric)
}
