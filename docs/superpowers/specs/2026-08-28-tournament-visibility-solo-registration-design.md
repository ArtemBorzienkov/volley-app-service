# Tournament visibility, solo registration, and self-cancellation (volley-app-service + volleyball-management-ui)

## Problem

Registration for an `OngoingEvent` today has exactly one shape: any logged-in player posts a
complete pair to `POST /ongoing/:id/teams`, with themselves as one of the two players. Three gaps
follow from that.

1. **Every tournament is public.** A creator who wants to assemble the field themselves has no way
   to close registration — anyone with an account can register into any tournament.
2. **You need a partner to enter.** A player without one cannot register at all, even though the
   ratings needed to pair them off fairly are already in `player_stats`.
3. **Registration is one-way for players.** `DELETE /ongoing/teams/:teamId` is creator/admin-only,
   so a player who can no longer come has to ask the organiser to remove them.

This change adds a visibility flag, a solo-registration pool with rating-based team formation, and
player-initiated cancellation bounded by a deadline.

## Non-goals

- No change to the rating engine, `Event`/`EventMember`, or the schedule/bracket generators. Teams
  formed from the solo pool are ordinary `ongoing_teams` rows; everything downstream is unaffected.
- No invitation or approval workflow for private tournaments. "Private" means only the creator or an
  admin may add entrants — there is no request-to-join queue.
- No notification of any kind (email/Telegram) when a registration is cancelled or teams are formed.
- No backfill. Existing tournaments take the defaults, which reproduce today's behaviour exactly.
- No re-pairing after teams are formed. Once the admin confirms the pairs they are ordinary teams,
  edited through the roster editor that already exists.

## Access model

Two independent axes, both stored on `OngoingEventConfig` next to `maxTeams` (registration rules
already live there, and `PUT /ongoing/:id/config` already lets the creator change them later):

| | Public | Private |
|---|---|---|
| Add a team | Any logged-in player, with themselves in the pair; creator/admin, any pair | Creator/admin only |
| Solo registration | Any logged-in player, for themselves, if `allowSoloRegistration` | Creator/admin only, if `allowSoloRegistration` |
| Cancel | Entrant themselves (until the deadline) or creator/admin (any time) | Same |
| Visible on `/calendar` | Yes | Yes, with a "Private" badge and no registration control |

"Creator or admin" is the existing `assertCanManage` predicate — this change adds no new role.

A private tournament is listed on `/calendar` under exactly the same filters as a public one: it
disappears once it is full, once a result is recorded, or once its date has passed. Visibility
controls *who may enter*, not *who may see*.

## Deadlines

Two distinct rules, both comparing UTC calendar days the way the existing
`isRegistrationDateOpen` does (a date-only input parses as UTC midnight, so the comparison must not
depend on the server's local timezone):

- **Registration** stays as it is: open through the whole of the tournament's own day
  (`eventDay >= today`). Unchanged.
- **Cancellation by the entrant** closes at the end of the day before: allowed while
  `today < eventDay`. On the day of the tournament a player can no longer withdraw themselves.

The creator and admins are **not** bound by the cancellation deadline — they may remove any entrant
at any time, subject only to `assertPlanning` (the roster locks once any game has a recorded score,
which is existing behaviour and unchanged).

## Data model

**`volley-app-service/prisma/schema.prisma`:**

```prisma
model OngoingEventConfig {
  // ...existing fields...
  visibility            String  @default("public") // 'public' | 'private', enforced in application code
  allowSoloRegistration Boolean @default(false) @map("allow_solo_registration")
}
```

```prisma
model OngoingSoloPlayer {
  id        String   @id @default(uuid())
  eventId   String   @map("event_id")
  playerId  String   @map("player_id")
  createdAt DateTime @default(now()) @map("created_at")

  event  OngoingEvent @relation(fields: [eventId], references: [id], onDelete: Cascade)
  player Player       @relation("OngoingSoloPlayer", fields: [playerId], references: [id], onDelete: Cascade)

  @@unique([eventId, playerId])
  @@index([eventId])
  @@map("ongoing_solo_players")
}
```

`OngoingEvent` gains `soloPlayers OngoingSoloPlayer[]`; `Player` gains
`ongoingSoloEntries OngoingSoloPlayer[] @relation("OngoingSoloPlayer")`.

- `visibility` is a plain string, matching this schema's convention (`role`, `scheme`, `phase`,
  `gender` are all plain strings validated in application code). It is not a boolean because a third
  mode is plausible later and a string leaves room for one without a migration of meaning.
