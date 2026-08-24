# Tournament Registration + Create Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let anyone register a two-player team into a tournament that has not started, from a new Calendar tab, and let an admin create a tournament — with a date and an initial roster — from a dedicated page.

**Architecture:** Everything hangs off one new concept, the **planning stage**: a tournament with no recorded result. The roster is mutable only during planning. A new additive `POST /ongoing/:id/teams` makes concurrent registrations safe (the existing `PUT` replaces the whole roster and would lose one of two simultaneous writes). One additive column, `ongoing_event_config.max_teams`, caps registrations; the tournament's own date is the deadline.

**Tech Stack:** NestJS 10 + Prisma 4.16 + PostgreSQL + Jest; Next.js App Router + TanStack Query + Tailwind v4 + shadcn/ui + i18next.

**Spec:** `volley-app-service/docs/superpowers/specs/2026-08-23-tournament-registration-design.md`

## Global Constraints

- **Never run a git command** — no `add`, `commit`, `push`, `checkout`, `stash`. Both repos' `CLAUDE.md` forbid it. **Every task ends without a commit step**; that is deliberate. There is uncommitted work from the previous increment in both repos — leave it alone, do not revert or stash it.
- **Backend `tsconfig` targets `es2017` with no `lib` override.** `flatMap`, `toSorted`, `Object.fromEntries` are NOT in the type library and fail `npm run build`. Use `for...of`, `push`, `.sort()` with an explicit comparator. The frontend has `lib: [..., "esnext"]` — `flatMap` is fine **there only**.
- **Backend `strictNullChecks: false`; frontend `strict: true`.**
- Backend Prettier: single quotes, trailing commas, **120-column** print width. Explicit return types on every controller and service method. Guard clauses at the top.
- **Backend has NO global `ValidationPipe`** — `class-validator` decorators are inert. Validate explicitly in the service and throw `BadRequestException` / `NotFoundException` / `ConflictException`. Keep 404 wording in the house format (`Ongoing event with ID ${id} not found`).
- **Backend baseline: `npm run test` is 50/50 across 3 suites and `npm run build` is clean.** Never let either regress.
- **Frontend `npm run lint` is NOT clean and never was.** Verified baseline: exactly **7 errors** (four `no-explicit-any`, three `set-state-in-effect`) in `app/add-results/page.tsx`, `app/events/page.tsx`, `app/events/[id]/page.tsx`, `components/layout-wrapper.tsx`, `components/navigation.tsx`. The gate is **"still exactly 7, none in touched files"**, NOT "clean". Never "fix" the pre-existing seven.
- **Frontend `npx tsc --noEmit` is the only real typecheck** (`next build` sets `ignoreBuildErrors: true`), is currently clean, and must stay clean.
- **Frontend repo rule, verbatim:** *"Derive during render instead of syncing with an effect. `set-state-in-effect` already fires three times in this repo; do not add a fourth."* No `useEffect` that calls `setState`.
- Frontend: every page/component file starts with `'use client'`. New `queryFn`s and mutations **must check `res.ok`, parse the server's JSON `{ message }`, and throw it** — never the bare unchecked `fetch().then(res => res.json())`.
- **Any new UI string goes into all four locale files** (`locales/{en,uk,pl,be}/common.json`), each must still parse as JSON.
- `lib/api.ts` is the single URL registry — never inline a URL in a component.
- **npm only** in the frontend (ignore the stale `pnpm-lock.yaml`). Install nothing — every dependency needed here is already present.
- No test framework exists in the frontend. Do not introduce one; never call anything "tested" there.
- No useless comments — comment only the *why* the code cannot state.
- Paths are relative to `/Users/artem/Desktop/projects/`.

## File Structure

**`volley-app-service/`**

| File | Responsibility |
| --- | --- |
| `prisma/schema.prisma` (modify) | `maxTeams` on `OngoingEventConfig` |
| `src/ongoing/ongoing.service.ts` (modify) | planning guard, shared roster validation, `addTeam`, `removeTeam`, `findOpen`, extended `create`/`updateConfig` |
| `src/ongoing/ongoing.controller.ts` (modify) | three new routes |
| `src/ongoing/dto/*.ts` (modify/create) | `AddOngoingTeamDto`, `OngoingOpenEventDto`, extended create/config DTOs |
| `src/ongoing/ongoing.service.spec.ts` (modify) | tests for all of the above |

**`volleyball-management-ui/`**

| File | Responsibility |
| --- | --- |
| `lib/api.ts`, `lib/types.ts` (modify) | new URLs and types |
| `components/ui/calendar.tsx` (create) | vendored shadcn calendar |
| `components/ongoing/team-roster-editor.tsx` (create) | the pair editor, extracted from the Config tab and reused |
| `components/ongoing/register-team-dialog.tsx` (create) | pick two players, register |
| `app/ongoing/new/page.tsx` (create) | create a tournament |
| `app/calendar/page.tsx` (create) | open tournaments + registration |
| `app/ongoing/page.tsx` (modify) | inline form → "New tournament" button; show date + badge |
| `app/ongoing/[id]/page.tsx` (modify) | show date + badge |
| `components/ongoing/ongoing-config-tab.tsx` (modify) | roster lock, maxTeams, per-team remove, use extracted editor |
| `components/navigation.tsx` (modify) | Calendar nav item |
| `locales/{en,uk,pl,be}/common.json` (modify) | new strings |

---

## Task 1: `maxTeams` column

**Files:**
- Modify: `volley-app-service/prisma/schema.prisma`
- Create: `volley-app-service/prisma/migrations/<timestamp>_add_max_teams/migration.sql` (generated)

**Interfaces:**
- Consumes: the existing `OngoingEventConfig` model
- Produces: `prisma.ongoingEventConfig.maxTeams` — `number | null` in the client, `max_teams` in the DB

- [ ] **Step 1: Confirm the target database**

Run: `grep -n '^DATABASE_URL' volley-app-service/.env`

The active line must be the **localhost** one (`127.0.0.1`). The remote `46.101.180.6` line is commented out and must stay that way. If the active URL is NOT localhost, **stop and ask the user** — do not migrate a shared database.

- [ ] **Step 2: Add the column**

In `prisma/schema.prisma`, inside `model OngoingEventConfig`, after the `courts` field:

```prisma
  maxTeams     Int?   @map("max_teams")
```

- [ ] **Step 3: Create and apply the migration**

```bash
cd volley-app-service && npm run prisma:migrate:dev -- --name add_max_teams
```

Expected: a new migration folder and `Your database is now in sync with your schema.` The migration must be a single additive `ALTER TABLE ... ADD COLUMN`. If Prisma warns about data loss, stop — this is purely additive.

- [ ] **Step 4: Regenerate and verify**

```bash
cd volley-app-service && npm run prisma:generate && npm run build && npm run test
```

Expected: build succeeds, tests stay at 50/50.

---

## Task 2: Planning-stage guard and shared roster validation

