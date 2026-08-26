export class UserResponseDto {
  id: string;
  email: string;
  name: string;
  role: string;
  playerId: string | null;
  createdAt: Date;
}