- The defaults reproduce today's behaviour for every existing row: public, no solo registration.
- Both foreign keys are `ON DELETE CASCADE`. There is no `game_player_rank`-style `RESTRICT` FK
  anywhere near this table, so deleting an event or a player cannot be aborted by a solo entry.

### The one-entry invariant

**A player appears at most once per tournament — either in a team or in the solo pool, never both.**

The `@@unique([eventId, playerId])` constraint covers duplicates *within* the pool; the team side is
covered in application code, because `ongoing_teams` has no equivalent constraint (it is enforced
today by `validateTeamPairs` scanning the whole roster). Every path that places a player into a team
— `addTeam`, `setTeams`, `formTeams` — deletes that player's solo entry in the same transaction, and
every path that adds a solo entry rejects a player already on the roster.

## Backend: pure helpers

New file `src/ongoing/pairing.ts`, following the `bracket.ts` / `groups.ts` / `schedule.ts` pattern
(module-level `export const` arrows, no DI, unit-tested in isolation):

```ts
export interface SoloEntry {
  playerId: string;
  rating: number;
}

export interface PairedTeam {
  player1Id: string;
  player2Id: string;
}

export const pairByRating = (entries: SoloEntry[]): { pairs: PairedTeam[]; unpaired: string[] };
```

Sort by `rating` descending, tie-broken by `playerId` ascending. The tiebreak is not cosmetic: rating
collisions are common (everyone starts at 1000), and without it the pairing depends on Postgres row
order — the same class of bug the rank-chain ordering fix dealt with. Then walk two pointers from
both ends, pairing strongest with weakest:

```
[1300, 1200, 1000, 800] → (1300, 800), (1200, 1000)
```

With an odd count the two pointers meet on the median, which is returned in `unpaired`. Choosing the
median rather than the weakest or strongest player is arbitrary but deterministic, and it is the
natural product of the algorithm rather than a special case bolted on. The UI surfaces the leftover;
the admin decides what to do with them.

`effectiveTeamCount(teamCount, soloCount) = teamCount + Math.ceil(soloCount / 2)` — the occupancy
figure compared against `maxTeams`. Two solo players consume one slot; an odd solo player consumes a
whole one, so a tournament cannot be over-filled by rounding.

`isCancellationOpen(date)` sits next to the existing `isRegistrationDateOpen` in
`ongoing.service.ts` and shares its UTC-day comparison.

## API

### New

| Endpoint | Auth | Body | Behaviour |
|---|---|---|---|
| `POST /ongoing/:id/solo` | JWT | `{ playerId? }` | Registers a solo entrant. A non-manager may only register themselves (`playerId` omitted or equal to their own), and only in a public tournament. A manager may pass any `playerId`. Requires `allowSoloRegistration`. |
| `DELETE /ongoing/solo/:soloId` | JWT | — | Cancels a solo registration. Allowed for the entrant themselves while `isCancellationOpen`, or for a manager at any time. |
| `GET /ongoing/:id/solo/preview` | JWT (manager) | — | Runs `pairByRating` over the current pool and returns `{ pairs: [{ player1, player2, rating }], unpaired: [player] }`. Read-only; nothing is persisted. |
| `POST /ongoing/:id/solo/form-teams` | JWT (manager) | `{ teams: [{ player1Id, player2Id }] }` | Persists the confirmed (possibly hand-edited) pairs. |

