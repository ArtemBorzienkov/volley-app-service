# Tournament visibility, solo registration and self-cancellation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a tournament creator close registration to outsiders (private tournaments), let players register without a partner and be paired off by rating, and let entrants cancel their own registration until the day before the tournament.

**Architecture:** Three additive changes to the `OngoingEvent` flow in `volley-app-service`, consumed by `volleyball-management-ui`. Two config flags (`visibility`, `allowSoloRegistration`) live on `ongoing_event_config` next to `maxTeams`; a new `ongoing_solo_players` table holds entrants without a partner; a new pure helper `src/ongoing/pairing.ts` turns that pool into pairs (strongest + weakest) which the creator confirms through a preview dialog. Nothing downstream of the roster changes — formed teams are ordinary `ongoing_teams` rows, so the schedule, bracket and rating engine are untouched.

**Tech Stack:** NestJS 9 + Prisma 4 + PostgreSQL (backend, Jest); Next.js App Router + TanStack Query + Tailwind v4 + shadcn/ui + i18next (frontend, no test runner).

**Spec:** [`docs/superpowers/specs/2026-08-28-tournament-visibility-solo-registration-design.md`](../specs/2026-08-28-tournament-visibility-solo-registration-design.md)

## Global Constraints

- **Never run any git command** — no `add`, `commit`, `push`, `checkout`, `branch`. This overrides the usual "commit at the end of each task" step; every task ends with a verification step instead. (User's standing rule, in both repos' CLAUDE.md.)
- **Repo paths:** backend `/Users/artem/Desktop/projects/volley-app-service`, frontend `/Users/artem/Desktop/projects/volleyball-management-ui`.
- **Backend `tsconfig` targets es2017** — `toSorted()`, `findLast()` and the other ES2023 array methods do not exist. Copy with `.slice()` and sort with `.sort()` plus an explicit comparator.
- **There is no global `ValidationPipe`** in the backend. Every `class-validator` decorator is inert; all validation must be written explicitly in the service, the way `normaliseScheme` and `validateTeamPairs` already do it.
- **Explicit return types** on every controller and service method (`Promise<OngoingEventResponseDto>`, `Promise<void>`). Prettier: single quotes, trailing commas, **120-column** width.
- **`npm run build` is the backend's only typecheck.** `npx tsc --noEmit` is the frontend's only typecheck (`next build` has `ignoreBuildErrors: true`).
- **There is no test database.** Backend unit tests mock `PrismaService`; never point a test at a real `DATABASE_URL`.
- **Frontend has no test runner.** Do not claim anything is "tested" there — verify with `npx tsc --noEmit`, `npm run lint`, `npm run build`, and the browser.
- **Frontend is npm-only.** Ignore the stale `pnpm-lock.yaml`.
- **Every new UI string goes into all four locale files** — `locales/en/common.json`, `locales/uk/common.json`, `locales/pl/common.json`, `locales/be/common.json`. A missing key silently falls back to English.
- **Endpoint URLs live only in `lib/api.ts`.** Never inline a URL in a component.
- **After any Prisma schema change run `npm run prisma:generate`.**
- **Literal values fixed by the spec:** `visibility` is the string `'public'` or `'private'`, default `'public'`. `allowSoloRegistration` is a boolean, default `false`. The solo table is `ongoing_solo_players`. Occupancy is `teams + ceil(solo / 2)`. Cancellation by an entrant is allowed while `todayUtcDay < eventUtcDay`; managers are never bound by it.

---

## File Structure

**Backend — `volley-app-service`**

| File | Responsibility |
|---|---|
| `prisma/schema.prisma` | Modify: two config columns, new `OngoingSoloPlayer` model, two back-relations |
| `prisma/migrations/<generated>/migration.sql` | Create (generated): the column + table DDL |
| `src/ongoing/pairing.ts` | Create: `pairByRating`, `effectiveTeamCount` — pure, no DI |
| `src/ongoing/pairing.spec.ts` | Create: unit tests for the above |
| `src/ongoing/dto/ongoing-event-response.dto.ts` | Modify: `OngoingSoloPlayerDto`, config flags, `soloPlayers` on both event DTOs |
| `src/ongoing/dto/create-ongoing-event.dto.ts` | Modify: `visibility`, `allowSoloRegistration` |
| `src/ongoing/dto/update-ongoing-config.dto.ts` | Modify: same two fields |
| `src/ongoing/dto/solo-registration.dto.ts` | Create: `AddSoloPlayerDto`, `FormTeamsFromSoloDto` |
| `src/ongoing/ongoing.service.ts` | Modify: the flags, the solo pool, the access rules, the deadline |
| `src/ongoing/ongoing.controller.ts` | Modify: four new routes |
| `src/ongoing/ongoing.service.spec.ts` | Modify: tests for every rule above |

**Frontend — `volleyball-management-ui`**

| File | Responsibility |
|---|---|
| `lib/types.ts` | Modify: config flags, `OngoingSoloPlayer`, `soloPlayers` |
| `lib/api.ts` | Modify: four new URLs |
| `lib/ongoing-permissions.ts` | Modify: the shared client-side predicates |
| `components/ongoing/create-tournament-form.tsx` | Modify: visibility + solo controls |
| `components/ongoing/ongoing-config-tab.tsx` | Modify: the same two controls |
| `components/ongoing/register-team-dialog.tsx` | Modify: partner / solo mode, private lock-out |
| `components/ongoing/cancel-registration-button.tsx` | Create: the entrant's own cancel control |
| `components/ongoing/solo-pool-section.tsx` | Create: the pool list + "Form teams" preview dialog |
| `components/ongoing/ongoing-roster-section.tsx` | Modify: mount the pool, widen `rosterSignature` |
| `app/calendar/page.tsx` | Modify: private badge, pool display, cancel button |
| `locales/{en,uk,pl,be}/common.json` | Modify: new keys, folded into the task that renders them |

---

## Task 1: Database schema and migration

**Files:**
- Modify: `volley-app-service/prisma/schema.prisma`
- Create: `volley-app-service/prisma/migrations/<timestamp>_add_ongoing_visibility_and_solo_players/migration.sql` (generated by Prisma, not hand-written)

**Interfaces:**
- Consumes: nothing.
- Produces: `prisma.ongoingSoloPlayer` with fields `{ id, eventId, playerId, createdAt }` and relations `event`, `player`; `prisma.ongoingEventConfig` fields `visibility: string` and `allowSoloRegistration: boolean`. Every later backend task queries these names.

- [ ] **Step 1: Confirm the migration will not hit the shared remote database**

`.env` ships pointing at a remote database with a commented-out localhost alternative. Applying a migration to it by accident is not recoverable from this session.

Run: `grep DATABASE_URL /Users/artem/Desktop/projects/volley-app-service/.env`

Expected: the **active** (uncommented) line contains `127.0.0.1` or `localhost`. If it does not, stop and ask the user before going further — do not edit `.env` unilaterally.

- [ ] **Step 2: Add the two config columns to the schema**

In `prisma/schema.prisma`, inside `model OngoingEventConfig`, after the `qualifiersPerGroup` line:

```prisma
  visibility            String  @default("public")
  allowSoloRegistration Boolean @default(false) @map("allow_solo_registration")
```

Do not use a Prisma enum — this schema's convention is plain strings validated in application code (`role`, `scheme`, `phase`, `gender` all work that way).

- [ ] **Step 3: Add the solo-pool model and its two back-relations**

Add a new model after `model OngoingTeam`:

```prisma
model OngoingSoloPlayer {
  id        String   @id @default(uuid())
  eventId   String   @map("event_id")
  playerId  String   @map("player_id")
  createdAt DateTime @default(now()) @map("created_at")

  event  OngoingEvent @relation(fields: [eventId], references: [id], onDelete: Cascade)
  player Player       @relation("OngoingSoloPlayer", fields: [playerId], references: [id], onDelete: Cascade)

  @@unique([eventId, playerId])
  @@index([eventId])
  @@map("ongoing_solo_players")
}
```

In `model OngoingEvent`, next to the existing `teams  OngoingTeam[]` line:

```prisma
  soloPlayers OngoingSoloPlayer[]
```

In `model Player`, next to the existing ongoing-team relations:

```prisma
  // Relations - solo (partnerless) tournament registrations
  ongoingSoloEntries    OngoingSoloPlayer[] @relation("OngoingSoloPlayer")
```

- [ ] **Step 4: Generate and apply the migration**

Run: `cd /Users/artem/Desktop/projects/volley-app-service && npm run prisma:migrate:dev -- --name add_ongoing_visibility_and_solo_players`

Expected: a new folder under `prisma/migrations/`, and the generated SQL contains an `ALTER TABLE "ongoing_event_config"` adding `visibility TEXT NOT NULL DEFAULT 'public'` and `allow_solo_registration BOOLEAN NOT NULL DEFAULT false`, plus `CREATE TABLE "ongoing_solo_players"` with a unique index on `("event_id","player_id")` and two `ON DELETE CASCADE` foreign keys.

- [ ] **Step 5: Regenerate the typed client and typecheck**

Run: `npm run prisma:generate && npm run build`

Expected: both succeed. The build is the only typecheck — if `prisma:generate` were skipped, `prisma.ongoingSoloPlayer` would not exist on the client type and every later task would fail to compile.

- [ ] **Step 6: Confirm the defaults preserve today's behaviour**

Run: `npm run test -- src/ongoing/ongoing.service.spec.ts`

Expected: PASS, unchanged. No service code has been touched yet; this catches a schema change that accidentally broke an existing mock expectation.

---

## Task 2: The pairing helper

**Files:**
- Create: `volley-app-service/src/ongoing/pairing.ts`
- Test: `volley-app-service/src/ongoing/pairing.spec.ts`

**Interfaces:**
- Consumes: nothing (pure module, no DI, no Prisma).
- Produces:
  - `interface SoloEntry { playerId: string; rating: number }`
  - `interface PairedTeam { player1Id: string; player2Id: string }`
  - `interface PairingResult { pairs: PairedTeam[]; unpaired: string[] }`
  - `pairByRating(entries: SoloEntry[]): PairingResult`
  - `effectiveTeamCount(teamCount: number, soloCount: number): number`

- [ ] **Step 1: Write the failing tests**

Create `src/ongoing/pairing.spec.ts`:

```ts
import { pairByRating, effectiveTeamCount, SoloEntry } from './pairing';

const entry = (playerId: string, rating: number): SoloEntry => ({ playerId, rating });

describe('pairByRating', () => {
  it('pairs the strongest with the weakest', () => {
    const result = pairByRating([entry('a', 1300), entry('b', 1200), entry('c', 1000), entry('d', 800)]);

    expect(result.pairs).toEqual([
      { player1Id: 'a', player2Id: 'd' },
      { player1Id: 'b', player2Id: 'c' },
    ]);
    expect(result.unpaired).toEqual([]);
  });

  it('is independent of the input order', () => {
    const shuffled = pairByRating([entry('c', 1000), entry('a', 1300), entry('d', 800), entry('b', 1200)]);

    expect(shuffled.pairs).toEqual([
      { player1Id: 'a', player2Id: 'd' },
      { player1Id: 'b', player2Id: 'c' },
    ]);
  });

  it('breaks rating ties by playerId so equal ratings pair deterministically', () => {
    const result = pairByRating([entry('d', 1000), entry('b', 1000), entry('c', 1000), entry('a', 1000)]);

    expect(result.pairs).toEqual([
      { player1Id: 'a', player2Id: 'd' },
      { player1Id: 'b', player2Id: 'c' },
    ]);
  });

  it('leaves the median player unpaired when the count is odd', () => {
    const result = pairByRating([entry('a', 1300), entry('b', 1200), entry('c', 1000)]);

    expect(result.pairs).toEqual([{ player1Id: 'a', player2Id: 'c' }]);
    expect(result.unpaired).toEqual(['b']);
  });

  it('handles an empty pool and a single entrant', () => {
    expect(pairByRating([])).toEqual({ pairs: [], unpaired: [] });
    expect(pairByRating([entry('a', 1000)])).toEqual({ pairs: [], unpaired: ['a'] });
  });

  it('does not mutate the caller array', () => {
    const entries = [entry('a', 800), entry('b', 1300)];
    pairByRating(entries);

    expect(entries.map((item) => item.playerId)).toEqual(['a', 'b']);
  });
});

describe('effectiveTeamCount', () => {
  it('counts two solo entrants as one slot and an odd one as a whole slot', () => {
    expect(effectiveTeamCount(0, 0)).toBe(0);
    expect(effectiveTeamCount(2, 0)).toBe(2);
    expect(effectiveTeamCount(0, 2)).toBe(1);
    expect(effectiveTeamCount(0, 3)).toBe(2);
    expect(effectiveTeamCount(3, 5)).toBe(6);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /Users/artem/Desktop/projects/volley-app-service && npx jest src/ongoing/pairing.spec.ts`

Expected: FAIL — `Cannot find module './pairing'`.

- [ ] **Step 3: Write the implementation**

Create `src/ongoing/pairing.ts`:

