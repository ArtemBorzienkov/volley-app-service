# Calendar Create Form + Time & Location Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move tournament creation onto the Calendar page behind an admin-only button, and give a tournament a start time and a venue.

**Architecture:** Two nullable columns on `ongoing_events`. `startTime` is a `"HH:MM"` venue-local wall-clock **string**, deliberately not folded into `date` — `date` stays UTC midnight because the registration deadline compares UTC calendar dates and three pages render the day from UTC parts. The create form is extracted from `/ongoing/new` into a component, rendered in a dialog on `/calendar`, and `/ongoing/new` is deleted.

**Tech Stack:** NestJS 10 + Prisma 4.16 + PostgreSQL + Jest; Next.js App Router + TanStack Query + Tailwind v4 + shadcn/ui + i18next.

**Spec:** `volley-app-service/docs/superpowers/specs/2026-08-23-calendar-create-form-design.md`

## Global Constraints

- **Never run a git command** — not even read-only. Both repos' `CLAUDE.md` forbid it. **Every task ends without a commit step.** Two previous increments are also uncommitted in these trees — leave them alone, never revert or stash.
- **Do not start or stop any dev server.** A backend runs on port 3000 and a frontend on 3001, managed centrally. Read-only `curl` against 3000 is fine. If you need a live check, say so in your report.
- Backend `tsconfig` targets `es2017`, no `lib` override — `flatMap`, `toSorted`, `Object.fromEntries` are **unavailable** and fail `npm run build`.
- Backend `strictNullChecks: false`; **no global `ValidationPipe`**, so validate explicitly and throw `BadRequestException` / `NotFoundException` / `ConflictException`.
- Backend Prettier: single quotes, trailing commas, **120-column** width. Explicit return types on every controller and service method. Guard clauses at the top.
- **Backend baseline: `npm run test` is 82/82 across 3 suites, `npm run build` clean.** Never regress either.
- **Frontend `npm run lint` is NOT clean and never was.** Baseline: exactly **7 errors** (four `no-explicit-any`, three `set-state-in-effect`) in `app/add-results/page.tsx`, `app/events/page.tsx`, `app/events/[id]/page.tsx`, `components/layout-wrapper.tsx`, `components/navigation.tsx`. The gate is **"still exactly 7, none in touched files"** — never "clean", and never touch those seven.
- **Frontend `npx tsc --noEmit` is the only real typecheck**, is clean, and must stay clean. `strict: true`.
- **Frontend rule, verbatim:** *"Derive during render instead of syncing with an effect. `set-state-in-effect` already fires three times in this repo; do not add a fourth."* No `useEffect` that calls `setState`.
- Frontend: every page/component starts with `'use client'`. Fetches must check `res.ok`, parse the server's JSON `{ message }` and throw it.
- `lib/api.ts` is the single URL registry. **No new endpoint is needed in this increment** — do not add one.
- **Any new UI string goes into all four locale files** (`locales/{en,uk,pl,be}/common.json`) with real uk/pl/be translations, never English pasted in. Each must still parse as JSON.
- **npm only** in the frontend. Install nothing.
- No test framework in the frontend. Do not introduce one; never call anything "tested" there.
- No useless comments — comment only the *why*.
- Paths are relative to `/Users/artem/Desktop/projects/`.

## File Structure

| File | Responsibility |
| --- | --- |
| `volley-app-service/prisma/schema.prisma` | `startTime`, `location` on `OngoingEvent` |
| `volley-app-service/src/ongoing/ongoing.service.ts` | validate + persist + expose both; `{ id: 'asc' }` tiebreaker |
| `volley-app-service/src/ongoing/dto/*.ts` | create DTO gains both; response DTOs expose both |
| `volleyball-management-ui/lib/types.ts` | both fields on the ongoing types |
| `volleyball-management-ui/components/ongoing/create-tournament-form.tsx` (create) | the form, extracted |
| `volleyball-management-ui/app/calendar/page.tsx` | admin-only button + dialog; show time/location |
| `volleyball-management-ui/app/ongoing/new/` | **deleted** |
| `volleyball-management-ui/app/ongoing/page.tsx` | button links to `/calendar`; show time/location |
| `volleyball-management-ui/app/ongoing/[id]/page.tsx` | header shows time/location |
| `volleyball-management-ui/locales/*/common.json` | new strings |

