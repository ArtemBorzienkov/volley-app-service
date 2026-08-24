# Groups (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A tournament can be configured as groups-plus-playoff, teams are dealt randomly into groups, each group plays its own round-robin, and standings are shown per group.

**Architecture:** Three config fields plus a `group_index` on the team. Group assignment happens at schedule generation: shuffle the roster and deal it round-robin so sizes differ by at most one. Pairings are built **within** each group, then all of them go through the existing `packIntoRounds` unchanged, so courts stay shared and a team still plays at most once per round. `computeStandings` is already `(teams, games)` and is simply called once per group. `roundRobin` is the same code path with one group containing everyone.

**Tech Stack:** NestJS 10 + Prisma 4.16 + PostgreSQL + Jest; Next.js App Router + TanStack Query + Tailwind v4 + shadcn/ui + i18next.

**Spec:** `volley-app-service/docs/superpowers/specs/2026-08-23-groups-and-playoff-design.md` (Phase 1 is the "Phase 1 — groups" section; **do not implement Phase 2** — no `phase`, `bracketRound`, `bracketSlot`, and do NOT make team ids nullable).

## Global Constraints

- **Never run a git command** — not even read-only. Both repos' `CLAUDE.md` forbid it. **Every task ends without a commit step.** Several increments are already uncommitted in these trees; leave them, never revert or stash.
- **Do not start or stop any dev server.** Ports 3000/3001 are managed centrally by the controller. Read-only `curl` against 3000 is fine when a server is up. If you want a live check, ask in your report.
- Backend `tsconfig` targets `es2017` with no `lib` override — **`flatMap`, `toSorted`, `Object.fromEntries` are unavailable** and fail `npm run build`.
- Backend `strictNullChecks: false`; **no global `ValidationPipe`** — validate explicitly, throw `BadRequestException` / `NotFoundException` / `ConflictException`.
- Backend Prettier: single quotes, trailing commas, **120 columns**. Explicit return types on every controller and service method. Guard clauses at the top. Providers are `@Injectable()` classes; module-level `export const fn = () => {}` arrows only for pure helpers outside the DI graph (`src/ongoing/schedule.ts` is the example).
- **Backend baseline: `npm run test` is 94 passing across 3 suites; `npm run build` clean.** Never regress.
- **Frontend `npm run lint` is NOT clean and never was.** Baseline: exactly **7 errors** (four `no-explicit-any`, three `set-state-in-effect`) in `app/add-results/page.tsx`, `app/events/page.tsx`, `app/events/[id]/page.tsx`, `components/layout-wrapper.tsx`, `components/navigation.tsx`. The gate is **"still exactly 7, none in touched files"**, never "clean", and never touch those seven.
- **Frontend `npx tsc --noEmit` is the only real typecheck**, is clean, and must stay clean. `strict: true`.
- **Frontend rule, verbatim:** *"Derive during render instead of syncing with an effect. `set-state-in-effect` already fires three times in this repo; do not add a fourth."*
- Frontend: `'use client'` on every page/component. New fetches check `res.ok`, parse the server's JSON `{ message }` and throw it.
- `lib/api.ts` is the single URL registry. **No new endpoint is needed in this phase.**
- **Any new UI string goes into all four locale files** (`locales/{en,uk,pl,be}/common.json`) with real uk/pl/be translations, never English pasted in. Re-read those files immediately before editing; each must still parse as JSON.
- **npm only** in the frontend; install nothing.
- No test framework in the frontend — do not introduce one, never call anything "tested" there.
- No useless comments — comment the *why* only.
- Paths are relative to `/Users/artem/Desktop/projects/`.

## File Structure

