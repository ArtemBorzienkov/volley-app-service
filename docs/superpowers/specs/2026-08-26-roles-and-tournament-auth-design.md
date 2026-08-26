# Roles and tournament authorization (volley-app-service + volleyball-management-ui)

## Problem

The auth system added previously (users, login, JWT cookie) has no authorization built on it yet:
every backend endpoint is still open, and the frontend's only "admin" concept is a fake
`localStorage`/`NEXT_PUBLIC_ADMIN_PASSWORD` gate. This change adds a real `role` (`admin`/`player`)
to `User`, uses it (plus tournament ownership) to gate tournament creation, editing, deletion, and
team registration, and closes a gap in the registration flow: a user who doesn't link to an existing
player must create one — there's no "logged in with no player" state anymore.

## Non-goals

- No role-management UI or endpoint. `role` defaults to `'player'` at registration; promoting someone
  to `'admin'` is a manual DB operation, done outside the application.
- No change to `Event`/`EventMember` (the separate, currently-unused-by-the-UI tournament model) —
  this is entirely about `OngoingEvent` (the live tournament flow the UI actually uses).
- No backfill for pre-existing `OngoingEvent` rows or pre-existing `User` rows with a null `playerId`
  — this is a dev app with no production data to migrate.
- No change to who can VIEW tournaments, players, games, etc. — only to who can create/mutate a
  tournament and its team roster. Read endpoints stay open.

## Data model

**`volley-app-service/prisma/schema.prisma`:**

```prisma
model User {
  // ...existing fields...
  role String @default("player") // 'admin' | 'player', enforced in application code
}
```

```prisma
model OngoingEvent {
  // ...existing fields...
  createdByUserId String? @map("created_by_user_id")
  createdByUser   User?   @relation(fields: [createdByUserId], references: [id], onDelete: SetNull)
}
```

`User` gets the corresponding back-reference `ongoingEventsCreated OngoingEvent[]`.

- `role` is a plain string (not a Prisma enum), matching this schema's existing convention
  (`gender`, `scheme`, `phase` are all plain strings with app-level meaning).
- `createdByUserId` is nullable: pre-existing tournaments (created before this change) have no
  creator, and deleting a user nulls out their created tournaments' creator rather than blocking the
  deletion or deleting the tournaments.

## Backend: role reaches every authenticated request

`JwtPayload` (`src/auth-guards/jwt-payload.interface.ts`) gains a `role: string` field. It's set:

- At login (`AuthService.logIn`), from the just-verified `User` row.
- On every sliding-session rotation (`JwtAuthGuard.refreshIfExpiringSoon`) and on the explicit
  `POST /auth/refresh-jwt` (`AuthService.refreshJWT`) — both already load the `User` row (or can
  cheaply), so the embedded role self-heals within one token lifetime (≤30 minutes) if it's ever
  changed at the DB level, the same staleness window `email` already has today.

`AuthedRequest.user.role` becomes the one source of truth for "is this an admin" everywhere — this
fully replaces the frontend's fake `NEXT_PUBLIC_ADMIN_PASSWORD` mechanism (see Frontend section).

## Backend: `/ongoing` authorization

All of these routes gain `@UseGuards(JwtAuthGuard)`. A new private helper in `OngoingService`:

```ts
private assertCanManage(event: { createdByUserId: string | null }, currentUser: { sub: string; role: string }): void {
  const isCreator = event.createdByUserId === currentUser.sub;
  const isAdmin = currentUser.role === 'admin';
  if (!isCreator && !isAdmin) {
    throw new ForbiddenException('Only the tournament creator or an admin can do this');
  }
}
```

is called (after loading the event, before mutating) from every "manage" method. Full mapping:

| Endpoint | Service method | Rule |
|---|---|---|
| `POST /ongoing` | `create` | any logged-in user — sets `createdByUserId: currentUser.sub` |
| `POST /ongoing/:id/teams` | `addTeam` | any logged-in user; see team-registration rule below |
| `PUT /ongoing/:id/teams` | `setTeams` | creator-or-admin (`assertCanManage`) |
| `PUT /ongoing/:id/config` | `updateConfig` | creator-or-admin |
| `DELETE /ongoing/:id` | `remove` | creator-or-admin |
| `POST /ongoing/:id/schedule` | `generateSchedule` | creator-or-admin |
| `PATCH /ongoing/games/:gameId` | `updateGameScore` | creator-or-admin (resolve the game's event first) |
| `DELETE /ongoing/games/:gameId/result` | `clearGameResult` | creator-or-admin (same resolution) |
| `POST`/`DELETE /ongoing/:id/playoff` | `generatePlayoff`/`deletePlayoff` | creator-or-admin |
| `PATCH /ongoing/:id/finish` | `finishTournament` | creator-or-admin |
| `DELETE /ongoing/teams/:teamId` | `removeTeam` | creator-or-admin (resolve the team's event first) |

Read endpoints (`GET /ongoing`, `GET /ongoing/:id`, `GET /ongoing/open`) are untouched — still public.

**Team-registration rule (`addTeam`):** the submitting user's own `playerId` (looked up via
`UserService.findById(currentUser.sub)`) must equal `player1Id` or `player2Id` in the request body,
or the endpoint throws `BadRequestException('You must register yourself as one of the two players')`.
No new "one team per user" check or column is needed: `addTeam` already rejects a player who's
already on another team in the event (`validateTeamPairs`), and since the user is now required to be
one of the two players on any team they submit, that existing check transitively caps them at one
team. The creator's bulk `setTeams` path is unaffected by this rule — it's creator-or-admin gated
separately and has no per-team self-inclusion requirement, matching "the creator can register any
number of teams."

## Backend: registration requires a player

`CreateUserDto` changes from an optional `playerId` to a required discriminated shape:

```ts
export class CreateUserDto {
  @IsEmail() email: string;
  @IsString() @IsNotEmpty() name: string;
  @IsString() @MinLength(8) password: string;

  @IsOptional() @IsUUID() playerId?: string;

  @IsOptional() @ValidateNested() @Type(() => NewPlayerDto) newPlayer?: NewPlayerDto;
}

export class NewPlayerDto {
  @IsString() @IsNotEmpty() name: string;
  @IsIn(['male', 'female']) gender: string;
}
```

`UserService.createUser` requires exactly one of `playerId` / `newPlayer` (throws
`BadRequestException` if both or neither are present — the frontend never allows this state, but the
API enforces its own contract). When `newPlayer` is given, it creates the `Player` row and the `User`
row together (a Prisma `$transaction`, so a failure on either side leaves neither behind), then links
the new player's id as before. When `playerId` is given, existing validation (player exists, not
already linked) is unchanged.

## Frontend: mandatory player choice at registration

`app/register/page.tsx`'s player `Select` replaces the "None" option with "＋ Create new player".
Choosing it reveals two more fields (name, and a gender `Select` with "Male"/"Female"). The zod schema
becomes a discriminated union enforcing exactly one path is filled before submit; the request body
sends either `{ playerId }` or `{ newPlayer: { name, gender } }`.

## Frontend: tooltip primitive + disabled-button pattern

Adds `components/ui/tooltip.tsx` (standard shadcn primitive; `@radix-ui/react-tooltip` is already a
dependency) — the first tooltip in this codebase. A small `DisabledWithTooltip` wrapper isn't needed;
each site wraps its existing `Button` in `Tooltip`/`TooltipTrigger`/`TooltipContent`, showing the
tooltip only when the button is disabled for the auth reason (Radix tooltips work on disabled buttons
via a wrapping `span`, which the shadcn pattern already accounts for).

Two sites get this treatment:
- "New tournament" flow: the button/link that leads to `CreateTournamentForm` (`app/ongoing/page.tsx`)
  and the form's own submit button — disabled + tooltip "Щоб створити турнір, потрібно бути
  залогіненим" when `useAuth().user` is null.
