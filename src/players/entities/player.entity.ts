export class Player {
  id: string;
  tgId?: string;
  name: string;
  avatar?: string;
  gender?: string;
  active: boolean;
  totalGames: number;
  totalWins: number;
  totalLosses: number;
  createdAt: Date;
  updatedAt: Date;
}