| File | Responsibility |
| --- | --- |
| `volley-app-service/prisma/schema.prisma` | `scheme`, `groupCount`, `qualifiersPerGroup`, `groupIndex` |
| `volley-app-service/src/ongoing/groups.ts` (create) | pure group dealing + power-of-two helper |
| `volley-app-service/src/ongoing/groups.spec.ts` (create) | unit tests for both |
| `volley-app-service/src/ongoing/schedule.ts` (modify) | pairings built per group |
| `volley-app-service/src/ongoing/schedule.spec.ts` (modify) | per-group pairing tests |
| `volley-app-service/src/ongoing/ongoing.service.ts` (modify) | validation, assignment, generation, exposure |
| `volley-app-service/src/ongoing/dto/*.ts` (modify) | config + team DTO fields |
| `volleyball-management-ui/lib/types.ts` (modify) | mirror the new fields |
| `volleyball-management-ui/components/ongoing/ongoing-config-tab.tsx` (modify) | scheme / groups / qualifiers controls |
| `volleyball-management-ui/components/ongoing/ongoing-standings-tab.tsx` (modify) | one table per group |
| `volleyball-management-ui/locales/*/common.json` (modify) | new strings |

---

## Task 1: Schema and config validation

**Files:**
- Modify: `volley-app-service/prisma/schema.prisma`
- Create: migration (generated)
- Modify: `src/ongoing/dto/update-ongoing-config.dto.ts`, `dto/create-ongoing-event.dto.ts`, `dto/ongoing-event-response.dto.ts`, `src/ongoing/ongoing.service.ts`
- Test: `src/ongoing/ongoing.service.spec.ts`

**Interfaces:**
- Produces: `scheme: string`, `groupCount: number`, `qualifiersPerGroup: number | null` on the config (Prisma + `OngoingEventConfigResponseDto`); `groupIndex: number | null` on `OngoingTeam` (Prisma only in this task); `private normaliseScheme(...)` consumed by Task 3.

- [ ] **Step 1: Confirm the target database**

Run: `grep -n '^DATABASE_URL' volley-app-service/.env`

The active line must be the **localhost** one (`127.0.0.1`); the remote `46.101.180.6` line is commented out and must stay so. If the active URL is not localhost, **stop and ask** — never migrate a shared database.

- [ ] **Step 2: Add the columns**

In `prisma/schema.prisma`, inside `model OngoingEventConfig` after `maxTeams`:

```prisma
  scheme             String @default("roundRobin")
  groupCount         Int    @default(1) @map("group_count")
  qualifiersPerGroup Int?   @map("qualifiers_per_group")
```

and inside `model OngoingTeam` after `player2Id`:

```prisma
  groupIndex Int? @map("group_index")
```

Match the file's existing indentation and alignment. **Do not run `npx prisma format`** — it reformats unrelated pre-existing models and needlessly widens the diff.

- [ ] **Step 3: Migrate and regenerate**

```bash
cd volley-app-service && npm run prisma:migrate:dev -- --name add_groups && npm run prisma:generate
```

Expected: one additive migration, four `ADD COLUMN`s, nothing dropped. If Prisma warns about data loss, stop.

- [ ] **Step 4: Write the failing validation tests**

Append inside the outer `describe('OngoingService', ...)` in `src/ongoing/ongoing.service.spec.ts`:

```ts
  describe('OngoingService.updateConfig scheme and groups', () => {
    it('rejects an unknown scheme', async () => {
      await expect(
        service.updateConfig('event-1', { gamesPerPair: 1, courts: 1, scheme: 'ladder' } as any),
      ).rejects.toThrow(new BadRequestException('scheme must be roundRobin or groupsPlayoff'));
    });

    it('forces roundRobin to a single group with no qualifiers', async () => {
      await service.updateConfig('event-1', {
        gamesPerPair: 1,
        courts: 1,
        scheme: 'roundRobin',
        groupCount: 3,
        qualifiersPerGroup: 2,
      } as any);

      const args = (prisma.ongoingEventConfig.upsert as jest.Mock).mock.calls[0][0];
      expect(args.update.groupCount).toBe(1);
      expect(args.update.qualifiersPerGroup).toBeNull();
    });

    it('requires at least two groups for groupsPlayoff', async () => {
      await expect(
        service.updateConfig('event-1', {
          gamesPerPair: 1,
          courts: 1,
          scheme: 'groupsPlayoff',
          groupCount: 1,
          qualifiersPerGroup: 2,
        } as any),
      ).rejects.toThrow(new BadRequestException('groupsPlayoff needs at least 2 groups'));
    });

    it('rejects a bracket size that is not a power of two', async () => {
      await expect(
        service.updateConfig('event-1', {
          gamesPerPair: 1,
          courts: 1,
          scheme: 'groupsPlayoff',
          groupCount: 3,
          qualifiersPerGroup: 3,
        } as any),
      ).rejects.toThrow(
        new BadRequestException('groupCount times qualifiersPerGroup must be a power of two'),
      );
    });

    it('accepts 2 groups with 2 qualifiers each', async () => {
      await service.updateConfig('event-1', {
        gamesPerPair: 1,
        courts: 1,
        scheme: 'groupsPlayoff',
        groupCount: 2,
        qualifiersPerGroup: 2,
      } as any);

      const args = (prisma.ongoingEventConfig.upsert as jest.Mock).mock.calls[0][0];
      expect(args.update.scheme).toBe('groupsPlayoff');
      expect(args.update.groupCount).toBe(2);
      expect(args.update.qualifiersPerGroup).toBe(2);
    });

    it('accepts 2 groups with 4 qualifiers each', async () => {
      await service.updateConfig('event-1', {
        gamesPerPair: 1,
        courts: 1,
        scheme: 'groupsPlayoff',
        groupCount: 2,
        qualifiersPerGroup: 4,
      } as any);

      expect(prisma.ongoingEventConfig.upsert).toHaveBeenCalled();
    });
  });
```

