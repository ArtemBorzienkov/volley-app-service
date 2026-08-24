# Playoff Bracket (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Once every group game has a result, an admin generates a full single-elimination bracket from the group standings; recording a playoff result advances the winner; a new Bracket tab shows the groups with qualifying places marked and the bracket itself.

**Architecture:** Playoff matches live in `ongoing_games` alongside group matches, distinguished by `phase`, and positioned by `bracketRound` + `bracketSlot`. The **whole** bracket is written up front — round 1 with both teams, later rounds with empty slots — which is why `team1Id`/`team2Id` become nullable. Seeding is the standard bracket: order qualifiers by placement then group index, then expand `[1,2] → [1,4,2,3] → [1,8,4,5,2,7,3,6]` so the top two seeds can only meet in the final. That expansion provably reproduces both requested cases (2×4→2 and 2×5→4).

**Tech Stack:** NestJS 10 + Prisma 4.16 + PostgreSQL + Jest; Next.js App Router + TanStack Query + Tailwind v4 + shadcn/ui + i18next.

**Spec:** `volley-app-service/docs/superpowers/specs/2026-08-23-groups-and-playoff-design.md` (the "Phase 2 — playoff" section). Phase 1 (groups) is already shipped and reviewed.

## Global Constraints

- **Never run a git command** — not even read-only, not even `git status`. Both repos' `CLAUDE.md` forbid it. **Every task ends without a commit step.** Several increments are already uncommitted in these trees; never revert or stash.
- **Do not start or stop any dev server.** Ports 3000/3001 are managed centrally by the controller and are currently free. Ask in your report if you want a live check. **A stale server already caused a false bug report in this project — never trust a running process you did not just start.**
- Backend `tsconfig` targets `es2017`, no `lib` override — **`flatMap`, `toSorted`, `Object.fromEntries` are unavailable** and fail `npm run build`.
- Backend `strictNullChecks: false`; **no global `ValidationPipe`** — validate explicitly and throw `BadRequestException` / `NotFoundException` / `ConflictException`.
- Backend Prettier: single quotes, trailing commas, **120 columns**. Explicit return types on every controller and service method. Guard clauses at the top. Pure helpers are module-level `export const fn = () => {}` arrows (`src/ongoing/schedule.ts`, `groups.ts` are the examples).
- **Backend baseline: `npm run test` is 119 passing across 4 suites; `npm run build` clean.** Never regress.
- **Frontend `npm run lint` is NOT clean and never was.** Baseline: exactly **7 errors** (four `no-explicit-any`, three `set-state-in-effect`) in `app/add-results/page.tsx`, `app/events/page.tsx`, `app/events/[id]/page.tsx`, `components/layout-wrapper.tsx`, `components/navigation.tsx`. Gate: **still exactly 7, none in touched files** — never "clean", and never touch those seven.
- **Frontend `npx tsc --noEmit` is the only real typecheck**, is clean, must stay clean. `strict: true`.
- **Frontend rule, verbatim:** *"Derive during render instead of syncing with an effect. `set-state-in-effect` already fires three times in this repo; do not add a fourth."*
- Frontend: `'use client'` on every page/component. New fetches check `res.ok`, parse the server's JSON `{ message }` and throw it.
- **Any new UI string goes into all four locale files** (`locales/{en,uk,pl,be}/common.json`) with real uk/pl/be translations, never English pasted in. Re-read them immediately before editing; each must still parse as JSON.
- `lib/api.ts` is the single URL registry — add new endpoint URLs there, never inline one.
- npm only in the frontend; install nothing. No frontend test framework — do not introduce one, never call anything "tested" there.
- No useless comments — comment the *why* only.
- Paths are relative to `/Users/artem/Desktop/projects/`.

## The rules this phase introduces

These are the decisions the tasks enforce. They exist to stop a bracket that silently contradicts itself.

1. **The group stage is complete when every `phase: 'group'` game has a result.** A tournament with zero group games is not complete.
2. **Generating the playoff is an explicit admin action**, not an automatic side effect of the last result — mirroring the existing "Generate schedule" button, and undoable.
3. **Once playoff games exist, group results are locked.** Editing or clearing a group score would invalidate the seeding that produced the bracket. To correct a group result, delete the playoff first.
4. **Clearing a playoff result is refused while the next round's game already has a result.** Undo later rounds first. This avoids a deep, surprising cascade.
5. **`computeStandings` counts only group games.** A playoff win must never appear in a group table.
6. **A score can only be recorded on a game whose two slots are both filled.**

