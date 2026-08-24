import { IsArray, IsString } from 'class-validator';

export class OngoingTeamInputDto {
  @IsString()
  player1Id: string;

  @IsString()
  player2Id: string;
}

export class SetOngoingTeamsDto {
  @IsArray()
  teams: OngoingTeamInputDto[];
}
