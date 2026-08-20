# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`volley-app-service` is the NestJS + Prisma REST API and rating engine behind **SandStats**, a
beach-volleyball tournament platform. The front-end is `volleyball-management-ui` (Next.js, a sibling
directory).

**Read [`README.md`](README.md) first for domain detail.** It is thorough and current: full API
reference, the rating algorithm's change tables, the data model, and deployment. This file covers
only what the README does not — commands, orientation, conventions, and the traps.

## Commands

```bash
# Development
npm run start:dev        # Watch-mode server on http://localhost:3000
npm run start            # Run once, no watch
npm run start:prod       # Run the compiled dist/main

# Build
npm run build            # nest build → dist/ (also the only typecheck; there is no separate typecheck script)

# Testing
npm run test             # Unit tests (src/**/*.spec.ts, jest + ts-jest)
npm run test:e2e         # E2E tests (test/*.e2e-spec.ts)
npm run test:cov         # Coverage
npx jest src/events/events.service.spec.ts   # Single test file
npx jest -t "skips the ranking replay"       # Tests matching a name pattern

# Linting / formatting
npm run lint             # ESLint with auto-fix
npm run format           # Prettier over src/ and test/

# Database (PostgreSQL via Prisma)
npm run prisma:generate        # Regenerate the typed client — run after ANY schema change
npm run prisma:migrate:dev     # Create + apply a migration (dev)
npm run prisma:migrate:deploy  # Apply pending migrations without generating (prod)
npm run prisma:migrate:status  # Check migration state
npm run prisma:studio          # Browse the DB
```

## Architecture

Standard NestJS module-per-domain layout; `AppModule` wires seven modules. Each follows
`controller → service → PrismaService`, with request/response shapes in a `dto/` folder.

| Module | Prefix | Responsibility |
|---|---|---|
| `PrismaModule` | — | `PrismaService extends PrismaClient`, declared `@Global()` |
| `PlayersModule` | `/players` | Player CRUD + the enriched player view |
| `EventsModule` | `/events` | Events + the `with-games` flow. Depends on `RankingsService` |
| `GamesModule` | `/games` | Game CRUD + per-player game feed |
| `EventMembersModule` | `/event-members` | Player↔event registrations |
| `RankingsModule` | `/rankings` | Leaderboards + the rating engine |
| `StatisticsModule` | — | `PlayerStatisticsService`, internal, no controller |

Because `PrismaModule` is `@Global()`, `PrismaService` is injectable anywhere without an import —
but every module imports `PrismaModule` explicitly anyway. The import is redundant; match the
existing pattern in a new module rather than relying on the global.

`src/main.ts` bootstraps with a hard-coded `app.listen(3000)` (it ignores `PORT`) and a fixed CORS
origin allow-list. There is **no authentication layer** — treat every endpoint as unauthenticated.

Rating logic lives in two files: [`src/rankings/utils.ts`](src/rankings/utils.ts) (the pure
change-table lookup) and [`src/rankings/rankings.service.ts`](src/rankings/rankings.service.ts)
(persistence, leaderboards, and `agregateRankings`).

### Design docs

Written designs for non-trivial changes live in `docs/superpowers/specs/`. Read the relevant one
before working in that area:

- `docs/superpowers/specs/2026-08-20-delete-event-cascade-design.md` — event deletion: the
  `game_player_rank` FK cascade and the rank-replay contract

## The rating chain — the single most important invariant

`PlayerStats.rank` is an ELO-like rating and `game_player_rank` is its audit chain. **Each game's
rating change depends on the players' ratings at that moment**, so the chain is order-dependent.

Consequences that bite:

- **Any write that inserts, mutates, or removes a game invalidates every later game's rank.** A
  local decrement cannot repair it. The only correct repair is a full replay:
  `rankingsService.agregateRankings()`.
- **`agregateRankings()` is destructive and slow.** It resets every `player_stats` row to
  `rank: 1000` with zeroed totals, deletes **all** `game_player_rank` rows, then replays every game
  in one transaction each. It rebuilds totals as a side effect, which is why callers do not need
  their own stat arithmetic.