## File Structure

| File | Responsibility |
| --- | --- |
| `volley-app-service/prisma/schema.prisma` | `phase`, `bracketRound`, `bracketSlot`; nullable team ids |
| `volley-app-service/src/ongoing/bracket.ts` (create) | pure seeding + bracket layout |
| `volley-app-service/src/ongoing/bracket.spec.ts` (create) | including the two requested cases verbatim |
| `volley-app-service/src/ongoing/ongoing.service.ts` | generate/delete playoff, advancement, the six rules |
| `volley-app-service/src/ongoing/ongoing.controller.ts` | two new routes |
| `volley-app-service/src/ongoing/dto/*.ts` | game DTO gains phase/bracket fields |
| `volleyball-management-ui/lib/types.ts`, `lib/api.ts` | mirror both |
| `volleyball-management-ui/lib/ongoing-standings.ts` | group-only filter |
| `volleyball-management-ui/components/ongoing/ongoing-bracket-tab.tsx` (create) | the new tab |
| `volleyball-management-ui/components/ongoing/ongoing-matches-tab.tsx` | group games only |
| `volleyball-management-ui/app/ongoing/[id]/page.tsx` | mount the tab |

---

## Task 1: Schema, nullable slots, and guarding the existing consumers

**Files:**
- Modify: `volley-app-service/prisma/schema.prisma`, `src/ongoing/ongoing.service.ts`, `src/ongoing/dto/ongoing-event-response.dto.ts`
- Create: migration (generated)
- Test: `src/ongoing/ongoing.service.spec.ts`

**Interfaces:**
- Produces: `OngoingGame.phase: string` (default `'group'`), `bracketRound: number | null`, `bracketSlot: number | null`, and `team1Id`/`team2Id` **nullable**, all surfaced on `OngoingGameResponseDto`.

- [x] **Step 1: Confirm the target database**

Run: `grep -n '^DATABASE_URL' volley-app-service/.env`

The active line must be the **localhost** one (`127.0.0.1`). If it is not, **stop and ask** — never migrate a shared database.

- [x] **Step 2: Change the schema**

In `model OngoingGame`:

```prisma
  team1Id      String?  @map("team1_id")
  team2Id      String?  @map("team2_id")
  phase        String   @default("group")
  bracketRound Int?     @map("bracket_round")
  bracketSlot  Int?     @map("bracket_slot")
```

and make both relations optional:

```prisma
  team1 OngoingTeam? @relation("OngoingGameTeam1", fields: [team1Id], references: [id], onDelete: Cascade)
  team2 OngoingTeam? @relation("OngoingGameTeam2", fields: [team2Id], references: [id], onDelete: Cascade)
```

**Do not run `npx prisma format`** — it reformats unrelated pre-existing models.

- [x] **Step 3: Migrate and regenerate**

```bash
cd volley-app-service && npm run prisma:migrate:dev -- --name add_playoff_phase && npm run prisma:generate
```

Expected: `ADD COLUMN` for the three new columns plus `ALTER COLUMN ... DROP NOT NULL` for the two team ids. Dropping NOT NULL never loses data. If Prisma warns about data loss, stop and report.

- [x] **Step 4: Write the failing tests**

Append inside the outer `describe('OngoingService', ...)`:

