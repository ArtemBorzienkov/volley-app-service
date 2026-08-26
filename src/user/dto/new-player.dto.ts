import { IsIn, IsNotEmpty, IsString } from 'class-validator';

export class NewPlayerDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsIn(['male', 'female'])
  gender: string;
}
