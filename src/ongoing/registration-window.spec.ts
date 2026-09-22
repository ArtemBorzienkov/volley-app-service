import { CANCELLATION_WINDOW_MS, eventStartInstant } from './registration-window';

describe('eventStartInstant', () => {
  it('reads the start time as a wall clock on the stored UTC day', () => {
    const start = eventStartInstant(new Date('2026-09-16T00:00:00.000Z'), '08:00');

    expect(new Date(start!).toISOString()).toBe('2026-09-16T08:00:00.000Z');
  });

  it('accepts a single-digit hour', () => {
    const start = eventStartInstant(new Date('2026-09-16T00:00:00.000Z'), '8:30');

    expect(new Date(start!).toISOString()).toBe('2026-09-16T08:30:00.000Z');
  });

  // The date column is UTC midnight, but a row written from a local-time input can carry an offset.
  // Only its calendar day may count, or the same tournament would start at a different hour per row.
  it('ignores the time already on the date and uses the day only', () => {
    const start = eventStartInstant(new Date('2026-09-16T21:45:00.000Z'), '08:00');

    expect(new Date(start!).toISOString()).toBe('2026-09-16T08:00:00.000Z');
  });

  it('falls back to midnight when no start time is set', () => {
    const start = eventStartInstant(new Date('2026-09-16T00:00:00.000Z'), null);

    expect(new Date(start!).toISOString()).toBe('2026-09-16T00:00:00.000Z');
  });

  it.each(['', '  ', 'noon', '25:00', '08:60', '0800'])('falls back to midnight for %p', (startTime) => {
    const start = eventStartInstant(new Date('2026-09-16T00:00:00.000Z'), startTime);

    expect(new Date(start!).toISOString()).toBe('2026-09-16T00:00:00.000Z');
  });

  it('returns null for an unreadable date rather than an instant in 1970', () => {
    expect(eventStartInstant(new Date('not-a-date'), '08:00')).toBeNull();
    expect(eventStartInstant('nonsense', null)).toBeNull();
  });
});

describe('CANCELLATION_WINDOW_MS', () => {
  it('is a day', () => {
    expect(CANCELLATION_WINDOW_MS).toBe(86_400_000);
  });
});