```ts
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
```

`.slice()` before `.sort()` is required twice over: the input is the caller's array, and `toSorted()` does not exist at this `tsconfig` target.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest src/ongoing/pairing.spec.ts`

Expected: PASS, 7 tests.

- [ ] **Step 5: Verify the mutation is actually caught**

Temporarily delete `if (a.playerId === b.playerId) return 0;` and the two lines after it, replacing them with `return 0;`, then re-run the suite.

Expected: the "breaks rating ties by playerId" test FAILS. Restore the code and confirm the suite is green again. Identical-looking comparator branches make it easy for a mutation to land somewhere harmless and look covered.

- [ ] **Step 6: Verify the build**

Run: `npm run build`

Expected: success.

---

## Task 3: Solo pool in the response shape

**Files:**
- Modify: `volley-app-service/src/ongoing/dto/ongoing-event-response.dto.ts`
- Modify: `volley-app-service/src/ongoing/ongoing.service.ts` (`EVENT_INCLUDE`, `mapEvent`, new `mapSoloPlayer`, `findOpen`)
- Test: `volley-app-service/src/ongoing/ongoing.service.spec.ts`

**Interfaces:**
- Consumes: `prisma.ongoingSoloPlayer` (Task 1).
- Produces:
  - `class OngoingSoloPlayerDto { id: string; player: OngoingTeamPlayerDto; rating: number }`
  - `OngoingEventConfigResponseDto` gains `visibility: string`, `allowSoloRegistration: boolean`
  - `OngoingEventResponseDto` gains `soloPlayers: OngoingSoloPlayerDto[]`
  - `OngoingOpenEventDto` gains `visibility: string`, `allowSoloRegistration: boolean`, `soloPlayers: OngoingSoloPlayerDto[]`
  - private `mapSoloPlayer(solo: any): OngoingSoloPlayerDto` on the service

- [ ] **Step 1: Write the failing tests**

Add to `src/ongoing/ongoing.service.spec.ts`. First extend the shared `EVENT_ROW` fixture so every existing test still describes a well-formed row — add `soloPlayers: []` next to `teams: []`, and add `visibility: 'public', allowSoloRegistration: false` inside its `config` object. Then add a new describe block:

```ts
describe('OngoingService.findOne solo pool', () => {
  it('maps solo entrants with their own rating, not a team sum', async () => {
    prisma.ongoingEvent.findUnique = jest.fn(async () => ({
      ...EVENT_ROW,
      soloPlayers: [
        {
          id: 'solo-1',
          player: { id: 'p1', name: 'Ann', avatar: null, playerStats: { rank: 1300 } },
        },
        {
          id: 'solo-2',
          player: { id: 'p2', name: 'Bob', avatar: null, playerStats: null },
        },
      ],
    })) as any;

    const event = await service.findOne('event-1');

    expect(event.soloPlayers).toEqual([
      { id: 'solo-1', player: { id: 'p1', name: 'Ann', avatar: null }, rating: 1300 },
      { id: 'solo-2', player: { id: 'p2', name: 'Bob', avatar: null }, rating: 1000 },
    ]);
  });

  it('exposes the two registration flags on the config', async () => {
    prisma.ongoingEvent.findUnique = jest.fn(async () => ({
      ...EVENT_ROW,
      config: { ...EVENT_ROW.config, visibility: 'private', allowSoloRegistration: true },
    })) as any;

    const event = await service.findOne('event-1');

    expect(event.config.visibility).toBe('private');
    expect(event.config.allowSoloRegistration).toBe(true);
  });

  it('defaults the flags when the config row is absent', async () => {
    prisma.ongoingEvent.findUnique = jest.fn(async () => ({ ...EVENT_ROW, config: null })) as any;

    const event = await service.findOne('event-1');

    expect(event.config.visibility).toBe('public');
    expect(event.config.allowSoloRegistration).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest src/ongoing/ongoing.service.spec.ts -t "solo pool"`

Expected: FAIL — `event.soloPlayers` is `undefined`.

- [ ] **Step 3: Extend the response DTOs**

In `src/ongoing/dto/ongoing-event-response.dto.ts`, after `OngoingTeamResponseDto`:

```ts
export class OngoingSoloPlayerDto {
  id: string;
  player: OngoingTeamPlayerDto;
  rating: number;
}
```

`rating` here is one player's rank, half of what a team's `rating` means — which is exactly why this is a separate class rather than a reuse of `OngoingTeamResponseDto`.

Add to `OngoingEventConfigResponseDto`:

```ts
  visibility: string;
  allowSoloRegistration: boolean;
```

Add to `OngoingEventResponseDto`, after `teams`:

```ts
  soloPlayers: OngoingSoloPlayerDto[];
```

Add to `OngoingOpenEventDto`, after `teams`:

```ts
  visibility: string;
  allowSoloRegistration: boolean;
  soloPlayers: OngoingSoloPlayerDto[];
```

- [ ] **Step 4: Load and map the pool**

In `src/ongoing/ongoing.service.ts`, add to the `EVENT_INCLUDE` constant, after the `teams` entry:

```ts
  soloPlayers: {
    include: { player: { include: { playerStats: true } } },
    // Same reason as teams: a bulk insert stamps one millisecond, so id is the real tiebreak.
    orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
  },
```

Add the mapper next to `mapTeam`:

```ts
  private mapSoloPlayer(solo: any): OngoingSoloPlayerDto {
    return {
      id: solo.id,
      player: { id: solo.player.id, name: solo.player.name, avatar: solo.player.avatar },
      rating: solo.player.playerStats?.rank ?? 1000,
    };
  }
```

In `mapEvent`, add the two config fields (following the existing `!== undefined` idiom, which distinguishes "column not selected" from "explicitly null"):

```ts
        visibility: event.config && event.config.visibility !== undefined ? event.config.visibility : 'public',
        allowSoloRegistration:
          event.config && event.config.allowSoloRegistration !== undefined ? event.config.allowSoloRegistration : false,
```

and after the `teams` line:

```ts
      soloPlayers: (event.soloPlayers || []).map((solo) => this.mapSoloPlayer(solo)),
```

In `findOpen`, add the three fields to the pushed object:

```ts
        visibility: event.config && event.config.visibility !== undefined ? event.config.visibility : 'public',
        allowSoloRegistration:
          event.config && event.config.allowSoloRegistration !== undefined ? event.config.allowSoloRegistration : false,
        soloPlayers: event.soloPlayers.map((solo) => this.mapSoloPlayer(solo)),
```

Import `OngoingSoloPlayerDto` alongside the other DTOs at the top of the file.

- [ ] **Step 5: Run to verify they pass**

Run: `npx jest src/ongoing/ongoing.service.spec.ts`

Expected: PASS — the three new tests and every pre-existing one.

- [ ] **Step 6: Verify the build**

Run: `npm run build`

Expected: success.

---

## Task 4: The two config flags

**Files:**
- Modify: `volley-app-service/src/ongoing/dto/create-ongoing-event.dto.ts`
- Modify: `volley-app-service/src/ongoing/dto/update-ongoing-config.dto.ts`
- Modify: `volley-app-service/src/ongoing/ongoing.service.ts` (`create`, `updateConfig`, two new normalisers)
- Test: `volley-app-service/src/ongoing/ongoing.service.spec.ts`

**Interfaces:**
- Consumes: `soloPlayers` on the loaded event (Task 3).
- Produces: private `normaliseVisibility(value: string | undefined | null): string` and `normaliseAllowSolo(value: boolean | undefined | null): boolean` on the service; `visibility` and `allowSoloRegistration` accepted as top-level body fields on `POST /ongoing` and `PUT /ongoing/:id/config` and persisted to the config row.

- [ ] **Step 1: Write the failing tests**

Add to `src/ongoing/ongoing.service.spec.ts`:

```ts
describe('OngoingService registration flags', () => {
  it('defaults a new tournament to public with solo registration off', async () => {
    await service.create({ name: 'WBSA Warsaw', date: '2026-08-23T10:00:00.000Z' }, CURRENT_USER);

    const created = prisma.ongoingEvent.create.mock.calls[0][0] as any;
    expect(created.data.config.create).toMatchObject({ visibility: 'public', allowSoloRegistration: false });
  });

  it('persists the flags given at creation', async () => {
    await service.create(
      { name: 'WBSA Warsaw', date: '2026-08-23T10:00:00.000Z', visibility: 'private', allowSoloRegistration: true },
      CURRENT_USER,
    );

    const created = prisma.ongoingEvent.create.mock.calls[0][0] as any;
    expect(created.data.config.create).toMatchObject({ visibility: 'private', allowSoloRegistration: true });
  });

  it('rejects a visibility that is neither public nor private', async () => {
    await expect(
      service.create(
        { name: 'WBSA Warsaw', date: '2026-08-23T10:00:00.000Z', visibility: 'secret' } as any,
        CURRENT_USER,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a non-boolean allowSoloRegistration', async () => {
    await expect(
      service.create(
        { name: 'WBSA Warsaw', date: '2026-08-23T10:00:00.000Z', allowSoloRegistration: 'yes' } as any,
        CURRENT_USER,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('writes both flags through updateConfig', async () => {
    await service.updateConfig(
      'event-1',
      { gamesPerPair: 1, courts: 2, visibility: 'private', allowSoloRegistration: true },
      CURRENT_USER,
    );

    expect(prisma.ongoingEventConfig.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ visibility: 'private', allowSoloRegistration: true }),
      }),
    );
  });

  it('refuses to turn solo registration off while the pool is not empty', async () => {
    prisma.ongoingEvent.findUnique = jest.fn(async () => ({
      ...EVENT_ROW,
      config: { ...EVENT_ROW.config, allowSoloRegistration: true },
      soloPlayers: [{ id: 'solo-1', player: { id: 'p1', name: 'Ann', avatar: null, playerStats: null } }],
    })) as any;

    await expect(
      service.updateConfig('event-1', { gamesPerPair: 1, courts: 2, allowSoloRegistration: false }, CURRENT_USER),
    ).rejects.toThrow(BadRequestException);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest src/ongoing/ongoing.service.spec.ts -t "registration flags"`

Expected: FAIL — the created config carries no `visibility` key.

- [ ] **Step 3: Extend the request DTOs**

`src/ongoing/dto/create-ongoing-event.dto.ts` — add the import of `IsBoolean` to the existing `class-validator` import, then the fields:

```ts
  @IsOptional()
  @IsString()
  visibility?: string;

  @IsOptional()
  @IsBoolean()
  allowSoloRegistration?: boolean;
```

Add the identical two fields to `src/ongoing/dto/update-ongoing-config.dto.ts` (also importing `IsBoolean`). The decorators are documentation only — nothing runs them — which is why Step 4 validates in the service.

- [ ] **Step 4: Add the normalisers and wire them in**

In `src/ongoing/ongoing.service.ts`, next to `normaliseScheme`:

```ts
  private normaliseVisibility(value: string | undefined | null): string {
    const resolved = value === undefined || value === null ? 'public' : value;

    if (resolved !== 'public' && resolved !== 'private') {
      throw new BadRequestException('visibility must be public or private');
    }

    return resolved;
  }

  private normaliseAllowSolo(value: boolean | undefined | null): boolean {
    if (value === undefined || value === null) return false;
    if (typeof value !== 'boolean') {
      throw new BadRequestException('allowSoloRegistration must be a boolean');
    }

    return value;
  }
```

In `create`, next to the existing `normaliseScheme` call:

```ts
    const visibility = this.normaliseVisibility(createOngoingEventDto.visibility);
    const allowSoloRegistration = this.normaliseAllowSolo(createOngoingEventDto.allowSoloRegistration);
```

and extend the `config: { create: { ... } }` literal with `visibility, allowSoloRegistration`.

In `updateConfig`, after the existing `normaliseScheme` call:

```ts
    const visibility = this.normaliseVisibility(updateOngoingConfigDto.visibility);
    const allowSoloRegistration = this.normaliseAllowSolo(updateOngoingConfigDto.allowSoloRegistration);

    // Otherwise the pool's entrants are stranded behind a UI that no longer renders it.
    if (!allowSoloRegistration && event.soloPlayers.length) {
      throw new BadRequestException('Solo registration cannot be turned off while the solo pool is not empty');
    }
```

and add `visibility, allowSoloRegistration` to both the `create` and the `update` object of the `ongoingEventConfig.upsert` call.

- [ ] **Step 5: Run to verify they pass**

Run: `npx jest src/ongoing/ongoing.service.spec.ts`

Expected: PASS, whole file.

- [ ] **Step 6: Verify the build**

Run: `npm run build`

Expected: success.

---

## Task 5: Solo registration and its cancellation

**Files:**
- Create: `volley-app-service/src/ongoing/dto/solo-registration.dto.ts`
- Modify: `volley-app-service/src/ongoing/ongoing.service.ts`
- Modify: `volley-app-service/src/ongoing/ongoing.controller.ts`
- Test: `volley-app-service/src/ongoing/ongoing.service.spec.ts`

