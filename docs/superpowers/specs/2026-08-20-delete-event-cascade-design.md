# Delete event by id: full cascade + rank re-aggregation

**Date:** 2026-08-20
**Service:** volley-app-service
**Endpoint:** `DELETE /events/:id`

## Problem

`DELETE /events/:id` already exists (`EventsController.remove` -> `EventsService.remove`), but
its body is a bare `prisma.event.delete({ where: { id } })` and carries two defects.

### Bug 1 - the delete throws instead of deleting

Foreign keys pointing at the event subtree:

| Table              | FK -> parent | On delete |
| ------------------ | ------------ | --------- |
| `games`            | -> `events`  | CASCADE   |
| `event_members`    | -> `events`  | CASCADE   |
| `game_player_rank` | -> `games`   | RESTRICT  |

`event.delete()` cascade-deletes the event's `games` rows. Those rows are still referenced by
`game_player_rank` under `RESTRICT`, and nothing removes the rank rows first, so Postgres aborts
the statement:

```
update or delete on table "games" violates foreign key constraint
"game_player_rank_game_id_fkey" on table "game_player_rank"
```

`RESTRICT` blocks the parent's deletion whether it came from a direct `DELETE` or a cascade. The
schema sets no `relationMode`, so the default `foreignKeys` mode applies and the database enforces
the constraint - Prisma does not emulate it away. Prisma surfaces it as `P2003`; `remove()` does
not handle it, so the caller receives a 500.

This is a regression. `game_player_rank` is the newest migration (`20260221100000`) and its
relation declares no `onDelete`, so Prisma defaulted the required relation to `RESTRICT`.
`remove()` predates it and worked until rank tracking landed. Any event with games - every real
one - has been undeletable since.

### Bug 2 - stats stay inflated even once the FK is unblocked

`remove()` never touches `player_stats`. After a delete that did succeed, every participant would
keep:

- `totalGames` / `totalWins` / `totalLosses` still counting the deleted games
- `rank` still carrying the `rankChange` deltas those games contributed

`GamesService.remove` at least calls `revertPlayerStatsForGame` for the four players, but even that
only fixes the win/loss counters, not `rank`.

`rank` cannot be repaired by local decrement anyway: it is a chain, where each game's
`game_player_rank.rank` depends on the state left by every prior game. Deleting an event from the
middle of history invalidates every downstream game's rank.

## Decisions

| Decision                     | Choice                                       | Why                                                                                                                                 |
| ---------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Route                        | Reuse existing `DELETE /events/:id`          | Already wired with `@HttpCode(NO_CONTENT)`; no UI caller exists yet, so the contract is free to complete rather than duplicate.       |
| Rank-row removal             | Explicit scoped `deleteMany` in code         | No migration. Nothing in the repo depends on rank rows auto-vanishing, and `agregateRankings()` already wipes them wholesale.         |
| Rank / stats repair          | Full replay via existing `agregateRankings()` | Guarantees a correct chain and correct totals for free; local decrement cannot fix chained rank.                                     |
| Replay timing                | Synchronous, awaited, before responding       | Caller sees a consistent DB on success rather than a transiently zeroed one.                                                          |
| Response                     | `204 No Content`                             | Matches the existing signature and the other `remove()` methods.                                                                     |

## Design

```
DELETE /events/:id
|- event.findUnique({ where: { id }, select: { id, games: { select: { id } } } })
|    `- null -> 404 NotFoundException(`Event with ID ${id} not found`)   // message unchanged
|- $transaction:
|    |- gamePlayerRank.deleteMany({ where: { gameId: { in: gameIds } } })
|    `- event.delete({ where: { id } })   // games + event_members cascade at the DB
|- if (gameIds.length) await rankingsService.agregateRankings()
`- 204 No Content
```

Ordering is load-bearing: rank rows must go before the event, or the `RESTRICT` FK blocks the
cascade. Both statements share one transaction, so any failure leaves the event fully intact.

The replay runs **after** the transaction commits, because `agregateRankings()` opens its own
per-game transactions and cannot nest. It resets every `player_stats` row to
`rank: 1000, totalGames/Wins/Losses: 0`, deletes all `game_player_rank` rows, then replays all
remaining games in `date, createdAt, id asc` order. That is why this endpoint needs no explicit
`player_stats` decrement logic, and why the downstream rank chain comes out correct.

Two consequences of relying on the global replay:

- Players whose only games were in the deleted event end up reset to `1000 / 0 / 0 / 0` and are
  never re-incremented. That is the correct outcome.
- The scoped `deleteMany` exists solely to unblock the FK; the replay wipes `game_player_rank`
  globally moments later regardless.

**Short-circuit:** if the event had no games, nothing entered the rank chain, so skip the replay.

Wiring already exists - `EventsModule` imports `RankingsModule` and `EventsService` injects
`RankingsService` for `createWithGames`.

## Error handling

- Unknown id -> 404, message unchanged from today.
- Replay throws -> the delete is already committed and stands. Log the event id plus the remedy
  (`POST /rankings/agregate-rankings`) and rethrow, yielding a 500. Deliberate: the caller must
  learn that rankings are mid-reset rather than receive a silent 204.

## Files

| File                                | Change                                                                       |
| ----------------------------------- | ---------------------------------------------------------------------------- |
| `src/events/events.service.ts`      | Rewrite `remove()` (~30 lines)                                               |
| `src/events/events.controller.ts`   | None                                                                         |
| `src/events/events.service.spec.ts` | New. First spec file in the repo; jest is configured (`rootDir: src`, `*.spec.ts`) |

## Testing

Unit tests against a mocked `PrismaService` + `RankingsService`:

1. Unknown id -> 404; no delete, no replay.
2. Rank rows deleted for exactly the event's game ids, then `event.delete`, both inside the
   transaction.
3. `agregateRankings()` awaited after the transaction commits, not before.
4. Event with no games -> no replay.

Manual verification against local `:3000`: create an event with games, `DELETE` it, then confirm
the `events` / `games` / `game_player_rank` / `event_members` rows are gone and the surviving
players' `player_stats` totals match their remaining games.

## Out of scope

`DELETE /games/:id` (`GamesService.remove`) carries both of the same defects - it hits the same
`RESTRICT` FK on `game_player_rank`, and its hand-rolled `revertPlayerStatsForGame` leaves the rank
chain drifted. Not addressed here.