---

## Task 1: Columns, validation, and exposure

**Files:**
- Modify: `volley-app-service/prisma/schema.prisma`
- Create: `volley-app-service/prisma/migrations/<timestamp>_add_start_time_location/migration.sql` (generated)
- Modify: `volley-app-service/src/ongoing/dto/create-ongoing-event.dto.ts`, `dto/ongoing-event-response.dto.ts`, `src/ongoing/ongoing.service.ts`
- Test: `volley-app-service/src/ongoing/ongoing.service.spec.ts`

**Interfaces:**
- Produces: `OngoingEvent.startTime: string | null`, `OngoingEvent.location: string | null` in the Prisma client and on every ongoing response DTO (`OngoingEventResponseDto`, `OngoingEventListItemDto`, `OngoingOpenEventDto`); `CreateOngoingEventDto` gains optional `startTime` and `location`.

- [ ] **Step 1: Confirm the target database**

Run: `grep -n '^DATABASE_URL' volley-app-service/.env`

The active line must be the **localhost** one (`127.0.0.1`); the remote `46.101.180.6` line is commented out and must stay so. If the active URL is not localhost, **stop and ask** — do not migrate a shared database.

- [ ] **Step 2: Add the columns**

In `prisma/schema.prisma`, inside `model OngoingEvent`, after the `date` field:

```prisma
  startTime String?  @map("start_time")
  location  String?
```

Match the file's existing indentation and alignment. **Do not run `npx prisma format`** — it reformats unrelated pre-existing models and needlessly widens the diff.

- [ ] **Step 3: Migrate and regenerate**

```bash
cd volley-app-service && npm run prisma:migrate:dev -- --name add_start_time_location && npm run prisma:generate
```

Expected: one additive migration containing two `ADD COLUMN` statements, nothing dropped. If Prisma warns about data loss, stop.

- [ ] **Step 4: Write the failing tests**

Append inside the outer `describe('OngoingService', ...)` in `src/ongoing/ongoing.service.spec.ts`:

```ts
  describe('OngoingService.create startTime and location', () => {
    const base = { name: 'T', date: '2030-01-01T00:00:00.000Z' };

    it('stores a valid HH:MM start time and a location', async () => {
      await service.create({ ...base, startTime: '18:30', location: 'Beach Court 2' });

      const args = (prisma.ongoingEvent.create as jest.Mock).mock.calls[0][0];
      expect(args.data.startTime).toBe('18:30');
      expect(args.data.location).toBe('Beach Court 2');
    });

    it('accepts a tournament with neither field', async () => {
      await service.create(base);

      const args = (prisma.ongoingEvent.create as jest.Mock).mock.calls[0][0];
      expect(args.data.startTime).toBeNull();
      expect(args.data.location).toBeNull();
    });

    it('accepts midnight and the last minute of the day', async () => {
      await service.create({ ...base, startTime: '00:00' });
      await service.create({ ...base, startTime: '23:59' });

      expect(prisma.ongoingEvent.create).toHaveBeenCalledTimes(2);
    });

    it('rejects a malformed start time', async () => {
      for (const bad of ['24:00', '18:60', '6:30', '1830', 'evening', '18:30:00']) {
        await expect(service.create({ ...base, startTime: bad })).rejects.toThrow(
          new BadRequestException('startTime must be in HH:MM 24-hour format'),
        );
      }
    });

    it('rejects a non-string location', async () => {
      await expect(service.create({ ...base, location: 42 as any })).rejects.toThrow(
        new BadRequestException('location must be a string'),
      );
    });

    it('trims the location and treats an empty one as absent', async () => {
      await service.create({ ...base, location: '   ' });

      const args = (prisma.ongoingEvent.create as jest.Mock).mock.calls[0][0];
      expect(args.data.location).toBeNull();
    });

    it('creates nothing when the start time is malformed', async () => {
      await expect(service.create({ ...base, startTime: 'nope' })).rejects.toThrow(BadRequestException);
      expect(prisma.ongoingEvent.create).not.toHaveBeenCalled();
    });
  });

  describe('OngoingService team ordering', () => {
    it('breaks createdAt ties by id so the order is deterministic', async () => {
      await service.findOne('event-1');

      const args = (prisma.ongoingEvent.findUnique as jest.Mock).mock.calls[0][0];
      expect(args.include.teams.orderBy).toEqual([{ createdAt: 'asc' }, { id: 'asc' }]);
    });
  });
```

