export interface DisplayNameSource {
  name: string | null;
  telegramNickname: string | null;
  email: string;
  player?: { name: string } | null;
}

/**
 * Sign-up no longer asks for a name — it asks for an optional Telegram nickname — so the name a
 * user is shown under comes from the player they are linked to. The remaining steps cover accounts
 * created before that change and the theoretical row with no player link at all.
 */
export const resolveDisplayName = (user: DisplayNameSource): string =>
  user.player?.name?.trim() || user.name?.trim() || user.telegramNickname?.trim() || user.email;

/** Telegram shows usernames with a leading @, but stores and resolves them without one. */
export const normaliseTelegramNickname = (value: string | undefined): string | null => {
  const trimmed = value?.trim().replace(/^@/, '');
  return trimmed ? trimmed : null;
};
