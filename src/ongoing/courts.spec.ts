import { BadRequestException } from '@nestjs/common';
import { DEFAULT_COURTS, isStructuralCourtChange, normaliseCourts } from './courts';

const court = (label: string, fromRound = 1, toRound: number | null = null) => ({ label, fromRound, toRound });

describe('normaliseCourts', () => {
  it('keeps a valid list in the organiser’s order', () => {
    expect(normaliseCourts([court('5'), court('7'), court('9', 1, 4)])).toEqual([
      court('5'),
      court('7'),
      court('9', 1, 4),
    ]);
  });

  it('defaults a court to all day', () => {
    expect(normaliseCourts([{ label: 'A' }])).toEqual([court('A')]);
  });

  // The organiser only types a label when the venue's numbering differs from the list's.
  it('falls back to the position for a blank label', () => {
    expect(normaliseCourts([{ label: '  ' }, { label: 'B' }, {}])).toEqual([court('1'), court('B'), court('3')]);
  });

  it('trims labels', () => {
    expect(normaliseCourts([{ label: '  Центр ' }])[0].label).toBe('Центр');
  });

  // What a client built before named courts sends.
  it('turns a bare number into that many all-day courts', () => {
    expect(normaliseCourts(3)).toEqual([court('1'), court('2'), court('3')]);
  });

  it.each([0, -1, 2.5, 21])('rejects %p as a number of courts', (count) => {
    expect(() => normaliseCourts(count)).toThrow(BadRequestException);
  });

  it('rejects an empty list and a non-list', () => {
    expect(() => normaliseCourts([])).toThrow('courts must list at least one court');
    expect(() => normaliseCourts('3 courts')).toThrow(BadRequestException);
    expect(() => normaliseCourts(null)).toThrow(BadRequestException);
  });

  it('rejects more than 20 courts', () => {
    expect(() => normaliseCourts(Array.from({ length: 21 }, () => ({})))).toThrow('at most 20 courts');
  });

  it('rejects a label longer than 10 characters', () => {
    expect(() => normaliseCourts([{ label: 'Centre Court' }])).toThrow('Court 1: label must be at most 10 characters');
    expect(normaliseCourts([{ label: 'Centre Crt' }])[0].label).toBe('Centre Crt');
  });

  it('rejects a label that is not text', () => {
    expect(() => normaliseCourts([{ label: 5 }])).toThrow('Court 1: label must be text');
  });

  // Two fixtures on "court 5" would be ambiguous at the venue, whatever the case.
  it('rejects the same label twice, regardless of case', () => {
    expect(() => normaliseCourts([court('A'), court('a')])).toThrow('Court labels must be unique; "a" is used twice');
  });

  it('rejects a duplicate a blank label falls back into', () => {
    expect(() => normaliseCourts([court('2'), {}])).toThrow(/unique/);
  });

  it.each([0, -3, 1.5, '2'])('rejects fromRound %p', (fromRound) => {
    expect(() => normaliseCourts([{ label: 'A', fromRound }])).toThrow(
      'Court 1: fromRound must be a whole number of at least 1',
    );
  });

  it('rejects a toRound before its fromRound, or not a whole number', () => {
    expect(() => normaliseCourts([court('A', 5, 4)])).toThrow('Court 1: toRound must be empty or at least fromRound');
    expect(() => normaliseCourts([{ label: 'A', toRound: 2.5 }])).toThrow(/toRound/);
  });

  it('accepts a court open for a single round', () => {
    expect(normaliseCourts([court('A', 3, 3)])).toEqual([court('A', 3, 3)]);
  });

  it('names the court at fault by its position', () => {
    expect(() => normaliseCourts([court('A'), court('B', 0)])).toThrow(/^Court 2:/);
  });
});

describe('isStructuralCourtChange', () => {
  const before = [court('5'), court('7'), court('9', 1, 4)];

  it('is false for the same list', () => {
    expect(
      isStructuralCourtChange(
        before,
        before.map((entry) => ({ ...entry })),
      ),
    ).toBe(false);
  });

  // Fixtures point at a position, so a rename changes only what the card shows.
  it('is false for a rename', () => {
    expect(isStructuralCourtChange(before, [court('5'), court('8'), court('9', 1, 4)])).toBe(false);
  });

  it('is true when a court is added or removed', () => {
    expect(isStructuralCourtChange(before, [...before, court('11')])).toBe(true);
    expect(isStructuralCourtChange(before, before.slice(0, 2))).toBe(true);
  });

  it('is true when a court’s rounds change', () => {
    expect(isStructuralCourtChange(before, [court('5'), court('7'), court('9', 1, 5)])).toBe(true);
    expect(isStructuralCourtChange(before, [court('5'), court('7', 2), court('9', 1, 4)])).toBe(true);
    expect(isStructuralCourtChange(before, [court('5'), court('7'), court('9')])).toBe(true);
  });

  // Swapping two all-day courts keeps every window equal, yet played fixtures would change court.
  it('is true when courts swap places, even with identical rounds', () => {
    expect(isStructuralCourtChange([court('5'), court('7')], [court('7'), court('5')])).toBe(true);
  });

  it('matches labels regardless of case when spotting a move', () => {
    expect(isStructuralCourtChange([court('A'), court('B')], [court('b'), court('a')])).toBe(true);
  });

  it('treats the default single court as unchanged by the same court', () => {
    expect(isStructuralCourtChange(DEFAULT_COURTS, [court('1')])).toBe(false);
  });
});
