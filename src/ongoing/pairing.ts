export interface SoloEntry {
  playerId: string;
  rating: number;
}

export interface PairedTeam {
  player1Id: string;
  player2Id: string;
}

export interface PairingResult {
  pairs: PairedTeam[];
  unpaired: string[];
}

// Strongest with weakest, so no team is two top seeds. playerId breaks rating ties because ratings
// repeat constantly (every player starts at 1000) — without it the pairing would follow row order,
// which no sortable column reproduces.
export const pairByRating = (entries: SoloEntry[]): PairingResult => {
  const sorted = entries.slice().sort((a, b) => {
    if (b.rating !== a.rating) return b.rating - a.rating;
    if (a.playerId === b.playerId) return 0;
    return a.playerId < b.playerId ? -1 : 1;
  });

  const pairs: PairedTeam[] = [];
  let low = 0;
  let high = sorted.length - 1;

  while (low < high) {
    pairs.push({ player1Id: sorted[low].playerId, player2Id: sorted[high].playerId });
    low += 1;
    high -= 1;
  }

  // The pointers land on the same index only for an odd count, and that index is the median.
  const unpaired = low === high ? [sorted[low].playerId] : [];

  return { pairs, unpaired };
};

// Two solo entrants will become one team; an odd one still needs a slot of their own, so a
// tournament can never be over-filled by the rounding.
export const effectiveTeamCount = (teamCount: number, soloCount: number): number =>
  teamCount + Math.ceil(soloCount / 2);
