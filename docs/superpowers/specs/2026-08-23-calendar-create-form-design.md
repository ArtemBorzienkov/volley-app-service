# Create a tournament from the Calendar, with time and location

**Date:** 2026-08-23
**Scope:** full-stack — `volley-app-service` and `volleyball-management-ui`.
**Builds on:** `2026-08-23-tournament-registration-design.md`.

## Problem

Creating a tournament lives on its own page, `/ongoing/new`, reached from the tournament list — not
from the Calendar, which is where tournaments are actually browsed and joined. And a tournament
currently carries only a date: no start time and no venue, so a registrant cannot tell when or
where they are turning up.

## Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Start time | **Separate `startTime` column, `"HH:MM"` local wall-clock** | The `date` column stays UTC midnight of the calendar day. That is load-bearing: the registration deadline compares UTC calendar dates and three pages render the day from UTC parts. Folding a time into `date` would reopen the off-by-one-day bug this feature already had once. |
| Location | New nullable `location` column | Free text. The existing `events` table has the same field, so this follows precedent. |
| Where creation lives | **Moved into `/calendar`; `/ongoing/new` is deleted** | One place to create a tournament. The form is extracted into a component so the move is not a copy. |
| Who may create | Admin only, via the existing cosmetic gate | Unchanged from today. Registration stays open to everyone. |
| Editing after creation | **Out of scope** | The Config tab manages format and roster, not identity. Name, date, time and location cannot be corrected after creation — see Out of scope. |

`startTime` is a wall-clock string, deliberately not an instant. A tournament at 18:00 is at 18:00
at the venue; there is no second timezone to reconcile and no conversion anywhere. It is stored,
returned and displayed verbatim.

Both columns are nullable — tournaments created before this change have neither, and the form
leaves both optional.

## Data model

```prisma
model OngoingEvent {
  // ... existing fields
  startTime String? @map("start_time")   // "HH:MM", 24-hour, venue-local
  location  String? @map("location")
}
```

Validation in the service: `startTime` must match `/^([01]\d|2[0-3]):[0-5]\d$/` when present;
`location` is trimmed and must be a string when present. Both may be omitted or null.

Also, unrelated but adjacent and cheap: `EVENT_INCLUDE` orders teams by `createdAt asc`, and a
single `setTeams` transaction stamps every row in the same millisecond, so that sort has ties.
Add `{ id: 'asc' }` as a tiebreaker. This makes the frontend's roster-remount key and the
`hasUnsavedTeams` index-wise comparison deterministic.

## API

No new endpoints.

| Method | Path | Change |
| --- | --- | --- |
| `POST` | `/ongoing` | accepts optional `startTime` and `location` |
| `GET` | `/ongoing`, `/ongoing/:id`, `/ongoing/open` | all three return `startTime` and `location` |

The list DTO gains them too, so the Calendar card and the tournament list can show the venue and
time without a second request.

## Frontend

```
components/ongoing/create-tournament-form.tsx   extracted from app/ongoing/new/page.tsx
app/calendar/page.tsx                           admin-only "New tournament" button -> dialog
app/ongoing/new/                                DELETED
app/ongoing/page.tsx                            its button now links to /calendar
```

- The Calendar gains an admin-only **New tournament** button that opens a dialog containing the
  form: name, date (the existing calendar popover), **start time** (`<input type="time">`, which
  yields `"HH:MM"` natively and needs no parsing), **location**, max teams, and the optional
  initial roster.
- On success the dialog closes and the new tournament appears in the list immediately — the create
  mutation already invalidates `["ongoing-open"]` and `["ongoing-events"]`.
- Time and location render on the Calendar cards, the tournament list cards and the detail header,
  each omitted when absent rather than showing a placeholder.
- `/ongoing/new` is removed along with its route; nothing links to it afterwards.

## Testing

Backend: Jest against a mocked `PrismaService`. Cover `startTime` format validation (accepted,
rejected, absent), `location` handling, both fields surfacing in `findOne`/`findAll`/`findOpen`,
and the `{ id: 'asc' }` tiebreaker appearing in the query.

Frontend: no test runner exists; verified with `npx tsc --noEmit`, `npm run lint` (must stay at the
7 pre-existing errors), `npm run build`, and a live browser walkthrough.

## Out of scope

Editing a tournament's name, date, time or location after creation; a venue picker or any
structured location model; timezone conversion of `startTime`; per-match times.
