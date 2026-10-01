/** A court as a client sends it. A blank label falls back to the court's position. */
export class OngoingCourtInput {
  label?: string;
  fromRound?: number;
  /** Null or omitted = open to the end of the tournament. */
  toRound?: number | null;
}

/** A court as the API returns it, in fill order: the first one is used first in every round. */
export class OngoingCourtDto {
  label: string;
  fromRound: number;
  toRound: number | null;
}
