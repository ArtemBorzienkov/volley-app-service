import { normaliseTelegramNickname, resolveDisplayName } from './display-name';

describe('resolveDisplayName', () => {
  const base = { name: null, telegramNickname: null, email: 'jane@example.com', player: null };

  it('prefers the linked player name, so renaming the player renames the user everywhere', () => {
    expect(resolveDisplayName({ ...base, name: 'Legacy Jane', player: { name: 'Jane Doe' } })).toBe('Jane Doe');
  });

  it('falls back to the stored name for accounts created before sign-up dropped the field', () => {
    expect(resolveDisplayName({ ...base, name: 'Legacy Jane' })).toBe('Legacy Jane');
  });

  it('falls back to the telegram nickname when there is no player and no stored name', () => {
    expect(resolveDisplayName({ ...base, telegramNickname: 'jane_doe' })).toBe('jane_doe');
  });

  it('falls back to the email so the display name is never empty', () => {
    expect(resolveDisplayName(base)).toBe('jane@example.com');
  });

  it('skips a whitespace-only player name instead of rendering a blank', () => {
    expect(resolveDisplayName({ ...base, name: 'Legacy Jane', player: { name: '   ' } })).toBe('Legacy Jane');
  });
});

describe('normaliseTelegramNickname', () => {
  it('strips the leading @ Telegram displays but does not store', () => {
    expect(normaliseTelegramNickname('@jane_doe')).toBe('jane_doe');
  });

  it('trims surrounding whitespace', () => {
    expect(normaliseTelegramNickname('  jane_doe  ')).toBe('jane_doe');
  });

  it('returns null for undefined, empty and whitespace-only input', () => {
    expect(normaliseTelegramNickname(undefined)).toBeNull();
    expect(normaliseTelegramNickname('')).toBeNull();
    expect(normaliseTelegramNickname('   ')).toBeNull();
    expect(normaliseTelegramNickname('@')).toBeNull();
  });
});