**Files:**
- Modify: `volley-app-service/src/ongoing/ongoing.service.ts`
- Test: `volley-app-service/src/ongoing/ongoing.service.spec.ts`

**Interfaces:**
- Consumes: existing `loadEvent`, `EVENT_INCLUDE`
- Produces, for Tasks 3–6:
  - `private async assertPlanning(eventId: string, action: string): Promise<void>` — throws `ConflictException` if any game of that event has a result
  - `private validateTeamPairs(pairs: Array<{player1Id: string; player2Id: string}>): string[]` — throws on structural problems, returns the flat list of player ids
  - `private async assertPlayersExist(playerIds: string[]): Promise<void>` — throws `NotFoundException` for the first unknown id

- [ ] **Step 1: Write the failing tests**

Append inside the outer `describe('OngoingService', ...)` in `src/ongoing/ongoing.service.spec.ts`:

```ts
  describe('OngoingService.setTeams planning guard', () => {
    it('refuses to replace the roster once any match has a result', async () => {
      prisma.ongoingGame.count = jest.fn(async () => 1);

      await expect(
        service.setTeams('event-1', { teams: [{ player1Id: 'p1', player2Id: 'p2' }] }),
      ).rejects.toThrow(new ConflictException('The tournament has already started; its roster is locked'));
    });

    it('counts only games that carry a result when deciding whether the tournament started', async () => {
      prisma.ongoingGame.count = jest.fn(async () => 0);
      prisma.player.findMany = jest.fn(async () => [{ id: 'p1' }, { id: 'p2' }] as any);

      await service.setTeams('event-1', { teams: [{ player1Id: 'p1', player2Id: 'p2' }] });

      expect(prisma.ongoingGame.count).toHaveBeenCalledWith({
        where: { eventId: 'event-1', NOT: { team1Points: null } },
      });
    });

    it('does not touch the roster when the guard rejects', async () => {
      prisma.ongoingGame.count = jest.fn(async () => 2);

      await expect(service.setTeams('event-1', { teams: [] })).rejects.toThrow(ConflictException);
      expect(prisma.ongoingTeam.deleteMany).not.toHaveBeenCalled();
      expect(prisma.ongoingGame.deleteMany).not.toHaveBeenCalled();
    });
  });
```

Extend the spec's `@nestjs/common` import to include `ConflictException`, and add `count: jest.fn(async () => 0)` to `ongoingGame` in `buildPrismaMock()` so every existing test still passes.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd volley-app-service && npx jest src/ongoing/ongoing.service.spec.ts`
Expected: the three new tests FAIL (no guard yet); the existing tests still pass.

- [ ] **Step 3: Add the helpers and wire the guard**

Add `ConflictException` to the `@nestjs/common` import in `ongoing.service.ts`. Add these private methods:

```ts
  // "Started" means a recorded result, not a generated fixture — an unplayed schedule is still planning.
  private async assertPlanning(eventId: string): Promise<void> {
    const played = await this.prisma.ongoingGame.count({
      where: { eventId, NOT: { team1Points: null } },
    });

    if (played) {
      throw new ConflictException('The tournament has already started; its roster is locked');
    }
  }

  private validateTeamPairs(pairs: Array<{ player1Id: string; player2Id: string }>): string[] {
    const seen = new Set<string>();

    for (const pair of pairs) {
      if (!pair || !pair.player1Id || !pair.player2Id) {
        throw new BadRequestException('A team must include both player1Id and player2Id');
      }
      if (pair.player1Id === pair.player2Id) {
        throw new BadRequestException('A team must have two different players');
      }
      for (const playerId of [pair.player1Id, pair.player2Id]) {
        if (seen.has(playerId)) {
          throw new BadRequestException(`Player ${playerId} is already in another team`);
        }
        seen.add(playerId);
      }
    }

    return Array.from(seen);
  }

  private async assertPlayersExist(playerIds: string[]): Promise<void> {
    if (!playerIds.length) return;

    const existing = await this.prisma.player.findMany({
      where: { id: { in: playerIds } },
      select: { id: true },
    });
    const existingIds = new Set(existing.map((player) => player.id));

    for (const playerId of playerIds) {
      if (!existingIds.has(playerId)) {
        throw new NotFoundException(`Player with ID ${playerId} not found`);
      }
    }
  }
```

Now rewrite the body of `setTeams` to use them, keeping its existing behaviour otherwise. The order matters — load, structural validation, planning guard, existence check, write:

```ts
  async setTeams(id: string, setOngoingTeamsDto: SetOngoingTeamsDto): Promise<OngoingEventResponseDto> {
    await this.loadEvent(id);

    if (!setOngoingTeamsDto || !Array.isArray(setOngoingTeamsDto.teams)) {
      throw new BadRequestException('teams must be an array');
    }

    const teams = setOngoingTeamsDto.teams;
    const playerIds = this.validateTeamPairs(teams);

    await this.assertPlanning(id);
    await this.assertPlayersExist(playerIds);

    await this.prisma.$transaction(async (tx) => {
      // Fixtures reference teams, so they go first — replacing the roster invalidates the schedule.
      await tx.ongoingGame.deleteMany({ where: { eventId: id } });
      await tx.ongoingTeam.deleteMany({ where: { eventId: id } });

      if (teams.length) {
        await tx.ongoingTeam.createMany({
          data: teams.map((team) => ({ eventId: id, player1Id: team.player1Id, player2Id: team.player2Id })),
        });
      }
    });

    return this.loadEvent(id);
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd volley-app-service && npx jest src/ongoing/ongoing.service.spec.ts`
Expected: all tests pass, including every pre-existing one. If an older `setTeams` test now fails because the mock lacks `ongoingGame.count`, fix the mock — not the assertion.

- [ ] **Step 5: Full suite and build**

```bash
cd volley-app-service && npm run test && npm run build
```

Expected: all suites green, build clean.

---

## Task 3: `POST /ongoing/:id/teams` — register one team

**Files:**
- Create: `volley-app-service/src/ongoing/dto/add-ongoing-team.dto.ts`
- Modify: `volley-app-service/src/ongoing/ongoing.service.ts`, `ongoing.controller.ts`
- Test: `volley-app-service/src/ongoing/ongoing.service.spec.ts`

**Interfaces:**
- Consumes: `assertPlanning`, `validateTeamPairs`, `assertPlayersExist`, `loadEvent` from Task 2
- Produces:
  - `AddOngoingTeamDto { player1Id: string; player2Id: string }`
  - `OngoingService.addTeam(id: string, dto: AddOngoingTeamDto): Promise<OngoingEventResponseDto>`
  - `POST /ongoing/:id/teams`

- [ ] **Step 1: Write the DTO**

`src/ongoing/dto/add-ongoing-team.dto.ts`:

```ts
import { IsString } from 'class-validator';

export class AddOngoingTeamDto {
  @IsString()
  player1Id: string;

  @IsString()
  player2Id: string;
}
```