- [ ] **Step 5: Run them and watch them fail**

Run: `cd volley-app-service && npx jest src/ongoing/ongoing.service.spec.ts`
Expected: the new tests FAIL; every pre-existing test still passes.

- [ ] **Step 6: Add the power-of-two helper**

Create `src/ongoing/groups.ts` with (the dealing function arrives in Task 2):

```ts
export const isPowerOfTwo = (value: number): boolean => Number.isInteger(value) && value > 0 && (value & (value - 1)) === 0;
```

- [ ] **Step 7: Validate in the service**

Add to `ongoing.service.ts`, next to `normaliseMaxTeams`:

```ts
  private normaliseScheme(
    scheme: string | undefined,
    groupCount: number | undefined,
    qualifiersPerGroup: number | undefined | null,
  ): { scheme: string; groupCount: number; qualifiersPerGroup: number | null } {
    const resolved = scheme === undefined || scheme === null ? 'roundRobin' : scheme;

    if (resolved !== 'roundRobin' && resolved !== 'groupsPlayoff') {
      throw new BadRequestException('scheme must be roundRobin or groupsPlayoff');
    }

    // A flat round-robin is the one-group case, so the group fields are meaningless there.
    if (resolved === 'roundRobin') {
      return { scheme: resolved, groupCount: 1, qualifiersPerGroup: null };
    }

    const groups = groupCount === undefined || groupCount === null ? 2 : groupCount;

    if (!Number.isInteger(groups) || groups < 2) {
      throw new BadRequestException('groupsPlayoff needs at least 2 groups');
    }
    if (!Number.isInteger(qualifiersPerGroup) || qualifiersPerGroup < 1) {
      throw new BadRequestException('qualifiersPerGroup must be at least 1');
    }
    if (!isPowerOfTwo(groups * qualifiersPerGroup)) {
      throw new BadRequestException('groupCount times qualifiersPerGroup must be a power of two');
    }

    return { scheme: resolved, groupCount: groups, qualifiersPerGroup };
  }
```

Call it in `updateConfig` and in `create`, and write all three values into the config `create`/`update` payloads. Extend `UpdateOngoingConfigDto` and `CreateOngoingEventDto` with the three optional fields, and `OngoingEventConfigResponseDto` with the three required ones (`qualifiersPerGroup: number | null`). Surface them in `mapEvent`'s config mapping with the same defensive fallbacks the other fields use (`roundRobin`, `1`, `null`).

- [ ] **Step 8: Run the tests and build**

```bash
cd volley-app-service && npx jest src/ongoing/ongoing.service.spec.ts && npm run test && npm run build
```

Expected: everything passes, build clean.

---

## Task 2: Pure group dealing

**Files:**
- Modify: `volley-app-service/src/ongoing/groups.ts`
- Create: `volley-app-service/src/ongoing/groups.spec.ts`