`POST /ongoing/:id/solo` and `DELETE /ongoing/solo/:soloId` return the full
`OngoingEventResponseDto`, matching `addTeam`/`removeTeam`.

`form-teams` validates that every id appears in this event's solo pool and appears exactly once
across the submitted teams, then in one `$transaction` creates the `ongoing_teams` rows and deletes
the corresponding `ongoing_solo_players` rows. Submitting a subset is legal — players left out stay
in the pool. A partial or duplicated payload is rejected wholesale with a `BadRequestException`; the
transaction means the pool and the roster can never disagree.

The URL shapes mirror the existing split: collection routes under `/ongoing/:id/...`, entity routes
addressed by their own id (`DELETE /ongoing/teams/:teamId` → `DELETE /ongoing/solo/:soloId`).

All four are `assertPlanning`-gated.

### Changed

**`POST /ongoing` (create)** and **`PUT /ongoing/:id/config`** accept `visibility` and
`allowSoloRegistration` as top-level body fields (both DTOs already flatten config fields such as
`maxTeams` and `scheme` this way; the service writes them into the config row). `create` does not
accept a solo pool — a tournament is created with teams or empty, and solo entrants arrive through
`POST /ongoing/:id/solo`. `normaliseVisibility` rejects anything but `'public'`/`'private'` with a
`BadRequestException`, following `normaliseScheme`. Turning `allowSoloRegistration` off while the
pool is non-empty is a `BadRequestException` — the alternative is entrants stranded in a pool the UI
no longer shows.

**`POST /ongoing/:id/teams` (addTeam)** — the current rule ("you must register yourself as one of
the two players") becomes the *non-manager* rule, and gains a visibility check:

```
manager            → any pair
non-manager        → public only, and must include themselves; otherwise 403
```

A non-manager hitting a private tournament gets `ForbiddenException`, not the existing
`BadRequestException` — it is an authorization failure, and it must not be confused with the
"register yourself" message. The capacity check becomes
`effectiveTeamCount(teams.length, soloPlayers.length) >= maxTeams`, and the roster scan that
`validateTeamPairs` performs is extended to reject a player who is in the solo pool.

**`DELETE /ongoing/teams/:teamId` (removeTeam)** — currently `assertCanManageEvent`. It becomes:
manager (any time), **or** a member of that team while `isCancellationOpen`. A member cancelling
removes the whole team; the partner is not moved to the solo pool and is free to register again.
Past the deadline a member gets `ForbiddenException` with a message naming the deadline.

**`GET /ongoing/open` (findOpen)** — same filters, three new fields per event: `visibility`,
`allowSoloRegistration`, and `soloPlayers`. Its capacity filter switches to `effectiveTeamCount`
so it agrees with `addTeam`, preserving the property the existing comment insists on: the calendar
must never list a tournament as open that `addTeam` would then reject.

**`PUT /ongoing/:id/teams` (setTeams)** — additionally deletes the solo entries of every player
named in the new roster, inside the transaction that already replaces the teams.

### Response shapes

`OngoingEventConfigResponseDto` gains `visibility: string` and `allowSoloRegistration: boolean`.

```ts
export class OngoingSoloPlayerDto {
  id: string;
  player: OngoingTeamPlayerDto;
  rating: number;
}
```

`rating` is the single player's `playerStats.rank ?? 1000` — half of what a team's `rating` means,
which is why it is a separate DTO rather than a reused one.

`OngoingEventResponseDto` and `OngoingOpenEventDto` gain `soloPlayers: OngoingSoloPlayerDto[]`;
`OngoingOpenEventDto` also gains `visibility` and `allowSoloRegistration` (its config is flattened,
so these are top-level there).

`EVENT_INCLUDE` gains `soloPlayers` with `include: { player: { include: { playerStats: true } } }`
and `orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]` — the same explicit tiebreak the teams include
already carries, for the same reason (a bulk insert stamps one millisecond).

## Frontend

**`lib/api.ts`** — `ADD_ONGOING_SOLO(id)`, `REMOVE_ONGOING_SOLO(soloId)`,
`GET_ONGOING_SOLO_PREVIEW(id)`, `FORM_ONGOING_TEAMS(id)`.

**`lib/types.ts`** — `visibility` and `allowSoloRegistration` on `OngoingEventConfig` and on
`OngoingOpenEvent`; a new `OngoingSoloPlayer`; `soloPlayers` on `OngoingEvent` and
`OngoingOpenEvent`.

**`lib/ongoing-permissions.ts`** — joins `canManageOngoingEvent` with pure predicates the components
share, so no component re-derives a rule:

```ts
isOngoingCancellationOpen(dateIso: string): boolean
canRegisterInOngoingEvent(user, event): boolean          // logged in, public or manager
canRegisterSoloInOngoingEvent(user, event): boolean       // the above plus allowSoloRegistration
canCancelOngoingEntry(user, event, entrantPlayerIds): boolean
```

These mirror the backend rules; the backend remains the enforcement point, the frontend only decides
what to render.

**Components:**

- `create-tournament-form.tsx` — a Public/Private control and an "allow registration without a
  partner" checkbox, both sent only when they differ from the defaults (the form already builds its
  body conditionally).
