# Groups and a playoff bracket

**Date:** 2026-08-23
**Scope:** full-stack — `volley-app-service` and `volleyball-management-ui`.
**Builds on:** `2026-08-23-ongoing-tournament-design.md`, `2026-08-23-tournament-registration-design.md`.

**Delivered in two phases.** This spec covers the whole shape so it can be agreed once; each phase
gets its own implementation plan. One plan for all of it would be 25+ tasks, and a mistake in the
foundation would only surface near the end.

- **Phase 1 — groups.** Format settings, random group assignment, a round-robin *inside* each
  group, and per-group standings.
- **Phase 2 — playoff.** Detecting that the group stage is complete, seeding, generating the full
  bracket, advancing winners, and the bracket tab.

## Problem

A tournament is one flat round-robin: everyone plays everyone, one table, no finals. Real events
split into groups and then a knockout. Neither exists.

## The seeding rule — derived, then validated

The requested pairings were given for two cases:

- 2 groups of 4, top 2 advance: **A1–B2, A2–B1**
- 2 groups of 5, top 4 advance: **A1–B4, A2–B3, A3–B2, A4–B1**

Both are exactly what a **standard single-elimination bracket** produces from a seed list ordered
*all 1st places, then all 2nd places, …*:

| Case | Seed list | Standard bracket | Matches requested rule |
| --- | --- | --- | --- |
| 2×4, 2 qualify | 1=A1 2=B1 3=A2 4=B2 | (1,4) (2,3) | A1–B2, B1–A2 ✅ |
| 2×5, 4 qualify | 1=A1 2=B1 3=A2 4=B2 5=A3 6=B3 7=A4 8=B4 | (1,8) (4,5) (2,7) (3,6) | A1–B4, A3–B2, A4–B1, A2–B3 ✅ |

So the requested rule is not a special case — it *is* the standard bracket, which is why it
generalises safely to any number of groups, as required.

Bracket positions come from the classic recursive expansion (`[1,2]` → `[1,4,2,3]` →
`[1,8,4,5,2,7,3,6]`), which guarantees the top two seeds can only meet in the final.

Within the same placement, qualifiers are ordered by **group index** (A before B). Simple,
deterministic, and it reproduces both requested cases exactly.

## Data model

**Phase 1** adds format settings and a team's group:

```prisma
model OngoingEventConfig {
  // ... existing gamesPerPair, courts, maxTeams
  scheme             String @default("roundRobin")   // "roundRobin" | "groupsPlayoff"
  groupCount         Int    @default(1)              // @map("group_count")
  qualifiersPerGroup Int?                            // @map("qualifiers_per_group")
}

model OngoingTeam {
  groupIndex Int? @map("group_index")   // 0-based; null while the tournament has no groups
}
```

**Phase 2** adds the playoff shape:

```prisma
model OngoingGame {
  phase        String  @default("group")   // "group" | "playoff"
  bracketRound Int?    @map("bracket_round")
  bracketSlot  Int?    @map("bracket_slot")
  team1Id      String?                     // becomes NULLABLE
  team2Id      String?
}
```

Each phase's migration serves code that ships with it — Phase 1 does not add columns nothing reads.

### The nullable-team decision, and its cost

The whole bracket is generated **up front with empty slots**, matching the reference image where
later boxes are blank, and filled in as winners emerge. That requires `team1Id`/`team2Id` to become
nullable on `ongoing_games`.

**Consequence, stated plainly:** every existing consumer that assumes both teams exist must skip
games that do not have them — `computeStandings`, the Matches tab, and the per-team fixture
cascade. Missing one of those means a crash or a silently wrong table. The alternative (generate
each round only once the previous finishes) avoids the nullability but cannot show the bracket in
advance, which is the thing that was asked for.

Group games always have both teams. A score can only be recorded on a game whose two slots are
filled.

## Validation

Enforced in the service, since there is no `ValidationPipe`:

- `scheme` ∈ {`roundRobin`, `groupsPlayoff`}.
- `groupCount` ≥ 1. `roundRobin` implies `groupCount = 1` and `qualifiersPerGroup = null`.
- For `groupsPlayoff`: `groupCount` ≥ 1, `qualifiersPerGroup` ≥ 1, and
  **`groupCount × qualifiersPerGroup` must be a power of two** — otherwise the bracket has byes,
  which this design does not model. `groupCount = 1` is a legal, deliberate case: a field too small
  to split plays a single round-robin table, and the playoff seeds straight off it (1st vs 4th, 2nd
  vs 3rd, ...) with the same seeding function used for multiple groups — no separate code path.
- `qualifiersPerGroup` must be **strictly less than the smallest group size**, so the group stage
  actually eliminates someone. Group sizes are only known once teams are assigned, so this is
  checked at schedule generation as well as opportunistically at config time.

## Phase 1 — groups

**Assignment happens at `POST /:id/schedule`**, not at registration: shuffle the roster and deal it
round-robin into `groupCount` groups, so sizes differ by at most one. Regenerating reshuffles.
Assignment is **random** as specified — no rating-based seeding.

**Schedule generation becomes per-group.** Today `generateSchedule(teamIds, gamesPerPair, courts)`
builds every pair across the whole roster. It becomes: build the pairings **within each group**,
then pack all of them into rounds together, so courts stay shared across groups and a team still
plays at most once per round. The existing pure `packIntoRounds` already enforces that and is
reused unchanged; only pairing construction changes.

`roundRobin` keeps today's behaviour exactly — one group containing everyone.

**Standings become per-group.** `computeStandings` already takes `(teams, games)`; it is called once
per group with that group's teams and its games. The single-table case is the same function with
one group, so no second implementation.

## Phase 2 — playoff

**The group stage is complete when every group game has a result.** A tournament with no group
games is not complete (nothing has been played).

Once complete, the bracket is generated: qualifiers are taken from each group's standings, ordered
into the seed list, laid out by the recursive bracket expansion, and written as `playoff` games
with `bracketRound` 1..log2(N) and `bracketSlot` within the round. Round 1 has both teams; later
rounds start empty. Recording a result fills the winner into the next round's slot.

The new **Bracket** tab shows each group's table with the qualifying places marked, and the bracket
itself with the pairings, mirroring the reference image.

## Testing

Backend: Jest with a mocked `PrismaService`, plus pure unit tests for the two new pure functions —
group dealing and bracket seeding. The seeding tests must assert the two requested cases verbatim
(2×4→2 and 2×5→4), since those are the specification.

Frontend: no test runner; `npx tsc --noEmit`, `npm run lint` (must hold at the 7 pre-existing
errors), `npm run build`, and a browser walkthrough.

## Out of scope

Byes and uneven brackets; third-place playoffs; best-of-N playoff series; re-seeding between
rounds; manual bracket editing; rating-based group assignment; changing the group stage after the
playoff has started.