- [ ] **Step 5: Run them and watch them fail**

Run: `cd volley-app-service && npx jest src/ongoing/ongoing.service.spec.ts`
Expected: the new tests FAIL; every pre-existing test still passes.

- [ ] **Step 6: Extend the DTOs**

`dto/create-ongoing-event.dto.ts` — add:

```ts
  @IsOptional()
  @IsString()
  startTime?: string;

  @IsOptional()
  @IsString()
  location?: string;
```

`dto/ongoing-event-response.dto.ts` — add `startTime: string | null;` and `location: string | null;` to **`OngoingEventResponseDto`**, **`OngoingEventListItemDto`** and **`OngoingOpenEventDto`**. All three feed a UI surface that shows them.

- [ ] **Step 7: Validate and persist**

In `ongoing.service.ts`, add a private helper next to the other validators:

```ts
  // A wall-clock time at the venue, not an instant — there is no timezone to reconcile, so it is
  // stored and rendered verbatim. `date` stays UTC midnight of the calendar day.
  private normaliseStartTime(value: string | undefined | null): string | null {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
      throw new BadRequestException('startTime must be in HH:MM 24-hour format');
    }

    return value;
  }

  private normaliseLocation(value: string | undefined | null): string | null {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string') {
      throw new BadRequestException('location must be a string');
    }

    return value.trim() || null;
  }
```

In `create`, after the existing name/date validation and **before** the Prisma call, add both to the payload:

```ts
    const startTime = this.normaliseStartTime(createOngoingEventDto.startTime);
    const location = this.normaliseLocation(createOngoingEventDto.location);
```

and include `startTime` and `location` in the `data` object.

- [ ] **Step 8: Expose them on every read path**

- In `mapEvent`, add `startTime: event.startTime, location: event.location`.
- In `findAll`'s mapped list item, add both.
- In `findOpen`'s pushed object, add both.
- In `EVENT_INCLUDE`, change the teams ordering to `orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }]`. A single `setTeams` transaction stamps every row in the same millisecond, so `createdAt` alone has ties and the row order is not guaranteed — the frontend's roster-remount key and its index-wise unsaved-changes comparison both depend on a stable order.

- [ ] **Step 9: Run the tests and build**

```bash
cd volley-app-service && npx jest src/ongoing/ongoing.service.spec.ts && npm run test && npm run build
```

Expected: everything passes (at least the 82 pre-existing plus the new ones), build clean.

---

## Task 2: Frontend types

**Files:**
- Modify: `volleyball-management-ui/lib/types.ts`

**Interfaces:**
- Produces: `startTime: string | null` and `location: string | null` on `OngoingEvent`, `OngoingEventListItem` and `OngoingOpenEvent`.

- [ ] **Step 1: Add the fields**

Add to all three interfaces:

```ts
  startTime: string | null;
  location: string | null;
```

Use `| null`, **not** optional `?` — the backend always sends the key, with `null` when unset, and modelling it as optional would let a consumer forget the null case.

- [ ] **Step 2: Typecheck**

```bash
cd volleyball-management-ui && npx tsc --noEmit && npm run lint
```

Expected: `tsc` clean; lint exactly 7 errors, none in `lib/types.ts`.

