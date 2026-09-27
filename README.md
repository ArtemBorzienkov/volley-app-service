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
- [Ongoing tournaments & schemes](#ongoing-tournaments--schemes)
- [Player anonymity](#player-anonymity--a-display-flag-not-stored-anonymisation)
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
  main.ts                 # bootstrap: CORS allow-list, listens on $PORT (default 3000)
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

Defined in [`prisma/schema.prisma`](prisma/schema.prisma). The original six models:

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

Accounts and live tournaments were added later and live in their own models:

- **User** (`users`) — `email`, hashed `password`, `role` (`admin` | `player`),
  an optional `telegramNickname`, `isAnonymous`, `dataConsentAt`, and a unique
  optional link to a `Player`.
  Sign-up asks for the nickname, not a name: the display name is resolved from the
  linked player (see [`src/user/display-name.ts`](src/user/display-name.ts)), so
  `name` is a nullable legacy column that new rows leave empty.
  `dataConsentAt` records when the account agreed to the published processing
  (GDPR art. 7(1)); sign-up refuses without it. `isAnonymous` is a **display**
  preference — see below.
- **OngoingEvent** (`ongoing_events`) — a tournament being run live, with its
  creator, `finishedAt`, and the relations below.
- **OngoingEventConfig** (`ongoing_event_config`) — one row per event: `courts`,
  `gamesPerPair`, `maxTeams`, `visibility` (`public` | `private`),
  `allowSoloRegistration`, `soloOnlyRegistration`, `hiddenRules`, and the scheme
  fields `scheme`, `groupCount`, `qualifiersPerGroup`, `rotationRounds`.
- **OngoingTeam** (`ongoing_teams`) — a registered pair plus its `groupIndex`.
- **OngoingSoloPlayer** (`ongoing_solo_players`) — a player registered without a
  partner. Unique per `(eventId, playerId)`; it is also the **roster** of a
  `fullRotation` event, where players are the entry unit.
- **OngoingGame** (`ongoing_games`) — a fixture: optional `team1Id`/`team2Id`,
  points, `round`, `court`, `order`, `phase` (`group` | `playoff` | `rotation`),
  bracket coordinates, and `groupIndex` for rotation fixtures.
- **OngoingGamePlayer** (`ongoing_game_players`) — who played on which `side` of a
  game. Populated for `rotation` games only: there a side is an ad-hoc pair rather
  than one of the event's `OngoingTeam` rows.
- **OngoingRotationSlot** (`ongoing_rotation_slots`) — a player's `groupIndex` for
  one `round` of a rotation event. Unique per `(eventId, round, playerId)`, and
  written per round so the promote/relegate history stays readable afterwards.

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

### Accounts — `/user`, `/auth`

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/user` | Sign up. Requires `acceptDataProcessing: true`; optional `telegramNickname` and `isAnonymous`. Links an existing `playerId` **or** creates a `newPlayer`, never both. The frontend's sign-up form does **not** offer `isAnonymous` — the flag is set out of band (see [Player anonymity](#player-anonymity--a-display-flag-not-stored-anonymisation)). |
| `GET` | `/user/me` | The signed-in account. |
| `POST` | `/auth/log-in` | Sets the `access_token` cookie. |
| `POST` | `/auth/log-out` | Clears it, idempotently. |

```jsonc
// POST /user
{
  "email": "player@example.com",
  "password": "at-least-8-chars",
  "acceptDataProcessing": true,   // required — results are published under a player's name
  "isAnonymous": false,           // optional — accepted, but the sign-up form does not send it
  "telegramNickname": "@nickname",// optional, 5-32 letters/digits/underscores
  "newPlayer": { "name": "Player Name", "gender": "male" }
}
```

## Ongoing tournaments & schemes

`/ongoing` runs a tournament live: register entrants, generate fixtures, record
scores, and read the standings back. Every write is guarded by `JwtAuthGuard` and
by `assertCanManage` (the event's creator, or an admin). A roster locks as soon as
any game has a result (`assertPlanning`).

### Endpoints — `/ongoing`

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/ongoing` | Unfinished events, newest first. |
| `GET` | `/ongoing/open` | Every **unfinished** tournament, for the calendar. Nothing is filtered by state: a started one, a past-dated one and a full one are all listed, carrying `hasStarted`, `registrationOpen`, `maxTeams`/`teamsCount`/`soloPlayers` so the client can say why registration is unavailable. `addTeam`/`addSoloPlayer` stay the enforcement point. |
| `GET` | `/ongoing/:id` | One event with config, roster, fixtures and, for `fullRotation`, the whole ladder. |
| `POST` | `/ongoing` | Create an event, optionally with a roster and a scheme. |
| `PATCH` | `/ongoing/:id/config` | Update courts, caps, visibility and scheme fields. |
| `POST` | `/ongoing/:id/teams` / `PUT /ongoing/:id/teams` | Add or replace pairs. Refused for `fullRotation`. |
| `POST` | `/ongoing/:id/solo` | Register a player without a partner. |
| `DELETE` | `/ongoing/solo/:soloId` | Cancel a partnerless registration. |
| `GET` | `/ongoing/:id/solo/preview` | Preview the rating-based pairing of the solo pool. |
| `POST` | `/ongoing/:id/solo/form-teams` | Turn the solo pool into pairs. |
| `POST` | `/ongoing/:id/solo/disband-teams` | The reverse: every pair goes back to the solo pool. |
| `POST` | `/ongoing/:id/schedule` | Generate the fixtures — see *Scheduling* below. For `fullRotation` this generates **round 1 only**. |
| `POST` | `/ongoing/:id/rotation/next-round` | `fullRotation` only: build the next round from this one's results. |
| `POST` | `/ongoing/:id/playoff` | `groupsPlayoff` only: seed the bracket from the group tables. |
| `PATCH` | `/ongoing/games/:gameId` | Record a score — open to the tournament's **entrants** as well as its organiser/admins (see below). |
| `DELETE` | `/ongoing/games/:gameId/result` | Clear a score — same rule as recording one. |

### Who may do what

Everything under `/ongoing` needs a session. Beyond that there are two levels:

- **Manage** (`assertCanManage`) — the event's creator or an admin. Config, roster, schedule and
  playoff generation, finishing, deleting.
- **Record a result** (`assertCanRecordResult`) — manage, **or** an entrant of that tournament: a
  player on one of its pairs, in its solo pool, or in one of its rotation groups. At a real event
  whoever is free walks over and enters the score, so this is deliberately per-event rather than
  per-game — a rotation player changes partner every fixture, and a pair only ever plays two of
  their group's courts.

### Scheduling

`packIntoRounds` in `schedule.ts` turns the fixture list into rounds of at most
`courts` matches, never with a team twice in a round, and with one more rule: **no
team sits out two rounds in a row** while it still has a game to play (idling
before the first game counts; being finished does not). It builds the day round by
round — a team that sat out the previous round must play in this one — and fills
every round to as many courts as possible, so the day is no longer than
`ceil(fixtures / courts)` rounds. Candidates are tried heaviest-first (most games
still to play), which is what keeps a tail of rounds from stranding a few teams. A
single pass usually succeeds; up to 60 reshuffled passes cover the tight cases
(e.g. 7 teams on 2 courts).

The rule is **impossible when `teams >= 4 × courts`** — 8 teams on 2 courts idle
four every round, so two consecutive idle sets would have to be exact complements
and the two halves could never meet. There the schedule is still complete, and no
rest is longer than two rounds. Group stages share the courts, so the rule holds
across the whole day, not per group.

A player can also withdraw their own entry (`assertOwnEntryOrManager`) until **24 hours before the
first ball** — `isCancellationOpen`, measured from `eventStartInstant(date, startTime)` in
`registration-window.ts`. `date` is a calendar day stored as UTC midnight and `startTime` is a
wall-clock `"HH:MM"`, so the two are combined **in UTC**: that is the only reading the browser can
reproduce exactly, and it is off by the venue's UTC offset rather than by days. An event with no
`startTime` is measured from its midnight. The organiser is not bound by the deadline — they are
fixing a roster, not withdrawing.

Note this is deliberately tighter than `isRegistrationDateOpen`, which stays open through the whole
of the tournament's own day: entering late only adds a player, while withdrawing late leaves a hole
in a schedule already built.

### After the tournament: handing over to `/events`

An ongoing tournament is working state, not the archive. When it is finished the frontend builds a
prefill, the organiser reviews it on `/add-results`, and `POST /events/with-games` writes the real
`events`, `games` and `game_player_rank` rows. **Once that returns 2xx the client deletes the
ongoing event** (`DELETE /ongoing/:id`), and the FK cascade clears every `ongoing_*` table —
config, teams, solo players, games, game players and rotation slots.

The delete is a second request rather than part of the upload, because `POST /events/with-games` has
no authentication and must not become a way to destroy a tournament. The cost is that it is not
atomic: if the browser dies in between, a finished `ongoing_events` row survives. That row is
harmless — `finishedAt` keeps it out of `/ongoing` and `/ongoing/open` — and can be deleted by hand.

### The three schemes

`OngoingEventConfig.scheme` decides how fixtures are built. It is validated in one
place — `normaliseScheme` — which also forces the fields the scheme does not use.

**`roundRobin`** (default) — one flat table. `groupCount` is forced to `1` and
`qualifiersPerGroup` to `null`; every pair meets every other pair `gamesPerPair`
times.

**`groupsPlayoff`** — pairs are dealt into `groupCount` groups, each plays a
round-robin, then the top `qualifiersPerGroup` of each group seed a knockout
bracket. `groupCount × qualifiersPerGroup` must be a power of two.

**Solo-only registration** — `soloOnlyRegistration` closes the pair entry path on
any scheme: `addTeam` is refused for everyone, the organiser included, and the
solo pool becomes the only way in (so the flag forces `allowSoloRegistration` on
too). The organiser still builds the teams, through `POST :id/solo/form-teams`
and the roster editor (`PUT :id/teams`). `form-teams` is deliberately **additive
and partial**: it takes whatever pairs it is given, requires only that each named
player is in the pool, and leaves everyone else there — which is what lets the
frontend pair some teams by hand now and the rest later.

`POST :id/solo/disband-teams` is its reverse: every pair goes back to the pool in
one transaction, with the unplayed schedule deleted first because its fixtures
reference the teams. Each player keeps the pair's `createdAt` as their
registration time rather than "now". Manage-only, refused once a result is
recorded (`assertPlanning`), refused for `fullRotation` (no teams), and refused
when `allowSoloRegistration` is off — there would be no pool to return them to. Turning it on is refused while pairs are
registered, for the same reason switching to `fullRotation` is. `fullRotation`
has it forced on — it has no pair entry path at all.

**Rule toggles** — `hiddenRules` holds the rule keys the organiser switched off;
everything *not* listed is shown on the frontend's Rules tab. Exclusions rather
than inclusions, so a rule added in a later release appears on tournaments
configured before it existed. The keys are validated against `rules.ts`, whose
catalogue the frontend mirrors in `lib/ongoing-rules.ts`; the wording itself
lives only in the frontend's four locale files. Keys belonging to another scheme
are kept rather than filtered out, so switching scheme and back restores what was
chosen before.

**`fullRotation`** — an individual format: players enter alone and change partner
every game.

- **Entry unit is the player.** `allowSoloRegistration` and
  `soloOnlyRegistration` are forced on, and `addTeam`/`setTeams` are refused. The
  roster is `OngoingSoloPlayer`, capped at `groupCount × 4` — `maxTeams` counts
  pairs and does not apply.
- **Groups of exactly four.** `groupCount` must be `2` or `3` (8 or 12 players),
  and the roster has to fill every group exactly: a group of three or five has no
  three-fixture rotation, so a partial field cannot be scheduled at all.
- **Three fixtures per group**, so every player partners every other player once
  and opposes each of them twice:
  `p1+p2 v p3+p4`, `p1+p3 v p2+p4`, `p1+p4 v p2+p3`.
  Those sides are stored in `OngoingGamePlayer`, not as `OngoingTeam` rows — which
  is why a rotation game is exempt from the "both teams must be known" guard on
  `PATCH /ongoing/games/:gameId`.
- **Round 1 is seeded by rating** (`PlayerStats.rank`, ties broken on `playerId` so
  a re-seed is deterministic): strongest four into group 0, which is the strongest
  rung of the ladder.
- **A round ends when all its games have results.** The top two of each group then
  go up and the bottom two go down; the ends of the ladder have nowhere to go, so
  the strongest group keeps its top two and the weakest keeps its bottom two. Every
  group still holds four afterwards.
- **`rotationRounds`** (default `3`) is how many rounds run. After the last one the
  strongest group's table is the result, and `rotation.finalStandings` lists every
  player — strongest group first, each group in its finishing order.
- **Standings are computed, never stored.** `rankGroupPlayers` orders a group by
  wins, then point difference, then points scored, then `playerId`; a corrected
  score reshuffles the tables immediately.

The pure logic lives in [`src/ongoing/rotation.ts`](src/ongoing/rotation.ts) with
its own tests; the service only supplies rosters and results and persists what
comes back.

```jsonc
// POST /ongoing — a full-rotation event
{
  "name": "Thursday Rotation",
  "date": "2026-09-24T00:00:00.000Z",
  "scheme": "fullRotation",
  "groupCount": 3,        // 2 or 3 → 8 or 12 players
  "rotationRounds": 4     // optional, default 3
}
```

---

## Player anonymity — a display flag, not stored anonymisation

`users.is_anonymous` says the account asked not to have its name published in full.
It changes **nothing about what is stored or returned**:

- `players.name` keeps the real name. No write path rewrites it, and none should.
- Every payload that names a player carries `isAnonymous` beside `name`, and the
  **real name still travels**. `PlayerResponseDto`, `OngoingTeamPlayerDto`,
  `PlayerGameRowPlayerDto` and the rankings rows all expose the pair.
- **The frontend does the masking**, at the point of display —
  `lib/player-name.ts` there turns `Artem Borzienkov` into `Ar*** Bo***`.

That split is deliberate, and its consequence has to be understood before relying
on it: because masking is client-side, **the real name of an anonymous player is
still readable from the public API** (`GET /players` and friends have no auth). The
flag reduces how visibly a name is published on the site; it is not technical
anonymisation, and `/privacy` in the frontend says so in as many words. If the
requirement ever becomes "the name must not leave the server", the masking has to
move into these mappers — the flag and the DTO field are already in place for it.

**Nothing in the UI sets the flag.** Sign-up used to offer a checkbox and no longer does, so
`is_anonymous` is turned on out of band — directly, or by whatever admin path is added later. The
frontend's `/privacy` therefore tells players to ask the controller rather than promising a
self-service toggle; keep the two in step if a control is reintroduced.

The flag is resolved from the linked account on every read that emits a name.
`PLAYER_INCLUDE` (players), `PLAYER_USER_SELECT` (ongoing) and
`GAME_PLAYER_SELECT` (games) each pull `user: { select: { isAnonymous: true } }`
alongside the stats; a player with no account reads as not anonymous.

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

   **Sign and size are independent, and conflating them has bitten twice.** Who won
   decides the sign; whether the result was expected decides the size. Both bugs let
   a losing team *gain* rating: a stray minus made the widest bucket's
   `biggerChange` negative (a beaten favourite came out at `+2`, the winning
   underdog at `−2`), and `getMaxRankChange` applied only a team1/team2 sign, never
   the win/loss one, so above a 1000‑point gap every team1 loss paid `+30`.
   [`src/rankings/utils.spec.ts`](src/rankings/utils.spec.ts) now sweeps every
   bucket boundary and a grid of rating pairings asserting the invariant directly.
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

# 4. run the API (listens on $PORT, default 3000)
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

> **Port:** `src/main.ts` listens on `process.env.PORT || 3000`. `.env` may set `PORT`, so check
> it before assuming 3000 — and keep it clear of whatever port the frontend dev server uses.
> When running the UI locally, run the front‑end on a different port to avoid a
> clash and point its `NEXT_PUBLIC_HOST_URL` at `http://localhost:3000`.

---

## Environment variables

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string (used by Prisma). |
| `JWT_SECRET` | Secret used to sign/verify JWTs for the auth endpoints (`/auth/*`, `GET /user/me`). Falls back to a dev-only default when unset — a deployed process (`NODE_ENV` = `production` or `prod`) refuses to boot without it. |

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

Unit tests mock `PrismaService` — there is **no test database**, and
`agregateRankings()` would rewrite every ranking in whatever `DATABASE_URL` points
at. The e2e scaffolding is still the NestJS default (`test/app.e2e-spec.ts`).

The rating engine is covered by [`src/rankings/utils.spec.ts`](src/rankings/utils.spec.ts) (the pure
change table: every bucket boundary, favourite/underdog on both outcomes, the newcomer multiplier,
draws, missing stats, and a rating grid asserting a loser never gains) and
[`src/rankings/rankings.service.spec.ts`](src/rankings/rankings.service.spec.ts) (what actually
reaches `game_player_rank`).

The `ongoing` module carries most of the coverage: `rotation.spec.ts`,
`pairing.spec.ts`, `groups.spec.ts`, `bracket.spec.ts` and `schedule.spec.ts` test
the pure logic directly, and `ongoing.service.spec.ts` tests the persistence and
the guards around it.

---

## Known quirks & caveats

- **Authentication is partial.** `/auth`, `/user` and `/ongoing` are behind a JWT
  cookie (`access_token`, `JwtAuthGuard`), but the older `/players`, `/events`,
  `/games`, `/event-members` and `/rankings` routes are still open — CORS is the
  only gate there, restricted to a fixed origin allow-list in `src/main.ts`.
- **No global `ValidationPipe`.** `main.ts` never calls `useGlobalPipes`, so DTO
  decorators are inert except where a controller registers the pipe itself
  (`/auth`, `/user`, `/ongoing` do). Services validate their own input.
- **Ratings only update via events.** Creating/editing/deleting games through
  `/games` updates `PlayerStats` totals but **not** `game_player_rank` — those
  ratings go stale until the next `agregateRankings` run.
- **`agregateRankings` is destructive and slow.** It wipes and rebuilds the whole
  rank chain and resets all stats; it must be re‑run (per database) after any
  change to game ordering or rating logic.
- **Stats can drift** between the stored `PlayerStats` columns and the on‑the‑fly
  computation (see [above](#player-statistics-two-sources-of-truth)).
- **A drawn score returns nothing from `getRanksChangesByGameResult`**, and
  `updatePlayersRankByGameResult` now guards for it instead of destructuring blind.
  It matters because `team1_points`/`team2_points` both `DEFAULT 0`, so an unscored
  row is a 0‑0 draw — and the destructure happens inside `agregateRankings`'
  per‑game transaction, where a `TypeError` aborts a destructive replay part‑way
  through. (An earlier note here blamed a missing `rankDifference === 0` branch;
  that was wrong — 0 is covered by the `<= 100` bucket.)
- **`setsWon` / `setsLost` are placeholders** — the schema removed per‑set scores
  (games store only total points), so these fields are never populated (they read
  as `0`, and `/rankings/sets` actually ranks by win count).
- **Not atomic:** in `events/with-games`, event+game inserts run in one transaction
  but the per‑game rating updates run in separate transactions afterward.
- **Two `make_tgid_optional` migrations** exist (`20260123162529` and
  `20260123164123`) — a historical artifact in the migration history.
</content>