**Interfaces:**
- Consumes: `pairByRating`/`effectiveTeamCount` are *not* used here; `mapSoloPlayer` and `soloPlayers` (Task 3), the flags (Task 4).
- Produces:
  - `class AddSoloPlayerDto { playerId?: string }`
  - `addSoloPlayer(id: string, dto: AddSoloPlayerDto, currentUser: JwtPayload): Promise<OngoingEventResponseDto>`
  - `removeSoloPlayer(soloId: string, currentUser: JwtPayload): Promise<OngoingEventResponseDto>`
  - private `isCancellationOpen(date: Date): boolean`
  - private `canManage(createdByUserId: string | null, currentUser: JwtPayload): boolean` — the non-throwing sibling of `assertCanManage`, which now delegates to it
  - `POST /ongoing/:id/solo`, `DELETE /ongoing/solo/:soloId`

- [ ] **Step 1: Write the failing tests**

Add to `src/ongoing/ongoing.service.spec.ts`. Note `CURRENT_USER` in this file has `role: 'admin'`; these tests need a plain player, so declare one in the describe block:

```ts
describe('OngoingService.addSoloPlayer', () => {
  const PLAYER_USER = { sub: 'user-9', email: 'p9@example.com', role: 'player', jti: 'jti-9', iat: 0, exp: 0 };

  const openSoloEvent = (overrides: any = {}) => ({
    ...EVENT_ROW,
    date: new Date('2999-01-01T00:00:00.000Z'),
    config: { ...EVENT_ROW.config, allowSoloRegistration: true },
    ...overrides,
  });

  it('registers the caller into the pool of a public tournament', async () => {
    prisma.ongoingEvent.findUnique = jest.fn(async () => openSoloEvent()) as any;
    userService.findById = jest.fn(async () => ({ playerId: 'p3' }) as any);

    await service.addSoloPlayer('event-1', {}, PLAYER_USER);

    expect(prisma.ongoingSoloPlayer.create).toHaveBeenCalledWith({
      data: { eventId: 'event-1', playerId: 'p3' },
    });
  });

  it('refuses a non-manager registering somebody else', async () => {
    prisma.ongoingEvent.findUnique = jest.fn(async () => openSoloEvent()) as any;
    userService.findById = jest.fn(async () => ({ playerId: 'p3' }) as any);

    await expect(service.addSoloPlayer('event-1', { playerId: 'p7' }, PLAYER_USER)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('refuses a non-manager on a private tournament', async () => {
    prisma.ongoingEvent.findUnique = jest.fn(async () =>
      openSoloEvent({ config: { ...EVENT_ROW.config, allowSoloRegistration: true, visibility: 'private' } }),
    ) as any;
    userService.findById = jest.fn(async () => ({ playerId: 'p3' }) as any);

    await expect(service.addSoloPlayer('event-1', {}, PLAYER_USER)).rejects.toThrow(ForbiddenException);
  });

  it('lets a manager add any player to a private tournament', async () => {
    prisma.ongoingEvent.findUnique = jest.fn(async () =>
      openSoloEvent({
        createdByUserId: 'user-1',
        config: { ...EVENT_ROW.config, allowSoloRegistration: true, visibility: 'private' },
      }),
    ) as any;

    await service.addSoloPlayer('event-1', { playerId: 'p7' }, CURRENT_USER);

    expect(prisma.ongoingSoloPlayer.create).toHaveBeenCalledWith({
      data: { eventId: 'event-1', playerId: 'p7' },
    });
  });

  it('refuses when solo registration is switched off', async () => {
    prisma.ongoingEvent.findUnique = jest.fn(async () => openSoloEvent({ config: { ...EVENT_ROW.config } })) as any;
    userService.findById = jest.fn(async () => ({ playerId: 'p3' }) as any);

    await expect(service.addSoloPlayer('event-1', {}, PLAYER_USER)).rejects.toThrow(ConflictException);
  });

  it('refuses a player who is already on the roster', async () => {
    prisma.ongoingEvent.findUnique = jest.fn(async () =>
      openSoloEvent({
        teams: [
          {
            id: 'team-1',
            player1: { id: 'p3', name: 'Ann', avatar: null, playerStats: null },
            player2: { id: 'p4', name: 'Bob', avatar: null, playerStats: null },
          },
        ],
      }),
    ) as any;
    userService.findById = jest.fn(async () => ({ playerId: 'p3' }) as any);

    await expect(service.addSoloPlayer('event-1', {}, PLAYER_USER)).rejects.toThrow(ConflictException);
  });
});

describe('OngoingService.removeSoloPlayer', () => {
  const PLAYER_USER = { sub: 'user-9', email: 'p9@example.com', role: 'player', jti: 'jti-9', iat: 0, exp: 0 };

  it('lets the entrant withdraw before the day of the tournament', async () => {
    prisma.ongoingSoloPlayer.findUnique = jest.fn(async () => ({
      id: 'solo-1',
      eventId: 'event-1',
      playerId: 'p3',
      event: { createdByUserId: 'user-1', date: new Date('2999-01-01T00:00:00.000Z') },
    })) as any;
    userService.findById = jest.fn(async () => ({ playerId: 'p3' }) as any);

    await service.removeSoloPlayer('solo-1', PLAYER_USER);

    expect(prisma.ongoingSoloPlayer.delete).toHaveBeenCalledWith({ where: { id: 'solo-1' } });
  });

  it('refuses the entrant on the day of the tournament', async () => {
    prisma.ongoingSoloPlayer.findUnique = jest.fn(async () => ({
      id: 'solo-1',
      eventId: 'event-1',
      playerId: 'p3',
      event: { createdByUserId: 'user-1', date: new Date() },
    })) as any;
    userService.findById = jest.fn(async () => ({ playerId: 'p3' }) as any);

    await expect(service.removeSoloPlayer('solo-1', PLAYER_USER)).rejects.toThrow(ForbiddenException);
  });

  it('lets a manager withdraw an entrant on the day of the tournament', async () => {
    prisma.ongoingSoloPlayer.findUnique = jest.fn(async () => ({
      id: 'solo-1',
      eventId: 'event-1',
      playerId: 'p3',
      event: { createdByUserId: 'user-1', date: new Date() },
    })) as any;

    await service.removeSoloPlayer('solo-1', CURRENT_USER);

    expect(prisma.ongoingSoloPlayer.delete).toHaveBeenCalledWith({ where: { id: 'solo-1' } });
  });

  it('refuses an unrelated player', async () => {
    prisma.ongoingSoloPlayer.findUnique = jest.fn(async () => ({
      id: 'solo-1',
      eventId: 'event-1',
      playerId: 'p3',
      event: { createdByUserId: 'user-1', date: new Date('2999-01-01T00:00:00.000Z') },
    })) as any;
    userService.findById = jest.fn(async () => ({ playerId: 'p8' }) as any);

    await expect(service.removeSoloPlayer('solo-1', PLAYER_USER)).rejects.toThrow(ForbiddenException);
  });
});
```

Extend `buildPrismaMock()` with the new delegate — omitting a method the code calls turns a behavioural failure into a `TypeError` that hides the real break:

```ts
    ongoingSoloPlayer: {
      create: jest.fn(async () => ({ id: 'solo-1' })),
      createMany: jest.fn(async () => ({ count: 0 })),
      deleteMany: jest.fn(async () => ({ count: 0 })),
      findUnique: jest.fn(async () => null as any),
      findMany: jest.fn(async () => []),
      delete: jest.fn(async () => ({})),
    },
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest src/ongoing/ongoing.service.spec.ts -t "SoloPlayer"`

Expected: FAIL — `service.addSoloPlayer is not a function`.

- [ ] **Step 3: Add the request DTO**

Create `src/ongoing/dto/solo-registration.dto.ts`:

```ts
import { IsArray, IsOptional, IsString } from 'class-validator';

export class AddSoloPlayerDto {
  @IsOptional()
  @IsString()
  playerId?: string;
}

export class FormTeamsFromSoloDto {
  @IsArray()
  teams: Array<{ player1Id: string; player2Id: string }>;
}
```

`FormTeamsFromSoloDto` is consumed in Task 8; it lives here because both shapes describe the same pool.

- [ ] **Step 4: Add the deadline helper and the non-throwing manager predicate**

In `src/ongoing/ongoing.service.ts`, directly below `isRegistrationDateOpen`:

```ts
  // Withdrawing yourself closes at the end of the day BEFORE the tournament — on the day itself the
  // organiser is already building a schedule around you. Same UTC-day comparison as registration, so
  // a date-only value is judged identically regardless of the server's local timezone.
  private isCancellationOpen(date: Date): boolean {
    const eventDate = new Date(date);
    const now = new Date();

    const eventDay = Date.UTC(eventDate.getUTCFullYear(), eventDate.getUTCMonth(), eventDate.getUTCDate());
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

    return today < eventDay;
  }
```

Split `assertCanManage` so the same rule can be asked as a question rather than thrown:

```ts
  private canManage(createdByUserId: string | null, currentUser: JwtPayload): boolean {
    const isCreator = createdByUserId !== null && createdByUserId === currentUser.sub;
    return isCreator || currentUser.role === 'admin';
  }

  private assertCanManage(createdByUserId: string | null, currentUser: JwtPayload): void {
    if (!this.canManage(createdByUserId, currentUser)) {
      throw new ForbiddenException('Only the tournament creator or an admin can do this');
    }
  }
```

- [ ] **Step 5: Implement the two service methods**

Add to `src/ongoing/ongoing.service.ts`, after `findOpen`:

```ts
  async addSoloPlayer(
    id: string,
    addSoloPlayerDto: AddSoloPlayerDto,
    currentUser: JwtPayload,
  ): Promise<OngoingEventResponseDto> {
    const event = await this.loadEvent(id);
    const isManager = this.canManage(event.createdByUserId, currentUser);

    if (!isManager && event.config.visibility === 'private') {
      throw new ForbiddenException('This tournament is private; only its creator can add entrants');
    }
    if (!event.config.allowSoloRegistration) {
      throw new ConflictException('This tournament does not accept registration without a partner');
    }

    const requestedPlayerId = addSoloPlayerDto ? addSoloPlayerDto.playerId : undefined;
    let playerId: string;

    if (isManager && requestedPlayerId) {
      playerId = requestedPlayerId;
    } else {
      const currentUserRecord = await this.userService.findById(currentUser.sub);
      if (!currentUserRecord?.playerId || (requestedPlayerId && requestedPlayerId !== currentUserRecord.playerId)) {
        throw new BadRequestException('You can only register yourself without a partner');
      }
      playerId = currentUserRecord.playerId;
    }

    await this.assertPlanning(id);

    if (!this.isRegistrationDateOpen(event.date)) {
      throw new ConflictException('Registration for this tournament has closed');
    }

    // The one-entry invariant: a player is in a team or in the pool, never both.
    const onRoster = event.teams.some((team) => team.player1.id === playerId || team.player2.id === playerId);
    if (onRoster) {
      throw new ConflictException(`Player ${playerId} is already in a team in this tournament`);
    }
    if (event.soloPlayers.some((solo) => solo.player.id === playerId)) {
      throw new ConflictException(`Player ${playerId} is already registered without a partner`);
    }

    if (
      event.config.maxTeams !== null &&
      effectiveTeamCount(event.teams.length, event.soloPlayers.length + 1) > event.config.maxTeams
    ) {
      throw new ConflictException('This tournament is full');
    }

    await this.assertPlayersExist([playerId]);
    await this.prisma.ongoingSoloPlayer.create({ data: { eventId: id, playerId } });

    return this.loadEvent(id);
  }

  async removeSoloPlayer(soloId: string, currentUser: JwtPayload): Promise<OngoingEventResponseDto> {
    const solo = await this.prisma.ongoingSoloPlayer.findUnique({
      where: { id: soloId },
      include: { event: { select: { createdByUserId: true, date: true } } },
    });

    if (!solo) {
      throw new NotFoundException(`Solo registration with ID ${soloId} not found`);
    }

    await this.assertOwnEntryOrManager(solo.event.createdByUserId, solo.event.date, [solo.playerId], currentUser);
    await this.assertPlanning(solo.eventId);

    await this.prisma.ongoingSoloPlayer.delete({ where: { id: soloId } });

    return this.loadEvent(solo.eventId);
  }
```

Add the shared authorization helper next to `assertCanManage` — Task 7 reuses it for teams, which is why it takes a list of player ids:

```ts
  // A manager may withdraw anybody at any time; an entrant may withdraw only themselves, and only
  // while the cancellation window is open.
  private async assertOwnEntryOrManager(
    createdByUserId: string | null,
    eventDate: Date,
    entryPlayerIds: string[],
    currentUser: JwtPayload,
  ): Promise<void> {
    if (this.canManage(createdByUserId, currentUser)) return;

    const currentUserRecord = await this.userService.findById(currentUser.sub);
    const playerId = currentUserRecord?.playerId;

    if (!playerId || !entryPlayerIds.includes(playerId)) {
      throw new ForbiddenException('You can only cancel your own registration');
    }
    if (!this.isCancellationOpen(eventDate)) {
      throw new ForbiddenException('Registration can no longer be cancelled — the deadline was the day before');
    }
  }
```

