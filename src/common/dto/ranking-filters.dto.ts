import { IsOptional, IsInt, IsDateString, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class RankingFiltersDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsString()
  eventId?: string;
}