```ts
  describe('OngoingService.updateGameScore with empty slots', () => {
    it('refuses a score on a game whose first slot is empty', async () => {
      prisma.ongoingGame.findUnique = jest.fn(async () => ({
        id: 'g1', eventId: 'event-1', team1Id: null, team2Id: 't2',
        team1Points: null, team2Points: null, round: 1, court: 1, order: 0,
        phase: 'playoff', bracketRound: 2, bracketSlot: 0,
      }) as any);

      await expect(service.updateGameScore('g1', { team1Points: 15, team2Points: 9 })).rejects.toThrow(
        new BadRequestException('Both teams must be known before a result can be recorded'),
      );
      expect(prisma.ongoingGame.update).not.toHaveBeenCalled();
    });

    it('refuses a score on a game whose second slot is empty', async () => {
      prisma.ongoingGame.findUnique = jest.fn(async () => ({
        id: 'g1', eventId: 'event-1', team1Id: 't1', team2Id: null,
        team1Points: null, team2Points: null, round: 1, court: 1, order: 0,
        phase: 'playoff', bracketRound: 2, bracketSlot: 0,
      }) as any);

      await expect(service.updateGameScore('g1', { team1Points: 15, team2Points: 9 })).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('OngoingService game phase exposure', () => {
    it('returns phase and bracket position on every game', async () => {
      prisma.ongoingEvent.findUnique = jest.fn(async () => ({
        ...EVENT_ROW,
        games: [
          { id: 'g1', eventId: 'event-1', team1Id: 't1', team2Id: 't2', team1Points: null, team2Points: null,
            round: 1, court: 1, order: 0, phase: 'group', bracketRound: null, bracketSlot: null },
        ],
      }) as any);

      const result = await service.findOne('event-1');

      expect(result.games[0].phase).toBe('group');
      expect(result.games[0].bracketRound).toBeNull();
      expect(result.games[0].bracketSlot).toBeNull();
    });
  });
```

- [x] **Step 5: Run them and watch them fail**

Run: `cd volley-app-service && npx jest src/ongoing/ongoing.service.spec.ts`

- [x] **Step 6: Implement**

- Add `phase: string; bracketRound: number | null; bracketSlot: number | null;` to `OngoingGameResponseDto`, change `team1Id`/`team2Id` to `string | null`, and map all five in `mapGame`.
- In `updateGameScore`, **before** the score validation, reject when either slot is null with the exact message above. This is rule 6.
- **Audit every other place that reads a game's team ids** and make each tolerate null. Grep the service for `team1Id` / `team2Id` and check each site. `findAll`'s `playedCount`, `assertPlanning`, `findOpen` and `removeTeam` all touch games — reason about each and say in your report what you found and changed. **A missed site is the whole risk of this task**: with nullable ids, a site that assumed a team exists will either crash or silently mis-count.
- `generateSchedule` must keep writing `phase: 'group'` with null bracket fields for every fixture it creates.

- [x] **Step 7: Run everything and build**

```bash
cd volley-app-service && npm run test && npm run build
```

---

## Task 2: Pure bracket seeding and layout

**Files:**
- Create: `volley-app-service/src/ongoing/bracket.ts`, `src/ongoing/bracket.spec.ts`

**Interfaces:**
- Produces:
  - `interface Qualifier { teamId: string; groupIndex: number; place: number }` — `place` is 1-based within its group
  - `buildSeedList(qualifiers: Qualifier[]): string[]` — sorted by `place` asc, then `groupIndex` asc
  - `bracketSeedOrder(size: number): number[]` — 1-based seed numbers in bracket position order
  - `buildBracketGames(seedList: string[]): Array<{ bracketRound: number; bracketSlot: number; team1Id: string | null; team2Id: string | null }>`

- [x] **Step 1: Write the failing tests**

Create `src/ongoing/bracket.spec.ts`. **The first two `buildBracketGames` cases are the specification** — they are the pairings that were explicitly requested, so they must be asserted verbatim.