- **It opens its own per-game transactions, so it cannot be nested** inside a `$transaction`. Call it
  after the enclosing transaction commits.
- **Replay order is `date asc, createdAt asc, id asc`** and must stay that way. `createdAt` is the
  meaningful tiebreak: `createWithGames` deliberately stamps each game `baseCreatedAt + index` ms so
  a bulk insert's UI order survives (Postgres `now()` is constant within a transaction). The read
  endpoints `/rankings/player-rank-history` (asc) and `/games/player/:id` (desc) mirror this ordering
  — change one and you must change all three.
- **Ordering or algorithm changes only take effect after re-running**
  `POST /rankings/agregate-rankings`, **per database**. Local and deployed DBs must be aggregated
  independently.

### Foreign keys around deletion

`game_player_rank_game_id_fkey` is **`ON DELETE RESTRICT`**, and it is the newest migration, so it
was added on top of delete paths written before it existed. Deleting an event cascades to its `games`
(and `event_members`), and any surviving rank row pointing at those games **aborts that cascade** with
a `P2003`. Delete the rank rows first, in the same transaction. See `EventsService.remove` for the
worked pattern.

`GamesService.remove` still carries both defects — it hits the FK abort, and its hand-rolled
`revertPlayerStatsForGame` fixes only the win/loss counters, leaving the chain drifted.
`GamesService.update` deletes nothing, so it avoids the FK, but it rewrites a game's points while
leaving every later rank untouched — drift without the crash. Neither is a template to copy.

## Databases

**PostgreSQL only**, through Prisma 4. Schema in [`prisma/schema.prisma`](prisma/schema.prisma), six
models: `Player`, `PlayerStats`, `Event`, `Game`, `EventMember`, `GamePlayerRank`. Table and column
names are snake_case in the DB and camelCase in the client via `@map`.

A single `.env` supplies `DATABASE_URL`, and it **ships pointing at a remote/shared database** with a
commented-out localhost alternative. Check which one is active before running anything that writes.

There is **no test database.** Any test that touches Prisma for real hits whatever `DATABASE_URL`
points at, and `agregateRankings()` would rewrite every ranking in it. Unit-test with a mocked
`PrismaService` instead — see Testing below.

## Code Conventions

Prettier: single quotes, trailing commas, **120-column** print width. ESLint runs
`@typescript-eslint/recommended` with `no-explicit-any`, `explicit-function-return-type`, and
`explicit-module-boundary-types` all **off**.

### Classes for providers, arrow consts for helpers

Providers are `@Injectable()` classes with `async` methods — the NestJS idiom. Use module-level
`export const fn = (…) => {}` arrows only for pure helpers outside the DI graph
(`src/rankings/utils.ts` is the example). Do not convert service methods to arrow properties.

### Explicit return types on public methods

Every controller and service method annotates its return type (`Promise<EventResponseDto>`,
`Promise<void>`) — ~60 sites. Keep doing this: the DTO in the signature is the contract, and it is
what makes a response-shape change a compile error. This differs from repos that prefer inference.

### DTOs and the validation trap

Request and response shapes are `class-validator`-decorated classes in each module's `dto/` folder;
`common/dto/` holds the shared `RankingFiltersDto` and `DateRangeDto`.

**There is no global `ValidationPipe`.** `main.ts` never calls `useGlobalPipes`, so every
`@IsString()` / `@IsDateString()` decorator across the ten DTO files is currently **inert** — nothing
validates request bodies at the framework level, and services must not assume input is well-formed.
Validate explicitly in the service (as `validateTeamComposition` does) or register the pipe
deliberately, understanding that turning it on may start rejecting traffic the UI sends today.

### Errors

Throw NestJS HTTP exceptions from services — `NotFoundException`, `BadRequestException`,
`ConflictException`. For a repeated domain error, subclass it in `src/common/exceptions/` with a
constructor that builds the message (see `DuplicateEventMemberException`). Keep existing 404 message
wording (`Event with ID ${id} not found`) — callers match on it.

