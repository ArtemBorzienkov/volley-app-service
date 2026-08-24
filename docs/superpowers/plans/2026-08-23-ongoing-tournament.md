# Ongoing Tournament Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Ongoing tournament" section that configures a round-robin format, generates a randomised schedule, records single-set scores as matches finish, and shows a live standings table.

**Architecture:** Four new Postgres tables (`ongoing_events`, `ongoing_event_config`, `ongoing_teams`, `ongoing_games`) served by a new NestJS `OngoingModule` under the `/ongoing` prefix, completely isolated from `events`/`games`/`player_stats` — nothing here touches the ELO rating chain. The Next.js app adds a `/ongoing` list route and an `/ongoing/[id]` detail route with three client-side tabs; a single `GET /ongoing/:id` query feeds all three, and standings are derived in the browser by a pure function.

**Tech Stack:** NestJS 10 + Prisma 4.16 + PostgreSQL + Jest (backend); Next.js App Router + TanStack Query + Tailwind v4 + shadcn/ui + i18next (frontend).

**Spec:** `volley-app-service/docs/superpowers/specs/2026-08-23-ongoing-tournament-design.md`

## Global Constraints

- **Never run a git command** — no `add`, `commit`, `push`, `checkout` — unless the user asks in a direct message. Both repos' `CLAUDE.md` state this. **Every task in this plan therefore ends without a commit step**; that is deliberate, not an omission.
- **Backend `tsconfig` targets `es2017` with no `lib` override.** `Array.prototype.flatMap`, `toSorted`, `Object.fromEntries` and other ES2018+ methods are **not in the type library** and will fail `npm run build`. Use `for...of`, `push`, `.sort()` with an explicit comparator. The frontend `tsconfig` has `lib: [..., "esnext"]`, so `flatMap` is fine **there only**.
- **Backend `strictNullChecks` is `false`; frontend `strict` is `true`.** Frontend code must handle `null` explicitly.
- Backend Prettier: single quotes, trailing commas, **120-column** print width.
- Backend has **no global `ValidationPipe`** — `class-validator` decorators are inert. Validate explicitly inside the service and throw `BadRequestException` / `NotFoundException`.
- Backend: every controller and service method gets an **explicit return type**.
- Frontend: every page and component file starts with `'use client'`. New `queryFn`s **must check `res.ok` and throw** — do not copy the unchecked `fetch().then((res) => res.json())` shape.
- Frontend: any new UI string must be added to **all four** locale files (`locales/{en,uk,pl,be}/common.json`).
- No useless comments in either repo. Comment only the *why* the code cannot state.
- Paths below are relative to `/Users/artem/Desktop/projects/`.

## File Structure

**`volley-app-service/`**

| File | Responsibility |
| --- | --- |
| `prisma/schema.prisma` (modify) | Four new models + back-relations on `Player` |
| `src/ongoing/schedule.ts` (create) | Pure scheduler: pairings, shuffle, round packing. No Prisma. |
| `src/ongoing/schedule.spec.ts` (create) | Unit tests for the scheduler |
| `src/ongoing/dto/*.ts` (create) | Request/response shapes |
| `src/ongoing/ongoing.service.ts` (create) | All persistence + validation |
| `src/ongoing/ongoing.service.spec.ts` (create) | Service tests against a mocked `PrismaService` |
| `src/ongoing/ongoing.controller.ts` (create) | Route wiring |
| `src/ongoing/ongoing.module.ts` (create) | Module definition |
| `src/app.module.ts` (modify) | Register `OngoingModule` |

**`volleyball-management-ui/`**

| File | Responsibility |
| --- | --- |
| `lib/api.ts` (modify) | Nine new endpoint URLs |
| `lib/types.ts` (modify) | Ongoing domain types |
| `lib/ongoing-standings.ts` (create) | Pure standings derivation |
| `hooks/use-is-admin.ts` (create) | Shared admin-gate hook (the `@/hooks` alias already exists in `components.json`) |
| `components/navigation.tsx` (modify) | `/ongoing` nav item |
| `locales/{en,uk,pl,be}/common.json` (modify) | `nav.ongoing` + the `ongoing.*` block |
| `app/ongoing/page.tsx` (create) | Tournament list + create form |
| `app/ongoing/[id]/page.tsx` (create) | Data fetch + tab shell |
| `components/ongoing/ongoing-config-tab.tsx` (create) | Format settings, roster editor, generate |
| `components/ongoing/ongoing-matches-tab.tsx` (create) | Matches grouped by round |
| `components/ongoing/ongoing-match-card.tsx` (create) | One fixture: score inputs, save / edit / clear |
| `components/ongoing/ongoing-standings-tab.tsx` (create) | Standings table |

---

## Task 1: Database schema

**Files:**
- Modify: `volley-app-service/prisma/schema.prisma`
- Create: `volley-app-service/prisma/migrations/<timestamp>_add_ongoing_tournament/migration.sql` (generated)

**Interfaces:**
- Consumes: nothing
- Produces: Prisma client models `ongoingEvent`, `ongoingEventConfig`, `ongoingTeam`, `ongoingGame`. Field names in the client are camelCase (`gamesPerPair`, `team1Points`, `player1Id`); DB columns are snake_case.

- [ ] **Step 1: Confirm which database `DATABASE_URL` points at**

Run: `grep DATABASE_URL volley-app-service/.env`

`.env` ships pointing at a **remote/shared** database with a commented-out localhost alternative. A migration run against the shared DB is a real schema change to shared data. If the remote URL is the active one, **stop and ask the user** which database to migrate before continuing. Do not guess.

- [ ] **Step 2: Add back-relations to the `Player` model**

In `prisma/schema.prisma`, inside `model Player`, after the `gamePlayerRanks` line:

```prisma
  // Relations - ongoing tournament teams
  ongoingTeamsAsPlayer1 OngoingTeam[] @relation("OngoingTeamPlayer1")
  ongoingTeamsAsPlayer2 OngoingTeam[] @relation("OngoingTeamPlayer2")
```

- [ ] **Step 3: Append the four new models**

At the end of `prisma/schema.prisma`:

```prisma
model OngoingEvent {
  id        String   @id @default(uuid())
  name      String
  date      DateTime
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  config OngoingEventConfig?
  teams  OngoingTeam[]
  games  OngoingGame[]

  @@index([date])
  @@map("ongoing_events")
}

model OngoingEventConfig {
  id           String @id @default(uuid())
  eventId      String @unique @map("event_id")
  gamesPerPair Int    @default(1) @map("games_per_pair")
  courts       Int    @default(1)

  event OngoingEvent @relation(fields: [eventId], references: [id], onDelete: Cascade)

  @@map("ongoing_event_config")
}

model OngoingTeam {
  id        String   @id @default(uuid())
  eventId   String   @map("event_id")
  player1Id String   @map("player1_id")
  player2Id String   @map("player2_id")
  createdAt DateTime @default(now()) @map("created_at")

  event   OngoingEvent @relation(fields: [eventId], references: [id], onDelete: Cascade)
  player1 Player       @relation("OngoingTeamPlayer1", fields: [player1Id], references: [id])
  player2 Player       @relation("OngoingTeamPlayer2", fields: [player2Id], references: [id])

  gamesAsTeam1 OngoingGame[] @relation("OngoingGameTeam1")
  gamesAsTeam2 OngoingGame[] @relation("OngoingGameTeam2")

  @@index([eventId])
  @@map("ongoing_teams")
}

model OngoingGame {
  id          String   @id @default(uuid())
  eventId     String   @map("event_id")
  team1Id     String   @map("team1_id")
  team2Id     String   @map("team2_id")
  team1Points Int?     @map("team1_points")
  team2Points Int?     @map("team2_points")
  round       Int
  court       Int
  order       Int
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  event OngoingEvent @relation(fields: [eventId], references: [id], onDelete: Cascade)
  team1 OngoingTeam  @relation("OngoingGameTeam1", fields: [team1Id], references: [id], onDelete: Cascade)
  team2 OngoingTeam  @relation("OngoingGameTeam2", fields: [team2Id], references: [id], onDelete: Cascade)

  @@index([eventId])
  @@map("ongoing_games")
}
```

`team1Points` and `team2Points` are nullable **together**: both null means the fixture is scheduled but unplayed; both set means played. No third state is written anywhere.

- [ ] **Step 4: Create and apply the migration**

Run from `volley-app-service/`:

```bash
npm run prisma:migrate:dev -- --name add_ongoing_tournament
```

Expected: a new folder under `prisma/migrations/` and `Your database is now in sync with your schema.` If Prisma warns about data loss, stop — this migration is purely additive and must not drop anything.

- [ ] **Step 5: Regenerate the client and typecheck**

```bash
npm run prisma:generate && npm run build
```

Expected: both succeed. `npm run build` is the only typecheck in this repo.

- [ ] **Step 6: Verify the tables exist**

```bash
npm run prisma:migrate:status
```

Expected: `Database schema is up to date!`

---

## Task 2: Pure schedule generator

**Files:**
- Create: `volley-app-service/src/ongoing/schedule.ts`
- Test: `volley-app-service/src/ongoing/schedule.spec.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `interface ScheduledMatch { team1Id: string; team2Id: string; round: number; court: number; order: number }`
  - `buildPairings(teamIds: string[], gamesPerPair: number): Array<[string, string]>`
  - `shuffle<T>(items: T[], random?: () => number): T[]`
  - `packIntoRounds(pairs: Array<[string, string]>, courts: number): ScheduledMatch[]`
  - `generateSchedule(teamIds: string[], gamesPerPair: number, courts: number, random?: () => number): ScheduledMatch[]`

- [ ] **Step 1: Write the failing tests**

Create `volley-app-service/src/ongoing/schedule.spec.ts`:

```ts
import { buildPairings, packIntoRounds, generateSchedule, ScheduledMatch } from './schedule';

// A counter-based generator keeps the shuffle deterministic, so a failure means the
// packing is wrong rather than that this run drew an unlucky permutation.
function sequenceRandom(values: number[]): () => number {
  let index = 0;
  return () => values[index++ % values.length];
}

describe('buildPairings', () => {
  it('produces every unordered pair exactly once for gamesPerPair 1', () => {
    const pairs = buildPairings(['a', 'b', 'c'], 1);

    expect(pairs).toHaveLength(3);
    expect(pairs).toEqual([
      ['a', 'b'],
      ['a', 'c'],
      ['b', 'c'],
    ]);
  });

  it('repeats every pair gamesPerPair times', () => {
    const pairs = buildPairings(['a', 'b', 'c'], 3);

    expect(pairs).toHaveLength(9);
    expect(pairs.filter(([one, two]) => one === 'a' && two === 'b')).toHaveLength(3);
  });

  it('returns nothing for fewer than two teams', () => {
    expect(buildPairings(['a'], 2)).toEqual([]);
  });
});

describe('packIntoRounds', () => {
  it('never schedules a team twice in the same round', () => {
    const matches = packIntoRounds(buildPairings(['a', 'b', 'c', 'd'], 1), 2);

    const teamsByRound = new Map<number, string[]>();
    for (const match of matches) {
      const teams = teamsByRound.get(match.round) || [];
      teams.push(match.team1Id, match.team2Id);
      teamsByRound.set(match.round, teams);
    }

    for (const teams of teamsByRound.values()) {
      expect(new Set(teams).size).toBe(teams.length);
    }
  });

  it('never puts more matches in a round than there are courts', () => {
    const matches = packIntoRounds(buildPairings(['a', 'b', 'c', 'd', 'e', 'f'], 1), 2);

    const sizeByRound = new Map<number, number>();
    for (const match of matches) {
      sizeByRound.set(match.round, (sizeByRound.get(match.round) || 0) + 1);
    }

    for (const size of sizeByRound.values()) {
      expect(size).toBeLessThanOrEqual(2);
    }
  });

  it('numbers courts from 1 and order from 0 within each round', () => {
    const matches = packIntoRounds(
      [
        ['a', 'b'],
        ['c', 'd'],
      ],
      2,
    );

    expect(matches.map((match) => [match.round, match.court, match.order])).toEqual([
      [1, 1, 0],
      [1, 2, 1],
    ]);
  });

  it('keeps every pair — packing drops nothing', () => {
    const pairs = buildPairings(['a', 'b', 'c', 'd'], 2);

    expect(packIntoRounds(pairs, 1)).toHaveLength(pairs.length);
  });

  it('gives each match its own round when there is one court', () => {
    const matches = packIntoRounds(buildPairings(['a', 'b', 'c'], 1), 1);

    expect(matches.map((match: ScheduledMatch) => match.round)).toEqual([1, 2, 3]);
  });
});

