import { RankingResponseDto } from './ranking-response.dto';

export class GroupedRankingResponseDto {
  ALL: RankingResponseDto[];
  W: RankingResponseDto[];
  M: RankingResponseDto[];
}
