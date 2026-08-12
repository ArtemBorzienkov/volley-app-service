# volley-app-service — Beach Volleyball backend API

`volley-app-service` is the REST API and rating engine behind **SandStats**, the
beach‑volleyball tournament‑management platform (the deployed instance serves the
Warsaw beach‑volley scene at **api.waw-beach-volley.site**). It owns all
persistent data — players, events, games, memberships and the ELO‑style player
rating — and exposes it to the front‑end (`volleyball-management-ui`, Next.js).

Built with **NestJS 9** + **Prisma 4** on **PostgreSQL**.

---

## Table of contents

- [What the service does](#what-the-service-does)
- [Tech stack](#tech-stack)
- [Architecture & modules](#architecture--modules)
- [Data model (Prisma schema)](#data-model-prisma-schema)
- [API reference](#api-reference)
- [The rating engine](#the-rating-engine)
- [Player statistics: two sources of truth](#player-statistics-two-sources-of-truth)
- [Getting started (development)](#getting-started-development)
- [Environment variables](#environment-variables)
- [Database & Prisma workflow](#database--prisma-workflow)
- [Build & deployment](#build--deployment)
- [Testing](#testing)
- [Known quirks & caveats](#known-quirks--caveats)

---

## What the service does

- **Manage players** — create players, list active players, and produce an
  "enriched" player view (rating, medals, win rate, recent form).
- **Manage events (tournaments & trainings)** — create an event together with all
  its 2‑v‑2 games and final standings ("places") in a single call.
- **Manage games** — CRUD for individual matches, plus a paginated
  per‑player game feed.
- **Compute rankings** — leaderboards by many metrics (rating, win rate, wins,
  sets, tournaments, games played, points difference…), grouped by gender.
- **Maintain an ELO‑like rating** — update every player's rating per game and keep
  a full, replayable audit chain (`game_player_rank`).
- **Manage event memberships** — a join table between players and events.

There is **no authentication layer** in this service — access control lives
(loosely) in the front‑end. Treat every endpoint as unauthenticated. CORS is
restricted to a fixed allow‑list of origins (see `src/main.ts`).

---

## Tech stack

| Area | Choice |
|------|--------|
| Framework | **NestJS 9** (`@nestjs/common`, `core`, `platform-express`) |
| ORM | **Prisma 4** (`@prisma/client`) |
| Database | **PostgreSQL** |
| Language | TypeScript 4.7 |
| Validation | `class-validator` + `class-transformer` (DTOs) |
| Testing | Jest + Supertest |
| Runtime | Node 20 |

---

## Architecture & modules

Standard NestJS module‑per‑domain layout. `AppModule` wires together:

| Module | Route prefix | Responsibility |
|--------|--------------|----------------|
| `PrismaModule` | — | Global Prisma client / DB connection |
| `PlayersModule` | `/players` | Player CRUD + enriched player view |
| `EventsModule` | `/events` | Events + the "create event with games" flow |
| `GamesModule` | `/games` | Game CRUD + per‑player game feed |
| `EventMembersModule` | `/event-members` | Player↔event registrations |
| `RankingsModule` | `/rankings` | Leaderboards + the rating engine |
| `StatisticsModule` | — | On‑the‑fly per‑player stat computation (internal) |

Each module follows `controller → service → PrismaService`, with `dto/` (request
& response shapes, validated via `class-validator`) and, where relevant,
`entities/`. `EventsService` depends on `RankingsService` to update ratings when a
tournament is created.

```
src/
  main.ts                 # bootstrap: CORS allow-list, listens on :3000
  app.module.ts           # root module
  prisma/                 # PrismaService + module
  players/                # /players
  events/                 # /events
  games/                  # /games
  event-members/          # /event-members
  rankings/               # /rankings + rating engine (rankings.service.ts, utils.ts)
  statistics/             # PlayerStatisticsService (internal, no controller)
  common/                 # shared DTOs (date-range, ranking-filters) + exceptions
  utils/                  # shared types
prisma/
  schema.prisma           # data model
  migrations/             # SQL migration history
scripts/
  migrate-and-start.sh    # prod entrypoint: migrate deploy → start:prod
```

---

## Data model (Prisma schema)

Defined in [`prisma/schema.prisma`](prisma/schema.prisma). Six models:

- **Player** (`players`) — `id`, optional Telegram `tgId`, `name`, `avatar`,
  `gender`, `active`. Has relations to all four game "slots", event memberships,
  created events, `PlayerStats`, and `GamePlayerRank`.
- **PlayerStats** (`player_stats`) — one row per player: `totalGames`,
  `totalWins`, `totalLosses`, and `rank` (**the rating, default `1000`**). Cascades
  on player delete.
- **Event** (`events`) — `name`, `date`, optional `location`, optional `createdBy`
  (creator player), and a **`data` JSON column** holding tournament standings as
  `{ "1": [playerId…], "2": […], "3": […] }`. Presence of `data` is what marks an
  event as a **tournament**; its absence marks a **training**.
- **Game** (`games`) — belongs to an event; four player FKs
  (`team1Player1/2`, `team2Player1/2`), `team1Points`/`team2Points`, `date`,
  `location`. The winner is derived from the points, not stored.
- **EventMember** (`event_members`) — unique `(userId, eventId)` join row.
- **GamePlayerRank** (`game_player_rank`) — the **rating audit chain**: one row per
  (game, player) with `rank` (the player's rating *after* that game) and
  `rankChange` (the delta applied). Rebuilt wholesale by `agregateRankings()`.

---

## API reference

Base URL = the service origin (`http://localhost:3000` in dev,
`https://api.waw-beach-volley.site` in prod).

### Players — `/players`

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/players` | Create a player (initializes a zeroed `PlayerStats`). Rejects a duplicate `tgId` with 409. |
| `GET` | `/players` | All **active** players (basic view, newest first). |
| `GET` | `/players/full` | Enriched players: adds `rank`, `medals` (gold/silver/bronze from event `data`), `totalEvents`, `totalGames`, `winRate`, and `recentGames` (last ~6 as `'win'`/`'lose'`). |
| `GET` | `/players/:id/events` | Events the player is a member of. |

### Events — `/events`

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/events` | Create a bare event (no games). |
| `POST` | `/events/with-games` | **Main flow:** create an event + all its games + `places`, and update player stats and ratings. |
| `GET` | `/events?page=&type=` | Paginated list (5/page, newest first). `type` = `all` \| `tournament` (has `data`) \| `training` (no `data`). Returns `{ events, page, hasMore, totalEvents }`. |
| `GET` | `/events/:id` | One event with its games and their rank rows. |
| `PATCH` | `/events/:id` | Update name/date/location/creator (not games or `data`). |
| `DELETE` | `/events/:id` | Delete an event (games cascade). |

`POST /events/with-games` payload
([`create-event-with-games.dto.ts`](src/events/dto/create-event-with-games.dto.ts)):

```jsonc
{
  "name": "Rio Summer Cup",
  "date": "2026-01-15T00:00:00.000Z",
  "location": "Copacabana",       // optional
  "createdBy": "<playerId>",       // optional
  "places": {                        // optional tournament standings → event.data
    "1": ["<playerId>", "<playerId>"],
    "2": ["<playerId>"]
  },
  "games": [
    {
      "team1Player1Id": "…", "team1Player2Id": "…",
      "team2Player1Id": "…", "team2Player2Id": "…",
      "team1Points": 21, "team2Points": 18
    }
  ]
}
```

### Games — `/games`

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/games` | Create a standalone game (updates player stats; **does not** update ratings — see caveats). |
| `GET` | `/games?limit=` | Latest games (default 200 via controller) + `allGamesCount`. |
| `GET` | `/games/player/:playerId?skip=&take=` | Paginated per‑player feed, oriented so the requested player is always Team 1 / Player 1; includes `rankChange` and `newRating` from the rank chain. |
| `GET` | `/games/:id` | One game. |
| `PATCH` | `/games/:id` | Update a game (reverts and re‑applies player stats; **does not** recompute ratings). |
| `DELETE` | `/games/:id` | Delete a game (reverts player stats). |

### Event members — `/event-members`

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/event-members` | Register a player to an event (409‑style duplicate guard on `(userId, eventId)`). |
| `GET` | `/event-members/event/:eventId` | Members of an event (with player). |
| `GET` | `/event-members/player/:userId` | A player's memberships. |
| `DELETE` | `/event-members/:id` | Remove by membership id. |
| `DELETE` | `/event-members/event/:eventId/player/:userId` | Remove by the composite key. |

### Rankings — `/rankings`

Leaderboard endpoints accept `RankingFiltersDto` query params:
`limit`, `startDate`, `endDate`, `eventId` (filter support varies by endpoint — see
caveats).

| Method | Path | Returns | Notes |
|--------|------|---------|-------|
| `GET` | `/rankings/wins` | list | By stored `totalWins`. |
| `GET` | `/rankings/sets` | list | "Sets won" (currently sourced from wins). |
| `GET` | `/rankings/tournaments` | list | Tournament wins (most game‑wins per event). |
| `GET` | `/rankings/lowest-losses` | list | Fewest losses (min 10 games). |
| `GET` | `/rankings/points-difference` | list | Points scored − conceded. |
| `GET` | `/rankings/won-events` | grouped | Medal counts from event `data`. |
| `GET` | `/rankings/win-rate` | grouped | Win rate (min 10 games). |
| `GET` | `/rankings/games-played` | grouped | Total games played. |
| `GET` | `/rankings/top-rank` | grouped | **The ELO rating leaderboard.** |
| `GET` | `/rankings/best-team-combinations?limit=` | list | Best 2‑player pairings by win rate. |
| `GET` | `/rankings/player-rank-history?playerId=` | list | Chronological rating chain for the rating chart. |
| `POST` | `/rankings/agregate-rankings` | 200 | **Recompute the entire rating chain from scratch** (see below). |

**Grouped** endpoints return `{ ALL, W, M }` — the full sorted list plus
female‑only and male‑only sub‑lists, each independently re‑ranked 1..N.

---

## The rating engine

The heart of the service. It is an **ELO‑like team rating** using fixed
change tables (not the classic logistic expected‑score formula). Core logic lives
in [`rankings/utils.ts`](src/rankings/utils.ts) and
[`rankings/rankings.service.ts`](src/rankings/rankings.service.ts).

**How it works**

1. Every player starts at **rating 1000** (`PlayerStats.rank`), clamped to
   `[0, 3000]` on every update.
2. For each game, the two players' ratings on a team are **summed**; the team with
   the higher sum is the **favorite**.
3. **Ties** (equal points) produce **no rating change**.
4. The rating change is looked up from `rankDifference = |team1Sum − team2Sum|`, in
   100‑point buckets, around a base `AVG_RANK_CHANGE = 15`:
   - Beating a **stronger** team → larger gain (up to ~28/30).
   - Beating a **weaker** team → smaller gain (down to ~3‑4).
   - Losing as the **favorite** is heavily penalized; big mismatches
     (`rankDifference > 1000`) use fixed extremes (`MIN 3` / `MAX 30`).
   - It is zero‑sum in magnitude per side: winners `+X`, losers `−X`.
5. **New‑player boost:** a player with **fewer than 10 total games** has their delta
   **doubled** — provisional placement so newcomers converge faster. (Computed per
   player, so teammates can receive different magnitudes.)
6. The applied (rounded) delta and the resulting rating are written to
   `game_player_rank`, and `PlayerStats.rank` is upserted.

**When ratings are written**

- ✅ `POST /events/with-games` → after inserting the games, each game triggers a
  rating update (`updatePlayersRankByGameResult`).
- ✅ `POST /rankings/agregate-rankings` → full rebuild.
- ❌ `POST/PATCH/DELETE /games` → **do not** touch ratings (only `PlayerStats`
  totals). Ratings can therefore go stale for games mutated via the games routes.

**`agregateRankings()` — full recompute**

Because each game's rating change depends on the players' *current* ratings, the
chain is **order‑dependent** and must be replayed chronologically. `agregateRankings`:

1. Resets every `PlayerStats` to `rank = 1000` and zeroes the totals.
2. **Deletes all `game_player_rank` rows.**
3. Loads all games ordered `date asc, createdAt asc, id asc` (a deterministic
   tiebreak — many games share the same date/createdAt, so `id` breaks ties).
4. Replays each game in a transaction, updating totals and re‑creating the rank
   chain.

> ⚠️ This is **slow** (one transaction per game) and **shifts every player's
> rating**. The read endpoints `player-rank-history` (asc) and `games/player/:id`
> (the exact reverse: desc) mirror this ordering so the chain reads back correctly.
> Any change to the aggregation ordering only takes effect after **re‑running**
> `POST /rankings/agregate-rankings`, and each database (local vs deployed) must be
> aggregated independently.

---

## Player statistics: two sources of truth

Be aware that per‑player stats come from **two different places**, which can drift:

- **Stored** `PlayerStats.totalGames/totalWins/totalLosses` — incremented by the
  write paths (`events/with-games`, `games` create/update/delete) and reset/rebuilt
  by `agregateRankings`. Used directly by `/rankings/wins`, `/rankings/lowest-losses`,
  and (for `rank`) `/rankings/top-rank`.
- **Computed on the fly** by `PlayerStatisticsService` — recomputed from the `game`
  table on every call (with optional date‑range/event filters), **ignoring** the
  stored columns. Used by `/players/full`, `/rankings/win-rate`,
  `/rankings/games-played`, `/rankings/sets`, and `/rankings/points-difference`.

The stored `rank` is the single source of truth for the rating.

---

## Getting started (development)

**Prerequisites:** Node 20 and a reachable PostgreSQL instance.

```bash
# 1. install
npm install

# 2. configure the database
#    edit .env → DATABASE_URL (see below)

# 3. generate the Prisma client + apply migrations to your DB
npm run prisma:generate
npm run prisma:migrate:dev

# 4. run the API (listens on http://localhost:3000)
npm run start:dev      # watch mode
```

Other scripts:

```bash
npm run start          # run once (no watch)
npm run start:prod     # run the compiled dist/main
npm run build          # nest build → dist/
npm run lint           # eslint --fix
npm run format         # prettier
npm run prisma:studio  # browse the DB in Prisma Studio
```

> **Port:** `src/main.ts` hard‑codes `app.listen(3000)` (it ignores `PORT`).
> When running the UI locally, run the front‑end on a different port to avoid a
> clash and point its `NEXT_PUBLIC_HOST_URL` at `http://localhost:3000`.

---

## Environment variables

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string (used by Prisma). |

`.env` ships with a remote database URL and a commented‑out localhost alternative.
Swap them depending on whether you want to develop against a local or shared DB.
`DATABASE_URL` is also consumed at Docker build time (for `prisma migrate deploy`)
and at container runtime.

---

## Database & Prisma workflow

- **Schema:** [`prisma/schema.prisma`](prisma/schema.prisma).
- **Create a migration (dev):** `npm run prisma:migrate:dev` — generates SQL under
  `prisma/migrations/` and applies it.
- **Apply migrations (prod):** `npm run prisma:migrate:deploy` — applies pending
  migrations without generating new ones. Run automatically on container start by
  `scripts/migrate-and-start.sh`.
- **Check status:** `npm run prisma:migrate:status`.
- **After changing the schema:** always `npm run prisma:generate` to refresh the
  typed client.

The migration history covers the full evolution: initial schema, event members,
optional Telegram id / creator, removing sets from games, the event `data` column,
splitting stats into `player_stats`, adding `rank`, and adding `game_player_rank`.

---

## Build & deployment

Automated via GitHub Actions
([`.github/workflows/production-deployment.yml`](.github/workflows/production-deployment.yml)):

1. On push to `main`, build a Docker image (`Dockerfile`, Node 20). The build
   runs `prisma generate`, optionally `prisma migrate deploy` (if `DATABASE_URL` is
   provided as a build arg), and `nest build`.
2. Push the image to Docker Hub
   (`artemborzienkov/volley-app-service:<run_id>`).
3. Over SSH, the DigitalOcean host stops/removes the old container, pulls the new
   image, and runs it as `-p 3000:3000` with `DATABASE_URL` injected from a secret.

At container start, `scripts/migrate-and-start.sh` runs `prisma migrate deploy`
(aborting startup on failure) and then `npm run start:prod`.

---

## Testing

```bash
npm run test        # unit tests (*.spec.ts, jest + ts-jest)
npm run test:e2e    # e2e tests (test/*.e2e-spec.ts)
npm run test:cov    # coverage
```

The test scaffolding is the NestJS default (`test/app.e2e-spec.ts`); domain test
coverage is currently minimal.

---

## Known quirks & caveats

- **No authentication.** Every endpoint is open; CORS is the only gate and is
  restricted to a fixed origin allow‑list in `src/main.ts`.
- **Ratings only update via events.** Creating/editing/deleting games through
  `/games` updates `PlayerStats` totals but **not** `game_player_rank` — those
  ratings go stale until the next `agregateRankings` run.
- **`agregateRankings` is destructive and slow.** It wipes and rebuilds the whole
  rank chain and resets all stats; it must be re‑run (per database) after any
  change to game ordering or rating logic.
- **Stats can drift** between the stored `PlayerStats` columns and the on‑the‑fly
  computation (see [above](#player-statistics-two-sources-of-truth)).
- **`getRankChangeByRankDifference` has no `rankDifference === 0` branch** — two
  non‑blowout teams with *exactly equal* rating sums can return `undefined` and
  throw when the caller destructures it.
- **`setsWon` / `setsLost` are placeholders** — the schema removed per‑set scores
  (games store only total points), so these fields are never populated (they read
  as `0`, and `/rankings/sets` actually ranks by win count).
- **Not atomic:** in `events/with-games`, event+game inserts run in one transaction
  but the per‑game rating updates run in separate transactions afterward.
- **Two `make_tgid_optional` migrations** exist (`20260123162529` and
  `20260123164123`) — a historical artifact in the migration history.
</content>