- [ ] **Step 2: Write the failing tests**

Append inside the outer `describe('OngoingService', ...)`:

```ts
  describe('OngoingService.addTeam', () => {
    const OPEN_EVENT = {
      ...EVENT_ROW,
      date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      config: { gamesPerPair: 1, courts: 2, maxTeams: null },
      teams: [{ id: 't1', player1: { id: 'p1', name: 'A' }, player2: { id: 'p2', name: 'B' } }],
    };

    beforeEach(() => {
      prisma.ongoingEvent.findUnique = jest.fn(async () => OPEN_EVENT as any);
      prisma.ongoingGame.count = jest.fn(async () => 0);
      prisma.player.findMany = jest.fn(async () => [{ id: 'p3' }, { id: 'p4' }] as any);
      prisma.ongoingTeam.create = jest.fn(async () => ({ id: 't2' }));
    });

    it('appends the team without touching the existing roster', async () => {
      await service.addTeam('event-1', { player1Id: 'p3', player2Id: 'p4' });

      expect(prisma.ongoingTeam.create).toHaveBeenCalledWith({
        data: { eventId: 'event-1', player1Id: 'p3', player2Id: 'p4' },
      });
      expect(prisma.ongoingTeam.deleteMany).not.toHaveBeenCalled();
      expect(prisma.ongoingGame.deleteMany).not.toHaveBeenCalled();
    });

    it('refuses once the tournament has started', async () => {
      prisma.ongoingGame.count = jest.fn(async () => 1);

      await expect(service.addTeam('event-1', { player1Id: 'p3', player2Id: 'p4' })).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.ongoingTeam.create).not.toHaveBeenCalled();
    });

    it('refuses once the tournament date has passed', async () => {
      prisma.ongoingEvent.findUnique = jest.fn(async () => ({
        ...OPEN_EVENT,
        date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      }) as any);

      await expect(service.addTeam('event-1', { player1Id: 'p3', player2Id: 'p4' })).rejects.toThrow(
        new ConflictException('Registration for this tournament has closed'),
      );
    });

    it('refuses when the tournament is full', async () => {
      prisma.ongoingEvent.findUnique = jest.fn(async () => ({
        ...OPEN_EVENT,
        config: { gamesPerPair: 1, courts: 2, maxTeams: 1 },
      }) as any);

      await expect(service.addTeam('event-1', { player1Id: 'p3', player2Id: 'p4' })).rejects.toThrow(
        new ConflictException('This tournament is full'),
      );
    });

    it('refuses a player who is already in a team of this tournament', async () => {
      await expect(service.addTeam('event-1', { player1Id: 'p1', player2Id: 'p3' })).rejects.toThrow(
        new BadRequestException('Player p1 is already in another team'),
      );
      expect(prisma.ongoingTeam.create).not.toHaveBeenCalled();
    });

    it('refuses two identical players', async () => {
      await expect(service.addTeam('event-1', { player1Id: 'p3', player2Id: 'p3' })).rejects.toThrow(
        new BadRequestException('A team must have two different players'),
      );
    });

    it('refuses an unknown player', async () => {
      prisma.player.findMany = jest.fn(async () => [{ id: 'p3' }] as any);

      await expect(service.addTeam('event-1', { player1Id: 'p3', player2Id: 'ghost' })).rejects.toThrow(
        new NotFoundException('Player with ID ghost not found'),
      );
    });
  });
```

Add `create: jest.fn(async () => ({ id: 't2' }))` to `ongoingTeam` in `buildPrismaMock()`.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd volley-app-service && npx jest src/ongoing/ongoing.service.spec.ts`
Expected: FAIL — `service.addTeam is not a function`.

- [ ] **Step 4: Write the implementation**

Import the DTO, then add after `setTeams`:

```ts
  async addTeam(id: string, addOngoingTeamDto: AddOngoingTeamDto): Promise<OngoingEventResponseDto> {
    const event = await this.loadEvent(id);

    if (!addOngoingTeamDto) {
      throw new BadRequestException('player1Id and player2Id are required');
    }

    const { player1Id, player2Id } = addOngoingTeamDto;

    // Validate the newcomer against the whole roster at once, so "already in another team" covers
    // both the incoming pair and everyone registered before it.
    const existingPairs = event.teams.map((team) => ({
      player1Id: team.player1.id,
      player2Id: team.player2.id,
    }));
    this.validateTeamPairs([...existingPairs, { player1Id, player2Id }]);

    await this.assertPlanning(id);

    if (!this.isRegistrationDateOpen(event.date)) {
      throw new ConflictException('Registration for this tournament has closed');
    }
    if (event.config.maxTeams !== null && event.teams.length >= event.config.maxTeams) {
      throw new ConflictException('This tournament is full');
    }

    await this.assertPlayersExist([player1Id, player2Id]);

    await this.prisma.ongoingTeam.create({ data: { eventId: id, player1Id, player2Id } });

    return this.loadEvent(id);
  }

  // The tournament's own date is the deadline: registration stays open through the whole of that day.
  private isRegistrationDateOpen(date: Date): boolean {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    return new Date(date).getTime() >= startOfToday.getTime();
  }
```

Note the ordering: structural validation runs before the planning guard so that a malformed pair is a 400 rather than a 409, matching how `setTeams` behaves.

- [ ] **Step 5: Add the controller route**

In `ongoing.controller.ts`, import `AddOngoingTeamDto` and add **above** `@Get(':id')`:

```ts
  @Post(':id/teams')
  @HttpCode(HttpStatus.CREATED)
  async addTeam(
    @Param('id') id: string,
    @Body() addOngoingTeamDto: AddOngoingTeamDto,
  ): Promise<OngoingEventResponseDto> {
    return this.ongoingService.addTeam(id, addOngoingTeamDto);
  }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd volley-app-service && npx jest src/ongoing/ongoing.service.spec.ts`
Expected: PASS, including all pre-existing tests.

- [ ] **Step 7: Build**

Run: `cd volley-app-service && npm run test && npm run build`
Expected: all green.

---

## Task 4: `DELETE /ongoing/teams/:teamId` — admin removes a team

**Files:**
- Modify: `volley-app-service/src/ongoing/ongoing.service.ts`, `ongoing.controller.ts`
- Test: `volley-app-service/src/ongoing/ongoing.service.spec.ts`

**Interfaces:**
- Consumes: `assertPlanning`, `loadEvent`
- Produces: `OngoingService.removeTeam(teamId: string): Promise<OngoingEventResponseDto>`; `DELETE /ongoing/teams/:teamId`

- [ ] **Step 1: Write the failing tests**

Append inside the outer `describe('OngoingService', ...)`:

```ts
  describe('OngoingService.removeTeam', () => {
    beforeEach(() => {
      prisma.ongoingTeam.findUnique = jest.fn(async () => ({ id: 't1', eventId: 'event-1' }) as any);
      prisma.ongoingTeam.delete = jest.fn(async () => ({ id: 't1' }));
      prisma.ongoingGame.count = jest.fn(async () => 0);
    });

    it('throws a 404 naming the id when the team does not exist', async () => {
      prisma.ongoingTeam.findUnique = jest.fn(async () => null as any);

      await expect(service.removeTeam('missing')).rejects.toThrow(
        new NotFoundException('Ongoing team with ID missing not found'),
      );
    });

    it('refuses once the tournament has started', async () => {
      prisma.ongoingGame.count = jest.fn(async () => 1);

      await expect(service.removeTeam('t1')).rejects.toThrow(ConflictException);
      expect(prisma.ongoingTeam.delete).not.toHaveBeenCalled();
    });

    it('deletes the team, letting the FK cascade take its unplayed fixtures', async () => {
      await service.removeTeam('t1');

      expect(prisma.ongoingTeam.delete).toHaveBeenCalledWith({ where: { id: 't1' } });
    });

    it('checks the planning stage of the team OWN event', async () => {
      await service.removeTeam('t1');

      expect(prisma.ongoingGame.count).toHaveBeenCalledWith({
        where: { eventId: 'event-1', NOT: { team1Points: null } },
      });
    });
  });
