# Ongoing tournament: config / matches / standings

**Date:** 2026-08-23
**Scope:** full-stack — `volley-app-service` (Prisma + `OngoingModule`) and
`volleyball-management-ui` (`/ongoing` route).

## Problem

There is no way to run a tournament *while it is happening*. `events` + `games` record a
finished session and feed the ELO chain; they cannot answer "who plays whom next" or "what is
the table right now". This adds a self-contained round-robin runner: configure the format,
generate a randomised schedule, fill scores as matches finish, read live standings.

## Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Teams | Pairs of existing `players` | Matches the domain (2v2 beach); lets the UI show real names/avatars |
| Match format | **One set per match**, single score each side | Simplest scoring; standings need only points for/against |
| Rating impact | **None** | `ongoing_*` never writes `games`/`player_stats`, never calls `agregateRankings()` |
| Courts | Round packing, no clock | `courts` caps matches per round; no time slots to configure |
| Standings points | Points scored/conceded only | No win/loss bonus points — W and L columns carry that |
| Delete result | Clears the score, keeps the fixture | The schedule stays intact once generated |
| Regenerate | Wipes and rebuilds unconditionally | Confirmation lives in the UI, not the API |
| Standings computation | Client-side pure function | `GET /ongoing/:id` already returns teams + games; no extra endpoint or roundtrip |

## Data model

Four new tables, isolated from the existing graph. Every FK inside the subtree is
`onDelete: Cascade`, so deleting an `OngoingEvent` removes its config, teams and games. FKs onto
`players` are the default `RESTRICT`, matching how `games` references players today.

```prisma
model OngoingEvent {                       // ongoing_events
  id        String   @id @default(uuid())
  name      String
  date      DateTime
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  config OngoingEventConfig?
  teams  OngoingTeam[]
  games  OngoingGame[]
}

model OngoingEventConfig {                 // ongoing_event_config
  id           String @id @default(uuid())
  eventId      String @unique @map("event_id")
  gamesPerPair Int    @default(1) @map("games_per_pair")   // 1 | 2 | 3
  courts       Int    @default(1)
}

model OngoingTeam {                        // ongoing_teams
  id        String @id @default(uuid())
  eventId   String @map("event_id")
  player1Id String @map("player1_id")
  player2Id String @map("player2_id")
}

model OngoingGame {                        // ongoing_games
  id          String @id @default(uuid())
  eventId     String @map("event_id")
  team1Id     String @map("team1_id")
  team2Id     String @map("team2_id")
  team1Points Int?   @map("team1_points")  // null = not played yet
  team2Points Int?   @map("team2_points")
  round       Int
  court       Int
  order       Int                          // stable position within a round
}
```

`ongoing_teams` was not in the original request but is required: a team is a pair of players, and
`ongoing_games` needs something to reference.

`team1Points`/`team2Points` are nullable together — either both are set (played) or both are null
(scheduled). A match is "played" iff both are non-null.

## API — `OngoingModule`, prefix `/ongoing`

| Method | Path | Body / result |
| --- | --- | --- |
| `GET` | `/ongoing` | list of events, newest first |
| `POST` | `/ongoing` | `{ name, date }` → creates the event **and a default config row** (`gamesPerPair: 1, courts: 1`) |
| `GET` | `/ongoing/:id` | event + config + teams (with player id/name/avatar) + games, ordered `round asc, order asc` |
| `DELETE` | `/ongoing/:id` | 204 |
| `PUT` | `/ongoing/:id/config` | `{ gamesPerPair, courts }` — upsert |
| `PUT` | `/ongoing/:id/teams` | `[{ player1Id, player2Id }]` — replaces the whole roster |
| `POST` | `/ongoing/:id/schedule` | deletes all games, regenerates, returns the new list |
| `PATCH` | `/ongoing/games/:gameId` | `{ team1Points, team2Points }` — save or edit a score |
| `DELETE` | `/ongoing/games/:gameId/result` | clears both scores back to null |

Validation is explicit in the service (there is no global `ValidationPipe`):

- `gamesPerPair` ∈ {1,2,3}, `courts` ≥ 1 → else `BadRequestException`
- team must be two *distinct* players; a player may appear in at most one team per event
- score: both values integers ≥ 0, not equal (a set has a winner)
- `PUT /teams` while games exist → replaces teams **and** deletes all games, since the fixtures
  would dangle otherwise
- missing ids → `NotFoundException` with the existing wording style
  (`Ongoing event with ID ${id} not found`)

## Schedule generation

Pure helper in `src/ongoing/schedule.ts`, unit-tested — no Prisma, seeded shuffle injectable so
the test is deterministic.

1. Build every unordered team pair, repeat each `gamesPerPair` times.
2. Shuffle (Fisher–Yates).
3. Greedy round packing: for each match, place it in the first round that has fewer than `courts`
   matches and contains neither team; create a new round if none fits.
4. Within a round, `court` = 1-based slot index; `order` = the same index.

Fewer than two teams → `BadRequestException`. The packing terminates because a fresh round always
accepts the match.

## Standings — `volleyball-management-ui/lib/ongoing-standings.ts`

Pure function over `{ teams, games }` from `GET /ongoing/:id`. Unplayed matches are skipped
entirely.

Per team: `played`, `wins`, `losses`, `pointsFor`, `pointsAgainst`.
Sort: `wins desc → (pointsFor − pointsAgainst) desc → pointsFor desc`, then assign `place` by
index. Columns rendered: `Place · Team · P · W · L · Points (115–112)`. No win-bonus column.

## Frontend

```
app/ongoing/page.tsx           list of tournaments + create form
app/ongoing/[id]/page.tsx      one GET /ongoing/:id query, tab state in useState
components/ongoing/
  ongoing-config-tab.tsx       gamesPerPair, courts, team roster editor, Generate schedule
  ongoing-matches-tab.tsx      games grouped by round
  ongoing-match-card.tsx       court label, score inputs, Save / edit / clear
  ongoing-standings-tab.tsx    the table
```

Follows the house pattern: `'use client'`, TanStack Query with a flat key, `useMutation` +
`invalidateQueries(['ongoing', id])`. New `queryFn`s check `res.ok` and throw, per CLAUDE.md —
they do not copy the unchecked `fetch().then(json)` shape.

- Endpoint URLs go in `lib/api.ts`; response types in `lib/types.ts`.
- Nav item `/ongoing` is visible to everyone; the Config tab and score editing are gated on the
  existing `isAdmin` localStorage check, exactly as `/add-results` is. That gate is cosmetic and
  is not treated as access control.
- Text keys are added to all four locales (`en`, `uk`, `pl`, `be`).
- "Generate schedule" opens a confirmation dialog when games already exist; the API itself does
  not refuse.

## Testing

Backend: Jest with a mocked `PrismaService`, mirroring `events.service.spec.ts`. Cover the pure
scheduler (pair count, no team twice per round, courts respected) and the service rules
(score validation, regenerate wipes first, replacing teams drops games).

Frontend: no test runner exists; `lib/ongoing-standings.ts` is verified by `npx tsc --noEmit`,
`npm run lint`, `npm run build` and by exercising `/ongoing` in the browser. Introducing a runner
here is out of scope.

## Out of scope

Playoffs/brackets, per-set scoring, match times, ELO integration, real authentication.