---

## Task 3: Extract the create form

**Files:**
- Create: `volleyball-management-ui/components/ongoing/create-tournament-form.tsx`
- Modify: `volleyball-management-ui/app/ongoing/new/page.tsx` (temporarily renders the extracted form; deleted in Task 4)
- Modify: all four `locales/*/common.json`

**Interfaces:**
- Produces:
```ts
interface CreateTournamentFormProps { onCreated?: (id: string) => void }
export function CreateTournamentForm(props: CreateTournamentFormProps)
```
Task 4 renders it inside a dialog on `/calendar`.

- [ ] **Step 1: Move the form out of the page**

Move everything from `app/ongoing/new/page.tsx` except the page shell and the admin gate into the new component: the name input, the date popover + `Calendar`, the max-teams input, the `TeamRosterEditor`, the incomplete-row guard, the create mutation and its error rendering.

Keep the existing behaviour exactly — in particular:
- the submit sends **one** POST to `API.CREATE_ONGOING_EVENT`;
- the date is sent as `new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())).toISOString()` — **local getters, UTC constructor**. This is load-bearing: it makes the stored UTC calendar day equal the day the user picked, in every timezone. Do not "simplify" it to `date.toISOString()`;
- `maxTeams` is omitted when blank (never sent as `0`);
- `teams` is omitted when empty, and submit is disabled while any roster row is half-filled;
- the mutation invalidates **both** `["ongoing-events"]` and `["ongoing-open"]`.

Replace the page's post-success `router.push` with a call to the optional `onCreated(id)` prop, so the caller decides what happens next. `app/ongoing/new/page.tsx` passes a handler that navigates to the new tournament, preserving today's behaviour until Task 4 deletes it.

- [ ] **Step 2: Add the start-time and location fields**

Inside the form, after the date field:
- **Start time** — `<input type="time">`, which yields `"HH:MM"` natively; no parsing needed. Optional.
- **Location** — a text `Input`. Optional.

Send them only when non-empty, the same way `maxTeams` is handled. The backend rejects a malformed `startTime` with `400 startTime must be in HH:MM 24-hour format`; that message must surface in the existing error area.

- [ ] **Step 3: Add the strings to all four locales**

Under `ongoing.create`: `startTimeLabel`, `startTimeHint` ("Optional"), `locationLabel`, `locationHint` ("Optional"). Real uk/pl/be translations.

- [ ] **Step 4: Verify**

```bash
cd volleyball-management-ui && npx tsc --noEmit && npm run lint
for f in locales/*/common.json; do node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" && echo "$f ok"; done
```

Expected: `tsc` clean, lint exactly 7 with none in touched files, four `ok` lines.

---

## Task 4: Create from the Calendar, and delete `/ongoing/new`

**Files:**
- Modify: `volleyball-management-ui/app/calendar/page.tsx`
- Delete: `volleyball-management-ui/app/ongoing/new/page.tsx` (and the now-empty `app/ongoing/new/` directory)
- Modify: `volleyball-management-ui/app/ongoing/page.tsx`
- Modify: all four `locales/*/common.json`

**Interfaces:**
- Consumes: `CreateTournamentForm` from Task 3, `useIsAdmin`

- [ ] **Step 1: Add the admin-only create dialog to the Calendar**

At the top of the Calendar page, for admins only, render a **New tournament** button that opens a `Dialog` containing `<CreateTournamentForm onCreated={...} />`. On success, close the dialog. The tournament appears in the list immediately because the mutation already invalidates `["ongoing-open"]` — do **not** add a manual refetch.

**The button and the dialog are admin-only. The Register button and the rest of the page must stay visible and usable for everyone** — that is the whole point of the Calendar. Do not wrap the page or the cards in an admin check.

- [ ] **Step 2: Delete the old route**

Delete `app/ongoing/new/page.tsx` and its directory.

- [ ] **Step 3: Repoint the list page's button**