Import `effectiveTeamCount` from `./pairing` and `AddSoloPlayerDto` from `./dto/solo-registration.dto` at the top of the file.

- [ ] **Step 6: Add the two routes**

In `src/ongoing/ongoing.controller.ts`, after the `addTeam` handler:

```ts
  @Post(':id/solo')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard)
  async addSoloPlayer(
    @Param('id') id: string,
    @Body() addSoloPlayerDto: AddSoloPlayerDto,
    @Req() req: AuthedRequest,
  ): Promise<OngoingEventResponseDto> {
    return this.ongoingService.addSoloPlayer(id, addSoloPlayerDto, req.user);
  }

  @Delete('solo/:soloId')
  @UseGuards(JwtAuthGuard)
  async removeSoloPlayer(@Param('soloId') soloId: string, @Req() req: AuthedRequest): Promise<OngoingEventResponseDto> {
    return this.ongoingService.removeSoloPlayer(soloId, req.user);
  }
```

Declare both above the `@Get(':id')` / `@Delete(':id')` handlers at the bottom of the controller, matching where `@Get('open')` sits. Note this is style, not a fix: a literal-vs-`:id` collision only happens when the segment counts are equal (`GET /ongoing/open` vs `GET /ongoing/:id`), and `/ongoing/solo/:soloId` has two segments where `/ongoing/:id` has one, so no order can make them collide. Import `AddSoloPlayerDto`.

- [ ] **Step 7: Run to verify they pass**

Run: `npx jest src/ongoing/ongoing.service.spec.ts`

Expected: PASS, whole file.

- [ ] **Step 8: Verify both new routes are reachable**

Port 3000 may already be held by a server from an earlier session, and `main.ts` ignores `PORT`, so probe on a spare port instead of restarting theirs: write a throwaway `probe-tmp.js` at the repo root that `NestFactory.create`s `./dist/app.module` and listens on 3011, run `npm run build`, start it, then:

```bash
curl -s -X POST http://localhost:3011/ongoing/abc/solo -H 'Content-Type: application/json' -d '{}'
```

Expected: `401 Not authenticated` for both new routes — the guard ran, which means the route matched. Contrast with `curl -s http://localhost:3011/ongoing/a/b/c`, which must give `404 Cannot GET`, so a 401 is real evidence of a match rather than a generic response. Kill the probe and delete `probe-tmp.js` afterwards (it must live at the repo root to resolve `node_modules`).

---

## Task 6: Visibility gate and solo-aware capacity on team registration

**Files:**
- Modify: `volley-app-service/src/ongoing/ongoing.service.ts` (`addTeam`, `findOpen`, `setTeams`)
- Test: `volley-app-service/src/ongoing/ongoing.service.spec.ts`

**Interfaces:**
- Consumes: `effectiveTeamCount` (Task 2), `canManage` (Task 5), `soloPlayers` (Task 3).
- Produces: no new symbols — behavioural changes to three existing methods.

- [ ] **Step 1: Write the failing tests**

Add to `src/ongoing/ongoing.service.spec.ts`:

```ts
describe('OngoingService.addTeam access and capacity', () => {
  const PLAYER_USER = { sub: 'user-9', email: 'p9@example.com', role: 'player', jti: 'jti-9', iat: 0, exp: 0 };

  const futureEvent = (overrides: any = {}) => ({
    ...EVENT_ROW,
    date: new Date('2999-01-01T00:00:00.000Z'),
    ...overrides,
  });

  it('refuses a non-manager on a private tournament', async () => {
    prisma.ongoingEvent.findUnique = jest.fn(async () =>
      futureEvent({ config: { ...EVENT_ROW.config, visibility: 'private' } }),
    ) as any;
    userService.findById = jest.fn(async () => ({ playerId: 'p3' }) as any);

    await expect(service.addTeam('event-1', { player1Id: 'p3', player2Id: 'p4' }, PLAYER_USER)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('lets a manager register a pair they are not part of', async () => {
    prisma.ongoingEvent.findUnique = jest.fn(async () =>
      futureEvent({ createdByUserId: 'user-1', config: { ...EVENT_ROW.config, visibility: 'private' } }),
    ) as any;

    await service.addTeam('event-1', { player1Id: 'p3', player2Id: 'p4' }, CURRENT_USER);

    expect(prisma.ongoingTeam.create).toHaveBeenCalledWith({
      data: { eventId: 'event-1', player1Id: 'p3', player2Id: 'p4' },
    });
  });

  it('counts solo entrants against maxTeams', async () => {
    prisma.ongoingEvent.findUnique = jest.fn(async () =>
      futureEvent({
        config: { ...EVENT_ROW.config, maxTeams: 2 },
        teams: [
          {
            id: 'team-1',
            player1: { id: 'p1', name: 'Ann', avatar: null, playerStats: null },
            player2: { id: 'p2', name: 'Bob', avatar: null, playerStats: null },
          },
        ],
        soloPlayers: [
          { id: 'solo-1', player: { id: 'p5', name: 'Cid', avatar: null, playerStats: null } },
          { id: 'solo-2', player: { id: 'p6', name: 'Dot', avatar: null, playerStats: null } },
        ],
      }),
    ) as any;
    userService.findById = jest.fn(async () => ({ playerId: 'p3' }) as any);

    await expect(service.addTeam('event-1', { player1Id: 'p3', player2Id: 'p4' }, PLAYER_USER)).rejects.toThrow(
      ConflictException,
    );
  });

  it('refuses a pair containing somebody already in the solo pool', async () => {
    prisma.ongoingEvent.findUnique = jest.fn(async () =>
      futureEvent({
        soloPlayers: [{ id: 'solo-1', player: { id: 'p4', name: 'Dot', avatar: null, playerStats: null } }],
      }),
    ) as any;
    userService.findById = jest.fn(async () => ({ playerId: 'p3' }) as any);

    await expect(service.addTeam('event-1', { player1Id: 'p3', player2Id: 'p4' }, PLAYER_USER)).rejects.toThrow(
      ConflictException,
    );
  });

  it('drops the solo entries of everybody named in a replaced roster', async () => {
    prisma.ongoingEvent.findUnique = jest.fn(async () => futureEvent({ createdByUserId: 'user-1' })) as any;

    await service.setTeams('event-1', { teams: [{ player1Id: 'p3', player2Id: 'p4' }] }, CURRENT_USER);

    expect(prisma.ongoingSoloPlayer.deleteMany).toHaveBeenCalledWith({
      where: { eventId: 'event-1', playerId: { in: ['p3', 'p4'] } },
    });
  });

  it('hides a tournament whose remaining capacity is taken by solo entrants', async () => {
    prisma.ongoingEvent.findMany = jest.fn(async () => [
      futureEvent({
        config: { ...EVENT_ROW.config, maxTeams: 1 },
        soloPlayers: [
          { id: 'solo-1', player: { id: 'p5', name: 'Cid', avatar: null, playerStats: null } },
          { id: 'solo-2', player: { id: 'p6', name: 'Dot', avatar: null, playerStats: null } },
        ],
      }),
    ]) as any;

    await expect(service.findOpen()).resolves.toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest src/ongoing/ongoing.service.spec.ts -t "access and capacity"`

Expected: FAIL — the private tournament accepts the registration.

- [ ] **Step 3: Rewrite the guard block in `addTeam`**

Replace the current `currentUserRecord` block (the one throwing `'You must register yourself as one of the two players'`) with:

```ts
    const isManager = this.canManage(event.createdByUserId, currentUser);

    if (!isManager) {
      if (event.config.visibility === 'private') {
        throw new ForbiddenException('This tournament is private; only its creator can add teams');
      }

      const currentUserRecord = await this.userService.findById(currentUser.sub);
      if (
        !currentUserRecord?.playerId ||
        (currentUserRecord.playerId !== player1Id && currentUserRecord.playerId !== player2Id)
      ) {
        throw new BadRequestException('You must register yourself as one of the two players');
      }
    }
```

The private case is a `ForbiddenException`, not the existing `BadRequestException` — it is an authorization failure and must not read as "register yourself".

- [ ] **Step 4: Make the roster checks and the capacity check solo-aware**

Still in `addTeam`, after the `validateTeamPairs` call:

```ts
    for (const playerId of [player1Id, player2Id]) {
      if (event.soloPlayers.some((solo) => solo.player.id === playerId)) {
        throw new ConflictException(`Player ${playerId} is registered without a partner; cancel that first`);
      }
    }
```

and replace the `maxTeams` check with:

```ts
    if (
      event.config.maxTeams !== null &&
      effectiveTeamCount(event.teams.length + 1, event.soloPlayers.length) > event.config.maxTeams
    ) {
      throw new ConflictException('This tournament is full');
    }
```

- [ ] **Step 5: Apply the same occupancy rule in `findOpen`**

Replace its capacity filter with:

```ts
      const maxTeams = event.config ? event.config.maxTeams : null;
      if (
        maxTeams !== null &&
        maxTeams !== undefined &&
        effectiveTeamCount(event.teams.length, event.soloPlayers.length) >= maxTeams
      ) {
        continue;
      }
```

The existing comment above `PLAYED_GAME_WHERE` insists `findOpen` and `addTeam` must agree on what "open" means; this keeps that true now that a slot can be half-consumed.

- [ ] **Step 6: Keep the one-entry invariant in `setTeams`**

Inside its `$transaction`, after the `createMany` call:

```ts
      // Anyone placed into a team leaves the pool — a player is in a team or in the pool, never both.
      const rosterPlayerIds = teams.flatMap((team) => [team.player1Id, team.player2Id]);
      if (rosterPlayerIds.length) {
        await tx.ongoingSoloPlayer.deleteMany({
          where: { eventId: id, playerId: { in: rosterPlayerIds } },
        });
      }
```

Do the same in `addTeam`, replacing its single `ongoingTeam.create` call with a transaction:

```ts
    await this.prisma.$transaction(async (tx) => {
      await tx.ongoingTeam.create({ data: { eventId: id, player1Id, player2Id } });
      await tx.ongoingSoloPlayer.deleteMany({
        where: { eventId: id, playerId: { in: [player1Id, player2Id] } },
      });
    });
```

The pool entries were already rejected in Step 4, so this deleteMany normally removes nothing — it closes the race where a solo registration lands between the read and the write.

- [ ] **Step 7: Run to verify they pass**

Run: `npx jest src/ongoing/ongoing.service.spec.ts`

Expected: PASS, whole file. The existing `addTeam` tests must still pass unchanged — the non-manager rule is the same as before for public tournaments.

- [ ] **Step 8: Verify the build**

Run: `npm run build`

Expected: success.

---

## Task 7: A player cancels their own team

**Files:**
- Modify: `volley-app-service/src/ongoing/ongoing.service.ts` (`removeTeam`)
- Test: `volley-app-service/src/ongoing/ongoing.service.spec.ts`

**Interfaces:**
- Consumes: `assertOwnEntryOrManager` (Task 5).
- Produces: `removeTeam` keeps its signature; only its authorization changes.

- [ ] **Step 1: Write the failing tests**

Add to `src/ongoing/ongoing.service.spec.ts`:

```ts
describe('OngoingService.removeTeam self-cancellation', () => {
  const PLAYER_USER = { sub: 'user-9', email: 'p9@example.com', role: 'player', jti: 'jti-9', iat: 0, exp: 0 };

  const teamRow = (eventDate: Date) => ({
    id: 'team-1',
    eventId: 'event-1',
    player1Id: 'p3',
    player2Id: 'p4',
    event: { createdByUserId: 'user-1', date: eventDate },
  });

  it('lets a member remove their own team before the day of the tournament', async () => {
    prisma.ongoingTeam.findUnique = jest.fn(async () => teamRow(new Date('2999-01-01T00:00:00.000Z'))) as any;
    userService.findById = jest.fn(async () => ({ playerId: 'p4' }) as any);

    await service.removeTeam('team-1', PLAYER_USER);

    expect(prisma.ongoingTeam.delete).toHaveBeenCalledWith({ where: { id: 'team-1' } });
  });

  it('refuses a member on the day of the tournament', async () => {
    prisma.ongoingTeam.findUnique = jest.fn(async () => teamRow(new Date())) as any;
    userService.findById = jest.fn(async () => ({ playerId: 'p4' }) as any);

    await expect(service.removeTeam('team-1', PLAYER_USER)).rejects.toThrow(ForbiddenException);
  });

  it('lets a manager remove a team on the day of the tournament', async () => {
    prisma.ongoingTeam.findUnique = jest.fn(async () => teamRow(new Date())) as any;

    await service.removeTeam('team-1', CURRENT_USER);

    expect(prisma.ongoingTeam.delete).toHaveBeenCalledWith({ where: { id: 'team-1' } });
  });

  it('refuses a player who is in neither slot', async () => {
    prisma.ongoingTeam.findUnique = jest.fn(async () => teamRow(new Date('2999-01-01T00:00:00.000Z'))) as any;
    userService.findById = jest.fn(async () => ({ playerId: 'p8' }) as any);

    await expect(service.removeTeam('team-1', PLAYER_USER)).rejects.toThrow(ForbiddenException);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest src/ongoing/ongoing.service.spec.ts -t "self-cancellation"`