**Interfaces:**
- Produces: `dealIntoGroups(teamIds: string[], groupCount: number, random?: () => number): string[][]` — shuffles then deals round-robin so group sizes differ by at most one. Consumed by Task 3.

- [ ] **Step 1: Write the failing tests**

Create `src/ongoing/groups.spec.ts`:

```ts
import { dealIntoGroups, isPowerOfTwo } from './groups';

// A counter-based generator keeps the shuffle deterministic, so a failure means the dealing is
// wrong rather than that this run drew an unlucky permutation.
function sequenceRandom(values: number[]): () => number {
  let index = 0;
  return () => values[index++ % values.length];
}

describe('isPowerOfTwo', () => {
  it('accepts powers of two', () => {
    for (const n of [1, 2, 4, 8, 16, 32]) expect(isPowerOfTwo(n)).toBe(true);
  });

  it('rejects everything else', () => {
    for (const n of [0, -2, 3, 5, 6, 7, 9, 12, 2.5]) expect(isPowerOfTwo(n)).toBe(false);
  });
});

describe('dealIntoGroups', () => {
  it('puts every team in exactly one group', () => {
    const teams = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const groups = dealIntoGroups(teams, 2, sequenceRandom([0.1, 0.9, 0.5]));

    const flat: string[] = [];
    for (const group of groups) for (const id of group) flat.push(id);

    expect(flat.slice().sort()).toEqual(teams.slice().sort());
    expect(flat).toHaveLength(teams.length);
  });

  it('produces the requested number of groups', () => {
    expect(dealIntoGroups(['a', 'b', 'c', 'd', 'e', 'f'], 3)).toHaveLength(3);
  });

  it('keeps group sizes within one of each other when the split is uneven', () => {
    const groups = dealIntoGroups(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'], 2);
    const sizes = groups.map((group) => group.length).sort();

    expect(sizes).toEqual([4, 5]);
  });

  it('splits evenly when it divides', () => {
    const groups = dealIntoGroups(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], 2);

    expect(groups.map((group) => group.length)).toEqual([4, 4]);
  });

  it('returns one group holding everyone when groupCount is 1', () => {
    const groups = dealIntoGroups(['a', 'b', 'c'], 1);

    expect(groups).toHaveLength(1);
    expect(groups[0].slice().sort()).toEqual(['a', 'b', 'c']);
  });

  it('returns empty groups rather than throwing when there are no teams', () => {
    expect(dealIntoGroups([], 2)).toEqual([[], []]);
  });

  it('tolerates more groups than teams', () => {
    const groups = dealIntoGroups(['a', 'b'], 4);

    expect(groups).toHaveLength(4);
    const filled = groups.filter((group) => group.length > 0);
    expect(filled).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd volley-app-service && npx jest src/ongoing/groups.spec.ts`
Expected: FAIL — `dealIntoGroups` is not exported.

- [ ] **Step 3: Implement**

Add to `src/ongoing/groups.ts`, reusing the existing Fisher–Yates from the scheduler rather than writing a second one:

```ts
import { shuffle } from './schedule';

export const dealIntoGroups = (
  teamIds: string[],
  groupCount: number,
  random: () => number = Math.random,
): string[][] => {
  const groups: string[][] = [];
  for (let i = 0; i < groupCount; i += 1) groups.push([]);

  const shuffled = shuffle(teamIds, random);
  for (let i = 0; i < shuffled.length; i += 1) {
    groups[i % groupCount].push(shuffled[i]);
  }

  return groups;
};
```

Dealing round-robin rather than slicing is what keeps sizes within one of each other for any count.

- [ ] **Step 4: Run and build**

```bash
cd volley-app-service && npx jest src/ongoing/groups.spec.ts && npm run test && npm run build
```

---

## Task 3: Per-group schedule generation

**Files:**
- Modify: `volley-app-service/src/ongoing/schedule.ts`, `schedule.spec.ts`, `src/ongoing/ongoing.service.ts`
- Test: `src/ongoing/ongoing.service.spec.ts`

**Interfaces:**
- Produces: `buildGroupPairings(groups: string[][], gamesPerPair: number): Array<[string, string]>`; `generateSchedule` gains a grouped form. `generateSchedule`'s existing single-roster signature must keep working — the round-robin path depends on it.

