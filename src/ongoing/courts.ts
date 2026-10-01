import { BadRequestException } from '@nestjs/common';
import type { CourtWindow } from './schedule';

/** A court as the organiser describes it. `toRound: null` runs to the end of the tournament. */
export interface CourtPlan extends CourtWindow {
  label: string;
}

export const MAX_COURT_LABEL_LENGTH = 10;
export const MAX_COURTS = 20;

/** What every tournament had before courts could be named: one court, all day. */
export const DEFAULT_COURTS: CourtPlan[] = [{ label: '1', fromRound: 1, toRound: null }];

const isPositiveInteger = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 1;

/**
 * The court list a request asked for, or a 400 saying what is wrong with it.
 *
 * A bare number is accepted as that many all-day courts, labelled 1..N — what a client built before
 * courts had names still sends. A blank label falls back to the court's position, so the organiser
 * only types one when the venue's numbering differs.
 */
export function normaliseCourts(value: unknown): CourtPlan[] {
  if (typeof value === 'number') {
    if (!isPositiveInteger(value) || value > MAX_COURTS) {
      throw new BadRequestException(`courts must be between 1 and ${MAX_COURTS}`);
    }
    return Array.from({ length: value }, (_, index) => ({ label: String(index + 1), fromRound: 1, toRound: null }));
  }

  if (!Array.isArray(value) || !value.length) {
    throw new BadRequestException('courts must list at least one court');
  }
  if (value.length > MAX_COURTS) {
    throw new BadRequestException(`A tournament can have at most ${MAX_COURTS} courts`);
  }

  const courts = value.map((entry, index): CourtPlan => {
    if (!entry || typeof entry !== 'object') {
      throw new BadRequestException(`Court ${index + 1} must be an object`);
    }
    const { label, fromRound, toRound } = entry as Record<string, unknown>;

    if (label !== undefined && label !== null && typeof label !== 'string') {
      throw new BadRequestException(`Court ${index + 1}: label must be text`);
    }
    const trimmed = typeof label === 'string' ? label.trim() : '';
    if (trimmed.length > MAX_COURT_LABEL_LENGTH) {
      throw new BadRequestException(`Court ${index + 1}: label must be at most ${MAX_COURT_LABEL_LENGTH} characters`);
    }

    const from = fromRound === undefined || fromRound === null ? 1 : fromRound;
    if (!isPositiveInteger(from)) {
      throw new BadRequestException(`Court ${index + 1}: fromRound must be a whole number of at least 1`);
    }
    const to = toRound === undefined ? null : toRound;
    if (to !== null && (!Number.isInteger(to) || (to as number) < from)) {
      throw new BadRequestException(`Court ${index + 1}: toRound must be empty or at least fromRound`);
    }

    return { label: trimmed || String(index + 1), fromRound: from, toRound: to as number | null };
  });

  const seen = new Set<string>();
  for (const court of courts) {
    const key = court.label.toLocaleLowerCase();
    if (seen.has(key)) throw new BadRequestException(`Court labels must be unique; "${court.label}" is used twice`);
    seen.add(key);
  }

  return courts;
}

/**
 * Whether the new list is anything but a rename. A scheduled game refers to its court by position, so
 * renaming the court at a position is safe at any time. Adding or removing a court, changing its
 * rounds, or moving a court to another position is not: a fixture could end up on a court that no
 * longer exists, that is closed in that round, or — for a move — on a different court than the one
 * it was played on.
 */
export function isStructuralCourtChange(before: CourtPlan[], after: CourtPlan[]): boolean {
  if (before.length !== after.length) return true;
  if (
    before.some((court, index) => court.fromRound !== after[index].fromRound || court.toRound !== after[index].toRound)
  ) {
    return true;
  }

  // A label kept but at another position is a reorder, even when every court is open all day.
  const beforePosition = new Map(before.map((court, index) => [court.label.toLocaleLowerCase(), index]));
  return after.some((court, index) => {
    const previous = beforePosition.get(court.label.toLocaleLowerCase());
    return previous !== undefined && previous !== index;
  });
}