Expected: FAIL — a member is refused with the creator/admin message.

- [ ] **Step 3: Rewrite `removeTeam`'s lookup and authorization**

```ts
  async removeTeam(teamId: string, currentUser: JwtPayload): Promise<OngoingEventResponseDto> {
    const team = await this.prisma.ongoingTeam.findUnique({
      where: { id: teamId },
      include: { event: { select: { createdByUserId: true, date: true } } },
    });

    if (!team) {
      throw new NotFoundException(`Ongoing team with ID ${teamId} not found`);
    }

    // Either member may withdraw the pair until the day before; the manager is not bound by that.
    await this.assertOwnEntryOrManager(
      team.event.createdByUserId,
      team.event.date,
      [team.player1Id, team.player2Id],
      currentUser,
    );
    await this.assertPlanning(team.eventId);

    // ongoing_games -> ongoing_teams is ON DELETE CASCADE, and in planning every fixture is unplayed,
    // so the cascade cannot destroy a recorded result.
    await this.prisma.ongoingTeam.delete({ where: { id: teamId } });

    return this.loadEvent(team.eventId);
  }
```

`assertCanManageEvent` is no longer called here; leave that method in place — `updateGameScore` and `clearGameResult` still use it.

- [ ] **Step 4: Run to verify they pass**

Run: `npx jest src/ongoing/ongoing.service.spec.ts`

Expected: PASS, whole file. Any pre-existing `removeTeam` test that mocked `ongoingTeam.findUnique` without the `event` relation needs its fixture extended to `{ ...row, event: { createdByUserId: 'user-1', date: new Date('2999-01-01T00:00:00.000Z') } }` — the include changed, so a stale fixture is a fixture bug, not a regression.

- [ ] **Step 5: Verify the deadline is actually enforced**

Change `return today < eventDay;` in `isCancellationOpen` to `return true;` and re-run the file.

Expected: "refuses a member on the day of the tournament" and the solo equivalent from Task 5 both FAIL. Restore and confirm green.

- [ ] **Step 6: Verify the build**

Run: `npm run build`

Expected: success.

---

## Task 8: Pairing preview and team formation

**Files:**
- Modify: `volley-app-service/src/ongoing/ongoing.service.ts`
- Modify: `volley-app-service/src/ongoing/ongoing.controller.ts`
- Modify: `volley-app-service/src/ongoing/dto/ongoing-event-response.dto.ts`
- Test: `volley-app-service/src/ongoing/ongoing.service.spec.ts`

**Interfaces:**
- Consumes: `pairByRating` (Task 2), `FormTeamsFromSoloDto` (Task 5), `assertCanManage` (existing).
- Produces:
  - `class OngoingSoloPairPreviewDto { pairs: Array<{ player1: OngoingTeamPlayerDto; player2: OngoingTeamPlayerDto; rating: number }>; unpaired: OngoingTeamPlayerDto[] }`
  - `previewSoloPairing(id: string, currentUser: JwtPayload): Promise<OngoingSoloPairPreviewDto>`
  - `formTeamsFromSolo(id: string, dto: FormTeamsFromSoloDto, currentUser: JwtPayload): Promise<OngoingEventResponseDto>`
  - `GET /ongoing/:id/solo/preview`, `POST /ongoing/:id/solo/form-teams`

- [ ] **Step 1: Write the failing tests**

Add to `src/ongoing/ongoing.service.spec.ts`:

```ts
describe('OngoingService solo pairing', () => {
  const poolEvent = (ratings: Array<[string, number | null]>) => ({
    ...EVENT_ROW,
    createdByUserId: 'user-1',
    date: new Date('2999-01-01T00:00:00.000Z'),
    soloPlayers: ratings.map(([id, rank], index) => ({
      id: `solo-${index + 1}`,
      player: {
        id,
        name: id.toUpperCase(),
        avatar: null,
        playerStats: rank === null ? null : { rank },
      },
    })),
  });

  it('previews strongest-with-weakest pairs and the team rating', async () => {
    prisma.ongoingEvent.findUnique = jest.fn(async () =>
      poolEvent([
        ['a', 1300],
        ['b', 1200],
        ['c', 1000],
        ['d', 800],
      ]),
    ) as any;

    const preview = await service.previewSoloPairing('event-1', CURRENT_USER);

    expect(preview.pairs.map((pair) => [pair.player1.id, pair.player2.id, pair.rating])).toEqual([
      ['a', 'd', 2100],
      ['b', 'c', 2200],
    ]);
    expect(preview.unpaired).toEqual([]);
  });

  it('reports the leftover player when the pool is odd', async () => {
    prisma.ongoingEvent.findUnique = jest.fn(async () =>
      poolEvent([
        ['a', 1300],
        ['b', 1200],
        ['c', 1000],
      ]),
    ) as any;

    const preview = await service.previewSoloPairing('event-1', CURRENT_USER);

    expect(preview.unpaired.map((player) => player.id)).toEqual(['b']);
  });

  it('creates the confirmed teams and empties the matching pool rows in one transaction', async () => {
    const calls: string[] = [];
    prisma.ongoingEvent.findUnique = jest.fn(async () =>
      poolEvent([
        ['a', 1300],
        ['b', 800],
      ]),
    ) as any;
    prisma.ongoingTeam.createMany = jest.fn(async () => {
      calls.push('createTeams');
      return { count: 1 };
    });
    prisma.ongoingSoloPlayer.deleteMany = jest.fn(async () => {
      calls.push('deleteSolo');
      return { count: 2 };
    });

    await service.formTeamsFromSolo('event-1', { teams: [{ player1Id: 'a', player2Id: 'b' }] }, CURRENT_USER);

    expect(prisma.$transaction).toHaveBeenCalled();
    expect(calls).toEqual(['createTeams', 'deleteSolo']);
    expect(prisma.ongoingTeam.createMany).toHaveBeenCalledWith({
      data: [{ eventId: 'event-1', player1Id: 'a', player2Id: 'b' }],
    });
    expect(prisma.ongoingSoloPlayer.deleteMany).toHaveBeenCalledWith({
      where: { eventId: 'event-1', playerId: { in: ['a', 'b'] } },
    });
  });

  it('rejects a player who is not in this pool without writing anything', async () => {
    prisma.ongoingEvent.findUnique = jest.fn(async () =>
      poolEvent([
        ['a', 1300],
        ['b', 800],
      ]),
    ) as any;

    await expect(
      service.formTeamsFromSolo('event-1', { teams: [{ player1Id: 'a', player2Id: 'zz' }] }, CURRENT_USER),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.ongoingTeam.createMany).not.toHaveBeenCalled();
  });

  it('rejects the same player appearing in two confirmed teams', async () => {
    prisma.ongoingEvent.findUnique = jest.fn(async () =>
      poolEvent([
        ['a', 1300],
        ['b', 1000],
        ['c', 800],
      ]),
    ) as any;

    await expect(
      service.formTeamsFromSolo(
        'event-1',
        {
          teams: [
            { player1Id: 'a', player2Id: 'b' },
            { player1Id: 'a', player2Id: 'c' },
          ],
        },
        CURRENT_USER,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('accepts a subset and leaves the rest in the pool', async () => {
    prisma.ongoingEvent.findUnique = jest.fn(async () =>
      poolEvent([
        ['a', 1300],
        ['b', 1000],
        ['c', 800],
      ]),
    ) as any;

    await service.formTeamsFromSolo('event-1', { teams: [{ player1Id: 'a', player2Id: 'c' }] }, CURRENT_USER);

    expect(prisma.ongoingSoloPlayer.deleteMany).toHaveBeenCalledWith({
      where: { eventId: 'event-1', playerId: { in: ['a', 'c'] } },
    });
  });

  it('refuses a non-manager', async () => {
    prisma.ongoingEvent.findUnique = jest.fn(async () => poolEvent([['a', 1300]])) as any;

    await expect(
      service.previewSoloPairing('event-1', {
        sub: 'user-9',
        email: 'p9@example.com',
        role: 'player',
        jti: 'jti-9',
        iat: 0,
        exp: 0,
      }),
    ).rejects.toThrow(ForbiddenException);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest src/ongoing/ongoing.service.spec.ts -t "solo pairing"`

Expected: FAIL — `service.previewSoloPairing is not a function`.

- [ ] **Step 3: Add the preview DTO**

In `src/ongoing/dto/ongoing-event-response.dto.ts`:

```ts
export class OngoingSoloPairDto {
  player1: OngoingTeamPlayerDto;
  player2: OngoingTeamPlayerDto;
  rating: number;
}

export class OngoingSoloPairPreviewDto {
  pairs: OngoingSoloPairDto[];
  unpaired: OngoingTeamPlayerDto[];
}
```

`rating` is the pair's combined rating, matching what `OngoingTeamResponseDto.rating` means for a real team, so the preview and the roster read the same way.

- [ ] **Step 4: Implement the two service methods**

Add to `src/ongoing/ongoing.service.ts`, after `removeSoloPlayer`:

```ts
  async previewSoloPairing(id: string, currentUser: JwtPayload): Promise<OngoingSoloPairPreviewDto> {
    const event = await this.loadEvent(id);
    this.assertCanManage(event.createdByUserId, currentUser);

    const byPlayerId = new Map(event.soloPlayers.map((solo) => [solo.player.id, solo]));
    const { pairs, unpaired } = pairByRating(
      event.soloPlayers.map((solo) => ({ playerId: solo.player.id, rating: solo.rating })),
    );

    return {
      pairs: pairs.map((pair) => {
        const first = byPlayerId.get(pair.player1Id);
        const second = byPlayerId.get(pair.player2Id);
        return {
          player1: first.player,
          player2: second.player,
          rating: first.rating + second.rating,
        };
      }),
      unpaired: unpaired.map((playerId) => byPlayerId.get(playerId).player),
    };
  }

  async formTeamsFromSolo(
    id: string,
    formTeamsFromSoloDto: FormTeamsFromSoloDto,
    currentUser: JwtPayload,
  ): Promise<OngoingEventResponseDto> {
    const event = await this.loadEvent(id);
    this.assertCanManage(event.createdByUserId, currentUser);

    if (!formTeamsFromSoloDto || !Array.isArray(formTeamsFromSoloDto.teams)) {
      throw new BadRequestException('teams must be an array');
    }

    const teams = formTeamsFromSoloDto.teams;
    // Reuses the roster validator, so "same player twice" and "a team of one" read identically here
    // and in setTeams.
    const playerIds = this.validateTeamPairs(teams);

    await this.assertPlanning(id);

    const poolIds = new Set(event.soloPlayers.map((solo) => solo.player.id));
    for (const playerId of playerIds) {
      if (!poolIds.has(playerId)) {
        throw new BadRequestException(`Player ${playerId} is not registered without a partner in this tournament`);
      }
    }

    if (!teams.length) return this.loadEvent(id);

    await this.prisma.$transaction(async (tx) => {
      await tx.ongoingTeam.createMany({
        data: teams.map((team) => ({ eventId: id, player1Id: team.player1Id, player2Id: team.player2Id })),
      });
      // Pool rows go second: the teams they became must exist before the pool forgets them, so a
      // failure can never leave an entrant in neither place.
      await tx.ongoingSoloPlayer.deleteMany({ where: { eventId: id, playerId: { in: playerIds } } });
    });

    return this.loadEvent(id);
  }
```

Import `pairByRating` from `./pairing`, `FormTeamsFromSoloDto` from `./dto/solo-registration.dto`, and `OngoingSoloPairPreviewDto` from the response DTO file.

Note there is no `maxTeams` check: forming teams never increases occupancy — `effectiveTeamCount` already charged those entrants a slot each.

- [ ] **Step 5: Add the two routes**

In `src/ongoing/ongoing.controller.ts`, immediately after the two solo routes from Task 5 (and still above `@Get(':id')`):

```ts
  @Get(':id/solo/preview')
  @UseGuards(JwtAuthGuard)
  async previewSoloPairing(@Param('id') id: string, @Req() req: AuthedRequest): Promise<OngoingSoloPairPreviewDto> {
    return this.ongoingService.previewSoloPairing(id, req.user);
  }

  @Post(':id/solo/form-teams')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async formTeamsFromSolo(
    @Param('id') id: string,
    @Body() formTeamsFromSoloDto: FormTeamsFromSoloDto,
    @Req() req: AuthedRequest,
  ): Promise<OngoingEventResponseDto> {
    return this.ongoingService.formTeamsFromSolo(id, formTeamsFromSoloDto, req.user);
  }
```

Import `FormTeamsFromSoloDto` and `OngoingSoloPairPreviewDto`.

- [ ] **Step 6: Run to verify they pass**

Run: `npx jest src/ongoing/ongoing.service.spec.ts`

Expected: PASS, whole file.