- `ongoing-config-tab.tsx` — the same two controls, posting through the existing `updateConfig`
  mutation, so a creator can flip a tournament after the fact.
- `register-team-dialog.tsx` — a mode toggle "With a partner / Without a partner". Solo mode drops
  the partner select and posts to the solo endpoint. When the tournament is private and the viewer
  is not a manager, the dialog is replaced by a "Private" badge, matching how the not-logged-in case
  is already handled with a disabled button and tooltip.
- `calendar/page.tsx` — the private badge, the solo pool under the team list, and a "Cancel
  registration" button shown when the viewer is in the roster or the pool and
  `isOngoingCancellationOpen`.
- **New** `components/ongoing/solo-pool-section.tsx` — the pool with per-player ratings, each row
  removable by a manager, plus a "Form teams" button that fetches the preview, shows the proposed
  pairs in an editable dialog (the admin may swap partners before confirming), warns about a leftover
  player, and posts the confirmed list to `form-teams`. Mounted from `ongoing-roster-section.tsx`
  above the existing `TeamRosterEditor`.
- `ongoing-roster-section.tsx` — its `rosterSignature` key must include the solo entry ids too, or a
  registration arriving while the admin has a draft open would no longer remount the editor.

**Cache invalidation** follows the established trio: `["ongoing-event", id]`, `["ongoing-events"]`,
`["ongoing-open"]` after every mutation above.

**i18n** — every new string added to all four locale files (`en`, `uk`, `pl`, `be`); a missing key
falls back silently to English.

## Testing

**Backend** (Jest, mocked `PrismaService` — there is no test database):

- New `src/ongoing/pairing.spec.ts`: the 1300/1200/1000/800 case pairs 1300+800 and 1200+1000;
  equal ratings pair deterministically by id; an odd count leaves the median unpaired; an empty and
  a single-entry pool are handled.
- `effectiveTeamCount`: two solo fill one slot, three solo fill two.
- Extensions to `ongoing.service.spec.ts`: a non-manager is refused on a private tournament; a
  manager is not; a team member cancels their own team before the deadline; the same member is
  refused on the day of the tournament; a manager is not; capacity counts solo entrants;
  `form-teams` creates teams and deletes the matching pool rows in one transaction, and rejects a
  playerId that is not in the pool.

The `form-teams` test asserts the emitted queries and their order, not merely that the mock was
reached — the pool and roster must never be observable in a half-updated state.

**Frontend** — no test runner exists. Verify with `npx tsc --noEmit`, `npm run lint`,
`npm run build`, and by exercising `/calendar` and `/ongoing/[id]` in the browser.

## Deployment

`prisma migrate deploy` must be run against the remote database separately from the local one. The
new columns carry defaults and the new table is empty, so the migration is backwards-compatible: an
older frontend against the migrated backend keeps working, and every existing tournament stays
public with solo registration off.
