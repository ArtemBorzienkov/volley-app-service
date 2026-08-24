# Numbered participant list with a team rating

**Date:** 2026-08-23
**Scope:** full-stack — `volley-app-service` (one field) and `volleyball-management-ui` (one list).
**Builds on:** `2026-08-23-tournament-registration-design.md`.

## Problem

A Calendar card lists its registered teams as a bare run of names. There is no position and no
indication of how strong a pair is, so a visitor deciding whether to enter has nothing to judge
the field by.

Target rendering:

```
1. Valentyna Havrush & Sergey Liaskovskiy   2380
2. …
```

## Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Team rating | **Sum of the two players' `player_stats.rank`** | Ranks run 418–1468 here (mean 993), so a sum lands in ~836–2936 — matching the requested example of 2380. An average would read ~1190. |
| Ordering | **Rating descending**, strongest first | User-confirmed. The number is a strength position, not a signup position. |
| Where | **Calendar card only** | User-confirmed. The Config tab's "Registered teams" list is unchanged. |
| Where the sort happens | **Frontend** | See below — this is the load-bearing decision. |
| Missing stats | Fall back to `1000` per player | `POST /players` does create a `player_stats` row (all 52 rows present today), but `players.service.ts` already guards with `?? 1000`; match that. |

**The sort must not happen on the backend.** `event.teams` is returned ordered by
`createdAt asc, id asc`, and two frontend behaviours depend on that order: the roster-editor
remount key (`event.teams.map(t => t.id).join(",")`) and the index-wise `hasUnsavedTeams`
comparison in the Config tab. Reordering the array server-side to satisfy a display concern on a
different page would put both at risk for no benefit. The backend therefore only *adds* a number;
the Calendar page sorts its own copy.

Ties keep registration order — `Array.prototype.sort` is stable, and the incoming array is already
in registration order.

## Backend

`OngoingTeamResponseDto` gains:

```ts
rating: number;
```

computed in the existing `mapTeam` as
`(player1.playerStats?.rank ?? 1000) + (player2.playerStats?.rank ?? 1000)`.

`EVENT_INCLUDE`'s teams include changes from `player1: true, player2: true` to
`player1: { include: { playerStats: true } }` (and likewise `player2`) so the rank is available.
The existing `orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]` is **unchanged**.

Because `mapTeam` is shared, `rating` also appears on `OngoingEventResponseDto.teams`. That is
harmless and keeps one team shape rather than two.

No new endpoint, no migration.

## Frontend

`OngoingTeam` gains `rating: number`. `app/calendar/page.tsx` renders the roster as an ordered
list: position, `teamName(team)`, and the rating, sorted by `rating` descending on a **copy** of
the array (never sorting the prop in place).

Nothing else changes — the Config tab, the detail page and the standings table are untouched.

## Testing

Backend: Jest against a mocked `PrismaService` — the sum, the `?? 1000` fallback when a player has
no stats row, and that the teams `orderBy` is still `createdAt` then `id`.

Frontend: no test runner; verified with `npx tsc --noEmit`, `npm run lint` (must hold at the 7
pre-existing errors), `npm run build`, and a browser check of a multi-team tournament.

## Out of scope

Showing individual player ranks; any rating that is not the sum of the two current ranks; changing
the standings table; reordering `event.teams` anywhere else.