In `app/ongoing/page.tsx`, change the admin-only button's `href` from `/ongoing/new` to `/calendar`. Reuse the existing `ongoing.newTournament` string.

- [ ] **Step 4: Confirm nothing still points at the deleted route**

Run: `cd volleyball-management-ui && grep -rn "ongoing/new" app components lib locales || echo "no references remain"`
Expected: `no references remain`. A stale link would 404.

- [ ] **Step 5: Add the strings to all four locales**

Under `calendar`: `newTournament` (the button) and `newTournamentTitle` (the dialog heading). Real uk/pl/be translations. Reuse `ongoing.config.cancel` for a cancel affordance if you add one.

- [ ] **Step 6: Verify**

```bash
cd volleyball-management-ui && npx tsc --noEmit && npm run lint && npm run build
for f in locales/*/common.json; do node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" && echo "$f ok"; done
```

Expected: `tsc` clean; lint exactly 7 with none in touched files; `next build` succeeds and **`/ongoing/new` no longer appears** in the route list while `/calendar` does; four `ok` lines.

---

## Task 5: Show time and location

**Files:**
- Modify: `volleyball-management-ui/app/calendar/page.tsx`, `app/ongoing/page.tsx`, `app/ongoing/[id]/page.tsx`
- Modify: all four `locales/*/common.json` if any new string is needed

**Interfaces:**
- Consumes: `startTime` and `location` from Task 2

- [ ] **Step 1: Render both wherever the date is rendered**

On the Calendar cards, the tournament list cards and the detail header, show the start time and the location beside the existing formatted date.

**Render `startTime` verbatim.** It is a venue-local wall-clock string, not an instant — do not pass it through `new Date(...)`, `date-fns`, or any timezone conversion. Doing so would both misinterpret it and reintroduce the class of bug this feature already had.

**Omit each field entirely when it is `null`** — no placeholder, no empty separator left dangling. A tournament with neither must render exactly as it does today.

- [ ] **Step 2: Verify**

```bash
cd volleyball-management-ui && npx tsc --noEmit && npm run lint
for f in locales/*/common.json; do node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" && echo "$f ok"; done
```

---

## Task 6: End-to-end verification

**Files:** none — verification only.

- [ ] **Step 1: Automated checks**

```bash
cd volley-app-service && npm run test && npm run build
cd ../volleyball-management-ui && npx tsc --noEmit && npm run lint && npm run build
```

Expected: backend all green (≥82 plus the new tests); frontend `tsc` clean, lint exactly 7, build succeeding without `/ongoing/new`. Paste the real output.

- [ ] **Step 2: Locale coverage across all four languages**

Extract every `t("...")` key used under `app/calendar`, `app/ongoing` and `components/ongoing` and assert each resolves in all four locale files. Report the count and any missing key — a missing key silently falls back to English.

- [ ] **Step 3: Live walkthrough** (the controller runs this; servers are managed centrally)

1. As admin on `/calendar`: **New tournament** is present → opens the dialog.
2. Create one with a name, a future date, `18:30`, a location, a cap of 3 and one initial team → dialog closes and the card appears **immediately**.
3. The card shows the picked day, `18:30` and the location.
4. The detail header shows the same three.
5. A malformed time cannot be submitted, or if submitted returns the backend message in the form.
6. Create one with **no** time and **no** location → card and header render cleanly with neither, no stray separators.
7. As a **non-admin**: `/calendar` shows no New tournament button, but Register still works.
8. `/ongoing/new` returns 404.

- [ ] **Step 4: Clean up**

Delete every tournament created during the walkthrough and confirm the cascade leaves no orphan rows.

---

## Notes for the implementer

- **Never migrate the shared remote database.** Task 1 Step 1 exists for that reason.
- **`date` must stay UTC midnight of the calendar day.** The registration deadline compares UTC calendar dates and three pages render the day from UTC parts. `startTime` is a separate wall-clock string precisely so that contract is untouched.
- **Never call `agregateRankings()`** or touch `games` / `player_stats`.
- **No git commands, and do not start or stop dev servers.**