- [ ] **Step 1: Write the failing scheduler tests**

Append to `src/ongoing/schedule.spec.ts`:

```ts
describe('buildGroupPairings', () => {
  it('pairs only within each group', () => {
    const pairs = buildGroupPairings([['a', 'b', 'c'], ['x', 'y', 'z']], 1);

    expect(pairs).toHaveLength(6);
    for (const [one, two] of pairs) {
      const bothLeft = ['a', 'b', 'c'].includes(one) && ['a', 'b', 'c'].includes(two);
      const bothRight = ['x', 'y', 'z'].includes(one) && ['x', 'y', 'z'].includes(two);
      expect(bothLeft || bothRight).toBe(true);
    }
  });

  it('never pairs a team from one group with a team from another', () => {
    const pairs = buildGroupPairings([['a', 'b'], ['x', 'y']], 1);

    expect(pairs).toHaveLength(2);
    expect(pairs.some(([one, two]) => (one === 'a' && two === 'x') || (one === 'x' && two === 'a'))).toBe(false);
  });

  it('repeats each within-group pair gamesPerPair times', () => {
    const pairs = buildGroupPairings([['a', 'b'], ['x', 'y']], 3);

    expect(pairs).toHaveLength(6);
  });

  it('is equivalent to a flat round-robin when there is one group', () => {
    const grouped = buildGroupPairings([['a', 'b', 'c', 'd']], 1);

    expect(grouped).toHaveLength(6);
  });

  it('ignores empty groups', () => {
    expect(buildGroupPairings([['a', 'b'], []], 1)).toHaveLength(1);
  });

  it('yields nothing for a group of one', () => {
    expect(buildGroupPairings([['a'], ['x']], 1)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run and watch fail**

Run: `cd volley-app-service && npx jest src/ongoing/schedule.spec.ts`
Expected: FAIL — `buildGroupPairings` is not exported.

- [ ] **Step 3: Implement in `schedule.ts`**

Add, expressing `buildPairings` as the one-group case so the rule lives once:

```ts
export const buildGroupPairings = (groups: string[][], gamesPerPair: number): Array<[string, string]> => {
  const pairs: Array<[string, string]> = [];

  for (const group of groups) {
    for (const pair of buildPairings(group, gamesPerPair)) {
      pairs.push(pair);
    }
  }

  return pairs;
};
```

Do **not** use `flatMap` — the `es2017` type lib does not have it and the build will fail.

Leave `buildPairings`, `shuffle`, `packIntoRounds` and the existing `generateSchedule` untouched: the flat round-robin path and its tests depend on them.

- [ ] **Step 4: Write the failing service tests**

Append inside the outer `describe('OngoingService', ...)`:

```ts
  describe('OngoingService.generateSchedule with groups', () => {
    const teams = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: `t${i}`,
        player1: { id: `p${i}a`, name: `A${i}` },
        player2: { id: `p${i}b`, name: `B${i}` },
      }));

    it('assigns every team a group index and writes them back', async () => {
      prisma.ongoingEvent.findUnique = jest.fn(async () => ({
        ...EVENT_ROW,
        config: { gamesPerPair: 1, courts: 2, maxTeams: null, scheme: 'groupsPlayoff', groupCount: 2, qualifiersPerGroup: 2 },
        teams: teams(8),
      }) as any);

      await service.generateSchedule('event-1');

      expect(prisma.ongoingTeam.update).toHaveBeenCalledTimes(8);
      const indices = (prisma.ongoingTeam.update as jest.Mock).mock.calls.map((c) => c[0].data.groupIndex);
      expect(indices.filter((i) => i === 0)).toHaveLength(4);
      expect(indices.filter((i) => i === 1)).toHaveLength(4);
    });

    it('never schedules a cross-group fixture', async () => {
      prisma.ongoingEvent.findUnique = jest.fn(async () => ({
        ...EVENT_ROW,
        config: { gamesPerPair: 1, courts: 2, maxTeams: null, scheme: 'groupsPlayoff', groupCount: 2, qualifiersPerGroup: 2 },
        teams: teams(8),
      }) as any);

      await service.generateSchedule('event-1');

      const groupOf = new Map<string, number>();
      for (const call of (prisma.ongoingTeam.update as jest.Mock).mock.calls) {
        groupOf.set(call[0].where.id, call[0].data.groupIndex);
      }
      const rows = (prisma.ongoingGame.createMany as jest.Mock).mock.calls[0][0].data;
      expect(rows).toHaveLength(12);
      for (const row of rows) {
        expect(groupOf.get(row.team1Id)).toBe(groupOf.get(row.team2Id));
      }
    });

    it('keeps the flat round-robin unchanged for roundRobin', async () => {
      prisma.ongoingEvent.findUnique = jest.fn(async () => ({
        ...EVENT_ROW,
        config: { gamesPerPair: 1, courts: 2, maxTeams: null, scheme: 'roundRobin', groupCount: 1, qualifiersPerGroup: null },
        teams: teams(4),
      }) as any);

      await service.generateSchedule('event-1');

      expect((prisma.ongoingGame.createMany as jest.Mock).mock.calls[0][0].data).toHaveLength(6);
    });

    it('refuses when a group would be too small for the configured qualifiers', async () => {
      prisma.ongoingEvent.findUnique = jest.fn(async () => ({
        ...EVENT_ROW,
        config: { gamesPerPair: 1, courts: 2, maxTeams: null, scheme: 'groupsPlayoff', groupCount: 2, qualifiersPerGroup: 4 },
        teams: teams(6),
      }) as any);

      await expect(service.generateSchedule('event-1')).rejects.toThrow(BadRequestException);
      expect(prisma.ongoingGame.createMany).not.toHaveBeenCalled();
    });
  });