describe('generateSchedule', () => {
  it('produces one match per pairing regardless of shuffle order', () => {
    const matches = generateSchedule(['a', 'b', 'c', 'd'], 2, 2, sequenceRandom([0.1, 0.9, 0.5]));

    expect(matches).toHaveLength(12);
  });

  it('returns nothing when there are fewer than two teams', () => {
    expect(generateSchedule(['a'], 3, 2)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd volley-app-service && npx jest src/ongoing/schedule.spec.ts`
Expected: FAIL — `Cannot find module './schedule'`.

- [ ] **Step 3: Write the implementation**

Create `volley-app-service/src/ongoing/schedule.ts`:

```ts
export interface ScheduledMatch {
  team1Id: string;
  team2Id: string;
  round: number;
  court: number;
  order: number;
}

export const buildPairings = (teamIds: string[], gamesPerPair: number): Array<[string, string]> => {
  const pairs: Array<[string, string]> = [];

  for (let i = 0; i < teamIds.length; i += 1) {
    for (let j = i + 1; j < teamIds.length; j += 1) {
      for (let repeat = 0; repeat < gamesPerPair; repeat += 1) {
        pairs.push([teamIds[i], teamIds[j]]);
      }
    }
  }

  return pairs;
};

export const shuffle = <T>(items: T[], random: () => number = Math.random): T[] => {
  const shuffled = items.slice();

  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const swap = shuffled[i];
    shuffled[i] = shuffled[j];
    shuffled[j] = swap;
  }

  return shuffled;
};

export const packIntoRounds = (pairs: Array<[string, string]>, courts: number): ScheduledMatch[] => {
  const rounds: Array<{ teams: Set<string>; size: number }> = [];
  const matches: ScheduledMatch[] = [];

  for (const [team1Id, team2Id] of pairs) {
    let index = rounds.findIndex(
      (round) => round.size < courts && !round.teams.has(team1Id) && !round.teams.has(team2Id),
    );

    // A fresh round always accepts the match, so the loop cannot stall.
    if (index === -1) {
      rounds.push({ teams: new Set<string>(), size: 0 });
      index = rounds.length - 1;
    }

    const round = rounds[index];
    round.teams.add(team1Id);
    round.teams.add(team2Id);
    matches.push({ team1Id, team2Id, round: index + 1, court: round.size + 1, order: round.size });
    round.size += 1;
  }

  return matches;
};

export const generateSchedule = (
  teamIds: string[],
  gamesPerPair: number,
  courts: number,
  random: () => number = Math.random,
): ScheduledMatch[] => packIntoRounds(shuffle(buildPairings(teamIds, gamesPerPair), random), courts);
```

Note: `matches` comes back in pairing order, **not** sorted by round. The read query sorts by `round asc, order asc`, so this is correct — do not add a sort here.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd volley-app-service && npx jest src/ongoing/schedule.spec.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Confirm no ES2018+ methods slipped in**

Run: `cd volley-app-service && npm run build`
Expected: success. A `Property 'flatMap' does not exist` error here means the `es2017` lib constraint was violated — replace with a `for...of` loop.

---

## Task 3: DTOs, module skeleton, and event CRUD

**Files:**
- Create: `volley-app-service/src/ongoing/dto/create-ongoing-event.dto.ts`
- Create: `volley-app-service/src/ongoing/dto/update-ongoing-config.dto.ts`
- Create: `volley-app-service/src/ongoing/dto/set-ongoing-teams.dto.ts`
- Create: `volley-app-service/src/ongoing/dto/update-ongoing-game-score.dto.ts`
- Create: `volley-app-service/src/ongoing/dto/ongoing-event-response.dto.ts`
- Create: `volley-app-service/src/ongoing/ongoing.service.ts`
- Create: `volley-app-service/src/ongoing/ongoing.controller.ts`
- Create: `volley-app-service/src/ongoing/ongoing.module.ts`
- Modify: `volley-app-service/src/app.module.ts`
- Test: `volley-app-service/src/ongoing/ongoing.service.spec.ts`

**Interfaces:**
- Consumes: the Prisma models from Task 1
- Produces:
  - `CreateOngoingEventDto { name: string; date: string }`
  - `UpdateOngoingConfigDto { gamesPerPair: number; courts: number }`
  - `SetOngoingTeamsDto { teams: Array<{ player1Id: string; player2Id: string }> }`
  - `UpdateOngoingGameScoreDto { team1Points: number; team2Points: number }`
  - `OngoingEventResponseDto`, `OngoingTeamResponseDto`, `OngoingGameResponseDto`, `OngoingEventListItemDto`
  - `OngoingService.findAll()`, `.create()`, `.findOne()`, `.remove()` — later tasks add `.updateConfig()`, `.setTeams()`, `.generateSchedule()`, `.updateGameScore()`, `.clearGameResult()`
  - Private helpers reused by later tasks: `loadEvent(id): Promise<OngoingEventResponseDto>`, `mapGame(game): OngoingGameResponseDto`

- [ ] **Step 1: Write the DTO files**

`src/ongoing/dto/create-ongoing-event.dto.ts`:

```ts
import { IsString, IsDateString } from 'class-validator';

export class CreateOngoingEventDto {
  @IsString()
  name: string;

  @IsDateString()
  date: string;
}
```

`src/ongoing/dto/update-ongoing-config.dto.ts`:

```ts
import { IsInt } from 'class-validator';

export class UpdateOngoingConfigDto {
  @IsInt()
  gamesPerPair: number;

  @IsInt()
  courts: number;
}
```

`src/ongoing/dto/set-ongoing-teams.dto.ts`:

```ts
import { IsArray, IsString } from 'class-validator';

export class OngoingTeamInputDto {
  @IsString()
  player1Id: string;

  @IsString()
  player2Id: string;
}

export class SetOngoingTeamsDto {
  @IsArray()
  teams: OngoingTeamInputDto[];
}
```

`src/ongoing/dto/update-ongoing-game-score.dto.ts`:

```ts
import { IsInt } from 'class-validator';

export class UpdateOngoingGameScoreDto {
  @IsInt()
  team1Points: number;

  @IsInt()
  team2Points: number;
}
```

`src/ongoing/dto/ongoing-event-response.dto.ts`:

```ts
export class OngoingTeamPlayerDto {
  id: string;
  name: string;
  avatar?: string;
}

export class OngoingTeamResponseDto {
  id: string;
  player1: OngoingTeamPlayerDto;
  player2: OngoingTeamPlayerDto;
}

export class OngoingGameResponseDto {
  id: string;
  eventId: string;
  team1Id: string;
  team2Id: string;
  team1Points: number | null;
  team2Points: number | null;
  round: number;
  court: number;
  order: number;
}

export class OngoingEventConfigResponseDto {
  gamesPerPair: number;
  courts: number;
}

export class OngoingEventResponseDto {
  id: string;
  name: string;
  date: Date;
  createdAt: Date;
  updatedAt: Date;
  config: OngoingEventConfigResponseDto;
  teams: OngoingTeamResponseDto[];
  games: OngoingGameResponseDto[];
}

export class OngoingEventListItemDto {
  id: string;
  name: string;
  date: Date;
  teamsCount: number;
  gamesCount: number;
  playedCount: number;
}
```

- [ ] **Step 2: Write the failing service tests**

Create `volley-app-service/src/ongoing/ongoing.service.spec.ts`:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { OngoingService } from './ongoing.service';
import { PrismaService } from '../prisma/prisma.service';

const EVENT_ROW = {
  id: 'event-1',
  name: 'WBSA Warsaw',
  date: new Date('2026-08-23T10:00:00.000Z'),
  createdAt: new Date('2026-08-23T09:00:00.000Z'),
  updatedAt: new Date('2026-08-23T09:00:00.000Z'),
  config: { gamesPerPair: 1, courts: 2 },
  teams: [],
  games: [],
};

function buildPrismaMock() {
  return {
    ongoingEvent: {
      findMany: jest.fn(async () => []),
      findUnique: jest.fn(async () => EVENT_ROW as any),
      create: jest.fn(async () => EVENT_ROW as any),
      delete: jest.fn(async () => EVENT_ROW as any),
    },
    ongoingEventConfig: {
      upsert: jest.fn(async () => ({ gamesPerPair: 1, courts: 2 })),
    },
    ongoingTeam: {
      createMany: jest.fn(async () => ({ count: 0 })),
      deleteMany: jest.fn(async () => ({ count: 0 })),
    },
    ongoingGame: {
      createMany: jest.fn(async () => ({ count: 0 })),
      deleteMany: jest.fn(async () => ({ count: 0 })),
      findUnique: jest.fn(async () => null as any),
      update: jest.fn(async (args: any) => ({ ...args.data, id: 'game-1', eventId: 'event-1' })),
    },
    player: {
      findMany: jest.fn(async () => []),
    },
    $transaction: jest.fn(async (cb: any) => cb(this)),
  };
}

describe('OngoingService', () => {
  let service: OngoingService;
  let prisma: ReturnType<typeof buildPrismaMock>;

  beforeEach(async () => {
    prisma = buildPrismaMock();
    prisma.$transaction = jest.fn(async (cb: any) => cb(prisma));

    const module: TestingModule = await Test.createTestingModule({
      providers: [OngoingService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<OngoingService>(OngoingService);
  });

  describe('OngoingService.create', () => {
    it('creates the event together with a default config row', async () => {
      await service.create({ name: 'WBSA Warsaw', date: '2026-08-23T10:00:00.000Z' });

      expect(prisma.ongoingEvent.create).toHaveBeenCalledWith({
        data: {
          name: 'WBSA Warsaw',
          date: new Date('2026-08-23T10:00:00.000Z'),
          config: { create: { gamesPerPair: 1, courts: 1 } },
        },
        include: expect.anything(),
      });
    });
  });

  describe('OngoingService.findOne', () => {
    it('throws a 404 naming the id when the event does not exist', async () => {
      prisma.ongoingEvent.findUnique = jest.fn(async () => null as any);

      await expect(service.findOne('missing')).rejects.toThrow(
        new NotFoundException('Ongoing event with ID missing not found'),
      );
    });

    it('returns the config, teams and games of the event', async () => {
      const result = await service.findOne('event-1');

      expect(result.id).toBe('event-1');
      expect(result.config).toEqual({ gamesPerPair: 1, courts: 2 });
      expect(result.teams).toEqual([]);
      expect(result.games).toEqual([]);
    });

    it('asks Postgres for games in round then order sequence', async () => {
      await service.findOne('event-1');

      const args = prisma.ongoingEvent.findUnique.mock.calls[0][0] as any;
      expect(args.include.games.orderBy).toEqual([{ round: 'asc' }, { order: 'asc' }]);
    });
  });

  describe('OngoingService.remove', () => {
    it('deletes the event and lets the cascade clear config, teams and games', async () => {
      await service.remove('event-1');

      expect(prisma.ongoingEvent.delete).toHaveBeenCalledWith({ where: { id: 'event-1' } });
    });

    it('throws a 404 rather than deleting when the event is missing', async () => {
      prisma.ongoingEvent.findUnique = jest.fn(async () => null as any);

      await expect(service.remove('missing')).rejects.toThrow(NotFoundException);
      expect(prisma.ongoingEvent.delete).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd volley-app-service && npx jest src/ongoing/ongoing.service.spec.ts`
Expected: FAIL — `Cannot find module './ongoing.service'`.

- [ ] **Step 4: Write the service**

Create `volley-app-service/src/ongoing/ongoing.service.ts`:

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOngoingEventDto } from './dto/create-ongoing-event.dto';
import {
  OngoingEventListItemDto,
  OngoingEventResponseDto,
  OngoingGameResponseDto,
  OngoingTeamResponseDto,
} from './dto/ongoing-event-response.dto';

const EVENT_INCLUDE = {
  config: true,
  teams: {
    include: { player1: true, player2: true },
    orderBy: { createdAt: 'asc' as const },
  },
  games: {
    orderBy: [{ round: 'asc' as const }, { order: 'asc' as const }],
  },
};

@Injectable()
export class OngoingService {
  constructor(private prisma: PrismaService) {}

  async findAll(): Promise<OngoingEventListItemDto[]> {
    const events = await this.prisma.ongoingEvent.findMany({
      orderBy: { date: 'desc' },
      include: { teams: true, games: true },
    });

    return events.map((event) => ({
      id: event.id,
      name: event.name,
      date: event.date,
      teamsCount: event.teams.length,
      gamesCount: event.games.length,
      playedCount: event.games.filter((game) => game.team1Points !== null && game.team2Points !== null).length,
    }));
  }

  async create(createOngoingEventDto: CreateOngoingEventDto): Promise<OngoingEventResponseDto> {
    const event = await this.prisma.ongoingEvent.create({
      data: {
        name: createOngoingEventDto.name,
        date: new Date(createOngoingEventDto.date),
        config: { create: { gamesPerPair: 1, courts: 1 } },
      },
      include: EVENT_INCLUDE,
    });

    return this.mapEvent(event);
  }

  async findOne(id: string): Promise<OngoingEventResponseDto> {
    return this.loadEvent(id);
  }

  async remove(id: string): Promise<void> {
    await this.loadEvent(id);
    await this.prisma.ongoingEvent.delete({ where: { id } });
  }

  private async loadEvent(id: string): Promise<OngoingEventResponseDto> {
    const event = await this.prisma.ongoingEvent.findUnique({
      where: { id },
      include: EVENT_INCLUDE,
    });

    if (!event) {
      throw new NotFoundException(`Ongoing event with ID ${id} not found`);
    }

    return this.mapEvent(event);
  }

  private mapEvent(event: any): OngoingEventResponseDto {
    return {
      id: event.id,
      name: event.name,
      date: event.date,
      createdAt: event.createdAt,
      updatedAt: event.updatedAt,
      config: {
        gamesPerPair: event.config ? event.config.gamesPerPair : 1,
        courts: event.config ? event.config.courts : 1,
      },
      teams: (event.teams || []).map((team) => this.mapTeam(team)),
      games: (event.games || []).map((game) => this.mapGame(game)),
    };
  }

  private mapTeam(team: any): OngoingTeamResponseDto {
    return {
      id: team.id,
      player1: { id: team.player1.id, name: team.player1.name, avatar: team.player1.avatar },
      player2: { id: team.player2.id, name: team.player2.name, avatar: team.player2.avatar },
    };
  }

  private mapGame(game: any): OngoingGameResponseDto {
    return {
      id: game.id,
      eventId: game.eventId,
      team1Id: game.team1Id,
      team2Id: game.team2Id,
      team1Points: game.team1Points,
      team2Points: game.team2Points,
      round: game.round,
      court: game.court,
      order: game.order,
    };
  }
}
```

- [ ] **Step 5: Write the controller and module**

`src/ongoing/ongoing.controller.ts`:

```ts
import { Controller, Get, Post, Body, Param, Delete, HttpCode, HttpStatus } from '@nestjs/common';
import { OngoingService } from './ongoing.service';
import { CreateOngoingEventDto } from './dto/create-ongoing-event.dto';
import { OngoingEventListItemDto, OngoingEventResponseDto } from './dto/ongoing-event-response.dto';

@Controller('ongoing')
export class OngoingController {
  constructor(private readonly ongoingService: OngoingService) {}

  @Get()
  async findAll(): Promise<OngoingEventListItemDto[]> {
    return this.ongoingService.findAll();
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() createOngoingEventDto: CreateOngoingEventDto): Promise<OngoingEventResponseDto> {
    return this.ongoingService.create(createOngoingEventDto);
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<OngoingEventResponseDto> {
    return this.ongoingService.findOne(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string): Promise<void> {
    return this.ongoingService.remove(id);
  }
}
```

`src/ongoing/ongoing.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { OngoingService } from './ongoing.service';
import { OngoingController } from './ongoing.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [OngoingController],
  providers: [OngoingService],
  exports: [OngoingService],
})
export class OngoingModule {}
```

- [ ] **Step 6: Register the module**

In `src/app.module.ts`, add the import line and the entry in `imports`:

```ts
import { OngoingModule } from './ongoing/ongoing.module';
```

```ts
    RankingsModule,
    OngoingModule,
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd volley-app-service && npx jest src/ongoing/ongoing.service.spec.ts`
Expected: PASS, 6 tests.

- [ ] **Step 8: Build and smoke-test the routes**

```bash
cd volley-app-service && npm run build
```

Then in one terminal `npm run start:dev`, and in another:

```bash
curl -s -X POST localhost:3000/ongoing -H 'Content-Type: application/json' -d '{"name":"Smoke test","date":"2026-08-23T10:00:00.000Z"}'
```

Expected: 201 with `config: {"gamesPerPair":1,"courts":1}`, empty `teams` and `games`. Then `curl -s localhost:3000/ongoing` lists it with `teamsCount: 0`. Delete it again with `curl -s -X DELETE localhost:3000/ongoing/<id> -i` → `204`.

---

## Task 4: Config and teams endpoints

**Files:**
- Modify: `volley-app-service/src/ongoing/ongoing.service.ts`
- Modify: `volley-app-service/src/ongoing/ongoing.controller.ts`
- Test: `volley-app-service/src/ongoing/ongoing.service.spec.ts`

**Interfaces:**
- Consumes: `loadEvent`, `EVENT_INCLUDE` from Task 3
- Produces:
  - `OngoingService.updateConfig(id: string, dto: UpdateOngoingConfigDto): Promise<OngoingEventResponseDto>`
  - `OngoingService.setTeams(id: string, dto: SetOngoingTeamsDto): Promise<OngoingEventResponseDto>`
  - `PUT /ongoing/:id/config`, `PUT /ongoing/:id/teams`

- [ ] **Step 1: Write the failing tests**

Append to `src/ongoing/ongoing.service.spec.ts`, inside the outer `describe('OngoingService', ...)` block:

```ts
  describe('OngoingService.updateConfig', () => {
    it('rejects a gamesPerPair outside 1..3', async () => {
      await expect(service.updateConfig('event-1', { gamesPerPair: 4, courts: 2 })).rejects.toThrow(
        new BadRequestException('gamesPerPair must be 1, 2 or 3'),
      );
    });

    it('rejects fewer than one court', async () => {
      await expect(service.updateConfig('event-1', { gamesPerPair: 1, courts: 0 })).rejects.toThrow(
        new BadRequestException('courts must be at least 1'),
      );
    });

    it('upserts the config row for the event', async () => {
      await service.updateConfig('event-1', { gamesPerPair: 2, courts: 3 });

      expect(prisma.ongoingEventConfig.upsert).toHaveBeenCalledWith({
        where: { eventId: 'event-1' },
        create: { eventId: 'event-1', gamesPerPair: 2, courts: 3 },
        update: { gamesPerPair: 2, courts: 3 },
      });
    });
  });

  describe('OngoingService.setTeams', () => {
    beforeEach(() => {
      prisma.player.findMany = jest.fn(async () => [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }, { id: 'p4' }] as any);
    });

    it('rejects a team whose two players are the same person', async () => {
      await expect(
        service.setTeams('event-1', { teams: [{ player1Id: 'p1', player2Id: 'p1' }] }),
      ).rejects.toThrow(new BadRequestException('A team must have two different players'));
    });

    it('rejects a player appearing in more than one team', async () => {
      await expect(
        service.setTeams('event-1', {
          teams: [
            { player1Id: 'p1', player2Id: 'p2' },
            { player1Id: 'p1', player2Id: 'p3' },
          ],
        }),
      ).rejects.toThrow(new BadRequestException('Player p1 is already in another team'));
    });

    it('rejects an unknown player id', async () => {
      prisma.player.findMany = jest.fn(async () => [{ id: 'p1' }] as any);

      await expect(
        service.setTeams('event-1', { teams: [{ player1Id: 'p1', player2Id: 'ghost' }] }),
      ).rejects.toThrow(new NotFoundException('Player with ID ghost not found'));
    });

    it('drops the existing games before replacing the roster, since fixtures would dangle', async () => {
      const calls: string[] = [];
      prisma.ongoingGame.deleteMany = jest.fn(async () => {
        calls.push('games.deleteMany');
        return { count: 0 };
      });
      prisma.ongoingTeam.deleteMany = jest.fn(async () => {
        calls.push('teams.deleteMany');
        return { count: 0 };
      });
      prisma.ongoingTeam.createMany = jest.fn(async () => {
        calls.push('teams.createMany');
        return { count: 1 };
      });

      await service.setTeams('event-1', { teams: [{ player1Id: 'p1', player2Id: 'p2' }] });

      expect(calls).toEqual(['games.deleteMany', 'teams.deleteMany', 'teams.createMany']);
    });

    it('writes each team with the event id attached', async () => {
      await service.setTeams('event-1', {
        teams: [
          { player1Id: 'p1', player2Id: 'p2' },
          { player1Id: 'p3', player2Id: 'p4' },
        ],
      });

      expect(prisma.ongoingTeam.createMany).toHaveBeenCalledWith({
        data: [
          { eventId: 'event-1', player1Id: 'p1', player2Id: 'p2' },
          { eventId: 'event-1', player1Id: 'p3', player2Id: 'p4' },
        ],
      });
    });

    it('accepts an empty roster and just clears everything', async () => {
      await service.setTeams('event-1', { teams: [] });

      expect(prisma.ongoingTeam.createMany).not.toHaveBeenCalled();
      expect(prisma.ongoingTeam.deleteMany).toHaveBeenCalledWith({ where: { eventId: 'event-1' } });
    });
  });
```

Extend the existing import at the top of the spec file:

```ts
import { BadRequestException, NotFoundException } from '@nestjs/common';
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd volley-app-service && npx jest src/ongoing/ongoing.service.spec.ts`
Expected: FAIL — `service.updateConfig is not a function`.

- [ ] **Step 3: Write the implementation**

Add to the imports of `src/ongoing/ongoing.service.ts`:

```ts
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { UpdateOngoingConfigDto } from './dto/update-ongoing-config.dto';
import { SetOngoingTeamsDto } from './dto/set-ongoing-teams.dto';
```

Add these public methods after `remove`:

```ts
  async updateConfig(id: string, updateOngoingConfigDto: UpdateOngoingConfigDto): Promise<OngoingEventResponseDto> {
    const { gamesPerPair, courts } = updateOngoingConfigDto;

    if (![1, 2, 3].includes(gamesPerPair)) {
      throw new BadRequestException('gamesPerPair must be 1, 2 or 3');
    }
    if (!Number.isInteger(courts) || courts < 1) {
      throw new BadRequestException('courts must be at least 1');
    }

    await this.loadEvent(id);

    await this.prisma.ongoingEventConfig.upsert({
      where: { eventId: id },
      create: { eventId: id, gamesPerPair, courts },
      update: { gamesPerPair, courts },
    });

    return this.loadEvent(id);
  }

  async setTeams(id: string, setOngoingTeamsDto: SetOngoingTeamsDto): Promise<OngoingEventResponseDto> {
    await this.loadEvent(id);

    const teams = setOngoingTeamsDto.teams || [];
    const seen = new Set<string>();

    for (const team of teams) {
      if (team.player1Id === team.player2Id) {
        throw new BadRequestException('A team must have two different players');
      }
      for (const playerId of [team.player1Id, team.player2Id]) {
        if (seen.has(playerId)) {
          throw new BadRequestException(`Player ${playerId} is already in another team`);
        }
        seen.add(playerId);
      }
    }

    const playerIds = Array.from(seen);
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

- [ ] **Step 4: Add the controller routes**

In `src/ongoing/ongoing.controller.ts`, add `Put` to the `@nestjs/common` import, add the two DTO imports, and add these handlers **above** the `@Get(':id')` handler:

```ts
  @Put(':id/config')
  async updateConfig(
    @Param('id') id: string,
    @Body() updateOngoingConfigDto: UpdateOngoingConfigDto,
  ): Promise<OngoingEventResponseDto> {
    return this.ongoingService.updateConfig(id, updateOngoingConfigDto);
  }

  @Put(':id/teams')
  async setTeams(
    @Param('id') id: string,
    @Body() setOngoingTeamsDto: SetOngoingTeamsDto,
  ): Promise<OngoingEventResponseDto> {
    return this.ongoingService.setTeams(id, setOngoingTeamsDto);
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd volley-app-service && npx jest src/ongoing/ongoing.service.spec.ts`
Expected: PASS, 13 tests.

- [ ] **Step 6: Build**

Run: `cd volley-app-service && npm run build`
Expected: success.

---

## Task 5: Schedule generation endpoint

**Files:**
- Modify: `volley-app-service/src/ongoing/ongoing.service.ts`
- Modify: `volley-app-service/src/ongoing/ongoing.controller.ts`
- Test: `volley-app-service/src/ongoing/ongoing.service.spec.ts`

**Interfaces:**
- Consumes: `generateSchedule` from Task 2; `loadEvent` from Task 3
- Produces: `OngoingService.generateSchedule(id: string): Promise<OngoingEventResponseDto>`; `POST /ongoing/:id/schedule`

- [ ] **Step 1: Write the failing tests**

Append inside `describe('OngoingService', ...)` in `src/ongoing/ongoing.service.spec.ts`:

```ts
  describe('OngoingService.generateSchedule', () => {
    const TEAM_ROWS = [
      { id: 't1', player1: { id: 'p1', name: 'A' }, player2: { id: 'p2', name: 'B' } },
      { id: 't2', player1: { id: 'p3', name: 'C' }, player2: { id: 'p4', name: 'D' } },
      { id: 't3', player1: { id: 'p5', name: 'E' }, player2: { id: 'p6', name: 'F' } },
    ];

    beforeEach(() => {
      prisma.ongoingEvent.findUnique = jest.fn(async () => ({
        ...EVENT_ROW,
        config: { gamesPerPair: 1, courts: 1 },
        teams: TEAM_ROWS,
      }) as any);
    });

    it('refuses to build a schedule with fewer than two teams', async () => {
      prisma.ongoingEvent.findUnique = jest.fn(async () => ({
        ...EVENT_ROW,
        config: { gamesPerPair: 1, courts: 1 },
        teams: [TEAM_ROWS[0]],
      }) as any);

      await expect(service.generateSchedule('event-1')).rejects.toThrow(
        new BadRequestException('At least two teams are required to generate a schedule'),
      );
    });

    it('wipes the existing fixtures before writing the new ones', async () => {
      const calls: string[] = [];
      prisma.ongoingGame.deleteMany = jest.fn(async () => {
        calls.push('deleteMany');
        return { count: 3 };
      });
      prisma.ongoingGame.createMany = jest.fn(async () => {
        calls.push('createMany');
        return { count: 3 };
      });

      await service.generateSchedule('event-1');

      expect(calls).toEqual(['deleteMany', 'createMany']);
    });

    it('writes one fixture per pairing, each carrying the event id', async () => {
      await service.generateSchedule('event-1');

      const data = (prisma.ongoingGame.createMany as jest.Mock).mock.calls[0][0].data;
      expect(data).toHaveLength(3);
      for (const row of data) {
        expect(row.eventId).toBe('event-1');
        expect(row.team1Points).toBeNull();
        expect(row.team2Points).toBeNull();
      }
    });

    it('honours gamesPerPair from the config', async () => {
      prisma.ongoingEvent.findUnique = jest.fn(async () => ({
        ...EVENT_ROW,
        config: { gamesPerPair: 2, courts: 2 },
        teams: TEAM_ROWS,
      }) as any);

      await service.generateSchedule('event-1');

      expect((prisma.ongoingGame.createMany as jest.Mock).mock.calls[0][0].data).toHaveLength(6);
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd volley-app-service && npx jest src/ongoing/ongoing.service.spec.ts`
Expected: FAIL — `service.generateSchedule is not a function`.

- [ ] **Step 3: Write the implementation**

Add to the imports of `src/ongoing/ongoing.service.ts`:

```ts
import { generateSchedule } from './schedule';
```

Add the method after `setTeams`:

```ts
  async generateSchedule(id: string): Promise<OngoingEventResponseDto> {
    const event = await this.loadEvent(id);

    if (event.teams.length < 2) {
      throw new BadRequestException('At least two teams are required to generate a schedule');
    }

    const matches = generateSchedule(
      event.teams.map((team) => team.id),
      event.config.gamesPerPair,
      event.config.courts,
    );

    await this.prisma.$transaction(async (tx) => {
      await tx.ongoingGame.deleteMany({ where: { eventId: id } });
      await tx.ongoingGame.createMany({
        data: matches.map((match) => ({
          eventId: id,
          team1Id: match.team1Id,
          team2Id: match.team2Id,
          team1Points: null,
          team2Points: null,
          round: match.round,
          court: match.court,
          order: match.order,
        })),
      });
    });

    return this.loadEvent(id);
  }
```

Regeneration is unconditional by design — the confirmation prompt lives in the UI (Task 10).

- [ ] **Step 4: Add the controller route**

In `src/ongoing/ongoing.controller.ts`, add above `@Get(':id')`:

```ts
  @Post(':id/schedule')
  @HttpCode(HttpStatus.OK)
  async generateSchedule(@Param('id') id: string): Promise<OngoingEventResponseDto> {
    return this.ongoingService.generateSchedule(id);
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd volley-app-service && npx jest src/ongoing/ongoing.service.spec.ts`
Expected: PASS, 17 tests.

- [ ] **Step 6: Build**

Run: `cd volley-app-service && npm run build`
Expected: success.

---

## Task 6: Score endpoints

**Files:**
- Modify: `volley-app-service/src/ongoing/ongoing.service.ts`
- Modify: `volley-app-service/src/ongoing/ongoing.controller.ts`
- Test: `volley-app-service/src/ongoing/ongoing.service.spec.ts`

**Interfaces:**
- Consumes: `mapGame` from Task 3
- Produces:
  - `OngoingService.updateGameScore(gameId: string, dto: UpdateOngoingGameScoreDto): Promise<OngoingGameResponseDto>`
  - `OngoingService.clearGameResult(gameId: string): Promise<OngoingGameResponseDto>`
  - `PATCH /ongoing/games/:gameId`, `DELETE /ongoing/games/:gameId/result`

- [ ] **Step 1: Write the failing tests**

Append inside `describe('OngoingService', ...)`:

```ts
  describe('OngoingService.updateGameScore', () => {
    const GAME_ROW = {
      id: 'game-1',
      eventId: 'event-1',
      team1Id: 't1',
      team2Id: 't2',
      team1Points: null,
      team2Points: null,
      round: 1,
      court: 1,
      order: 0,
    };

    beforeEach(() => {
      prisma.ongoingGame.findUnique = jest.fn(async () => GAME_ROW as any);
      prisma.ongoingGame.update = jest.fn(async (args: any) => ({ ...GAME_ROW, ...args.data }));
    });

    it('throws a 404 naming the id when the game does not exist', async () => {
      prisma.ongoingGame.findUnique = jest.fn(async () => null as any);

      await expect(service.updateGameScore('missing', { team1Points: 15, team2Points: 7 })).rejects.toThrow(
        new NotFoundException('Ongoing game with ID missing not found'),
      );
    });

    it('rejects a negative score', async () => {
      await expect(service.updateGameScore('game-1', { team1Points: -1, team2Points: 7 })).rejects.toThrow(
        new BadRequestException('Points must be whole numbers of 0 or more'),
      );
    });

    it('rejects a non-integer score', async () => {
      await expect(service.updateGameScore('game-1', { team1Points: 15.5, team2Points: 7 })).rejects.toThrow(
        new BadRequestException('Points must be whole numbers of 0 or more'),
      );
    });

    it('rejects a draw, because a set always has a winner', async () => {
      await expect(service.updateGameScore('game-1', { team1Points: 15, team2Points: 15 })).rejects.toThrow(
        new BadRequestException('A set cannot end in a draw'),
      );
    });

    it('stores both scores on the game', async () => {
      const result = await service.updateGameScore('game-1', { team1Points: 15, team2Points: 7 });

      expect(prisma.ongoingGame.update).toHaveBeenCalledWith({
        where: { id: 'game-1' },
        data: { team1Points: 15, team2Points: 7 },
      });
      expect(result.team1Points).toBe(15);
      expect(result.team2Points).toBe(7);
    });
  });

  describe('OngoingService.clearGameResult', () => {
    beforeEach(() => {
      prisma.ongoingGame.findUnique = jest.fn(async () => ({
        id: 'game-1',
        eventId: 'event-1',
        team1Id: 't1',
        team2Id: 't2',
        team1Points: 15,
        team2Points: 7,
        round: 1,
        court: 1,
        order: 0,
      }) as any);
      prisma.ongoingGame.update = jest.fn(async (args: any) => ({
        id: 'game-1',
        eventId: 'event-1',
        team1Id: 't1',
        team2Id: 't2',
        round: 1,
        court: 1,
        order: 0,
        ...args.data,
      }));
    });

    it('nulls both scores and keeps the fixture', async () => {
      const result = await service.clearGameResult('game-1');

      expect(prisma.ongoingGame.update).toHaveBeenCalledWith({
        where: { id: 'game-1' },
        data: { team1Points: null, team2Points: null },
      });
      expect(result.team1Points).toBeNull();
      expect(result.round).toBe(1);
    });

    it('throws a 404 when the game does not exist', async () => {
      prisma.ongoingGame.findUnique = jest.fn(async () => null as any);

      await expect(service.clearGameResult('missing')).rejects.toThrow(NotFoundException);
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd volley-app-service && npx jest src/ongoing/ongoing.service.spec.ts`
Expected: FAIL — `service.updateGameScore is not a function`.

- [ ] **Step 3: Write the implementation**

Add to the imports of `src/ongoing/ongoing.service.ts`:

```ts
import { UpdateOngoingGameScoreDto } from './dto/update-ongoing-game-score.dto';
```

Add these methods after `generateSchedule`:

```ts
  async updateGameScore(
    gameId: string,
    updateOngoingGameScoreDto: UpdateOngoingGameScoreDto,
  ): Promise<OngoingGameResponseDto> {
    await this.loadGame(gameId);

    const { team1Points, team2Points } = updateOngoingGameScoreDto;
    const isValidScore = (points: number) => Number.isInteger(points) && points >= 0;

    if (!isValidScore(team1Points) || !isValidScore(team2Points)) {
      throw new BadRequestException('Points must be whole numbers of 0 or more');
    }
    if (team1Points === team2Points) {
      throw new BadRequestException('A set cannot end in a draw');
    }

    const game = await this.prisma.ongoingGame.update({
      where: { id: gameId },
      data: { team1Points, team2Points },
    });

    return this.mapGame(game);
  }

  async clearGameResult(gameId: string): Promise<OngoingGameResponseDto> {
    await this.loadGame(gameId);

    const game = await this.prisma.ongoingGame.update({
      where: { id: gameId },
      data: { team1Points: null, team2Points: null },
    });

    return this.mapGame(game);
  }

  private async loadGame(gameId: string): Promise<void> {
    const game = await this.prisma.ongoingGame.findUnique({ where: { id: gameId } });

    if (!game) {
      throw new NotFoundException(`Ongoing game with ID ${gameId} not found`);
    }
  }
```

- [ ] **Step 4: Add the controller routes**

In `src/ongoing/ongoing.controller.ts`, add `Patch` to the `@nestjs/common` import, import `UpdateOngoingGameScoreDto` and `OngoingGameResponseDto`, and add these handlers **above** `@Get(':id')` and `@Delete(':id')`:

```ts
  @Patch('games/:gameId')
  async updateGameScore(
    @Param('gameId') gameId: string,
    @Body() updateOngoingGameScoreDto: UpdateOngoingGameScoreDto,
  ): Promise<OngoingGameResponseDto> {
    return this.ongoingService.updateGameScore(gameId, updateOngoingGameScoreDto);
  }

  @Delete('games/:gameId/result')
  async clearGameResult(@Param('gameId') gameId: string): Promise<OngoingGameResponseDto> {
    return this.ongoingService.clearGameResult(gameId);
  }
```

`DELETE games/:gameId/result` has three path segments and `DELETE :id` has one, so they cannot collide — but keep the specific route declared first regardless.

- [ ] **Step 5: Run the whole backend suite**

Run: `cd volley-app-service && npm run test`
Expected: PASS — the new `ongoing` specs (25 tests across the two files) plus the pre-existing `events.service.spec.ts`, all green.

- [ ] **Step 6: Build and smoke-test the full backend flow**

```bash
cd volley-app-service && npm run build
```

With `npm run start:dev` running and at least four real player ids from `curl -s localhost:3000/players`:

```bash
curl -s -X POST localhost:3000/ongoing -H 'Content-Type: application/json' -d '{"name":"Smoke","date":"2026-08-23T10:00:00.000Z"}'
curl -s -X PUT localhost:3000/ongoing/<id>/config -H 'Content-Type: application/json' -d '{"gamesPerPair":1,"courts":2}'
curl -s -X PUT localhost:3000/ongoing/<id>/teams -H 'Content-Type: application/json' -d '{"teams":[{"player1Id":"<p1>","player2Id":"<p2>"},{"player1Id":"<p3>","player2Id":"<p4>"}]}'
curl -s -X POST localhost:3000/ongoing/<id>/schedule
```

Expected: the last call returns one game with `round: 1`, `court: 1`, `team1Points: null`. Then `PATCH /ongoing/games/<gameId>` with `{"team1Points":15,"team2Points":7}` returns the stored score, and `DELETE /ongoing/games/<gameId>/result` returns it with both back to `null`. Delete the smoke-test event afterwards.

---

## Task 7: Frontend types, endpoints, and standings logic

**Files:**
- Modify: `volleyball-management-ui/lib/api.ts`
- Modify: `volleyball-management-ui/lib/types.ts`
- Create: `volleyball-management-ui/lib/ongoing-standings.ts`
- Create: `volleyball-management-ui/hooks/use-is-admin.ts`

**Interfaces:**
- Consumes: the JSON shapes returned by Tasks 3–6
- Produces:
  - Types `OngoingEventListItem`, `OngoingEventConfig`, `OngoingTeamPlayer`, `OngoingTeam`, `OngoingGame`, `OngoingEvent`, `OngoingStandingsRow`
  - `API.GET_ONGOING_EVENTS`, `API.CREATE_ONGOING_EVENT`, `API.GET_ONGOING_EVENT(id)`, `API.DELETE_ONGOING_EVENT(id)`, `API.UPDATE_ONGOING_CONFIG(id)`, `API.SET_ONGOING_TEAMS(id)`, `API.GENERATE_ONGOING_SCHEDULE(id)`, `API.UPDATE_ONGOING_GAME(gameId)`, `API.CLEAR_ONGOING_GAME_RESULT(gameId)`
  - `computeStandings(teams: OngoingTeam[], games: OngoingGame[]): OngoingStandingsRow[]`
  - `teamName(team: OngoingTeam): string`
  - `useIsAdmin(): boolean`

- [ ] **Step 1: Add the types**

Append to `volleyball-management-ui/lib/types.ts`:

```ts
export interface OngoingEventListItem {
  id: string;
  name: string;
  date: string;
  teamsCount: number;
  gamesCount: number;
  playedCount: number;
}

export interface OngoingEventConfig {
  gamesPerPair: number;
  courts: number;
}

export interface OngoingTeamPlayer {
  id: string;
  name: string;
  avatar?: string;
}

export interface OngoingTeam {
  id: string;
  player1: OngoingTeamPlayer;
  player2: OngoingTeamPlayer;
}

export interface OngoingGame {
  id: string;
  eventId: string;
  team1Id: string;
  team2Id: string;
  team1Points: number | null;
  team2Points: number | null;
  round: number;
  court: number;
  order: number;
}

export interface OngoingEvent {
  id: string;
  name: string;
  date: string;
  createdAt: string;
  updatedAt: string;
  config: OngoingEventConfig;
  teams: OngoingTeam[];
  games: OngoingGame[];
}

export interface OngoingStandingsRow {
  place: number;
  team: OngoingTeam;
  played: number;
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
}
```

- [ ] **Step 2: Add the endpoint URLs**

In `volleyball-management-ui/lib/api.ts`, add these entries to the `API` object, before the closing brace:

```ts
  GET_ONGOING_EVENTS: `${process.env.NEXT_PUBLIC_HOST_URL}/ongoing`,
  CREATE_ONGOING_EVENT: `${process.env.NEXT_PUBLIC_HOST_URL}/ongoing`,
  GET_ONGOING_EVENT: (id: string) => `${process.env.NEXT_PUBLIC_HOST_URL}/ongoing/${id}`,
  DELETE_ONGOING_EVENT: (id: string) => `${process.env.NEXT_PUBLIC_HOST_URL}/ongoing/${id}`,
  UPDATE_ONGOING_CONFIG: (id: string) => `${process.env.NEXT_PUBLIC_HOST_URL}/ongoing/${id}/config`,
  SET_ONGOING_TEAMS: (id: string) => `${process.env.NEXT_PUBLIC_HOST_URL}/ongoing/${id}/teams`,
  GENERATE_ONGOING_SCHEDULE: (id: string) => `${process.env.NEXT_PUBLIC_HOST_URL}/ongoing/${id}/schedule`,
  UPDATE_ONGOING_GAME: (gameId: string) => `${process.env.NEXT_PUBLIC_HOST_URL}/ongoing/games/${gameId}`,
  CLEAR_ONGOING_GAME_RESULT: (gameId: string) =>
    `${process.env.NEXT_PUBLIC_HOST_URL}/ongoing/games/${gameId}/result`,
```

- [ ] **Step 3: Write the standings module**

Create `volleyball-management-ui/lib/ongoing-standings.ts`:

```ts
import type { OngoingGame, OngoingStandingsRow, OngoingTeam } from "@/lib/types";

export function teamName(team: OngoingTeam): string {
  return `${team.player1.name} & ${team.player2.name}`;
}

export function isPlayed(game: OngoingGame): boolean {
  return game.team1Points !== null && game.team2Points !== null;
}

export function computeStandings(
  teams: OngoingTeam[],
  games: OngoingGame[],
): OngoingStandingsRow[] {
  const rows = new Map<string, Omit<OngoingStandingsRow, "place">>();

  for (const team of teams) {
    rows.set(team.id, {
      team,
      played: 0,
      wins: 0,
      losses: 0,
      pointsFor: 0,
      pointsAgainst: 0,
    });
  }

  for (const game of games) {
    if (!isPlayed(game)) continue;

    const team1 = rows.get(game.team1Id);
    const team2 = rows.get(game.team2Id);
    if (!team1 || !team2) continue;

    const points1 = game.team1Points as number;
    const points2 = game.team2Points as number;

    team1.played += 1;
    team2.played += 1;
    team1.pointsFor += points1;
    team1.pointsAgainst += points2;
    team2.pointsFor += points2;
    team2.pointsAgainst += points1;

    if (points1 > points2) {
      team1.wins += 1;
      team2.losses += 1;
    } else {
      team2.wins += 1;
      team1.losses += 1;
    }
  }

  const sorted = Array.from(rows.values()).sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    const diffA = a.pointsFor - a.pointsAgainst;
    const diffB = b.pointsFor - b.pointsAgainst;
    if (diffB !== diffA) return diffB - diffA;
    return b.pointsFor - a.pointsFor;
  });

  return sorted.map((row, index) => ({ ...row, place: index + 1 }));
}
```

There is no win-bonus points column: `wins`/`losses` carry the record and `pointsFor`/`pointsAgainst` render as `115–112`.

- [ ] **Step 4: Write the admin hook**

Create `volleyball-management-ui/hooks/use-is-admin.ts`. This is the first file in `hooks/`; the `@/hooks` alias is already declared in `components.json`.

```ts
"use client";

import { useEffect, useState } from "react";

// Mirrors the cosmetic gate in components/navigation.tsx. It hides controls; it is not access control.
export function useIsAdmin(): boolean {
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const hasAccess = [
      process.env.NEXT_PUBLIC_ADMIN_PASSWORD,
      process.env.NEXT_PUBLIC_MODERATOR_PASSWORD,
    ].includes(localStorage.getItem("ADMIN_PASSWORD") || "");
    setIsAdmin(hasAccess);
  }, []);

  return isAdmin;
}
```

- [ ] **Step 5: Typecheck**

Run: `cd volleyball-management-ui && npx tsc --noEmit`
Expected: clean. It was clean before this change and must stay clean.

- [ ] **Step 6: Sanity-check the standings maths by hand**

Create a scratch file `/private/tmp/claude-501/-Users-artem-Desktop-projects/e162df03-93f3-4b0b-9c22-b51881e8a0e1/scratchpad/standings-check.mjs` (there is no test runner in this repo, so this is a throwaway check, not a committed test):

```js
const teams = [
  { id: "t1", player1: { id: "p1", name: "A" }, player2: { id: "p2", name: "B" } },
  { id: "t2", player1: { id: "p3", name: "C" }, player2: { id: "p4", name: "D" } },
  { id: "t3", player1: { id: "p5", name: "E" }, player2: { id: "p6", name: "F" } },
];
const games = [
  { id: "g1", team1Id: "t1", team2Id: "t2", team1Points: 15, team2Points: 7 },
  { id: "g2", team1Id: "t1", team2Id: "t3", team1Points: 12, team2Points: 15 },
  { id: "g3", team1Id: "t2", team2Id: "t3", team1Points: 15, team2Points: 10 },
];
```

Paste the body of `computeStandings` alongside it and print the result. Expected order: `t3` and `t1` and `t2` all on 1 win, separated by point difference — `t3` (+8: 25 for, 27 against → −2), recompute by hand and confirm the printed `place` values match your arithmetic. Delete the scratch file afterwards.

---

## Task 8: Navigation, translations, and the tournament list page

**Files:**
- Modify: `volleyball-management-ui/components/navigation.tsx`
- Modify: `volleyball-management-ui/locales/en/common.json`
- Modify: `volleyball-management-ui/locales/uk/common.json`
- Modify: `volleyball-management-ui/locales/pl/common.json`
- Modify: `volleyball-management-ui/locales/be/common.json`
- Create: `volleyball-management-ui/app/ongoing/page.tsx`

**Interfaces:**
- Consumes: `API.GET_ONGOING_EVENTS`, `API.CREATE_ONGOING_EVENT`, `API.DELETE_ONGOING_EVENT`, `OngoingEventListItem`, `useIsAdmin` from Task 7
- Produces: the route `/ongoing`; the query key `['ongoing-events']`

- [ ] **Step 1: Add the nav item**

In `components/navigation.tsx`, add `Swords` to the `lucide-react` import and add the entry to `allNavItems` after the events line:

```ts
  { href: '/ongoing', labelKey: 'nav.ongoing', icon: Swords },
```

No change to the `navItems` filter — `/ongoing` falls through to `return true` and is visible to everyone. Write-side controls are gated inside the pages instead.

- [ ] **Step 2: Add the English strings**

In `locales/en/common.json`, add `"ongoing": "Ongoing"` to the `nav` object, and add this top-level block:

```json
  "ongoing": {
    "title": "Ongoing tournaments",
    "subtitle": "Configure a format, generate the schedule, and track results live.",
    "createTitle": "New tournament",
    "namePlaceholder": "Tournament name",
    "create": "Create",
    "empty": "No tournaments yet.",
    "teams": "Teams",
    "matches": "Matches",
    "played": "Played",
    "delete": "Delete",
    "deleteConfirm": "Delete this tournament and all its matches?",
    "notFound": "Tournament not found.",
    "loading": "Loading…",
    "loadFailed": "Could not load the tournament.",
    "tabs": {
      "config": "Config",
      "matches": "Matches",
      "standings": "Standings"
    },
    "config": {
      "title": "Format",
      "gamesPerPair": "Games between each pair of teams",
      "courts": "Courts",
      "save": "Save format",
      "saved": "Format saved",
      "teamsTitle": "Teams",
      "addTeam": "Add team",
      "removeTeam": "Remove",
      "selectPlayer": "Select player",
      "saveTeams": "Save teams",
      "teamsHint": "A player can be in only one team.",
      "generate": "Generate schedule",
      "generateConfirm": "This deletes the current schedule and all saved results. Generate a new one?",
      "generateConfirmTitle": "Regenerate schedule",
      "cancel": "Cancel",
      "confirm": "Regenerate",
      "needTeams": "Add at least two teams first."
    },
    "matchesTab": {
      "round": "Round",
      "court": "Court",
      "save": "Save match",
      "edit": "Edit",
      "clear": "Clear result",
      "clearConfirm": "Clear the result of this match?",
      "empty": "No schedule yet — generate one in the Config tab.",
      "invalidScore": "Enter two different whole numbers."
    },
    "standings": {
      "place": "#",
      "team": "Team",
      "played": "P",
      "wins": "W",
      "losses": "L",
      "points": "Points",
      "empty": "No results yet."
    }
  }
```

- [ ] **Step 3: Add the same block to the other three locales**

`locales/uk/common.json` — add `"ongoing": "Турнір"` to `nav`, then:

```json
  "ongoing": {
    "title": "Поточні турніри",
    "subtitle": "Налаштуйте формат, згенеруйте розклад і стежте за результатами наживо.",
    "createTitle": "Новий турнір",
    "namePlaceholder": "Назва турніру",
    "create": "Створити",
    "empty": "Турнірів ще немає.",
    "teams": "Команди",
    "matches": "Матчі",
    "played": "Зіграно",
    "delete": "Видалити",
    "deleteConfirm": "Видалити цей турнір і всі його матчі?",
    "notFound": "Турнір не знайдено.",
    "loading": "Завантаження…",
    "loadFailed": "Не вдалося завантажити турнір.",
    "tabs": { "config": "Налаштування", "matches": "Матчі", "standings": "Таблиця" },
    "config": {
      "title": "Формат",
      "gamesPerPair": "Ігор між кожною парою команд",
      "courts": "Кортів",
      "save": "Зберегти формат",
      "saved": "Формат збережено",
      "teamsTitle": "Команди",
      "addTeam": "Додати команду",
      "removeTeam": "Прибрати",
      "selectPlayer": "Оберіть гравця",
      "saveTeams": "Зберегти команди",
      "teamsHint": "Гравець може бути лише в одній команді.",
      "generate": "Згенерувати розклад",
      "generateConfirm": "Це видалить поточний розклад і всі збережені результати. Згенерувати новий?",
      "generateConfirmTitle": "Перегенерувати розклад",
      "cancel": "Скасувати",
      "confirm": "Перегенерувати",
      "needTeams": "Спочатку додайте щонайменше дві команди."
    },
    "matchesTab": {
      "round": "Раунд",
      "court": "Корт",
      "save": "Зберегти матч",
      "edit": "Редагувати",
      "clear": "Очистити результат",
      "clearConfirm": "Очистити результат цього матчу?",
      "empty": "Розкладу ще немає — згенеруйте його у вкладці «Налаштування».",
      "invalidScore": "Введіть два різні цілі числа."
    },
    "standings": {
      "place": "#",
      "team": "Команда",
      "played": "І",
      "wins": "П",
      "losses": "Пр",
      "points": "Очки",
      "empty": "Результатів ще немає."
    }
  }
```

`locales/pl/common.json` — add `"ongoing": "Turniej"` to `nav`, then:

```json
  "ongoing": {
    "title": "Trwające turnieje",
    "subtitle": "Ustaw format, wygeneruj terminarz i śledź wyniki na żywo.",
    "createTitle": "Nowy turniej",
    "namePlaceholder": "Nazwa turnieju",
    "create": "Utwórz",
    "empty": "Nie ma jeszcze turniejów.",
    "teams": "Drużyny",
    "matches": "Mecze",
    "played": "Rozegrane",
    "delete": "Usuń",
    "deleteConfirm": "Usunąć ten turniej i wszystkie jego mecze?",
    "notFound": "Nie znaleziono turnieju.",
    "loading": "Ładowanie…",
    "loadFailed": "Nie udało się wczytać turnieju.",
    "tabs": { "config": "Ustawienia", "matches": "Mecze", "standings": "Tabela" },
    "config": {
      "title": "Format",
      "gamesPerPair": "Mecze między każdą parą drużyn",
      "courts": "Boiska",
      "save": "Zapisz format",
      "saved": "Format zapisany",
      "teamsTitle": "Drużyny",
      "addTeam": "Dodaj drużynę",
      "removeTeam": "Usuń",
      "selectPlayer": "Wybierz gracza",
      "saveTeams": "Zapisz drużyny",
      "teamsHint": "Gracz może być tylko w jednej drużynie.",
      "generate": "Wygeneruj terminarz",
      "generateConfirm": "To usunie obecny terminarz i wszystkie zapisane wyniki. Wygenerować nowy?",
      "generateConfirmTitle": "Wygeneruj ponownie",
      "cancel": "Anuluj",
      "confirm": "Wygeneruj ponownie",
      "needTeams": "Najpierw dodaj co najmniej dwie drużyny."
    },
    "matchesTab": {
      "round": "Runda",
      "court": "Boisko",
      "save": "Zapisz mecz",
      "edit": "Edytuj",
      "clear": "Wyczyść wynik",
      "clearConfirm": "Wyczyścić wynik tego meczu?",
      "empty": "Nie ma jeszcze terminarza — wygeneruj go w zakładce Ustawienia.",
      "invalidScore": "Podaj dwie różne liczby całkowite."
    },
    "standings": {
      "place": "#",
      "team": "Drużyna",
      "played": "M",
      "wins": "Z",
      "losses": "P",
      "points": "Punkty",
      "empty": "Nie ma jeszcze wyników."
    }
  }
```

`locales/be/common.json` — add `"ongoing": "Турнір"` to `nav`, then:

```json
  "ongoing": {
    "title": "Бягучыя турніры",
    "subtitle": "Наладзьце фармат, згенеруйце расклад і сачыце за вынікамі ў рэальным часе.",
    "createTitle": "Новы турнір",
    "namePlaceholder": "Назва турніру",
    "create": "Стварыць",
    "empty": "Турніраў яшчэ няма.",
    "teams": "Каманды",
    "matches": "Матчы",
    "played": "Згуляна",
    "delete": "Выдаліць",
    "deleteConfirm": "Выдаліць гэты турнір і ўсе яго матчы?",
    "notFound": "Турнір не знойдзены.",
    "loading": "Загрузка…",
    "loadFailed": "Не атрымалася загрузіць турнір.",
    "tabs": { "config": "Налады", "matches": "Матчы", "standings": "Табліца" },
    "config": {
      "title": "Фармат",
      "gamesPerPair": "Гульняў паміж кожнай парай каманд",
      "courts": "Пляцовак",
      "save": "Захаваць фармат",
      "saved": "Фармат захаваны",
      "teamsTitle": "Каманды",
      "addTeam": "Дадаць каманду",
      "removeTeam": "Прыбраць",
      "selectPlayer": "Абярыце гульца",
      "saveTeams": "Захаваць каманды",
      "teamsHint": "Гулец можа быць толькі ў адной камандзе.",
      "generate": "Згенераваць расклад",
      "generateConfirm": "Гэта выдаліць бягучы расклад і ўсе захаваныя вынікі. Згенераваць новы?",
      "generateConfirmTitle": "Перагенераваць расклад",
      "cancel": "Скасаваць",
      "confirm": "Перагенераваць",
      "needTeams": "Спачатку дадайце хаця б дзве каманды."
    },
    "matchesTab": {
      "round": "Раўнд",
      "court": "Пляцоўка",
      "save": "Захаваць матч",
      "edit": "Рэдагаваць",
      "clear": "Ачысціць вынік",
      "clearConfirm": "Ачысціць вынік гэтага матчу?",
      "empty": "Раскладу яшчэ няма — згенеруйце яго ва ўкладцы «Налады».",
      "invalidScore": "Увядзіце два розныя цэлыя лікі."
    },
    "standings": {
      "place": "#",
      "team": "Каманда",
      "played": "І",
      "wins": "П",
      "losses": "Пр",
      "points": "Ачкі",
      "empty": "Вынікаў яшчэ няма."
    }
  }
```

- [ ] **Step 4: Verify the four locale files are still valid JSON**

```bash
cd volleyball-management-ui && for f in locales/*/common.json; do node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" && echo "$f ok"; done
```

Expected: four `ok` lines.

- [ ] **Step 5: Write the list page**

Create `volleyball-management-ui/app/ongoing/page.tsx`:

```tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Trash2, Plus } from "lucide-react";
import { Navigation } from "@/components/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useIsAdmin } from "@/hooks/use-is-admin";
import API from "@/lib/api";
import type { OngoingEventListItem } from "@/lib/types";

async function fetchOngoingEvents(): Promise<OngoingEventListItem[]> {
  const response = await fetch(API.GET_ONGOING_EVENTS);
  if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
  return response.json();
}

export default function OngoingListPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const isAdmin = useIsAdmin();
  const [name, setName] = useState("");

  const { data: events = [], isLoading } = useQuery<OngoingEventListItem[]>({
    queryKey: ["ongoing-events"],
    queryFn: fetchOngoingEvents,
  });

  const createMutation = useMutation({
    mutationFn: async (tournamentName: string) => {
      const response = await fetch(API.CREATE_ONGOING_EVENT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: tournamentName, date: new Date().toISOString() }),
      });
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      return response.json();
    },
    onSuccess: () => {
      setName("");
      queryClient.invalidateQueries({ queryKey: ["ongoing-events"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(API.DELETE_ONGOING_EVENT(id), { method: "DELETE" });
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["ongoing-events"] }),
  });

  return (
    <div className="min-h-screen bg-background">
      <Navigation />
      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-semibold tracking-tight" suppressHydrationWarning>
          {t("ongoing.title")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground" suppressHydrationWarning>
          {t("ongoing.subtitle")}
        </p>

        {isAdmin && (
          <Card className="mt-6">
            <CardContent className="flex flex-col gap-3 p-4 sm:flex-row">
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t("ongoing.namePlaceholder")}
              />
              <Button
                onClick={() => createMutation.mutate(name.trim())}
                disabled={!name.trim() || createMutation.isPending}
              >
                <Plus className="mr-2 h-4 w-4" />
                <span suppressHydrationWarning>{t("ongoing.create")}</span>
              </Button>
            </CardContent>
          </Card>
        )}

        {isLoading && (
          <p className="mt-6 text-sm text-muted-foreground" suppressHydrationWarning>
            {t("ongoing.loading")}
          </p>
        )}

        {!isLoading && !events.length && (
          <p className="mt-6 text-sm text-muted-foreground" suppressHydrationWarning>
            {t("ongoing.empty")}
          </p>
        )}

        <div className="mt-6 flex flex-col gap-3">
          {events.map((event) => (
            <Card key={event.id}>
              <CardContent className="flex items-center justify-between gap-4 p-4">
                <Link href={`/ongoing/${event.id}`} className="min-w-0 flex-1">
                  <p className="truncate font-medium">{event.name}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t("ongoing.teams")}: {event.teamsCount} · {t("ongoing.matches")}: {event.gamesCount} ·{" "}
                    {t("ongoing.played")}: {event.playedCount}
                  </p>
                </Link>
                {isAdmin && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("ongoing.delete")}
                    onClick={() => {
                      if (window.confirm(t("ongoing.deleteConfirm"))) deleteMutation.mutate(event.id);
                    }}
                  >
                    <Trash2 className="h-4 w-4 text-muted-foreground" />
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </main>
    </div>
  );
}
```

- [ ] **Step 5b: Confirm the `Button` primitive supports `disabled` and `size="icon"`**

Run: `cd volleyball-management-ui && grep -n "icon" components/ui/button.tsx`
Expected: an `icon` entry in the `size` variants. If it is absent, use `size="sm"` instead — do not add a new variant.

- [ ] **Step 6: Typecheck and lint**

```bash
cd volleyball-management-ui && npx tsc --noEmit && npm run lint
```

Expected: both clean.

- [ ] **Step 7: Exercise the route**

Start the dev server on port 3001 (`npm run dev -- -p 3001`) with the backend running, set `localStorage.ADMIN_PASSWORD` to the admin value in the browser console, reload, and open `http://localhost:3001/ongoing`. Expected: the nav shows the new item; creating a tournament adds a card without a full page reload; the delete button removes it after the confirm.

---

## Task 9: Detail page shell and Config tab

**Files:**
- Create: `volleyball-management-ui/app/ongoing/[id]/page.tsx`
- Create: `volleyball-management-ui/components/ongoing/ongoing-config-tab.tsx`

**Interfaces:**
- Consumes: `API.GET_ONGOING_EVENT`, `API.UPDATE_ONGOING_CONFIG`, `API.SET_ONGOING_TEAMS`, `API.GENERATE_ONGOING_SCHEDULE`, `API.GET_ALL_PLAYERS`, `OngoingEvent`, `Player`, `useIsAdmin`
- Produces:
  - the route `/ongoing/[id]`; the query key `['ongoing-event', id]`
  - `<OngoingConfigTab event={OngoingEvent} />`
  - Tasks 10 and 11 render into the same shell via `<OngoingMatchesTab event={...} />` and `<OngoingStandingsTab event={...} />`

- [ ] **Step 1: Write the page shell**

Create `volleyball-management-ui/app/ongoing/[id]/page.tsx`. The three tab components are imported now; Tasks 10 and 11 create the last two, so this file will not compile until they exist — implement the tasks in order.

```tsx
"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Settings, CalendarDays, ListOrdered } from "lucide-react";
import { Navigation } from "@/components/navigation";
import { Button } from "@/components/ui/button";
import { OngoingConfigTab } from "@/components/ongoing/ongoing-config-tab";
import { OngoingMatchesTab } from "@/components/ongoing/ongoing-matches-tab";
import { OngoingStandingsTab } from "@/components/ongoing/ongoing-standings-tab";
import { useIsAdmin } from "@/hooks/use-is-admin";
import API from "@/lib/api";
import { cn } from "@/lib/utils";
import type { OngoingEvent } from "@/lib/types";

type OngoingTab = "config" | "matches" | "standings";

const TABS: { key: OngoingTab; labelKey: string; icon: typeof Settings }[] = [
  { key: "matches", labelKey: "ongoing.tabs.matches", icon: CalendarDays },
  { key: "standings", labelKey: "ongoing.tabs.standings", icon: ListOrdered },
  { key: "config", labelKey: "ongoing.tabs.config", icon: Settings },
];

export default function OngoingEventPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { t } = useTranslation();
  const isAdmin = useIsAdmin();
  const [tab, setTab] = useState<OngoingTab>("matches");

  const { data: event, isLoading, isError } = useQuery<OngoingEvent>({
    queryKey: ["ongoing-event", id],
    queryFn: async () => {
      const response = await fetch(API.GET_ONGOING_EVENT(id));
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      return response.json();
    },
  });

  const visibleTabs = TABS.filter((item) => item.key !== "config" || isAdmin);

  return (
    <div className="min-h-screen bg-background">
      <Navigation />
      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        {isLoading && (
          <p className="text-sm text-muted-foreground" suppressHydrationWarning>
            {t("ongoing.loading")}
          </p>
        )}

        {isError && (
          <p className="text-sm text-destructive" suppressHydrationWarning>
            {t("ongoing.loadFailed")}
          </p>
        )}

        {event && (
          <>
            <h1 className="text-2xl font-semibold tracking-tight">{event.name}</h1>

            <div className="mt-6 flex flex-wrap gap-2">
              {visibleTabs.map((item) => (
                <Button
                  key={item.key}
                  variant={tab === item.key ? "default" : "outline"}
                  onClick={() => setTab(item.key)}
                  className={cn("gap-2")}
                >
                  <item.icon className="h-4 w-4" />
                  <span suppressHydrationWarning>{t(item.labelKey)}</span>
                </Button>
              ))}
            </div>

            <div className="mt-6">
              {tab === "matches" && <OngoingMatchesTab event={event} />}
              {tab === "standings" && <OngoingStandingsTab event={event} />}
              {tab === "config" && isAdmin && <OngoingConfigTab event={event} />}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Write the Config tab**

Create `volleyball-management-ui/components/ongoing/ongoing-config-tab.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Plus, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import API from "@/lib/api";
import type { OngoingEvent, Player } from "@/lib/types";

interface OngoingConfigTabProps {
  event: OngoingEvent;
}

interface TeamDraft {
  player1Id: string;
  player2Id: string;
}

async function putJson(url: string, body: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: "Request failed" }));
    throw new Error(error.message || `HTTP error! status: ${response.status}`);
  }
  return response.json();
}