```

Add `findUnique: jest.fn(async () => null as any)` and `delete: jest.fn(async () => ({}))` to `ongoingTeam` in `buildPrismaMock()`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd volley-app-service && npx jest src/ongoing/ongoing.service.spec.ts`
Expected: FAIL — `service.removeTeam is not a function`.

- [ ] **Step 3: Write the implementation**

Add after `addTeam`:

```ts
  async removeTeam(teamId: string): Promise<OngoingEventResponseDto> {
    const team = await this.prisma.ongoingTeam.findUnique({ where: { id: teamId } });

    if (!team) {
      throw new NotFoundException(`Ongoing team with ID ${teamId} not found`);
    }

    await this.assertPlanning(team.eventId);

    // ongoing_games -> ongoing_teams is ON DELETE CASCADE, and in planning every fixture is unplayed,
    // so the cascade cannot destroy a recorded result.
    await this.prisma.ongoingTeam.delete({ where: { id: teamId } });

    return this.loadEvent(team.eventId);
  }
```

- [ ] **Step 4: Add the controller route**

In `ongoing.controller.ts`, add **above** `@Get(':id')` and `@Delete(':id')`:

```ts
  @Delete('teams/:teamId')
  async removeTeam(@Param('teamId') teamId: string): Promise<OngoingEventResponseDto> {
    return this.ongoingService.removeTeam(teamId);
  }
```