```ts
import { buildSeedList, bracketSeedOrder, buildBracketGames, Qualifier } from './bracket';

const q = (teamId: string, groupIndex: number, place: number): Qualifier => ({ teamId, groupIndex, place });

describe('buildSeedList', () => {
  it('orders all first places before all second places', () => {
    const seeds = buildSeedList([q('a2', 0, 2), q('b1', 1, 1), q('a1', 0, 1), q('b2', 1, 2)]);

    expect(seeds).toEqual(['a1', 'b1', 'a2', 'b2']);
  });

  it('breaks ties within a placement by group index', () => {
    const seeds = buildSeedList([q('c1', 2, 1), q('a1', 0, 1), q('b1', 1, 1)]);

    expect(seeds).toEqual(['a1', 'b1', 'c1']);
  });

  it('does not mutate its input', () => {
    const input = [q('b1', 1, 1), q('a1', 0, 1)];
    buildSeedList(input);

    expect(input[0].teamId).toBe('b1');
  });
});

describe('bracketSeedOrder', () => {
  it('pairs the top and bottom seed for a two-team bracket', () => {
    expect(bracketSeedOrder(2)).toEqual([1, 2]);
  });

  it('expands to four so seeds 1 and 2 are on opposite halves', () => {
    expect(bracketSeedOrder(4)).toEqual([1, 4, 2, 3]);
  });

  it('expands to eight in the standard order', () => {
    expect(bracketSeedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
  });

  it('keeps seeds 1 and 2 apart until the final at every size', () => {
    for (const size of [2, 4, 8, 16]) {
      const order = bracketSeedOrder(size);
      const half = size / 2;
      expect(order.slice(0, half)).toContain(1);
      expect(order.slice(half)).toContain(2);
    }
  });
});

describe('buildBracketGames', () => {
  // The two cases below are the requested specification, expressed as seed lists.
  it('reproduces the 2 groups of 4 case: A1-B2 and A2-B1', () => {
    // seeds: 1=A1, 2=B1, 3=A2, 4=B2
    const games = buildBracketGames(['A1', 'B1', 'A2', 'B2']);
    const roundOne = games.filter((game) => game.bracketRound === 1);

    expect(roundOne).toHaveLength(2);
    expect(roundOne.map((game) => [game.team1Id, game.team2Id])).toEqual([
      ['A1', 'B2'],
      ['B1', 'A2'],
    ]);
  });

  it('reproduces the 2 groups of 5 case: A1-B4, A3-B2, B1-A4, A2-B3', () => {
    // seeds: 1=A1 2=B1 3=A2 4=B2 5=A3 6=B3 7=A4 8=B4
    const games = buildBracketGames(['A1', 'B1', 'A2', 'B2', 'A3', 'B3', 'A4', 'B4']);
    const roundOne = games.filter((game) => game.bracketRound === 1);

    expect(roundOne).toHaveLength(4);
    expect(roundOne.map((game) => [game.team1Id, game.team2Id])).toEqual([
      ['A1', 'B4'],
      ['B2', 'A3'],
      ['B1', 'A4'],
      ['A2', 'B3'],
    ]);
  });

  it('creates every later round with both slots empty', () => {
    const games = buildBracketGames(['A1', 'B1', 'A2', 'B2', 'A3', 'B3', 'A4', 'B4']);

    for (const game of games.filter((one) => one.bracketRound > 1)) {
      expect(game.team1Id).toBeNull();
      expect(game.team2Id).toBeNull();
    }
  });

  it('creates log2(size) rounds with halving game counts', () => {
    const games = buildBracketGames(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
    const perRound = new Map<number, number>();
    for (const game of games) perRound.set(game.bracketRound, (perRound.get(game.bracketRound) || 0) + 1);

    expect([...perRound.entries()].sort((one, two) => one[0] - two[0])).toEqual([[1, 4], [2, 2], [3, 1]]);
  });

  it('numbers slots from zero within each round', () => {
    const games = buildBracketGames(['a', 'b', 'c', 'd']);

    expect(games.filter((game) => game.bracketRound === 1).map((game) => game.bracketSlot)).toEqual([0, 1]);
    expect(games.filter((game) => game.bracketRound === 2).map((game) => game.bracketSlot)).toEqual([0]);
  });

  it('builds a single final for a two-team bracket', () => {
    const games = buildBracketGames(['a', 'b']);

    expect(games).toHaveLength(1);
    expect([games[0].team1Id, games[0].team2Id]).toEqual(['a', 'b']);
  });

  it('rejects a seed list whose length is not a power of two', () => {
    expect(() => buildBracketGames(['a', 'b', 'c'])).toThrow();
  });
});
```

- [x] **Step 2: Run them and watch them fail**

Run: `cd volley-app-service && npx jest src/ongoing/bracket.spec.ts`
Expected: FAIL — `Cannot find module './bracket'`.

- [x] **Step 3: Implement**

Create `src/ongoing/bracket.ts`. Reuse `isPowerOfTwo` from `./groups` rather than writing a second check.

