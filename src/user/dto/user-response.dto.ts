export class UserResponseDto {
  id: string;
  email: string;
  /** Resolved for display — see resolveDisplayName; not a stored column any more. */
  name: string;
  telegramNickname: string | null;
  /** Clients mask the displayed name when true; the stored name is untouched. */
  isAnonymous: boolean;
  dataConsentAt: Date | null;
  role: string;
  playerId: string | null;
  createdAt: Date;
}