`DELETE teams/:teamId` has two path segments and `DELETE :id` has one, so they cannot collide — but keep the specific route first regardless.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd volley-app-service && npx jest src/ongoing/ongoing.service.spec.ts`
Expected: PASS.

- [ ] **Step 6: Build**

Run: `cd volley-app-service && npm run test && npm run build`

---

## Task 5: `GET /ongoing/open` — tournaments accepting registrations

**Files:**
- Modify: `volley-app-service/src/ongoing/dto/ongoing-event-response.dto.ts`, `ongoing.service.ts`, `ongoing.controller.ts`
- Test: `volley-app-service/src/ongoing/ongoing.service.spec.ts`

**Interfaces:**
- Consumes: `mapTeam`, `isRegistrationDateOpen`
- Produces:
  - `OngoingOpenEventDto { id, name, date, maxTeams: number | null, teamsCount: number, teams: OngoingTeamResponseDto[] }`
  - `OngoingService.findOpen(): Promise<OngoingOpenEventDto[]>`; `GET /ongoing/open`

- [ ] **Step 1: Add the response DTO**

Append to `src/ongoing/dto/ongoing-event-response.dto.ts`:

```ts
export class OngoingOpenEventDto {
  id: string;
  name: string;
  date: Date;
  maxTeams: number | null;
  teamsCount: number;
  teams: OngoingTeamResponseDto[];
}
```

- [ ] **Step 2: Write the failing tests**

Append inside the outer `describe('OngoingService', ...)`:

```ts
  describe('OngoingService.findOpen', () => {
    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const past = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const team = { id: 't1', player1: { id: 'p1', name: 'A' }, player2: { id: 'p2', name: 'B' } };

    const row = (over: any) => ({
      id: 'e',
      name: 'n',
      date: future,
      config: { gamesPerPair: 1, courts: 1, maxTeams: null },
      teams: [team],
      games: [],
      ...over,
    });

    it('excludes a tournament whose date has passed', async () => {
      prisma.ongoingEvent.findMany = jest.fn(async () => [row({ date: past })] as any);

      expect(await service.findOpen()).toEqual([]);
    });

    it('excludes a tournament that has a recorded result', async () => {
      prisma.ongoingEvent.findMany = jest.fn(async () => [
        row({ games: [{ team1Points: 15, team2Points: 7 }] }),
      ] as any);

      expect(await service.findOpen()).toEqual([]);
    });

    it('includes a tournament whose fixtures exist but are all unplayed', async () => {
      prisma.ongoingEvent.findMany = jest.fn(async () => [
        row({ games: [{ team1Points: null, team2Points: null }] }),
      ] as any);

      expect(await service.findOpen()).toHaveLength(1);
    });

    it('excludes a tournament that is full', async () => {
      prisma.ongoingEvent.findMany = jest.fn(async () => [
        row({ config: { gamesPerPair: 1, courts: 1, maxTeams: 1 } }),
      ] as any);

      expect(await service.findOpen()).toEqual([]);
    });

    it('returns each open tournament with its roster and counts', async () => {
      prisma.ongoingEvent.findMany = jest.fn(async () => [row({})] as any);

      const result = await service.findOpen();

      expect(result).toHaveLength(1);
      expect(result[0].teamsCount).toBe(1);
      expect(result[0].maxTeams).toBeNull();
      expect(result[0].teams[0].player1.name).toBe('A');
    });

    it('orders soonest first', async () => {
      await service.findOpen();

      const args = (prisma.ongoingEvent.findMany as jest.Mock).mock.calls[0][0];
      expect(args.orderBy).toEqual({ date: 'asc' });
    });
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd volley-app-service && npx jest src/ongoing/ongoing.service.spec.ts`
Expected: FAIL — `service.findOpen is not a function`.

- [ ] **Step 4: Write the implementation**

Import `OngoingOpenEventDto` and add:

```ts
  async findOpen(): Promise<OngoingOpenEventDto[]> {
    const events = await this.prisma.ongoingEvent.findMany({
      orderBy: { date: 'asc' },
      include: EVENT_INCLUDE,
    });

    const open: OngoingOpenEventDto[] = [];

    for (const event of events) {
      const hasResult = event.games.some((game) => game.team1Points !== null && game.team2Points !== null);
      if (hasResult) continue;
      if (!this.isRegistrationDateOpen(event.date)) continue;

      const maxTeams = event.config ? event.config.maxTeams : null;
      if (maxTeams !== null && maxTeams !== undefined && event.teams.length >= maxTeams) continue;

      open.push({
        id: event.id,
        name: event.name,
        date: event.date,
        maxTeams: maxTeams === undefined ? null : maxTeams,
        teamsCount: event.teams.length,
        teams: event.teams.map((team) => this.mapTeam(team)),
      });
    }

    return open;
  }
```

- [ ] **Step 5: Add the controller route**

In `ongoing.controller.ts`, import `OngoingOpenEventDto` and add this handler **above** `@Get(':id')` — otherwise `/ongoing/open` is captured by the `:id` route and returns a 404 for an event named "open":

```ts
  @Get('open')
  async findOpen(): Promise<OngoingOpenEventDto[]> {
    return this.ongoingService.findOpen();
  }
```

- [ ] **Step 6: Run the tests to verify they pass, then build**

```bash
cd volley-app-service && npx jest src/ongoing/ongoing.service.spec.ts && npm run test && npm run build
```

- [ ] **Step 7: Prove the route-ordering trap is actually avoided**

Start the server (`npm run start:dev`), then:

```bash
curl -s -o /dev/null -w "GET /ongoing/open -> %{http_code}\n" localhost:3000/ongoing/open
```

Expected: `200`, not `404`. A 404 means the handler was declared below `@Get(':id')`. Stop the server afterwards.

---

## Task 6: `maxTeams` in config, and an inline roster on create

**Files:**
- Modify: `volley-app-service/src/ongoing/dto/create-ongoing-event.dto.ts`, `update-ongoing-config.dto.ts`, `ongoing.service.ts`
- Test: `volley-app-service/src/ongoing/ongoing.service.spec.ts`

**Interfaces:**
- Consumes: `validateTeamPairs`, `assertPlayersExist`
- Produces: `CreateOngoingEventDto` gains optional `teams` and `maxTeams`; `UpdateOngoingConfigDto` gains optional `maxTeams`

- [ ] **Step 1: Extend the DTOs**

`create-ongoing-event.dto.ts`:

```ts
import { IsString, IsDateString, IsOptional, IsArray, IsInt } from 'class-validator';

export class CreateOngoingEventDto {
  @IsString()
  name: string;

  @IsDateString()
  date: string;

  @IsOptional()
  @IsArray()
  teams?: Array<{ player1Id: string; player2Id: string }>;

  @IsOptional()
  @IsInt()
  maxTeams?: number;
}
```

`update-ongoing-config.dto.ts` — add:

```ts
  @IsOptional()
  @IsInt()
  maxTeams?: number;
```

- [ ] **Step 2: Write the failing tests**

Append inside the outer `describe('OngoingService', ...)`:

```ts
  describe('OngoingService.create with a roster', () => {
    beforeEach(() => {
      prisma.player.findMany = jest.fn(async () => [{ id: 'p1' }, { id: 'p2' }] as any);
    });

    it('creates the event, its config and the roster in one call', async () => {
      await service.create({
        name: 'T',
        date: '2030-01-01T10:00:00.000Z',
        maxTeams: 8,
        teams: [{ player1Id: 'p1', player2Id: 'p2' }],
      });

      const args = (prisma.ongoingEvent.create as jest.Mock).mock.calls[0][0];
      expect(args.data.config.create).toEqual({ gamesPerPair: 1, courts: 1, maxTeams: 8 });
      expect(args.data.teams.create).toEqual([{ player1Id: 'p1', player2Id: 'p2' }]);
    });

    it('rejects an unknown player before creating anything', async () => {
      prisma.player.findMany = jest.fn(async () => [] as any);

      await expect(
        service.create({ name: 'T', date: '2030-01-01T10:00:00.000Z', teams: [{ player1Id: 'p1', player2Id: 'p2' }] }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.ongoingEvent.create).not.toHaveBeenCalled();
    });

    it('still creates a tournament with no roster at all', async () => {
      await service.create({ name: 'T', date: '2030-01-01T10:00:00.000Z' });

      const args = (prisma.ongoingEvent.create as jest.Mock).mock.calls[0][0];
      expect(args.data.teams).toBeUndefined();
      expect(args.data.config.create.maxTeams).toBeNull();
    });
  });

  describe('OngoingService.updateConfig maxTeams', () => {
    it('rejects a maxTeams below two', async () => {
      await expect(service.updateConfig('event-1', { gamesPerPair: 1, courts: 1, maxTeams: 1 })).rejects.toThrow(
        new BadRequestException('maxTeams must be at least 2'),
      );
    });

    it('rejects a maxTeams below the number of teams already registered', async () => {
      prisma.ongoingEvent.findUnique = jest.fn(async () => ({
        ...EVENT_ROW,
        teams: [
          { id: 'a', player1: { id: '1', name: 'x' }, player2: { id: '2', name: 'y' } },
          { id: 'b', player1: { id: '3', name: 'z' }, player2: { id: '4', name: 'w' } },
          { id: 'c', player1: { id: '5', name: 'q' }, player2: { id: '6', name: 'r' } },
        ],
      }) as any);

      await expect(service.updateConfig('event-1', { gamesPerPair: 1, courts: 1, maxTeams: 2 })).rejects.toThrow(
        new BadRequestException('maxTeams cannot be lower than the number of registered teams'),
      );
    });

    it('accepts an absent maxTeams as unlimited', async () => {
      await service.updateConfig('event-1', { gamesPerPair: 1, courts: 1 });

      const args = (prisma.ongoingEventConfig.upsert as jest.Mock).mock.calls[0][0];
      expect(args.update.maxTeams).toBeNull();
    });
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd volley-app-service && npx jest src/ongoing/ongoing.service.spec.ts`

- [ ] **Step 4: Extend `create`**

In `create`, after the existing name/date validation and before the Prisma call:

```ts
    const teams = createOngoingEventDto.teams;

    if (teams !== undefined && !Array.isArray(teams)) {
      throw new BadRequestException('teams must be an array');
    }

    const maxTeams = this.normaliseMaxTeams(createOngoingEventDto.maxTeams, teams ? teams.length : 0);

    if (teams && teams.length) {
      const playerIds = this.validateTeamPairs(teams);
      await this.assertPlayersExist(playerIds);
    }
```

Then build the create payload so event, config and roster land in one write:

```ts
    const data: any = {
      name,
      date: parsedDate,
      config: { create: { gamesPerPair: 1, courts: 1, maxTeams } },
    };

    if (teams && teams.length) {
      data.teams = {
        create: teams.map((team) => ({ player1Id: team.player1Id, player2Id: team.player2Id })),
      };
    }

    const event = await this.prisma.ongoingEvent.create({ data, include: EVENT_INCLUDE });

    return this.mapEvent(event);
```

Add the shared bounds helper:

```ts
  private normaliseMaxTeams(value: number | undefined | null, currentTeamCount: number): number | null {
    if (value === undefined || value === null) return null;
    if (!Number.isInteger(value) || value < 2) {
      throw new BadRequestException('maxTeams must be at least 2');
    }
    if (value < currentTeamCount) {
      throw new BadRequestException('maxTeams cannot be lower than the number of registered teams');
    }

    return value;
  }
```

- [ ] **Step 5: Extend `updateConfig`**

In `updateConfig`, after the existing `gamesPerPair`/`courts` guards, replace the load-and-upsert section with:

```ts
    const event = await this.loadEvent(id);
    const maxTeams = this.normaliseMaxTeams(updateOngoingConfigDto.maxTeams, event.teams.length);

    await this.prisma.ongoingEventConfig.upsert({
      where: { eventId: id },
      create: { eventId: id, gamesPerPair, courts, maxTeams },
      update: { gamesPerPair, courts, maxTeams },
    });

    return this.loadEvent(id);
```

Note this makes an omitted `maxTeams` mean "unlimited", not "leave unchanged" — the config form always submits the whole config, so there is one meaning per request.

- [ ] **Step 6: Surface `maxTeams` in the response** — **ALREADY DONE IN TASK 3.** The `maxTeams` field on `OngoingEventConfigResponseDto` and its mapping in `mapEvent` were pulled forward into Task 3, because Task 3's "tournament full" guard reads `event.config.maxTeams` and was dead code without it. Verify it is present and correct; do not duplicate it.

In `mapEvent`, extend the config mapping:

```ts
      config: {
        gamesPerPair: event.config ? event.config.gamesPerPair : 1,
        courts: event.config ? event.config.courts : 1,
        maxTeams: event.config && event.config.maxTeams !== undefined ? event.config.maxTeams : null,
      },
```

and add `maxTeams: number | null;` to `OngoingEventConfigResponseDto`.

- [ ] **Step 7: Run the tests and build**

```bash
cd volley-app-service && npx jest src/ongoing/ongoing.service.spec.ts && npm run test && npm run build
```

- [ ] **Step 8: Live smoke test of the whole registration flow**

Start `npm run start:dev`. Using two real player ids from `curl -s localhost:3000/players`:

```bash
curl -s -X POST localhost:3000/ongoing -H 'Content-Type: application/json' -d '{"name":"Reg smoke","date":"2030-06-01T10:00:00.000Z","maxTeams":2}'
curl -s localhost:3000/ongoing/open
curl -s -X POST localhost:3000/ongoing/<id>/teams -H 'Content-Type: application/json' -d '{"player1Id":"<p1>","player2Id":"<p2>"}'
```

Expected: the tournament appears in `/ongoing/open` with `teamsCount: 0`, then `teamsCount: 1` after the registration. Register a second team, then confirm a **third** attempt returns `409 This tournament is full` and that the tournament has disappeared from `/ongoing/open`. Delete the smoke-test tournament and stop the server.

---

## Task 7: Frontend types, URLs, and the calendar primitive

**Files:**
- Modify: `volleyball-management-ui/lib/api.ts`, `lib/types.ts`
- Create: `volleyball-management-ui/components/ui/calendar.tsx`

**Interfaces:**
- Produces:
  - `API.GET_OPEN_ONGOING_EVENTS`, `API.ADD_ONGOING_TEAM(id)`, `API.REMOVE_ONGOING_TEAM(teamId)`
  - Types `OngoingOpenEvent`; `OngoingEventConfig` gains `maxTeams: number | null`
  - `<Calendar />` from `@/components/ui/calendar`

- [ ] **Step 1: Add the endpoint URLs**

In `lib/api.ts`, inside the `API` object:

```ts
  GET_OPEN_ONGOING_EVENTS: `${process.env.NEXT_PUBLIC_HOST_URL}/ongoing/open`,
  ADD_ONGOING_TEAM: (id: string) => `${process.env.NEXT_PUBLIC_HOST_URL}/ongoing/${id}/teams`,
  REMOVE_ONGOING_TEAM: (teamId: string) => `${process.env.NEXT_PUBLIC_HOST_URL}/ongoing/teams/${teamId}`,
```

- [ ] **Step 2: Add and extend the types**

In `lib/types.ts`, add `maxTeams: number | null;` to `OngoingEventConfig`, and append:

```ts
export interface OngoingOpenEvent {
  id: string;
  name: string;
  date: string;
  maxTeams: number | null;
  teamsCount: number;
  teams: OngoingTeam[];
}
```

- [ ] **Step 3: Vendor the calendar primitive**

Create `components/ui/calendar.tsx`. `react-day-picker@9.8` and `date-fns@4.1` are already installed — **install nothing**. Note v9 renamed the classNames API from v8; use the v9 names below.

```tsx
"use client";

import * as React from "react";
import { DayPicker } from "react-day-picker";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

export function Calendar({ className, classNames, showOutsideDays = true, ...props }: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-3", className)}
      classNames={{
        months: "flex flex-col sm:flex-row gap-4",
        month: "flex flex-col gap-4",
        month_caption: "flex justify-center pt-1 relative items-center",
        caption_label: "text-sm font-medium",
        nav: "flex items-center gap-1",
        button_previous:
          "absolute left-1 inline-flex h-7 w-7 items-center justify-center rounded-md opacity-50 hover:opacity-100",
        button_next:
          "absolute right-1 inline-flex h-7 w-7 items-center justify-center rounded-md opacity-50 hover:opacity-100",
        month_grid: "w-full border-collapse space-y-1",
        weekdays: "flex",
        weekday: "text-muted-foreground rounded-md w-9 font-normal text-[0.8rem]",
        week: "flex w-full mt-2",
        day: "h-9 w-9 text-center text-sm p-0 relative",
        day_button:
          "inline-flex h-9 w-9 items-center justify-center rounded-md p-0 font-normal hover:bg-secondary",
        selected: "bg-primary text-primary-foreground rounded-md",
        today: "bg-secondary text-foreground rounded-md",
        outside: "text-muted-foreground opacity-50",
        disabled: "text-muted-foreground opacity-50",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, ...rest }) =>
          orientation === "left" ? <ChevronLeft className="h-4 w-4" {...rest} /> : <ChevronRight className="h-4 w-4" {...rest} />,
      }}
      {...props}
    />
  );
}
```

- [ ] **Step 4: Verify the primitive typechecks against the installed version**

```bash
cd volleyball-management-ui && npx tsc --noEmit && npm run lint
```

Expected: `tsc` clean; lint exactly 7 errors, none in `components/ui/calendar.tsx`. If `tsc` rejects a `classNames` key or the `Chevron` component signature, the installed `react-day-picker` major differs from what this code assumes — check `node_modules/react-day-picker/package.json` for the real version and adjust the class keys to that version's API rather than guessing. Report exactly what you changed.

---

## Task 8: Extract the roster editor (pure refactor)

**Files:**
- Create: `volleyball-management-ui/components/ongoing/team-roster-editor.tsx`
- Modify: `volleyball-management-ui/components/ongoing/ongoing-config-tab.tsx`

**Interfaces:**
- Produces:
```ts
export interface TeamDraft { player1Id: string; player2Id: string }
interface TeamRosterEditorProps {
  teams: TeamDraft[];
  players: Player[];
  onChange: (teams: TeamDraft[]) => void;
  disabled?: boolean;
}
export function TeamRosterEditor(props: TeamRosterEditorProps)
```
Task 9 (create page) and the Config tab both render it.

- [ ] **Step 1: Create the component**

Move the pair-editor markup out of `ongoing-config-tab.tsx` verbatim: the rows of two player `<select>`s, the remove button, the "Add team" button, and the `takenPlayerIds` filter that keeps each row's own current selection selectable. It owns no state — the parent holds `teams` and passes `onChange`. Keep the functional-updater style when the parent computes the next value.

The `disabled` prop renders the roster read-only (no selects, no add/remove buttons, just the team names) — Task 10 uses it to lock the roster once the tournament has started.

- [ ] **Step 2: Use it from the Config tab**

Replace the inlined editor in `ongoing-config-tab.tsx` with `<TeamRosterEditor teams={teams} players={players} onChange={setTeams} />`. **This step must not change any behaviour** — same markup, same validation messages, same disabled conditions on Save teams.

- [ ] **Step 3: Verify nothing changed**

```bash
cd volleyball-management-ui && npx tsc --noEmit && npm run lint
```

Expected: `tsc` clean; lint exactly 7, none in either file.

Then start the dev server (`npm run dev -- -p 3001`) with the backend running, open an existing tournament's Config tab, and confirm the roster editor still adds a row, removes a row, keeps a chosen player out of the other rows' dropdowns, and still shows the incomplete-row and unsaved-changes messages. Stop the server. Report what you observed.

---

## Task 9: `/ongoing/new` create page

**Files:**
- Create: `volleyball-management-ui/app/ongoing/new/page.tsx`
- Modify: `volleyball-management-ui/app/ongoing/page.tsx`
- Modify: all four `locales/*/common.json`

**Interfaces:**
- Consumes: `TeamRosterEditor`, `Calendar`, `API.CREATE_ONGOING_EVENT`, `API.GET_ALL_PLAYERS`, `useIsAdmin`
- Produces: the route `/ongoing/new`

- [ ] **Step 1: Build the create page**

`'use client'`. Fields: name (`Input`), date (a `Button` showing the formatted date that opens a `Popover` containing `<Calendar mode="single" selected={date} onSelect={...} />`, defaulting to today), max teams (optional number input, blank = unlimited), and `<TeamRosterEditor />` for the optional initial roster.

Submit posts **once** to `API.CREATE_ONGOING_EVENT` with `{ name, date: date.toISOString(), maxTeams, teams }`, omitting `maxTeams` when blank and `teams` when empty. The `mutationFn` checks `res.ok`, parses `{ message }`, and throws it; the error renders above the button. On success, `queryClient.invalidateQueries({ queryKey: ["ongoing-events"] })` then `router.push(\`/ongoing/${created.id}\`)`.

Gate the page on `useIsAdmin()` — a non-admin sees a short "admins only" message instead of the form, consistent with how the list page gates creation today.

Format the date with `date-fns` `format` (already a dependency).

- [ ] **Step 2: Replace the inline form on the list page**

In `app/ongoing/page.tsx`, delete the name input, the Create button and `createMutation` entirely, and render in their place, for admins only, a `Button` wrapped in `<Link href="/ongoing/new">` labelled with the new `ongoing.newTournament` key. Remove the now-unused `useState` for the name and any import that becomes dead — an unused import is a lint error.

- [ ] **Step 3: Add the strings to all four locales**

Add under `ongoing`: `newTournament`, and under `ongoing.create` a nested block for the page — `pageTitle`, `nameLabel`, `dateLabel`, `maxTeamsLabel`, `maxTeamsHint` ("Leave empty for no limit"), `teamsLabel`, `submit`, `adminOnly`. Write real translations for uk, pl and be — do not copy the English.

- [ ] **Step 4: Verify**

```bash
cd volleyball-management-ui && npx tsc --noEmit && npm run lint
for f in locales/*/common.json; do node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" && echo "$f ok"; done
```

Expected: `tsc` clean, lint exactly 7 with none in touched files, four `ok` lines.

---

## Task 10: Config tab — roster lock, `maxTeams`, per-team removal

**Files:**
- Modify: `volleyball-management-ui/components/ongoing/ongoing-config-tab.tsx`
- Modify: all four `locales/*/common.json`

**Interfaces:**
- Consumes: `TeamRosterEditor` (its `disabled` prop), `API.REMOVE_ONGOING_TEAM`, `API.UPDATE_ONGOING_CONFIG`
- Produces: nothing new for later tasks

- [ ] **Step 1: Derive the planning stage**

At the top of the component, derive — do not store in state:

```ts
const hasStarted = event.games.some((game) => game.team1Points !== null && game.team2Points !== null);
```

- [ ] **Step 2: Lock the roster when started**

When `hasStarted`: pass `disabled` to `<TeamRosterEditor />`, hide "Save teams", and show `ongoing.config.rosterLocked` explaining that the roster is fixed once the first result is recorded. Leave the format controls and Generate schedule as they are.

- [ ] **Step 3: Add the max-teams field**

A number input beside `courts`, blank meaning unlimited, submitted with the rest of the config. Seed it once from `event.config.maxTeams` in the `useState` initialiser — **no `useEffect`**.

- [ ] **Step 4: Add per-team removal for admins during planning**

A small remove control per registered team, visible only when `!hasStarted`, calling `API.REMOVE_ONGOING_TEAM(teamId)` behind a `window.confirm` with `ongoing.config.removeTeamConfirm`. The `mutationFn` checks `res.ok`, parses `{ message }`, and throws; render the error. On success invalidate BOTH `["ongoing-event", event.id]` and `["ongoing-events"]`.

This removes a *persisted* team, unlike the editor's row-remove which only edits the draft — make the two visually distinct so an admin cannot confuse "drop this row from my draft" with "remove this registered team".

- [ ] **Step 5: Correct the replace-roster dialog copy**

The dialog currently warns that saving the roster deletes the schedule **and all saved results**. With the planning guard that is no longer possible — the endpoint refuses once a result exists. Reword `ongoing.config.saveTeamsConfirm` in all four locales to say it deletes the current schedule, dropping the claim about results.

- [ ] **Step 6: Add the new strings to all four locales**

`ongoing.config.rosterLocked`, `ongoing.config.maxTeams`, `ongoing.config.maxTeamsHint`, `ongoing.config.removeTeam`, `ongoing.config.removeTeamConfirm` — real translations in uk, pl, be.

- [ ] **Step 7: Verify**

```bash
cd volleyball-management-ui && npx tsc --noEmit && npm run lint
for f in locales/*/common.json; do node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" && echo "$f ok"; done
```

---

## Task 11: Calendar tab and registration

**Files:**
- Create: `volleyball-management-ui/app/calendar/page.tsx`
- Create: `volleyball-management-ui/components/ongoing/register-team-dialog.tsx`
- Modify: `volleyball-management-ui/components/navigation.tsx`
- Modify: all four `locales/*/common.json`

**Interfaces:**
- Consumes: `API.GET_OPEN_ONGOING_EVENTS`, `API.ADD_ONGOING_TEAM`, `API.GET_ALL_PLAYERS`, `OngoingOpenEvent`
- Produces: the route `/calendar`; the query key `["ongoing-open"]`

- [ ] **Step 1: Add the nav item**

In `components/navigation.tsx`, import `CalendarDays` from `lucide-react` (plain `Calendar` is already used by the Events item) and add to `allNavItems` after the `/ongoing` entry:

```ts
  { href: '/calendar', labelKey: 'nav.calendar', icon: CalendarDays },
```

Do not touch the `navItems` filter — `/calendar` must fall through to `return true` and be visible to everyone, including non-admins. Registration is open to all; that is the point of the page.

- [ ] **Step 2: Build the registration dialog**

`register-team-dialog.tsx` takes `{ event: OngoingOpenEvent; players: Player[] }` and renders a `Dialog` with two player `<select>`s and a Register button. Filter out every player already registered in **that** event, computed from `event.teams`, and keep each select from offering the player chosen in the other one.

The `mutationFn` POSTs `{ player1Id, player2Id }` to `API.ADD_ONGOING_TEAM(event.id)`, checks `res.ok`, parses `{ message }`, and throws it — the backend's 409s ("This tournament is full", "Registration for this tournament has closed", "The tournament has already started; its roster is locked") are the user-facing text and must be shown verbatim, not swallowed into a status code. On success, close the dialog and invalidate `["ongoing-open"]` **and** `["ongoing-events"]`.

Disable Register until two distinct players are chosen.

- [ ] **Step 3: Build the calendar page**

`'use client'`. One query on `["ongoing-open"]` against `API.GET_OPEN_ONGOING_EVENTS` (checking `res.ok`), one on `["players"]`. Render a card per tournament: name, formatted date, `Teams: {teamsCount}/{maxTeams ?? "∞"}`, the list of registered team names via `teamName()` from `lib/ongoing-standings`, and the Register button. Empty state when nothing is open.

The card is **not** admin-gated. Link the tournament name to `/ongoing/[id]`.

- [ ] **Step 4: Add the strings to all four locales**

`nav.calendar`, and a `calendar` block: `title`, `subtitle`, `empty`, `teams`, `unlimited`, `register`, `registerTitle`, `player1`, `player2`, `noPlayersLeft`, `loading`, `loadFailed`. Real translations in uk, pl, be.

- [ ] **Step 5: Verify**

```bash
cd volleyball-management-ui && npx tsc --noEmit && npm run lint && npm run build
for f in locales/*/common.json; do node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" && echo "$f ok"; done
```

Expected: `tsc` clean; lint exactly 7 with none in touched files; `next build` succeeds and lists `/calendar` and `/ongoing/new` among the routes; four `ok` lines.

---

## Task 12: Show the date and the planning badge

**Files:**
- Modify: `volleyball-management-ui/app/ongoing/page.tsx`, `app/ongoing/[id]/page.tsx`
- Modify: all four `locales/*/common.json`

**Interfaces:**
- Consumes: `OngoingEventListItem.date`, `OngoingEvent.date`, `date-fns` `format`
- Produces: nothing new

- [ ] **Step 1: Show the date**

`date` has been stored and returned since the first increment and never displayed. Render it with `date-fns` `format(new Date(event.date), "d MMM yyyy")` on each list card and in the tournament header.

- [ ] **Step 2: Add the Planning / In progress badge**

Derive from data already present — on the list page `playedCount === 0`, on the detail page `!event.games.some(isPlayed)`. Use the existing `Badge` primitive with `ongoing.badge.planning` / `ongoing.badge.inProgress`. The badge is what makes the locked roster legible, so put it next to the tournament name in both places.

- [ ] **Step 3: Add the strings to all four locales**

`ongoing.badge.planning`, `ongoing.badge.inProgress` — real translations.

- [ ] **Step 4: Verify**

```bash
cd volleyball-management-ui && npx tsc --noEmit && npm run lint
for f in locales/*/common.json; do node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" && echo "$f ok"; done
```

---

## Task 13: End-to-end verification

**Files:** none — verification only.

- [ ] **Step 1: Full automated checks**

```bash
cd volley-app-service && npm run test && npm run build
cd ../volleyball-management-ui && npx tsc --noEmit && npm run lint && npm run build
```

Expected: backend all suites green; frontend `tsc` clean, lint exactly 7 errors, build succeeding. Paste the real output — never claim a command passed without running it.

- [ ] **Step 2: Locale-key coverage across all four languages**

Extract every `t("...")` key used in `app/calendar`, `app/ongoing`, and `components/ongoing`, and assert each resolves in all four locale files. Report the count and any missing key. A missing key silently falls back to English, so this check is the only thing that catches it.

- [ ] **Step 3: Live walkthrough**

Backend on 3000, frontend on 3001, admin gate set in `localStorage`.

1. `/ongoing` → the inline form is gone, "New tournament" is present → click through to `/ongoing/new`.
2. Create a tournament dated a week out, max teams 3, with one initial team → lands on the detail page; the header shows the date and a **Planning** badge.
3. `/calendar` → the tournament appears with `Teams: 1/3`.
4. Register a second team → it appears in that card's roster immediately and the counter reads `2/3`.
5. Register a third → the counter reads `3/3` and the tournament **disappears from the calendar** (full).
6. Config → generate a schedule → the roster is still editable (fixtures alone are not a start).
7. Record one score → return to Config: the roster is now **read-only** with the lock message, per-team removal is gone, and the badge reads **In progress**.
8. `/calendar` → the tournament is no longer listed.
9. As a non-admin (clear `localStorage.ADMIN_PASSWORD`, reload): `/calendar` is still reachable and registration still works on an open tournament; `/ongoing/new` shows the admins-only message.

- [ ] **Step 4: Check the console and network**

No red console errors through the whole walkthrough; every `/ongoing` request 2xx except the deliberate 409s, which must surface as readable messages in the UI rather than a bare status.

- [ ] **Step 5: Clean up**

Delete every tournament created during the walkthrough. If you created any players, remove exactly those and confirm the player count returns to its starting value.

---

## Notes for the implementer

- **Never migrate the shared remote database.** Task 1 Step 1 exists for that reason.
- **Never call `agregateRankings()`** or touch `games` / `player_stats`. The ongoing tables are deliberately outside the ELO chain.
- **No git commands.** Report what is ready to commit instead of committing it.
- There is uncommitted work from the previous increment in both repos. Leave it as it is.
