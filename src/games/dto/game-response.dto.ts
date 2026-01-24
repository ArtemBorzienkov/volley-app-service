export class GameResponseDto {
  id: string;
  eventId: string;
  team1Player1Id: string;
  team1Player2Id: string;
  team2Player1Id: string;
  team2Player2Id: string;
  team1Points: number;
  team2Points: number;
  date: Date;
  location?: string;
  createdAt: Date;
  updatedAt: Date;
}