```

Add `update: jest.fn(async (args: any) => args)` to `ongoingTeam` in `buildPrismaMock()` if it is not there.

- [ ] **Step 5: Run and watch fail**

Run: `cd volley-app-service && npx jest src/ongoing/ongoing.service.spec.ts`

- [ ] **Step 6: Rework `generateSchedule` in the service**

Inside the existing method, after the two-teams guard and before writing:

1. Read `scheme`, `groupCount`, `qualifiersPerGroup` off `event.config`.
2. `const groups = dealIntoGroups(event.teams.map((t) => t.id), groupCount);`
3. When `scheme === 'groupsPlayoff'`, reject if the **smallest non-empty** group size is `<= qualifiersPerGroup`, with a message naming the numbers — otherwise the group stage eliminates nobody and the bracket is a lie. Do this **before** any write.
4. `const matches = packIntoRounds(shuffle(buildGroupPairings(groups, gamesPerPair)), courts);`
5. In the same `$transaction` that clears and writes the fixtures, write each team's `groupIndex` (0-based by its position in `groups`). For `roundRobin` that is `0` for everyone — keep it consistent rather than null, so one code path serves both.

Keep everything else identical: the unconditional wipe, the null scores, the `round`/`court`/`order` fields.

- [ ] **Step 7: Expose `groupIndex` on the team DTO**

Add `groupIndex: number | null;` to `OngoingTeamResponseDto` and map it in `mapTeam`.

- [ ] **Step 8: Run everything and build**

```bash
cd volley-app-service && npm run test && npm run build
```

---

## Task 4: Frontend types and the config controls

**Files:**
- Modify: `volleyball-management-ui/lib/types.ts`, `components/ongoing/ongoing-config-tab.tsx`, all four `locales/*/common.json`

**Interfaces:**
- Consumes: the config and team fields from Tasks 1 and 3
- Produces: `OngoingEventConfig` gains `scheme: string`, `groupCount: number`, `qualifiersPerGroup: number | null`; `OngoingTeam` gains `groupIndex: number | null`

- [ ] **Step 1: Add the types**

`| null` where the backend sends null, never optional `?` — the backend always sends the key.

- [ ] **Step 2: Add the controls to the Format card**

A **scheme** select (`roundRobin` / `groupsPlayoff`); when `groupsPlayoff` is chosen, reveal a **group count** number input and a **qualifiers per group** number input. Hide both for `roundRobin` — they are meaningless there and the backend forces them anyway.

Seed all three once in their `useState` initialisers from `event.config`. **Do not add a `useEffect`** to resync; the tab's seed-once design must survive.

Send all three with the rest of the config. The backend rejects a bracket size that is not a power of two and a group count below 2 — surface those messages in the existing error area rather than duplicating the validation client-side. Adding a client-side hint (e.g. showing the resulting bracket size) is welcome, but the server stays the authority.

- [ ] **Step 3: Add the strings to all four locales**

Under `ongoing.config`: `scheme`, `schemeRoundRobin`, `schemeGroupsPlayoff`, `groupCount`, `groupCountHint`, `qualifiersPerGroup`, `qualifiersPerGroupHint`. Real uk/pl/be translations.

- [ ] **Step 4: Verify**

```bash
cd volleyball-management-ui && npx tsc --noEmit && npm run lint
for f in locales/*/common.json; do node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" && echo "$f ok"; done
```

Expected: `tsc` clean, lint exactly 7 with none in touched files, four `ok` lines.

---

## Task 5: Standings per group

**Files:**
- Modify: `volleyball-management-ui/components/ongoing/ongoing-standings-tab.tsx`, all four `locales/*/common.json`

**Interfaces:**
- Consumes: `team.groupIndex`, `computeStandings` from `lib/ongoing-standings.ts`

- [ ] **Step 1: Render one table per group**

Group the teams by `groupIndex`, then call the existing **`computeStandings(groupTeams, event.games)` once per group**. Do not write a second standings implementation and do not change `computeStandings` — it already takes the teams it should rank, and it ignores games whose teams are not in that list.

Order the groups by index and label them **A, B, C…** from the index. When there is a single group (or every `groupIndex` is null, i.e. no schedule generated yet) render exactly one unlabelled table, identical to today — the round-robin case must look unchanged.

Derive the grouping during render; **no `useEffect`**.

- [ ] **Step 2: Add the label string to all four locales**

`ongoing.standings.group` (e.g. `"Group {{letter}}"`), with real uk/pl/be translations. If you prefer to avoid interpolation, a bare letter heading is acceptable — say which you chose.

- [ ] **Step 3: Verify**

```bash
cd volleyball-management-ui && npx tsc --noEmit && npm run lint && npm run build
for f in locales/*/common.json; do node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" && echo "$f ok"; done
```

---

## Task 6: End-to-end verification

**Files:** none — verification only.

- [ ] **Step 1: Automated checks**

```bash
cd volley-app-service && npm run test && npm run build
cd ../volleyball-management-ui && npx tsc --noEmit && npm run lint && npm run build
```

Paste the real output. Backend must be at least the 94 pre-existing plus the new tests; frontend `tsc` clean, lint exactly 7.

- [ ] **Step 2: Locale coverage**

Extract every `t("...")` key used under `app/ongoing`, `app/calendar` and `components/ongoing` and assert each resolves in all four locale files. Report the count and any missing key.

- [ ] **Step 3: Live walkthrough** (the controller runs this; servers are managed centrally)

1. Create a tournament, register 8 teams.
2. Config → scheme **groupsPlayoff**, 2 groups, 2 qualifiers → save. A non-power-of-two combination (3 groups × 3) must be refused with the server's message.
3. Generate the schedule → **no fixture pairs teams from different groups**, and each group's fixtures form a complete round-robin of its 4 teams (6 each, 12 total).
4. Standings → **two tables**, labelled A and B, four teams each.
5. Switch the scheme back to **roundRobin** and regenerate → one table, 28 fixtures, exactly as before this phase.
6. With 6 teams, 2 groups and 4 qualifiers, generating must be refused — a group of 3 cannot yield 4 qualifiers.

- [ ] **Step 4: Clean up**

Delete every tournament created during the walkthrough and confirm the cascade leaves no orphan rows.

---

## Notes for the implementer

- **Phase 2 is out of scope.** Do not add `phase`, `bracketRound` or `bracketSlot`, and do **not** make `team1Id`/`team2Id` nullable. Those land with the playoff.
- **Never migrate the shared remote database.** Task 1 Step 1 exists for that reason.
- **Never call `agregateRankings()`** or touch `games` / `player_stats`.
- **No git commands, and do not start or stop dev servers.**
