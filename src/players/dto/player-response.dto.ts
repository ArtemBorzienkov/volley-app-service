export class PlayerResponseDto {
  id: string;
  tgId?: string;
  name: string;
  /** True when the account behind this player asked not to have their name published unmasked. */
  isAnonymous: boolean;
  avatar?: string;
  gender?: string;
  active: boolean;
  totalGames: number;
  totalWins: number;
  totalLosses: number;
  createdAt: Date;
}
