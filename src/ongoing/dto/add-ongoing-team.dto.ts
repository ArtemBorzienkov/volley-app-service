import { IsString } from 'class-validator';

export class AddOngoingTeamDto {
  @IsString()
  player1Id: string;

  @IsString()
  player2Id: string;
}