- [ ] **Step 7: Verify the transaction ordering assertion bites**

Swap the two calls inside the `$transaction` so the deleteMany runs first, and re-run.

Expected: "creates the confirmed teams and empties the matching pool rows in one transaction" FAILS on the `calls` order. Restore and confirm green. A bare "was called" assertion would not have caught this.

- [ ] **Step 8: Full backend verification**

Run: `npm run build && npm run test && npm run lint`

Expected: all three succeed. This is the last backend task — everything after it is frontend.

---

## Task 9: Frontend types, URLs and permission predicates

**Files:**
- Modify: `volleyball-management-ui/lib/types.ts`
- Modify: `volleyball-management-ui/lib/api.ts`
- Modify: `volleyball-management-ui/lib/ongoing-permissions.ts`

**Interfaces:**
- Consumes: the backend response shapes from Tasks 3 and 8.
- Produces:
  - `interface OngoingSoloPlayer { id: string; player: OngoingTeamPlayer; rating: number }`
  - `interface OngoingSoloPairPreview { pairs: Array<{ player1: OngoingTeamPlayer; player2: OngoingTeamPlayer; rating: number }>; unpaired: OngoingTeamPlayer[] }`
  - `API.ADD_ONGOING_SOLO(id)`, `API.REMOVE_ONGOING_SOLO(soloId)`, `API.GET_ONGOING_SOLO_PREVIEW(id)`, `API.FORM_ONGOING_TEAMS(id)`
  - `isOngoingCancellationOpen(dateIso: string): boolean`
  - `canRegisterInOngoingEvent(user, event): boolean`
  - `canRegisterSoloInOngoingEvent(user, event): boolean`
  - `canCancelOngoingEntry(user, event, entryPlayerIds: string[]): boolean`

- [ ] **Step 1: Extend the domain types**

In `lib/types.ts`, add to `OngoingEventConfig`:

```ts
  visibility: string
  allowSoloRegistration: boolean
```

Add after `OngoingTeam`:

```ts
export interface OngoingSoloPlayer {
  id: string
  player: OngoingTeamPlayer
  rating: number
}

export interface OngoingSoloPair {
  player1: OngoingTeamPlayer
  player2: OngoingTeamPlayer
  rating: number
}

export interface OngoingSoloPairPreview {
  pairs: OngoingSoloPair[]
  unpaired: OngoingTeamPlayer[]
}
```

Add `soloPlayers: OngoingSoloPlayer[]` to `OngoingEvent`, and to `OngoingOpenEvent` add all three of:

```ts
  visibility: string
  allowSoloRegistration: boolean
  soloPlayers: OngoingSoloPlayer[]
```

- [ ] **Step 2: Register the four URLs**

In `lib/api.ts`, next to `REMOVE_ONGOING_TEAM`:

```ts
  ADD_ONGOING_SOLO: (id: string) => `${process.env.NEXT_PUBLIC_HOST_URL}/ongoing/${id}/solo`,
  REMOVE_ONGOING_SOLO: (soloId: string) => `${process.env.NEXT_PUBLIC_HOST_URL}/ongoing/solo/${soloId}`,
  GET_ONGOING_SOLO_PREVIEW: (id: string) => `${process.env.NEXT_PUBLIC_HOST_URL}/ongoing/${id}/solo/preview`,
  FORM_ONGOING_TEAMS: (id: string) => `${process.env.NEXT_PUBLIC_HOST_URL}/ongoing/${id}/solo/form-teams`,
```

- [ ] **Step 3: Add the shared predicates**

In `lib/ongoing-permissions.ts`, below the existing `canManageOngoingEvent`:

```ts
interface OngoingAccessUser {
  id: string
  role: string
  playerId?: string | null
}

interface OngoingAccessEvent {
  createdByUserId: string | null
  date: string
  visibility: string
  allowSoloRegistration: boolean
}

// Mirrors the backend's isCancellationOpen: withdrawing yourself closes at the end of the day before
// the tournament. UTC calendar days on both sides, so a date-only value is read identically here and
// on the server regardless of the viewer's timezone.
export function isOngoingCancellationOpen(dateIso: string): boolean {
  const eventDate = new Date(dateIso)
  if (Number.isNaN(eventDate.getTime())) return false
  const now = new Date()

  const eventDay = Date.UTC(eventDate.getUTCFullYear(), eventDate.getUTCMonth(), eventDate.getUTCDate())
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())

  return today < eventDay
}

export function canRegisterInOngoingEvent(
  user: OngoingAccessUser | null,
  event: OngoingAccessEvent,
): boolean {
  if (!user) return false
  if (canManageOngoingEvent(user, event.createdByUserId)) return true
  return event.visibility !== 'private'
}

export function canRegisterSoloInOngoingEvent(
  user: OngoingAccessUser | null,
  event: OngoingAccessEvent,
): boolean {
  return event.allowSoloRegistration && canRegisterInOngoingEvent(user, event)
}

// The manager is deliberately not bound by the deadline — they may fix a roster right up to the
// first recorded result.
export function canCancelOngoingEntry(
  user: OngoingAccessUser | null,
  event: OngoingAccessEvent,
  entryPlayerIds: string[],
): boolean {
  if (!user) return false
  if (canManageOngoingEvent(user, event.createdByUserId)) return true
  if (!user.playerId || !entryPlayerIds.includes(user.playerId)) return false
  return isOngoingCancellationOpen(event.date)
}
```

`canManageOngoingEvent`'s existing parameter type is `{ id: string; role: string } | null`, which `OngoingAccessUser` satisfies structurally — do not widen the old signature.

- [ ] **Step 4: Typecheck**

Run: `cd /Users/artem/Desktop/projects/volleyball-management-ui && npx tsc --noEmit`

Expected: errors **only** in the components that build an `OngoingOpenEvent`/`OngoingEvent` literal without the new required fields — there should be none, because every one of them comes from a `fetch`. If `tsc` is clean, move on. If it reports anything else, fix it before continuing; this repo's `tsc --noEmit` is currently clean and must stay that way.

- [ ] **Step 5: Lint**

Run: `npm run lint`

Expected: clean.

---

## Task 10: Visibility and solo controls on the create form and config tab

**Files:**
- Modify: `volleyball-management-ui/components/ongoing/create-tournament-form.tsx`
- Modify: `volleyball-management-ui/components/ongoing/ongoing-config-tab.tsx`
- Modify: `volleyball-management-ui/locales/{en,uk,pl,be}/common.json`

**Interfaces:**
- Consumes: `OngoingEventConfig.visibility` / `.allowSoloRegistration` (Task 9).
- Produces: `POST /ongoing` and `PUT /ongoing/:id/config` bodies now carry `visibility` and `allowSoloRegistration`.

- [ ] **Step 1: Add the locale keys**

Add to the `ongoing.create` object in all four locale files:

`locales/en/common.json`:

```json
      "visibilityLabel": "Who can register",
      "visibilityPublic": "Public — anyone can register",
      "visibilityPrivate": "Private — only I add teams",
      "allowSoloLabel": "Allow registration without a partner",
      "allowSoloHint": "Players without a partner join a pool and are paired by rating before the tournament."
```

`locales/uk/common.json`:

```json
      "visibilityLabel": "Хто може реєструватися",
      "visibilityPublic": "Публічний — усі можуть зареєструватися",
      "visibilityPrivate": "Приватний — команди додаю лише я",
      "allowSoloLabel": "Дозволити реєстрацію без пари",
      "allowSoloHint": "Гравці без пари потрапляють у пул, і перед турніром їх розбивають на команди за рейтингом."
```

`locales/pl/common.json`:

```json
      "visibilityLabel": "Kto może się zapisać",
      "visibilityPublic": "Publiczny — każdy może się zapisać",
      "visibilityPrivate": "Prywatny — drużyny dodaję tylko ja",
      "allowSoloLabel": "Zezwól na zapisy bez partnera",
      "allowSoloHint": "Gracze bez partnera trafiają do puli i przed turniejem są łączeni w pary według rankingu."
```

`locales/be/common.json`:

```json
      "visibilityLabel": "Хто можа зарэгістравацца",
      "visibilityPublic": "Публічны — усе могуць зарэгістравацца",
      "visibilityPrivate": "Прыватны — каманды дадаю толькі я",
      "allowSoloLabel": "Дазволіць рэгістрацыю без пары",
      "allowSoloHint": "Гульцы без пары трапляюць у пул, і перад турнірам іх разбіваюць на каманды паводле рэйтынгу."
```

The config tab reuses the same `ongoing.create.*` keys — the two forms edit the same two settings, and a second copy of the strings would drift.

- [ ] **Step 2: Add the two controls to the create form**

In `create-tournament-form.tsx`, add the state next to `maxTeams`:

```tsx
  const [visibility, setVisibility] = useState("public");
  const [allowSoloRegistration, setAllowSoloRegistration] = useState(false);
```

Send them in `createMutation`'s body, next to the `maxTeams` line — always, not conditionally, so flipping a control back to its default is not silently dropped:

```tsx
      body.visibility = visibility;
      body.allowSoloRegistration = allowSoloRegistration;
```

Render, after the max-teams field:

```tsx
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium" suppressHydrationWarning>
            {t("ongoing.create.visibilityLabel")}
          </label>
          <select
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={visibility}
            onChange={(event) => setVisibility(event.target.value)}
          >
            <option value="public">{t("ongoing.create.visibilityPublic")}</option>
            <option value="private">{t("ongoing.create.visibilityPrivate")}</option>
          </select>
        </div>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={allowSoloRegistration}
            onChange={(event) => setAllowSoloRegistration(event.target.checked)}
          />
          <span className="flex flex-col gap-0.5">
            <span className="font-medium" suppressHydrationWarning>
              {t("ongoing.create.allowSoloLabel")}
            </span>
            <span className="text-xs text-muted-foreground" suppressHydrationWarning>
              {t("ongoing.create.allowSoloHint")}
            </span>
          </span>
        </label>
```

A native `select`/`checkbox` is deliberate: this form already uses native selects and only ten shadcn primitives are vendored.

- [ ] **Step 3: Add the same two controls to the config tab**

In `ongoing-config-tab.tsx`, seed state from the loaded config (seeded once, never resynced — matching the existing `maxTeams`/`scheme` comments):

```tsx
  const [visibility, setVisibility] = useState(event.config.visibility);
  const [allowSoloRegistration, setAllowSoloRegistration] = useState(event.config.allowSoloRegistration);
```

Add `visibility, allowSoloRegistration` to the `saveConfigMutation` body, and render the same two blocks from Step 2 after the max-teams field.

- [ ] **Step 4: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`

Expected: both clean.

- [ ] **Step 5: Verify in the browser**

Start the backend (`cd ../volley-app-service && npm run start`) and the frontend (`npm run dev -- -p 3001`), and point `.env`'s `NEXT_PUBLIC_HOST_URL` at `http://localhost:3000` for the duration — it ships pointing at the remote backend, which does not have this code.

Open `http://localhost:3001/calendar`, create a private tournament with solo registration on, then open its Config tab.

Expected: the tab shows Private and the checkbox ticked — proving the round-trip through `create`, `findOne` and the config mapper. Restore `.env` when done.

---

## Task 11: Solo mode and the private lock-out in the registration dialog

**Files:**
- Modify: `volleyball-management-ui/components/ongoing/register-team-dialog.tsx`
- Modify: `volleyball-management-ui/app/calendar/page.tsx`
- Modify: `volleyball-management-ui/locales/{en,uk,pl,be}/common.json`

**Interfaces:**
- Consumes: `API.ADD_ONGOING_SOLO`, `canRegisterInOngoingEvent`, `canRegisterSoloInOngoingEvent` (Task 9).
- Produces: no exported symbols — `RegisterTeamDialog` keeps its `{ event, players }` props.

- [ ] **Step 1: Add the locale keys**

Add to the `calendar` object in all four files:

| key | en | uk | pl | be |
|---|---|---|---|---|
| `privateBadge` | `Private` | `Приватний` | `Prywatny` | `Прыватны` |
| `privateHint` | `Only the organiser adds teams to this tournament` | `Команди в цей турнір додає лише організатор` | `Drużyny do tego turnieju dodaje tylko organizator` | `Каманды ў гэты турнір дадае толькі арганізатар` |
| `modeWithPartner` | `With a partner` | `З напарником` | `Z partnerem` | `З напарнікам` |
| `modeSolo` | `Without a partner` | `Без пари` | `Bez partnera` | `Без пары` |
| `soloHint` | `You will be paired by rating before the tournament starts` | `Тебе розподілять у команду за рейтингом перед стартом турніру` | `Zostaniesz dobrany w parę według rankingu przed startem turnieju` | `Цябе размяркуюць у каманду паводле рэйтынгу перад стартам турніру` |
| `soloPool` | `Without a partner` | `Без пари` | `Bez partnera` | `Без пары` |

- [ ] **Step 2: Add the mode toggle and the solo mutation**

In `register-team-dialog.tsx`, add state next to `player2Id`:

```tsx
  const [mode, setMode] = useState<"partner" | "solo">("partner");
```