### Early returns

Guard clauses at the top, happy path at the bottom, minimal nesting. Prefer truthy/falsy length
checks over comparing to `0` — existing code is mixed (`length === 0` and `length > 0` both appear),
so this is the target for new code, not a description of every call site.

```ts
if (!event) {
  throw new NotFoundException(`Event with ID ${id} not found`);
}
if (!gameIds.length) return;
```

### Comments

Short and essential only. Comment the *why* that the code cannot state — an ordering constraint, a
non-obvious invariant, a deliberate deviation. One or two lines. Never restate what the next line
already says, and never leave a comment that a reader could derive from the identifiers.

```ts
// Rank rows first: the FK is ON DELETE RESTRICT and would abort the cascade.
await tx.gamePlayerRank.deleteMany({ where: { gameId: { in: gameIds } } });
```

### DRY — reuse before creating

Before adding a helper, query, or DTO, search for one that already covers it. Player-stat
increments (`updatePlayerStatsForGame`), team validation (`validateTeamComposition`), and rating
computation (`getRanksChangesByGameResult`) all already exist and are duplicated across services in
places. Prefer lifting an existing implementation into a shared location over copying it — and never
hand-roll rating arithmetic when `agregateRankings()` will do it correctly.

### Do not port conventions from sibling services

Other services in this workspace use a different stack. Applying their conventions here breaks
things:

- **`toSorted()` is unavailable.** `tsconfig` targets `es2017`, so the ES2023 array methods are not in
  the type lib. Use `.sort()` with an explicit comparator, on a copy when the input is not yours to
  mutate.
- **There is no ban on `function` declarations.** `main.ts`'s `bootstrap()` and test helpers use
  them; leave them alone. The class-vs-arrow guidance above is the actual rule.
- **knex/kysely, Vitest, zod, and `@/` path aliases do not exist here.** Imports are relative; the
  ORM is Prisma; the test runner is Jest; validation is `class-validator`.
- **Types live beside their module**, in `dto/` files or next to the helper that uses them, not in a
  folder-level `types.ts`. `src/utils/types.ts` and the `entities/` classes under `players/` and
  `event-members/` are **dead code** — unimported leftovers. Do not extend them or treat them as the
  pattern.

## Testing

Jest with `ts-jest`, `rootDir: src`, matching `*.spec.ts`. E2E specs use the separate
`test/jest-e2e.json` config. Coverage is currently thin — `src/events/events.service.spec.ts` is the
reference for new work.

### Unit tests mock PrismaService

With no test database, DB-backed tests are not an option, so unit-test services against a mocked
`PrismaService` provided through `Test.createTestingModule`. When the behavior under test *is* the
sequence of DB operations — as with delete ordering, where the FK makes order load-bearing — build the
mock so it records call order, and assert that sequence:

```ts
const module: TestingModule = await Test.createTestingModule({
  providers: [
    EventsService,
    { provide: PrismaService, useValue: prismaMock },
    { provide: RankingsService, useValue: rankingsMock },
  ],
}).compile();
```

Two rules that earn their keep here:

- **Mirror the real `PrismaClient` surface.** Omitting a method the code calls turns a behavioral
  failure into a `TypeError`, which hides what actually broke.
- **Assert the emitted queries and their order, not that a mock was reached.** `toHaveBeenCalledWith`
  on a hand-derived literal argument is the contract; a bare "was called" assertion is not.

### Test naming

Describe the behavior and the break it catches, in one sentence: `deletes the rank rows of exactly
the event's games before deleting the event`. Nest `describe` by class then method
(`describe('EventsService.remove')`).

### Verify before claiming done

`npm run build` is the only typecheck — run it alongside `npm run test`. When a change's whole point
is an ordering or cascade contract, mutate the production code and confirm a test actually fails;
identical code blocks elsewhere in a file make it easy for a mutation to land somewhere harmless and
look "uncaught".

## Git

Do not run any git command — no `add`, `commit`, `push`, or `checkout` — unless explicitly asked in a
direct message.

DO NOT WRITE USELESS COMMENTS