export function OngoingConfigTab({ event }: OngoingConfigTabProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [gamesPerPair, setGamesPerPair] = useState(event.config.gamesPerPair);
  const [courts, setCourts] = useState(event.config.courts);
  const [teams, setTeams] = useState<TeamDraft[]>(
    event.teams.map((team) => ({ player1Id: team.player1.id, player2Id: team.player2.id })),
  );
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);

  const { data: players = [] } = useQuery<Player[]>({
    queryKey: ["players"],
    queryFn: async () => {
      const response = await fetch(API.GET_ALL_PLAYERS);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      return response.json();
    },
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["ongoing-event", event.id] });

  const saveConfigMutation = useMutation({
    mutationFn: () => putJson(API.UPDATE_ONGOING_CONFIG(event.id), { gamesPerPair, courts }),
    onSuccess: invalidate,
  });

  const saveTeamsMutation = useMutation({
    mutationFn: () =>
      putJson(API.SET_ONGOING_TEAMS(event.id), {
        teams: teams.filter((team) => team.player1Id && team.player2Id),
      }),
    onSuccess: invalidate,
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(API.GENERATE_ONGOING_SCHEDULE(event.id), { method: "POST" });
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: "Request failed" }));
        throw new Error(error.message || `HTTP error! status: ${response.status}`);
      }
      return response.json();
    },
    onSuccess: () => {
      setIsConfirmOpen(false);
      invalidate();
    },
  });

  // A player already picked in another row must not be selectable again — the API rejects it anyway.
  const takenPlayerIds = new Set(
    teams.flatMap((team) => [team.player1Id, team.player2Id]).filter(Boolean),
  );

  const updateTeam = (index: number, field: keyof TeamDraft, value: string) => {
    setTeams(teams.map((team, position) => (position === index ? { ...team, [field]: value } : team)));
  };

  const renderPlayerSelect = (index: number, field: keyof TeamDraft) => {
    const selected = teams[index][field];
    return (
      <select
        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
        value={selected}
        onChange={(changeEvent) => updateTeam(index, field, changeEvent.target.value)}
      >
        <option value="">{t("ongoing.config.selectPlayer")}</option>
        {players
          .filter((player) => player.id === selected || !takenPlayerIds.has(player.id))
          .map((player) => (
            <option key={player.id} value={player.id}>
              {player.name}
            </option>
          ))}
      </select>
    );
  };

  const hasEnoughTeams = teams.filter((team) => team.player1Id && team.player2Id).length >= 2;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardContent className="flex flex-col gap-4 p-4">
          <p className="font-medium" suppressHydrationWarning>
            {t("ongoing.config.title")}
          </p>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground" suppressHydrationWarning>
              {t("ongoing.config.gamesPerPair")}
            </span>
            <select
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={gamesPerPair}
              onChange={(changeEvent) => setGamesPerPair(Number(changeEvent.target.value))}
            >
              <option value={1}>1</option>
              <option value={2}>2</option>
              <option value={3}>3</option>
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground" suppressHydrationWarning>
              {t("ongoing.config.courts")}
            </span>
            <Input
              type="number"
              min={1}
              value={courts}
              onChange={(changeEvent) => setCourts(Number(changeEvent.target.value))}
            />
          </label>

          <Button
            className="self-start"
            onClick={() => saveConfigMutation.mutate()}
            disabled={saveConfigMutation.isPending}
          >
            <span suppressHydrationWarning>{t("ongoing.config.save")}</span>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-4 p-4">
          <p className="font-medium" suppressHydrationWarning>
            {t("ongoing.config.teamsTitle")}
          </p>
          <p className="text-sm text-muted-foreground" suppressHydrationWarning>
            {t("ongoing.config.teamsHint")}
          </p>

          {teams.map((team, index) => (
            <div key={index} className="flex items-center gap-2">
              {renderPlayerSelect(index, "player1Id")}
              {renderPlayerSelect(index, "player2Id")}
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("ongoing.config.removeTeam")}
                onClick={() => setTeams(teams.filter((_, position) => position !== index))}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}

          <Button
            variant="outline"
            className="self-start"
            onClick={() => setTeams([...teams, { player1Id: "", player2Id: "" }])}
          >
            <Plus className="mr-2 h-4 w-4" />
            <span suppressHydrationWarning>{t("ongoing.config.addTeam")}</span>
          </Button>

          {saveTeamsMutation.isError && (
            <p className="text-sm text-destructive">{(saveTeamsMutation.error as Error).message}</p>
          )}

          <Button
            className="self-start"
            onClick={() => saveTeamsMutation.mutate()}
            disabled={saveTeamsMutation.isPending}
          >
            <span suppressHydrationWarning>{t("ongoing.config.saveTeams")}</span>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-3 p-4">
          {!hasEnoughTeams && (
            <p className="text-sm text-muted-foreground" suppressHydrationWarning>
              {t("ongoing.config.needTeams")}
            </p>
          )}
          <Button
            className="self-start"
            disabled={!hasEnoughTeams || generateMutation.isPending}
            onClick={() => (event.games.length ? setIsConfirmOpen(true) : generateMutation.mutate())}
          >
            <span suppressHydrationWarning>{t("ongoing.config.generate")}</span>
          </Button>
          {generateMutation.isError && (
            <p className="text-sm text-destructive">{(generateMutation.error as Error).message}</p>
          )}
        </CardContent>
      </Card>

      <Dialog open={isConfirmOpen} onOpenChange={setIsConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle suppressHydrationWarning>{t("ongoing.config.generateConfirmTitle")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground" suppressHydrationWarning>
            {t("ongoing.config.generateConfirm")}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsConfirmOpen(false)}>
              <span suppressHydrationWarning>{t("ongoing.config.cancel")}</span>
            </Button>
            <Button onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending}>
              <span suppressHydrationWarning>{t("ongoing.config.confirm")}</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

Saving teams reloads the event, so `event.teams` changes — but `teams` state is seeded once at mount and deliberately not synced back with an effect. `set-state-in-effect` already fires three times in this repo; do not add a fourth. The user's draft stays theirs until they navigate away.

- [ ] **Step 3: Confirm the Dialog primitive exports the parts used here**

Run: `cd volleyball-management-ui && grep -n "^export" components/ui/dialog.tsx`
Expected: `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogFooter` are all exported. If `DialogFooter` is missing, replace it with a `<div className="flex justify-end gap-2">`.

- [ ] **Step 4: Typecheck**

Run: `cd volleyball-management-ui && npx tsc --noEmit`
Expected: two errors, both `Cannot find module '@/components/ongoing/ongoing-matches-tab'` and `.../ongoing-standings-tab`. Those are created in Tasks 10 and 11. Any *other* error must be fixed now.

---

## Task 10: Matches tab

**Files:**
- Create: `volleyball-management-ui/components/ongoing/ongoing-match-card.tsx`
- Create: `volleyball-management-ui/components/ongoing/ongoing-matches-tab.tsx`

**Interfaces:**
- Consumes: `API.UPDATE_ONGOING_GAME`, `API.CLEAR_ONGOING_GAME_RESULT`, `teamName`, `isPlayed`, `OngoingEvent`, `OngoingGame`, `OngoingTeam`, `useIsAdmin`
- Produces: `<OngoingMatchesTab event={OngoingEvent} />`, `<OngoingMatchCard game team1 team2 canEdit />`

- [ ] **Step 1: Write the match card**

Create `volleyball-management-ui/components/ongoing/ongoing-match-card.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Check, Pencil, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import API from "@/lib/api";
import { isPlayed, teamName } from "@/lib/ongoing-standings";
import type { OngoingGame, OngoingTeam } from "@/lib/types";

interface OngoingMatchCardProps {
  game: OngoingGame;
  team1: OngoingTeam;
  team2: OngoingTeam;
  canEdit: boolean;
}

export function OngoingMatchCard({ game, team1, team2, canEdit }: OngoingMatchCardProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const played = isPlayed(game);
  const [isEditing, setIsEditing] = useState(!played);
  const [points1, setPoints1] = useState(game.team1Points === null ? "" : String(game.team1Points));
  const [points2, setPoints2] = useState(game.team2Points === null ? "" : String(game.team2Points));

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["ongoing-event", game.eventId] });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(API.UPDATE_ONGOING_GAME(game.id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ team1Points: Number(points1), team2Points: Number(points2) }),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: "Request failed" }));
        throw new Error(error.message || `HTTP error! status: ${response.status}`);
      }
      return response.json();
    },
    onSuccess: () => {
      setIsEditing(false);
      invalidate();
    },
  });

  const clearMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(API.CLEAR_ONGOING_GAME_RESULT(game.id), { method: "DELETE" });
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      return response.json();
    },
    onSuccess: () => {
      setPoints1("");
      setPoints2("");
      setIsEditing(true);
      invalidate();
    },
  });

  const parsed1 = Number(points1);
  const parsed2 = Number(points2);
  const isScoreValid =
    points1 !== "" &&
    points2 !== "" &&
    Number.isInteger(parsed1) &&
    Number.isInteger(parsed2) &&
    parsed1 >= 0 &&
    parsed2 >= 0 &&
    parsed1 !== parsed2;

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <span className="rounded-md bg-secondary px-2 py-1 text-xs font-medium text-muted-foreground">
            {t("ongoing.matchesTab.court")} {game.court}
          </span>
          {canEdit && played && !isEditing && (
            <div className="flex gap-1">
              <Button variant="ghost" size="icon" aria-label={t("ongoing.matchesTab.edit")} onClick={() => setIsEditing(true)}>
                <Pencil className="h-4 w-4 text-muted-foreground" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("ongoing.matchesTab.clear")}
                onClick={() => {
                  if (window.confirm(t("ongoing.matchesTab.clearConfirm"))) clearMutation.mutate();
                }}
              >
                <Trash2 className="h-4 w-4 text-muted-foreground" />
              </Button>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3">
          <span className="flex-1 text-right text-sm font-medium">{teamName(team1)}</span>

          {canEdit && isEditing ? (
            <div className="flex items-center gap-2">
              <Input
                className="w-16 text-center"
                inputMode="numeric"
                value={points1}
                onChange={(changeEvent) => setPoints1(changeEvent.target.value)}
              />
              <span className="text-muted-foreground">:</span>
              <Input
                className="w-16 text-center"
                inputMode="numeric"
                value={points2}
                onChange={(changeEvent) => setPoints2(changeEvent.target.value)}
              />
            </div>
          ) : (
            <span className="min-w-24 text-center text-sm font-semibold tabular-nums">
              {played ? `${game.team1Points} : ${game.team2Points}` : "— : —"}
            </span>
          )}

          <span className="flex-1 text-sm font-medium">{teamName(team2)}</span>
        </div>

        {canEdit && isEditing && (
          <>
            {!isScoreValid && (points1 !== "" || points2 !== "") && (
              <p className="text-center text-xs text-destructive" suppressHydrationWarning>
                {t("ongoing.matchesTab.invalidScore")}
              </p>
            )}
            {saveMutation.isError && (
              <p className="text-center text-xs text-destructive">{(saveMutation.error as Error).message}</p>
            )}
            <Button
              className="self-center"
              disabled={!isScoreValid || saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
            >
              <Check className="mr-2 h-4 w-4" />
              <span suppressHydrationWarning>{t("ongoing.matchesTab.save")}</span>
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
```

`Number("")` is `0`, which is why `points1 !== ""` is checked before the numeric guards — without it an empty box would read as a legal 0.

- [ ] **Step 2: Write the matches tab**

Create `volleyball-management-ui/components/ongoing/ongoing-matches-tab.tsx`:

```tsx
"use client";

import { useTranslation } from "react-i18next";
import { OngoingMatchCard } from "@/components/ongoing/ongoing-match-card";
import { useIsAdmin } from "@/hooks/use-is-admin";
import type { OngoingEvent, OngoingGame } from "@/lib/types";

interface OngoingMatchesTabProps {
  event: OngoingEvent;
}

export function OngoingMatchesTab({ event }: OngoingMatchesTabProps) {
  const { t } = useTranslation();
  const isAdmin = useIsAdmin();

  const teamsById = new Map(event.teams.map((team) => [team.id, team]));

  const rounds = new Map<number, OngoingGame[]>();
  for (const game of event.games) {
    const existing = rounds.get(game.round) || [];
    existing.push(game);
    rounds.set(game.round, existing);
  }
  const roundNumbers = Array.from(rounds.keys()).sort((a, b) => a - b);

  if (!event.games.length) {
    return (
      <p className="text-sm text-muted-foreground" suppressHydrationWarning>
        {t("ongoing.matchesTab.empty")}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {roundNumbers.map((round) => (
        <section key={round} className="flex flex-col gap-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t("ongoing.matchesTab.round")} {round}
          </h2>
          {(rounds.get(round) || []).map((game) => {
            const team1 = teamsById.get(game.team1Id);
            const team2 = teamsById.get(game.team2Id);
            if (!team1 || !team2) return null;

            return (
              <OngoingMatchCard
                key={game.id}
                game={game}
                team1={team1}
                team2={team2}
                canEdit={isAdmin}
              />
            );
          })}
        </section>
      ))}
    </div>
  );
}
```

Clearing a result resets the visible inputs because `clearMutation.onSuccess` sets `points1`/`points2` back to `""` explicitly. Keying by `game.id` does NOT remount on clear — the id is unchanged, only the scores go null — so the reset must stay explicit.

- [ ] **Step 3: Typecheck**

Run: `cd volleyball-management-ui && npx tsc --noEmit`
Expected: one remaining error, `Cannot find module '@/components/ongoing/ongoing-standings-tab'` — created in Task 11.

---

## Task 11: Standings tab

**Files:**
- Create: `volleyball-management-ui/components/ongoing/ongoing-standings-tab.tsx`

**Interfaces:**
- Consumes: `computeStandings`, `teamName` from Task 7
- Produces: `<OngoingStandingsTab event={OngoingEvent} />`

- [ ] **Step 1: Write the tab**

Create `volleyball-management-ui/components/ongoing/ongoing-standings-tab.tsx`:

```tsx
"use client";

import { useTranslation } from "react-i18next";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { computeStandings, teamName } from "@/lib/ongoing-standings";
import type { OngoingEvent } from "@/lib/types";

interface OngoingStandingsTabProps {
  event: OngoingEvent;
}

export function OngoingStandingsTab({ event }: OngoingStandingsTabProps) {
  const { t } = useTranslation();
  const standings = computeStandings(event.teams, event.games);

  if (!standings.length) {
    return (
      <p className="text-sm text-muted-foreground" suppressHydrationWarning>
        {t("ongoing.standings.empty")}
      </p>
    );
  }

  return (
    <Card>
      <CardContent className="overflow-x-auto p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12" suppressHydrationWarning>
                {t("ongoing.standings.place")}
              </TableHead>
              <TableHead suppressHydrationWarning>{t("ongoing.standings.team")}</TableHead>
              <TableHead className="text-right" suppressHydrationWarning>
                {t("ongoing.standings.played")}
              </TableHead>
              <TableHead className="text-right" suppressHydrationWarning>
                {t("ongoing.standings.wins")}
              </TableHead>
              <TableHead className="text-right" suppressHydrationWarning>
                {t("ongoing.standings.losses")}
              </TableHead>
              <TableHead className="text-right" suppressHydrationWarning>
                {t("ongoing.standings.points")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {standings.map((row) => (
              <TableRow key={row.team.id}>
                <TableCell className="text-muted-foreground">{row.place}</TableCell>
                <TableCell className="font-medium">{teamName(row.team)}</TableCell>
                <TableCell className="text-right tabular-nums">{row.played}</TableCell>
                <TableCell className="text-right tabular-nums">{row.wins}</TableCell>
                <TableCell className="text-right tabular-nums">{row.losses}</TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {row.pointsFor}–{row.pointsAgainst}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Confirm the Table primitive exports the parts used here**

Run: `cd volleyball-management-ui && grep -n "^export" components/ui/table.tsx`
Expected: `Table`, `TableHeader`, `TableBody`, `TableHead`, `TableRow`, `TableCell` all exported.

- [ ] **Step 3: Typecheck and lint**

```bash
cd volleyball-management-ui && npx tsc --noEmit && npm run lint
```

Expected: both clean — this is the first point at which `npx tsc --noEmit` passes with no missing-module errors.

---

## Task 12: End-to-end verification

**Files:** none — verification only.

**Interfaces:**
- Consumes: everything from Tasks 1–11
- Produces: evidence that the feature works

- [ ] **Step 1: Run the backend suite and build**

```bash
cd volley-app-service && npm run test && npm run build
```

Expected: all specs pass, build succeeds. Report the actual output — do not claim success without it.

- [ ] **Step 2: Run the frontend checks**

```bash
cd volleyball-management-ui && npx tsc --noEmit && npm run lint && npm run build
```

Expected: all three clean. `next build` does **not** typecheck (`ignoreBuildErrors: true`), which is why `tsc --noEmit` runs separately and is the real gate.

- [ ] **Step 3: Walk the happy path in the browser**

With the backend on 3000 and `npm run dev -- -p 3001`, and `localStorage.ADMIN_PASSWORD` set to the admin value:

1. `/ongoing` → create a tournament → it appears in the list.
2. Open it → **Config** → set games-per-pair to 2 and courts to 2 → Save format → reload → the values persist.
3. Add three teams from six distinct players → Save teams → each player disappears from the other rows' dropdowns.
4. Generate schedule → confirm the dialog is **not** shown the first time (no existing games) → **Matches** shows 6 fixtures across rounds, at most 2 per round, no team twice in a round.
5. Enter `15` : `7` on the first match → Save Match → the card collapses to the score with edit and clear icons.
6. **Standings** → that team shows P 1, W 1, L 0, Points `15–7`; the loser shows `7–15` and place 2 or lower.
7. Back to **Config** → Generate schedule → this time the confirmation dialog appears → confirm → the schedule is new and all scores are cleared.
8. Clear a result via the trash icon → the card returns to empty inputs and Standings drops that match.

- [ ] **Step 4: Check for console and network errors**

With the browser devtools open through the walkthrough: no red console errors, and every `/ongoing` request returns 2xx. A 400 from a deliberately invalid score (e.g. `15` : `15`) is expected and must surface as the inline error message, not a silent success.

- [ ] **Step 5: Verify the other locales render**

Switch the language to uk, pl, and be with the language switcher. Expected: no raw key strings such as `ongoing.tabs.matches` anywhere on either route. A visible key means that locale file is missing the entry.

---

## Notes for the implementer

- **Do not run `npm run prisma:migrate:dev` against the shared remote database without asking.** Task 1 Step 1 exists for this reason.
- **Do not call `agregateRankings()` anywhere in this feature.** The ongoing tables are deliberately outside the rating chain; touching it would rewrite every player's rating.
- **No git commands.** Both repos forbid them unless the user asks directly. Report what is ready to commit instead of committing it.