Reset it in `resetAndSetOpen`'s `if (!nextOpen)` branch with `setMode("partner")`, so a closed dialog reopens in the default mode.

Add a second mutation next to `registerMutation`:

```tsx
  const registerSoloMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(API.ADD_ONGOING_SOLO(event.id), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: "Request failed" }));
        throw new Error(error.message || `HTTP error! status: ${response.status}`);
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ongoing-open"] });
      queryClient.invalidateQueries({ queryKey: ["ongoing-events"] });
      queryClient.invalidateQueries({ queryKey: ["ongoing-event", event.id] });
      resetAndSetOpen(false);
    },
  });
```

The body is `{}`: the backend takes the caller's own `playerId` when none is given, so the client never has to assert who it is.

Add `registerSoloMutation.reset()` to `resetAndSetOpen`'s reset branch alongside `registerMutation.reset()`.

- [ ] **Step 3: Render the toggle and switch the footer**

Above the player fields inside `DialogContent`, shown only when the tournament accepts solo entrants:

```tsx
          {event.allowSoloRegistration && (
            <div className="flex gap-2">
              <Button
                type="button"
                variant={mode === "partner" ? "default" : "outline"}
                size="sm"
                onClick={() => setMode("partner")}
              >
                <span suppressHydrationWarning>{t("calendar.modeWithPartner")}</span>
              </Button>
              <Button
                type="button"
                variant={mode === "solo" ? "default" : "outline"}
                size="sm"
                onClick={() => setMode("solo")}
              >
                <span suppressHydrationWarning>{t("calendar.modeSolo")}</span>
              </Button>
            </div>
          )}
```

Wrap the existing partner select (the `renderPlayerField("player2", ...)` call and the `availablePlayers.length === 0` notice) in `{mode === "partner" && ( ... )}`, and add the solo branch:

```tsx
          {mode === "solo" && (
            <p className="text-sm text-muted-foreground" suppressHydrationWarning>
              {t("calendar.soloHint")}
            </p>
          )}
```

Replace the footer button with a mode-aware one:

```tsx
        <DialogFooter>
          {mode === "solo" ? (
            <Button onClick={() => registerSoloMutation.mutate()} disabled={registerSoloMutation.isPending}>
              <span suppressHydrationWarning>{t("calendar.register")}</span>
            </Button>
          ) : (
            <Button onClick={() => registerMutation.mutate()} disabled={!canRegister || registerMutation.isPending}>
              <span suppressHydrationWarning>{t("calendar.register")}</span>
            </Button>
          )}
        </DialogFooter>
```

and render `registerSoloMutation`'s error the same way `registerMutation`'s is rendered.

- [ ] **Step 4: Lock out non-managers on a private tournament**

Still in `register-team-dialog.tsx`, import `useAuth` is already present; add the permission import and an early return directly after the existing `if (!user)` block:

```tsx
  if (!canRegisterInOngoingEvent(user, event)) {
    return (
      <Badge variant="secondary" title={t("calendar.privateHint")}>
        <span suppressHydrationWarning>{t("calendar.privateBadge")}</span>
      </Badge>
    );
  }
```

Import `canRegisterInOngoingEvent` from `@/lib/ongoing-permissions` and `Badge` from `@/components/ui/badge`. This sits below the `!user` guard so a logged-out visitor still gets the existing "log in first" tooltip rather than a bare Private badge.

- [ ] **Step 5: Show the pool on the calendar cards**

In `app/calendar/page.tsx`, after the existing `<ol>` of teams:

```tsx
                {event.soloPlayers.length > 0 && (
                  <div className="flex flex-col gap-1 text-sm text-muted-foreground">
                    <span className="text-xs font-medium" suppressHydrationWarning>
                      {t("calendar.soloPool")}
                    </span>
                    {[...event.soloPlayers]
                      .sort((a, b) => b.rating - a.rating)
                      .map((solo) => (
                        <span key={solo.id}>
                          {solo.player.name} <span className="text-foreground">{solo.rating}</span>
                        </span>
                      ))}
                  </div>
                )}
```

`[...event.soloPlayers]` before `.sort()` matters — the array belongs to TanStack Query's cache and sorting it in place mutates cached data.

- [ ] **Step 6: Typecheck, lint and verify in the browser**

Run: `npx tsc --noEmit && npm run lint`

Then, with both servers running and `NEXT_PUBLIC_HOST_URL` pointed at localhost, on `/calendar`:

1. As a logged-in player, register without a partner into the public solo-enabled tournament.
   Expected: the card lists you under "Without a partner" with your rating.
2. Look at the private tournament created in Task 10 while logged in as a non-creator.
   Expected: a "Private" badge instead of the Register button.
3. Log in as the creator and look at the same card.
   Expected: the Register button is back.

---

## Task 12: The entrant cancels their own registration

**Files:**
- Create: `volleyball-management-ui/components/ongoing/cancel-registration-button.tsx`
- Modify: `volleyball-management-ui/app/calendar/page.tsx`
- Modify: `volleyball-management-ui/locales/{en,uk,pl,be}/common.json`

**Interfaces:**
- Consumes: `canCancelOngoingEntry` (Task 9), `API.REMOVE_ONGOING_TEAM`, `API.REMOVE_ONGOING_SOLO`.
- Produces: `export function CancelRegistrationButton({ event }: { event: OngoingOpenEvent })` — renders nothing when the viewer has no cancellable entry.

- [ ] **Step 1: Add the locale keys**

Add to the `calendar` object in all four files:

| key | en | uk | pl | be |
|---|---|---|---|---|
| `cancelRegistration` | `Cancel registration` | `Скасувати реєстрацію` | `Anuluj rejestrację` | `Скасаваць рэгістрацыю` |
| `cancelTeamConfirm` | `Cancel this registration? The whole team is withdrawn.` | `Скасувати реєстрацію? Команда знімається повністю.` | `Anulować rejestrację? Cała drużyna zostanie wycofana.` | `Скасаваць рэгістрацыю? Каманда здымаецца цалкам.` |
| `cancelSoloConfirm` | `Cancel this registration?` | `Скасувати реєстрацію?` | `Anulować rejestrację?` | `Скасаваць рэгістрацыю?` |
| `cancelClosed` | `Registration can no longer be cancelled` | `Реєстрацію вже не можна скасувати` | `Rejestracji nie można już anulować` | `Рэгістрацыю ўжо нельга скасаваць` |

- [ ] **Step 2: Write the component**

Create `components/ongoing/cancel-registration-button.tsx`:

```tsx
"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/providers/auth-provider";
import { canCancelOngoingEntry, isOngoingCancellationOpen } from "@/lib/ongoing-permissions";
import API from "@/lib/api";
import type { OngoingOpenEvent } from "@/lib/types";

interface CancelRegistrationButtonProps {
  event: OngoingOpenEvent;
}

export function CancelRegistrationButton({ event }: CancelRegistrationButtonProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const playerId = user?.playerId ?? null;
  const ownTeam = playerId
    ? event.teams.find((team) => team.player1.id === playerId || team.player2.id === playerId)
    : undefined;
  const ownSolo = playerId ? event.soloPlayers.find((solo) => solo.player.id === playerId) : undefined;

  const cancelMutation = useMutation({
    mutationFn: async () => {
      const url = ownTeam ? API.REMOVE_ONGOING_TEAM(ownTeam.id) : API.REMOVE_ONGOING_SOLO(ownSolo!.id);
      const response = await fetch(url, { method: "DELETE", credentials: "include" });
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: "Request failed" }));
        throw new Error(error.message || `HTTP error! status: ${response.status}`);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ongoing-open"] });
      queryClient.invalidateQueries({ queryKey: ["ongoing-events"] });
      queryClient.invalidateQueries({ queryKey: ["ongoing-event", event.id] });
    },
  });

  if (!ownTeam && !ownSolo) return null;

  const entryPlayerIds = ownTeam ? [ownTeam.player1.id, ownTeam.player2.id] : [ownSolo!.player.id];

  if (!canCancelOngoingEntry(user, event, entryPlayerIds)) {
    return (
      <p className="text-xs text-muted-foreground" suppressHydrationWarning>
        {t("calendar.cancelClosed")}
      </p>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="outline"
        size="sm"
        disabled={cancelMutation.isPending}
        onClick={() => {
          const message = ownTeam ? t("calendar.cancelTeamConfirm") : t("calendar.cancelSoloConfirm");
          if (window.confirm(message)) cancelMutation.mutate();
        }}
      >
        <span suppressHydrationWarning>{t("calendar.cancelRegistration")}</span>
      </Button>
      {cancelMutation.isError && (
        <p className="text-xs text-destructive">{(cancelMutation.error as Error).message}</p>
      )}
    </div>
  );
}
```

`window.confirm` matches how `ongoing-roster-section.tsx` already confirms a team removal; a shadcn dialog here would be a second convention for the same decision.

`isOngoingCancellationOpen` is imported but only used through `canCancelOngoingEntry` — drop the unused import if lint flags it.

- [ ] **Step 3: Mount it on the calendar cards**

In `app/calendar/page.tsx`, replace the single `<RegisterTeamDialog ... />` with a stacked pair:

```tsx
                  <div className="flex flex-col items-end gap-2">
                    <RegisterTeamDialog event={event} players={players} />
                    <CancelRegistrationButton event={event} />
                  </div>
```

Import `CancelRegistrationButton` from `@/components/ongoing/cancel-registration-button`.

- [ ] **Step 4: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`

Expected: both clean.

- [ ] **Step 5: Verify both branches in the browser**

With both servers running:

1. As a player registered in a **future** tournament, click Cancel registration and confirm.
   Expected: the card's team/pool list loses you without a page reload (the three invalidations).
2. Create a tournament dated **today**, register into it, then reload `/calendar`.
   Expected: "Registration can no longer be cancelled" instead of the button.
3. As the tournament's creator, on that same today-dated tournament, use the roster section's
   existing Remove control.
   Expected: it still works — the manager is not bound by the deadline.

---

## Task 13: The solo pool section and the team-formation dialog

**Files:**
- Create: `volleyball-management-ui/components/ongoing/solo-pool-section.tsx`
- Modify: `volleyball-management-ui/components/ongoing/ongoing-roster-section.tsx`
- Modify: `volleyball-management-ui/locales/{en,uk,pl,be}/common.json`

**Interfaces:**
- Consumes: `API.GET_ONGOING_SOLO_PREVIEW`, `API.FORM_ONGOING_TEAMS`, `API.REMOVE_ONGOING_SOLO`, `OngoingSoloPairPreview` (Task 9).
- Produces: `export function SoloPoolSection({ event }: { event: OngoingEvent })`; `rosterSignature` now also covers solo entry ids.

- [ ] **Step 1: Add the locale keys**

Add a `solo` object inside `ongoing.config` in all four files:

`en`:

```json
      "solo": {
        "title": "Registered without a partner",
        "empty": "Nobody is waiting without a partner.",
        "formTeams": "Form teams",
        "previewTitle": "Suggested teams",
        "previewHint": "Strongest is paired with weakest. Swap anyone before confirming.",
        "unpaired": "Left without a partner",
        "oddWarning": "There is an odd number of players — one will stay in the pool.",
        "confirm": "Create these teams",
        "cancel": "Cancel",
        "remove": "Remove"
      }
```

`uk`:

```json
      "solo": {
        "title": "Зареєстровані без пари",
        "empty": "Немає гравців без пари.",
        "formTeams": "Сформувати команди",
        "previewTitle": "Запропоновані команди",
        "previewHint": "Найсильніший стає в пару з найслабшим. Перед підтвердженням можна поміняти будь-кого.",
        "unpaired": "Залишився без пари",
        "oddWarning": "Непарна кількість гравців — один залишиться в пулі.",
        "confirm": "Створити ці команди",
        "cancel": "Скасувати",
        "remove": "Прибрати"
      }
```

`pl`:

```json
      "solo": {
        "title": "Zapisani bez partnera",
        "empty": "Nikt nie czeka bez partnera.",
        "formTeams": "Utwórz drużyny",
        "previewTitle": "Proponowane drużyny",
        "previewHint": "Najsilniejszy trafia w parę z najsłabszym. Przed potwierdzeniem możesz zamienić dowolną osobę.",
        "unpaired": "Został bez partnera",
        "oddWarning": "Nieparzysta liczba graczy — jedna osoba zostanie w puli.",
        "confirm": "Utwórz te drużyny",
        "cancel": "Anuluj",
        "remove": "Usuń"
      }
```

`be`:

```json
      "solo": {
        "title": "Зарэгістраваныя без пары",
        "empty": "Няма гульцоў без пары.",
        "formTeams": "Сфармаваць каманды",
        "previewTitle": "Прапанаваныя каманды",
        "previewHint": "Наймацнейшы становіцца ў пару з найслабейшым. Перад пацвярджэннем можна памяняць любога.",
        "unpaired": "Застаўся без пары",
        "oddWarning": "Няцотная колькасць гульцоў — адзін застанецца ў пуле.",
        "confirm": "Стварыць гэтыя каманды",
        "cancel": "Скасаваць",
        "remove": "Прыбраць"
      }
