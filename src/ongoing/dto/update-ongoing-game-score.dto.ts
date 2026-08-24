import { IsInt } from 'class-validator';

export class UpdateOngoingGameScoreDto {
  @IsInt()
  team1Points: number;

  @IsInt()
  team2Points: number;
}
