# Tournament creation page + open registration (Calendar)

**Date:** 2026-08-23
**Scope:** full-stack — `volley-app-service` and `volleyball-management-ui`.
**Builds on:** `2026-08-23-ongoing-tournament-design.md` (the Ongoing tournament feature).

## Problem

Two gaps in the Ongoing tournament feature, which turn out to share one root concept:

1. Creating a tournament is a bare name field. There is no date picker (the `date` column is
   written and never displayed), and the roster can only be built afterwards, in the Config tab.
2. There is no way for a team to put itself into a tournament. Only an admin, in Config, can
   edit the roster — and that editor replaces the roster wholesale.

Both need the same missing idea: a tournament that has not started yet, whose roster is still
open. This spec introduces that idea and builds both features on it.

## The planning stage

A tournament is **in planning** while **no match has a result** — every `ongoing_games` row for
it has `team1_points IS NULL`. The moment a first score is recorded it has started.

The roster is mutable only during planning. Once started it is frozen: no additions, no
replacement, no removals.

This is not only a UX rule, it closes a real hole in the existing feature. `PUT /ongoing/:id/teams`
currently deletes every fixture and therefore every recorded score; the previous increment guarded
it with a confirmation dialog. With this rule the endpoint *cannot* destroy a recorded result,
because it is refused outright once one exists.

**Registration is open** when all three hold:

1. the tournament is in planning;
2. its date has not passed — `date >= start of today`;
3. `maxTeams` is null, or the current team count is below it.

**Decision — the deadline is the tournament's own date.** No separate `registrationDeadline`
column. Registration closes on the day the tournament happens. A distinct deadline field is
another column and another form input for a case this club does not appear to have.

## Access model

**Anyone may register a team; only an admin may remove one.** Confirmed by the user after the
risk was raised explicitly.

This service has **no authentication of any kind** — not on the backend, not on the frontend,
where the admin gate is a `NEXT_PUBLIC_` password that ships in the client bundle. Therefore:

- Anyone can enter any two existing players into any open tournament.
- The registrant cannot withdraw their own team; only someone with the cosmetic admin gate can.
- The `DELETE` endpoint is unauthenticated like every other endpoint here. The admin gate hides
  the button; it does not protect the route.

This is an accepted, documented boundary for a private club app, not an oversight. Building real
authentication is out of scope.

## Data model

One additive column. No new tables.

```prisma
model OngoingEventConfig {
  // ... existing fields
  maxTeams Int? @map("max_teams")   // null = unlimited
}
```

`maxTeams`, when set, must be an integer >= 2 and must not be below the current team count.

## API

### New

| Method | Path | Body / result |
| --- | --- | --- |
| `POST` | `/ongoing/:id/teams` | `{ player1Id, player2Id }` — appends **one** team, returns the full event |
| `DELETE` | `/ongoing/teams/:teamId` | removes one team and its (necessarily unplayed) fixtures, returns the full event |
| `GET` | `/ongoing/open` | tournaments open for registration, each with its teams |

`POST /ongoing/:id/teams` is additive by necessity, not preference. The existing
`PUT /ongoing/:id/teams` replaces the whole roster, so two people registering at the same time
would each submit a list computed before the other's write and one registration would silently
vanish. An append cannot lose a concurrent write.

It rejects with `ConflictException` (409) when the tournament has started, its date has passed,
or it is full; and with the existing `BadRequestException` / `NotFoundException` rules for two
identical players, a player already in another team of that tournament, or an unknown player.

`DELETE /ongoing/teams/:teamId` rejects with 409 once the tournament has started. During planning
every fixture is unplayed, so removing the team and cascading its fixtures destroys no results.

`GET /ongoing/open` returns only tournaments where registration is open, each carrying
`{ id, name, date, maxTeams, teamsCount, teams: [{ id, player1: {id,name,avatar?}, player2: {...} }] }`.
It is a separate endpoint rather than a flag on `GET /ongoing` so the list endpoint stays lean —
the calendar needs every open tournament's full roster, which the list page does not.

### Changed

| Method | Path | Change |
| --- | --- | --- |
| `POST` | `/ongoing` | accepts optional `teams: [{player1Id, player2Id}]` and optional `maxTeams`; event, config and roster are created in one transaction |
| `PUT` | `/ongoing/:id/config` | accepts optional `maxTeams` |
| `PUT` | `/ongoing/:id/teams` | now refused with 409 once the tournament has started |

`POST /ongoing` takes the roster inline so the create page is one atomic request. Creating the
event and then setting the roster in a second call would leave an empty orphan tournament if the
second call failed.

The team-validation rules (two distinct players, a player in at most one team per tournament,
players must exist) are extracted from `setTeams` into one private helper used by `create`,
`setTeams` and `addTeam`, so the rule cannot drift between three copies.

## Frontend

```
app/calendar/page.tsx                        open tournaments + registration
app/ongoing/new/page.tsx                     create a tournament
components/ongoing/register-team-dialog.tsx  pick two players, register
components/ongoing/team-roster-editor.tsx    the pair editor, shared by create page and Config
components/ui/calendar.tsx                   vendored shadcn primitive
```

- **Nav gains a "Calendar" item** at `/calendar`, visible to everyone. Cards show name, date,
  `Teams: 3/8`, the already-registered teams, and a **Register** button that opens a dialog with
  two player selects. On success the new team appears in that card's roster immediately.
- **`/ongoing/new`** replaces the inline create form on `/ongoing`, which becomes a
  **New tournament** button. Fields: name, date (calendar popover, defaults to today), optional
  max teams, optional initial roster. Submits once, then redirects to the new tournament.
- **Config tab**: the roster becomes read-only once the tournament has started, with an
  explanation; an admin can remove an individual team while in planning; a `maxTeams` field is
  added. The replace-roster confirmation copy is corrected — it can no longer destroy results.
- **Date is finally shown** on the list cards and the tournament header, alongside a
  **Planning / In progress** badge that makes the roster lock legible.
- The pair editor currently living inside `ongoing-config-tab.tsx` is extracted to
  `team-roster-editor.tsx` and reused by the create page, rather than written twice.

`react-day-picker@9.8`, `date-fns@4.1` and `@radix-ui/react-popover` are already dependencies and
currently unused, so the calendar primitive adds **no new dependency**.

## Testing

Backend: Jest against a mocked `PrismaService`, following `ongoing.service.spec.ts`. Cover the
planning-stage guard on all three roster mutations, each 409 condition on `addTeam` (started,
date passed, full), the `maxTeams` bounds, `GET /ongoing/open`'s filter, and that `create` with an
inline roster writes event, config and teams in one transaction.

Frontend: no test runner exists; verified with `npx tsc --noEmit`, `npm run lint` (must stay at
the 7 pre-existing errors), `npm run build`, and a live browser walkthrough.

## Out of scope

Authentication, per-user identity, self-withdrawal, waitlists, a month-grid calendar view,
recurring tournaments, notifications.