```

- [ ] **Step 2: Write the section component**

Create `components/ongoing/solo-pool-section.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import API from "@/lib/api";
import type { OngoingEvent, OngoingSoloPairPreview } from "@/lib/types";

interface SoloPoolSectionProps {
  event: OngoingEvent;
  disabled: boolean;
}

interface DraftPair {
  player1Id: string;
  player2Id: string;
}

// The preview arrives as players; the dialog edits ids and looks names back up, so a swap is a
// one-field change rather than a rebuild of the pair objects.
function toDraft(preview: OngoingSoloPairPreview): DraftPair[] {
  return preview.pairs.map((pair) => ({ player1Id: pair.player1.id, player2Id: pair.player2.id }));
}

export function SoloPoolSection({ event, disabled }: SoloPoolSectionProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [draft, setDraft] = useState<DraftPair[]>([]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["ongoing-event", event.id] });
    queryClient.invalidateQueries({ queryKey: ["ongoing-events"] });
    queryClient.invalidateQueries({ queryKey: ["ongoing-open"] });
  };

  const nameOf = (playerId: string) =>
    event.soloPlayers.find((solo) => solo.player.id === playerId)?.player.name ?? playerId;
  const ratingOf = (playerId: string) =>
    event.soloPlayers.find((solo) => solo.player.id === playerId)?.rating ?? 0;

  const previewMutation = useMutation({
    mutationFn: async (): Promise<OngoingSoloPairPreview> => {
      const response = await fetch(API.GET_ONGOING_SOLO_PREVIEW(event.id), { credentials: "include" });
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: "Request failed" }));
        throw new Error(error.message || `HTTP error! status: ${response.status}`);
      }
      return response.json();
    },
    onSuccess: (preview) => {
      setDraft(toDraft(preview));
      setIsPreviewOpen(true);
    },
  });

  const formTeamsMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(API.FORM_ONGOING_TEAMS(event.id), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ teams: draft }),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: "Request failed" }));
        throw new Error(error.message || `HTTP error! status: ${response.status}`);
      }
      return response.json();
    },
    onSuccess: () => {
      setIsPreviewOpen(false);
      setDraft([]);
      invalidate();
    },
  });

  const removeSoloMutation = useMutation({
    mutationFn: async (soloId: string) => {
      const response = await fetch(API.REMOVE_ONGOING_SOLO(soloId), { method: "DELETE", credentials: "include" });
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: "Request failed" }));
        throw new Error(error.message || `HTTP error! status: ${response.status}`);
      }
    },
    onSuccess: invalidate,
  });

  // Every pool member, so a slot's select can offer anyone; the id already placed in the other slot
  // of the same pair is the only exclusion, because the backend rejects a repeated player outright.
  const draftPlayerIds = draft.flatMap((pair) => [pair.player1Id, pair.player2Id]);
  const leftoverIds = event.soloPlayers
    .map((solo) => solo.player.id)
    .filter((playerId) => !draftPlayerIds.includes(playerId));

  const setSlot = (index: number, slot: "player1Id" | "player2Id", playerId: string) => {
    setDraft((previous) =>
      previous.map((pair, pairIndex) => (pairIndex === index ? { ...pair, [slot]: playerId } : pair)),
    );
  };

  const renderSlot = (index: number, slot: "player1Id" | "player2Id") => {
    const pair = draft[index];
    const otherId = slot === "player1Id" ? pair.player2Id : pair.player1Id;

    return (
      <select
        className="h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm"
        value={pair[slot]}
        onChange={(changeEvent) => setSlot(index, slot, changeEvent.target.value)}
      >
        {event.soloPlayers
          .filter((solo) => solo.player.id !== otherId)
          .map((solo) => (
            <option key={solo.id} value={solo.player.id}>
              {solo.player.name} ({solo.rating})
            </option>
          ))}
      </select>
    );
  };

  return (
    <>
      <Card>
        <CardContent className="flex flex-col gap-3 p-4">
          <p className="font-medium" suppressHydrationWarning>
            {t("ongoing.config.solo.title")}
          </p>

          {event.soloPlayers.length === 0 && (
            <p className="text-sm text-muted-foreground" suppressHydrationWarning>
              {t("ongoing.config.solo.empty")}
            </p>
          )}

          {event.soloPlayers.map((solo) => (
            <div key={solo.id} className="flex items-center justify-between gap-2 text-sm">
              <span>
                {solo.player.name} <span className="text-muted-foreground">{solo.rating}</span>
              </span>
              <Button
                variant="destructive"
                size="sm"
                disabled={disabled || removeSoloMutation.isPending}
                onClick={() => removeSoloMutation.mutate(solo.id)}
              >
                <Trash2 className="mr-1 h-3.5 w-3.5" />
                <span suppressHydrationWarning>{t("ongoing.config.solo.remove")}</span>
              </Button>
            </div>
          ))}

          {removeSoloMutation.isError && (
            <p className="text-sm text-destructive">{(removeSoloMutation.error as Error).message}</p>
          )}

          {event.soloPlayers.length >= 2 && (
            <Button
              className="self-start"
              disabled={disabled || previewMutation.isPending}
              onClick={() => previewMutation.mutate()}
            >
              <span suppressHydrationWarning>{t("ongoing.config.solo.formTeams")}</span>
            </Button>
          )}

          {previewMutation.isError && (
            <p className="text-sm text-destructive">{(previewMutation.error as Error).message}</p>
          )}
        </CardContent>
      </Card>

      <Dialog open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle suppressHydrationWarning>{t("ongoing.config.solo.previewTitle")}</DialogTitle>
          </DialogHeader>

          <p className="text-sm text-muted-foreground" suppressHydrationWarning>
            {t("ongoing.config.solo.previewHint")}
          </p>

          <div className="flex flex-col gap-2">
            {draft.map((pair, index) => (
              <div key={index} className="flex items-center gap-2">
                {renderSlot(index, "player1Id")}
                <span className="text-muted-foreground">+</span>
                {renderSlot(index, "player2Id")}
                <span className="w-14 text-right text-sm text-muted-foreground">
                  {ratingOf(pair.player1Id) + ratingOf(pair.player2Id)}
                </span>
              </div>
            ))}
          </div>

          {leftoverIds.length > 0 && (
            <div className="flex flex-col gap-1 rounded-md border border-input p-3 text-sm">
              <span className="text-muted-foreground" suppressHydrationWarning>
                {t("ongoing.config.solo.unpaired")}
              </span>
              {leftoverIds.map((playerId) => (
                <span key={playerId}>{nameOf(playerId)}</span>
              ))}
              <span className="text-xs text-muted-foreground" suppressHydrationWarning>
                {t("ongoing.config.solo.oddWarning")}
              </span>
            </div>
          )}

          {formTeamsMutation.isError && (
            <p className="text-sm text-destructive">{(formTeamsMutation.error as Error).message}</p>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsPreviewOpen(false)}>
              <span suppressHydrationWarning>{t("ongoing.config.solo.cancel")}</span>
            </Button>
            <Button onClick={() => formTeamsMutation.mutate()} disabled={!draft.length || formTeamsMutation.isPending}>
              <span suppressHydrationWarning>{t("ongoing.config.solo.confirm")}</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
```

- [ ] **Step 3: Mount it and widen the roster signature**

In `ongoing-roster-section.tsx`, extend the exported signature helper — a solo registration arriving while an admin has a roster draft open must remount the editor for exactly the reason the existing comment gives:

```tsx
export function rosterSignature(event: OngoingEvent): string {
  return [...event.teams.map((team) => team.id), ...event.soloPlayers.map((solo) => solo.id)].join(",");
}
```

Render the section above the first `<Card>` in the returned fragment:

```tsx
        <SoloPoolSection event={event} disabled={hasStarted} />
```

Import `SoloPoolSection` from `@/components/ongoing/solo-pool-section`.

- [ ] **Step 4: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`

Expected: both clean.

- [ ] **Step 5: Verify the whole flow in the browser**

With both servers running, on a public solo-enabled future tournament, register three players without a partner (log in as each, or add them as the creator), then open the tournament's Config tab.

1. Click "Form teams".
   Expected: one suggested pair of the strongest and the weakest, the third player listed under "Left without a partner" with the odd-count warning.
2. Swap a player between the two slots and confirm.
   Expected: the pool shrinks to the one remaining player and the roster above gains the new team.
3. Reload the page.
   Expected: the same state — proving it persisted rather than only living in the draft.

---

## Task 14: End-to-end verification and deployment note

**Files:** none modified — this task only runs and reports.

**Interfaces:**
- Consumes: everything.
- Produces: nothing.

- [ ] **Step 1: Full backend verification**

Run: `cd /Users/artem/Desktop/projects/volley-app-service && npm run build && npm run test && npm run lint`

Expected: all three succeed. Report the actual test count; do not claim green without the output.

- [ ] **Step 2: Full frontend verification**

Run: `cd /Users/artem/Desktop/projects/volleyball-management-ui && npx tsc --noEmit && npm run lint && npm run build`

Expected: all three succeed. `next build` does not typecheck, which is why `tsc --noEmit` runs first and separately.

- [ ] **Step 3: Confirm every locale key exists in all four files**

Run:

```bash
cd /Users/artem/Desktop/projects/volleyball-management-ui && python3 -c "
import json
keys=set()
data={}
for lng in ['en','uk','pl','be']:
    d=json.load(open(f'locales/{lng}/common.json'))
    tr=d.get('translation',d)
    def walk(node,prefix=''):
        out=set()
        for k,v in node.items():
            p=f'{prefix}{k}'
            out |= walk(v,p+'.') if isinstance(v,dict) else {p}
        return out
    data[lng]=walk(tr)
    keys|=data[lng]
for lng in ['en','uk','pl','be']:
    missing=sorted(keys-data[lng])
    print(lng, 'missing:', missing if missing else 'none')
"
```

Expected: `none` for all four. A missing key falls back to English silently, so nothing else catches this.

- [ ] **Step 4: Confirm the pre-existing behaviour is untouched**

With both servers running, create a tournament leaving both new controls at their defaults, register a pair the old way from `/calendar`, and generate a schedule.

Expected: identical to before this change — public, no solo section shown until the flag is on, and the schedule generates from the roster. The defaults are the whole backwards-compatibility argument; this exercises them.

- [ ] **Step 5: Report what still has to happen on the remote database**

The remote/deployed database has **not** been migrated — Task 1 ran against localhost only. Tell the user, in the completion message, that deploying this needs `npm run prisma:migrate:deploy` against the remote `DATABASE_URL`, and that until then the deployed frontend must not be pointed at the new backend code. Do not run it.

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| Access model (public/private, who may add) | 4 (flags), 5 (solo), 6 (teams), 11 (UI lock-out) |
| Deadlines (registration unchanged, cancellation D-1, manager exempt) | 5 (`isCancellationOpen`, solo), 7 (teams), 9 + 12 (UI) |
| Data model (two columns, `ongoing_solo_players`, cascades) | 1 |
| One-entry invariant | 5 (solo rejects roster members), 6 (`addTeam`/`setTeams` clear the pool), 8 (`form-teams` transaction) |
| `pairByRating`, `effectiveTeamCount` | 2, used in 6 and 8 |
| New endpoints (solo, solo cancel, preview, form-teams) | 5, 8 |
| Changed endpoints (create, updateConfig, addTeam, removeTeam, findOpen, setTeams) | 4, 6, 7 |
| Response shapes (`OngoingSoloPlayerDto`, config flags, `soloPlayers`, `EVENT_INCLUDE`) | 3, 8 |
| Frontend api/types/permissions | 9 |
| Frontend components (create form, config tab, register dialog, calendar, pool section, roster signature) | 10, 11, 12, 13 |
| i18n across four locales | folded into 10, 11, 12, 13; audited in 14 |
| Testing (pairing spec, service spec extensions, FE verification) | 2, 3–8, 14 |
| Deployment (remote migrate) | 14 |

No spec requirement is unassigned.

**Type consistency:** `pairByRating` / `effectiveTeamCount` / `SoloEntry` / `PairedTeam` / `PairingResult` (Task 2) are used under those exact names in Tasks 6 and 8. `mapSoloPlayer`, `OngoingSoloPlayerDto`, `soloPlayers` (Task 3) are consumed unchanged by Tasks 4, 5, 6, 8. `canManage` / `assertCanManage` / `assertOwnEntryOrManager` (Task 5) are reused verbatim in Tasks 6, 7, 8. `AddSoloPlayerDto` / `FormTeamsFromSoloDto` (Task 5) match the controller signatures in Tasks 5 and 8. `OngoingSoloPlayer` / `OngoingSoloPairPreview` / the four `API.*` names (Task 9) match every call site in Tasks 11–13. `rosterSignature` keeps its name and its single-`OngoingEvent` signature.

**Known deliberate omissions:** the frontend has no automated tests (no runner is installed, and adding one is a decision to raise, not to make silently); the remote database is not migrated by this plan.
