import { IsString, IsOptional, IsBoolean } from 'class-validator';

export class CreatePlayerDto {
  @IsOptional()
  @IsString()
  tgId?: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  avatar?: string;

  @IsOptional()
  @IsString()
  gender?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