```ts
import { isPowerOfTwo } from './groups';

export interface Qualifier {
  teamId: string;
  groupIndex: number;
  place: number;
}

export interface BracketGame {
  bracketRound: number;
  bracketSlot: number;
  team1Id: string | null;
  team2Id: string | null;
}

// All first places, then all second places, and so on — within a placement, by group order.
// This ordering is what makes the standard bracket below reproduce the requested pairings.
export const buildSeedList = (qualifiers: Qualifier[]): string[] =>
  qualifiers
    .slice()
    .sort((one, two) => (one.place !== two.place ? one.place - two.place : one.groupIndex - two.groupIndex))
    .map((qualifier) => qualifier.teamId);

// Classic recursive expansion: [1,2] -> [1,4,2,3] -> [1,8,4,5,2,7,3,6]. Guarantees the top two
// seeds sit in opposite halves and can only meet in the final.
export const bracketSeedOrder = (size: number): number[] => {
  let order = [1, 2];

  while (order.length < size) {
    const next = order.length * 2;
    const expanded: number[] = [];
    for (const seed of order) {
      expanded.push(seed);
      expanded.push(next + 1 - seed);
    }
    order = expanded;
  }

  return order;
};

export const buildBracketGames = (seedList: string[]): BracketGame[] => {
  if (!isPowerOfTwo(seedList.length)) {
    throw new Error(`A bracket needs a power-of-two number of teams, got ${seedList.length}`);
  }

  const order = bracketSeedOrder(seedList.length);
  const games: BracketGame[] = [];

  for (let slot = 0; slot < order.length / 2; slot += 1) {
    games.push({
      bracketRound: 1,
      bracketSlot: slot,
      team1Id: seedList[order[slot * 2] - 1],
      team2Id: seedList[order[slot * 2 + 1] - 1],
    });
  }

  let remaining = seedList.length / 2;
  let round = 2;
  while (remaining > 1) {
    remaining = remaining / 2;
    for (let slot = 0; slot < remaining; slot += 1) {
      games.push({ bracketRound: round, bracketSlot: slot, team1Id: null, team2Id: null });
    }
    round += 1;
  }

  return games;
};
```

Note `bracketSeedOrder(2)` must return `[1, 2]` without entering the loop — check that.

- [x] **Step 4: Run and build**

```bash
cd volley-app-service && npx jest src/ongoing/bracket.spec.ts && npm run test && npm run build
```

---

## Task 3: Generate and delete the playoff

**Files:**
- Modify: `volley-app-service/src/ongoing/ongoing.service.ts`, `ongoing.controller.ts`
- Test: `src/ongoing/ongoing.service.spec.ts`

**Interfaces:**
- Produces: `generatePlayoff(id): Promise<OngoingEventResponseDto>`, `deletePlayoff(id): Promise<OngoingEventResponseDto>`, `POST /ongoing/:id/playoff`, `DELETE /ongoing/:id/playoff`; and a private `isGroupStageComplete(games): boolean`.

- [x] **Step 1: Write the failing tests**

Append inside the outer `describe('OngoingService', ...)`. Cover at least:

- refuses when `scheme` is `roundRobin` (there is no playoff in a flat round-robin) — `BadRequestException`
- refuses when the tournament has **no** group games at all
- refuses when any group game still lacks a result — `ConflictException`, and nothing is created
- refuses when playoff games already exist — `ConflictException` naming that the playoff must be deleted first
- on success, writes exactly `log2(groupCount × qualifiersPerGroup)` rounds' worth of games, all with `phase: 'playoff'`, round 1 fully populated and later rounds empty
- seeds from the **group standings**, not registration order: build a fixture where group A's table order differs from its team order and assert the seeding follows the table
- `deletePlayoff` removes only `phase: 'playoff'` games and leaves every group game untouched

Write these yourself from the rules; put the exact expected message strings in the assertions.

- [x] **Step 2: Run and watch fail**

- [x] **Step 3: Implement**