- `RegisterTeamDialog`'s submit — disabled + tooltip "Щоб зареєструватися в турнір, потрібно бути
  залогіненим" when logged out. When logged in, the dialog no longer lets the user pick both players
  freely: `player1` is fixed to the current user's own player (from `useAuth().user.playerId`,
  read-only), and only the partner (`player2`) is a free pick from the roster.

## Frontend: real role replaces the fake admin gate everywhere

`hooks/use-is-admin.ts` and the `NEXT_PUBLIC_ADMIN_PASSWORD`/`NEXT_PUBLIC_MODERATOR_PASSWORD` env vars
are deleted. Every one of the 10 existing call sites swaps its `isAdmin` check for the appropriate new
one, per this mapping:

| Site | Old check | New check |
|---|---|---|
| `navigation.tsx` — `/add-results` link | `isAdmin` | `user?.role === 'admin'` |
| `navigation.tsx` — `/ongoing` link | `isAdmin \|\| hasTournamentToday` | `user?.role === 'admin' \|\| hasTournamentToday` |
| `ongoing/page.tsx` — "new tournament" button | `isAdmin`-gated visibility | always visible; disabled+tooltip per above |
| `ongoing/page.tsx` — per-event delete button | `isAdmin` | `user?.role === 'admin' \|\| event.createdByUserId === user?.id` |
| `calendar/page.tsx` — render `CreateTournamentForm` | `isAdmin` | always rendered (any logged-in user); the form's submit button is the auth gate |
| `ongoing/[id]/page.tsx` — config tab visibility, finish action, render `OngoingConfigTab` | `isAdmin` (×3) | creator-or-admin (same formula as the delete button, using that tournament's `createdByUserId`) |
| `ongoing-matches-tab.tsx` — `canEdit` (×2) | `isAdmin` | creator-or-admin |
| `ongoing-bracket-tab.tsx` — playoff/bracket edit (×5) | `isAdmin` | creator-or-admin |

`OngoingEventResponseDto`/`OngoingEventListItemDto` (and wherever else an ongoing event is returned)
gain a `createdByUserId: string | null` field so the frontend can compute creator-or-admin without an
extra request.

## Testing

Backend (TDD, mocked `PrismaService`, matching the existing convention):

- `UserService.createUser`: exactly-one-of `playerId`/`newPlayer` enforcement (400 on both/neither),
  transactional creation of a new player + user, role defaults to `'player'`.
- `AuthService`: `logIn`/`refreshJWT` embed the current `role` in the issued token.
- `OngoingService`: `assertCanManage` unit tests (creator passes, admin passes, neither throws
  `ForbiddenException`); `addTeam`'s self-inclusion rule (submitting user's playerId must be one of
  the two, rejects otherwise); confirms the existing "already on another team" check still fires when
  a user tries to register a second team.
- `OngoingController` route-guard wiring: at minimum, confirm `JwtAuthGuard` is applied to every
  route in the mapping table above (can be a focused test or a manual `grep` check during review).

Frontend: no test runner (per this project's existing convention) — verified via `npx tsc --noEmit`,
lint, build, and manual browser exercise of: create (logged out → disabled+tooltip; logged in →
works, sets creator), edit/delete as non-creator/non-admin (blocked), edit/delete as creator (works),
edit/delete as admin-non-creator (works), register-team (logged out → disabled+tooltip; logged in →
self-locked as player1, one team per tournament enforced), registration with "create new player".

## Rollout

1. Schema: `User.role`, `OngoingEvent.createdByUserId` + migration.
2. Backend: JWT payload gains `role`; `OngoingService`/`OngoingController` authorization (TDD).
3. Backend: registration's mandatory-player change (TDD).
4. Frontend: tooltip primitive, register page's new-player flow.
5. Frontend: tournament create/edit/delete/register-team UI changes + role mapping table, deleting
   the fake admin mechanism last (once every call site has its replacement in place).
6. Manual end-to-end verification in the browser preview.
