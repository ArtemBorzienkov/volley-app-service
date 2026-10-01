import { OngoingCourtInput } from './ongoing-court.dto';
import { IsString, IsDateString, IsOptional, IsArray, IsInt, IsBoolean } from 'class-validator';

export class CreateOngoingEventDto {
  @IsString()
  name: string;

  @IsDateString()
  date: string;

  @IsOptional()
  @IsArray()
  teams?: Array<{ player1Id: string; player2Id: string }>;

  /** Player ids to seed the partnerless pool with. Requires allowSoloRegistration. */
  @IsOptional()
  @IsArray()
  soloPlayers?: string[];

  @IsOptional()
  @IsInt()
  maxTeams?: number;

  @IsOptional()
  @IsString()
  startTime?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsString()
  scheme?: string;

  @IsOptional()
  @IsInt()
  groupCount?: number;

  @IsOptional()
  @IsInt()
  qualifiersPerGroup?: number;

  @IsOptional()
  @IsInt()
  rotationRounds?: number;

  @IsOptional()
  @IsString()
  visibility?: string;

  @IsOptional()
  @IsBoolean()
  allowSoloRegistration?: boolean;

  /** The court list in fill order; omitted = one court, "1", open all day. */
  @IsOptional()
  courts?: OngoingCourtInput[] | number;

  /** Pairs cannot register at all; implies allowSoloRegistration, which the service forces on. */
  @IsOptional()
  @IsBoolean()
  soloOnlyRegistration?: boolean;
}