`generatePlayoff(id)`:
1. `loadEvent(id)`.
2. Reject unless `config.scheme === 'groupsPlayoff'`.
3. Reject if any `phase: 'playoff'` game exists (rule 2's undo path is `deletePlayoff`).
4. Take the group games; reject if there are none, or if any lacks a result (rule 1). Reuse the existing shared played-game predicate — **do not write a third copy of "has a result"**; `isGamePlayed` and `PLAYED_GAME_WHERE` already exist for exactly this.
5. Compute each group's standings **on the backend**. `computeStandings` lives in the frontend, so you need the ranking here: rank within a group by wins desc, then point difference desc, then points-for desc — **the same comparator the frontend uses**. Put it in `bracket.ts` as a pure exported function so the rule lives in one place on this side, and note in your report that it mirrors `lib/ongoing-standings.ts`; the two must agree or the bracket will contradict the visible tables.
6. Take the top `qualifiersPerGroup` from each group as `Qualifier`s, `buildSeedList`, `buildBracketGames`, and write them all in one transaction with `phase: 'playoff'`, null scores, and `round`/`court`/`order` set to something consistent (bracket games are not court-scheduled in this phase — use `round: 0`, `court: 0`, and `order` = a running index, and say so in your report).

`deletePlayoff(id)`: `deleteMany({ where: { eventId: id, phase: 'playoff' } })`.

- [x] **Step 4: Controller routes**

Add **above** `@Get(':id')`:

```ts
  @Post(':id/playoff')
  @HttpCode(HttpStatus.OK)
  async generatePlayoff(@Param('id') id: string): Promise<OngoingEventResponseDto> {
    return this.ongoingService.generatePlayoff(id);
  }

  @Delete(':id/playoff')
  async deletePlayoff(@Param('id') id: string): Promise<OngoingEventResponseDto> {
    return this.ongoingService.deletePlayoff(id);
  }
```

- [x] **Step 5: Run everything and build**

---

## Task 4: Advance winners, and lock what must not move

**Files:**
- Modify: `volley-app-service/src/ongoing/ongoing.service.ts`
- Test: `src/ongoing/ongoing.service.spec.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–3. No new public methods; `updateGameScore` and `clearGameResult` gain behaviour.

- [x] **Step 1: Write the failing tests**

Cover, with exact messages:

- recording a playoff result writes the winner into the next round's correct slot: the game at round `r`, slot `s` feeds round `r+1`, slot `floor(s/2)`; an **even** `s` fills `team1Id`, an **odd** `s` fills `team2Id`
- the final (last round) advances nobody and does not error
- **rule 3:** editing or clearing a **group** result while any playoff game exists is refused with `ConflictException`
- **rule 4:** clearing a playoff result is refused while the next round's game already has a result
- clearing a playoff result when the next round is still unplayed succeeds and empties the slot it had filled
- a group result can still be edited freely when no playoff exists (regression guard — this is today's behaviour)

- [x] **Step 2: Run and watch fail**

- [x] **Step 3: Implement**

In `updateGameScore`, after loading the game:
- if the game's `phase` is `'group'` and any playoff game exists for its event → `ConflictException` (rule 3).
- after writing the score, if `phase` is `'playoff'`, find the next-round game (`bracketRound + 1`, `bracketSlot = floor(bracketSlot / 2)`) and set `team1Id` or `team2Id` to the winner by the parity of the current slot. Do the write and the advancement in **one transaction** — a winner recorded without being advanced, or vice versa, is a corrupt bracket.

In `clearGameResult`:
- same group-lock check (rule 3).
- for a playoff game, look up the next-round game; if it exists **and has a result**, refuse (rule 4). Otherwise clear this result **and** null the slot this game had filled downstream, in one transaction.

**Derive the winner from the two scores; never store it.** A stored winner is a second source of truth that can drift from the score.

- [x] **Step 4: Run everything and build**

---

## Task 5: Frontend types, URLs, and the group-only standings filter

**Files:**
- Modify: `volleyball-management-ui/lib/types.ts`, `lib/api.ts`, `lib/ongoing-standings.ts`, `components/ongoing/ongoing-matches-tab.tsx`

**Interfaces:**
- Produces: `OngoingGame` gains `phase: string`, `bracketRound: number | null`, `bracketSlot: number | null`, and `team1Id`/`team2Id` become `string | null`; `API.GENERATE_ONGOING_PLAYOFF(id)`, `API.DELETE_ONGOING_PLAYOFF(id)`; `computeStandings` counts group games only.

- [x] **Step 1: Types and URLs**

`team1Id: string | null` on `OngoingGame` will produce type errors wherever a game's team id is used as a map key or passed to a lookup. **Fix each one by handling the null case, not by casting it away** — a cast here reintroduces exactly the crash this nullability exists to make impossible.

- [x] **Step 2: `computeStandings` counts only group games (rule 5)**

Filter to `game.phase === 'group'` before tallying. A playoff win must never appear in a group table. **Add nothing else to that function** — it is shared and already reviewed.

- [x] **Step 3: The Matches tab shows group games only**

Filter to `phase === 'group'`. Playoff games belong to the Bracket tab, and a bracket game with empty slots cannot render a team name at all. Keep the existing empty state.

- [x] **Step 4: Verify**

```bash
cd volleyball-management-ui && npx tsc --noEmit && npm run lint
```

Expected: `tsc` clean; lint exactly 7, none in touched files. **Report every site the nullability change forced you to touch** — that list is the real output of this task.

---

## Task 6: The Bracket tab

**Files:**
- Create: `volleyball-management-ui/components/ongoing/ongoing-bracket-tab.tsx`
- Modify: `app/ongoing/[id]/page.tsx`, all four `locales/*/common.json`

**Interfaces:**
- Consumes: the types and URLs from Task 5

- [x] **Step 1: Build the tab**

Two sections:

1. **Groups** — reuse the per-group standings rendering already in `ongoing-standings-tab.tsx` (extract the shared table into a component rather than copying it), with the qualifying places visually marked. `config.qualifiersPerGroup` says how many.
2. **The bracket** — rounds left to right, each game a box with its two teams (or a placeholder for an empty slot) and the score when played. The reference image is a mirrored bracket; a **single left-to-right** bracket is acceptable and much simpler — say in your report which you built.

For admins, a **Generate playoff** button when the group stage is complete and no playoff exists, and a **Delete playoff** button (behind a confirmation) when one does. Surface the backend's `{ message }` for every refusal — the 409s explain exactly why an action is unavailable.

The tab is visible to everyone; only the two buttons are admin-gated.

- [x] **Step 2: Mount it**

Add it to the tab list in `app/ongoing/[id]/page.tsx`. Show it only when `config.scheme === 'groupsPlayoff'` — a flat round-robin has no bracket, and an empty tab is worse than no tab.

- [x] **Step 3: Strings in all four locales**

- [x] **Step 4: Verify**

```bash
cd volleyball-management-ui && npx tsc --noEmit && npm run lint && npm run build
for f in locales/*/common.json; do node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" && echo "$f ok"; done
```

---

## Task 7: End-to-end verification

**Files:** none — verification only.

- [x] **Step 1: Automated checks**

```bash
cd volley-app-service && npm run test && npm run build
cd ../volleyball-management-ui && npx tsc --noEmit && npm run lint && npm run build
```

- [x] **Step 2: Locale coverage** across all four files for every `t()` key under `app/ongoing`, `app/calendar`, `components/ongoing`.

- [x] **Step 3: Live walkthrough** (the controller runs this)

1. 8 teams, 2 groups, 2 qualifiers, schedule generated.
2. Generate playoff **before** all group results → refused, nothing created.
3. Record every group result → Generate playoff → 2 semifinals + 1 final; round 1 populated from the group tables, the final empty.
4. **Assert the pairings are A1–B2 and A2–B1** against the actual group tables.
5. Record a semifinal → the winner appears in the final's correct slot.
6. Try to edit a group result → refused (rule 3).
7. Clear the semifinal while the final is unplayed → succeeds, the final's slot empties.
8. Record the final, then try clearing the semifinal → refused (rule 4).
9. Group standings show **no** playoff results; the Matches tab shows **no** bracket games.
10. A `roundRobin` tournament shows **no** Bracket tab.

- [x] **Step 4: Clean up** — delete every tournament created during the walkthrough and confirm no orphan rows.

---

## Notes for the implementer

- **Never migrate the shared remote database.** Task 1 Step 1 exists for that reason.
- **Never call `agregateRankings()`** or touch `games` / `player_stats`.
- **No git commands, and do not start or stop dev servers.**
- The played-game predicate already exists in two coordinated forms (`isGamePlayed`, `PLAYED_GAME_WHERE`). Do not add a third.
