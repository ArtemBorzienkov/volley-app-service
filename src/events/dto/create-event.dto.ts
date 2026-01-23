import { IsString, IsDateString, IsOptional } from 'class-validator';

export class CreateEventDto {
  @IsString()
  name: string;

  @IsDateString()
  date: string;

  @IsString()
  createdBy: string;

  @IsOptional()
  @IsString()
  location?: string;
}
