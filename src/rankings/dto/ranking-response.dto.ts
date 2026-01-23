import { PlayerResponseDto } from '../../players/dto/player-response.dto';

export class RankingResponseDto {
  rank: number;
  player: PlayerResponseDto;
  value: number;
  metric: string;
}
