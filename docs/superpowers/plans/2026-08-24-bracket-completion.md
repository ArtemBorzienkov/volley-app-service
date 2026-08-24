# Plan: playoff-in-Matches, 3rd-place match, tie placements, Finish tournament

Design: `docs/superpowers/specs/2026-08-24-bracket-completion-design.md` — read it first, in full.

Backend: `volley-app-service`. Frontend: `volleyball-management-ui`. Tasks are ordered by
dependency; each is a fresh implementer with no memory of the others beyond this plan and the spec.

## Notes for every implementer

- **Never migrate the shared remote database.** `volley-app-service/.env`'s active `DATABASE_URL` is
  local (`127.0.0.1`) — confirm this yourself before running `prisma:migrate:dev`, don't assume it.
- **Never call `agregateRankings()`**, and don't touch `games`/`player_stats`/`event_members` tables.
- **No git commands** — not even read-only (`status`, `diff`, `log`). None.
- **Do not start or stop dev servers.** Verify with `npm run test` / `npm run build` / `tsc --noEmit`
  / `npm run lint` only.
- Follow TDD: write a failing test for new behavior before writing the implementation.
- `strictNullChecks` is `false` on the backend — the compiler will not catch null-unsafe code; reason
  about it by hand, especially around `team1Id`/`team2Id`/`bracketRound`/`bracketSlot`.
- The backend `tsconfig` targets `es2017` — no `flatMap`, `toSorted`, `Object.fromEntries`.
- Comments: short, essential, explain *why* not *what*. No comment restating the next line.

---

## Task 1: The 3rd-place match (backend)

**Files:**
- Modify: `prisma/schema.prisma` (new migration), `src/ongoing/ongoing.service.ts`,
  `src/ongoing/ongoing.service.spec.ts`
- Read: `docs/superpowers/specs/2026-08-24-bracket-completion-design.md` §2, and the existing
  `findPlayoffSuccessor`/`updateGameScore`/`clearGameResult`/`generatePlayoff` in
  `ongoing.service.ts` — this task modifies all four.

**This is the highest-risk task in this plan.** The rule-3/rule-4 successor logic this task extends
has already had two real defects found and fixed by review earlier today (an edit-vs-clear asymmetry
in rule 4, and a stale-comment/duplication issue from a crashed agent). Move carefully; a fresh
review pass will happen after this task lands, so leave the reasoning legible in comments where it
is genuinely non-obvious, not everywhere.

- [ ] **Step 1: Schema**

  Add to `OngoingGame`: `thirdPlace Boolean @default(false) @map("third_place")`. Run
  `npm run prisma:migrate:dev` against the confirmed-local database, then `npm run prisma:generate`.

- [ ] **Step 2: Generate the 3rd-place row**

  In `generatePlayoff`, after `buildBracketGames` produces the normal bracket rows, add one more row
  — `phase: 'playoff', thirdPlace: true, bracketRound: null, bracketSlot: null, team1Id: null,
  team2Id: null, team1Points: null, team2Points: null, round: 0, court: 0` — **only when the
  qualifier count (`seedList.length`) is ≥ 4**. Give it `order` one past the last normal row's order
  so it inserts alongside the rest in the same `createMany`. Write tests: a 4-qualifier bracket gets
  the extra row with both fields correctly set; a 2-qualifier bracket (a single final, no
  semifinal) does **not** get one.

- [ ] **Step 3: Generalize the successor lookup**

  Replace `findPlayoffSuccessor` (returns one-or-null) with a function that returns an array of the
  successors this game feeds — 0 for the final with no 3rd-place row, 1 for any other normal round,
  and 2 for a semifinal when a 3rd-place row exists (the normal successor, plus the 3rd-place row).
  "Is this game a semifinal" is `bracketRound === maxBracketRound - 1`; fetch `maxBracketRound` (the
  highest `bracketRound` among the event's playoff games) and the 3rd-place row (if any) in the same
  transaction, alongside the existing normal-successor query — don't add a second round trip where
  one query already exists for something adjacent to it, but don't force a single query to do two
  unrelated things either; use your judgment on the cleanest shape.

  The 3rd-place row's slot: the semifinal at the **lower** `bracketSlot` writes `team1Id`, the other
  writes `team2Id` — pick one fixed rule and test it, the exact choice doesn't matter as long as it's
  deterministic and each semifinal always maps to the same slot.

  Update every call site (`updateGameScore`, `clearGameResult`) to loop over the returned array
  instead of handling a single optional result. **There must still be exactly one place the successor
  geometry is computed and exactly one refusal message** — this task generalizes cardinality (0/1 →
  0/1/2), it does not introduce a second version of either.

- [ ] **Step 4: Advance winner AND loser**

  In `updateGameScore`, when this game is a semifinal, the write to the normal successor still
  carries the **winner** (unchanged); the write to the 3rd-place row carries the **loser** —
  `team1Points > team2Points ? game.team2Id : game.team1Id`, the mirror of the existing winner
  expression sitting right next to it. Both writes happen in the same transaction as the score write,
  same as today.

- [ ] **Step 5: Rule 4 over multiple successors**

  Both `updateGameScore` and `clearGameResult` must refuse (same message, same exception type) if
  **any** successor already has a result — not just the first one checked. Write a test: recording
  the 3rd-place match, then trying to edit or clear the semifinal that fed it, is refused exactly like
  editing a semifinal after the final is played is refused today. Also test the reverse: recording
  only the final (not the 3rd-place match) does **not** block re-editing a semifinal whose loser feeds
  the still-empty 3rd-place row — only an actually-played successor blocks.

- [ ] **Step 6: `clearGameResult` empties both slots it filled**

  Clearing a semifinal result must null out **both** the normal successor's slot and the 3rd-place
  row's slot it had filled (when unblocked by rule 4). Test this explicitly — it's the most likely
  place for someone to update only one of the two writes and miss the other.

- [ ] **Step 7: Verify**

  ```bash
  cd volley-app-service && npm run test && npm run build
  ```

  Report the exact test count before and after. Confirm by reading the final diff of
  `ongoing.service.ts` that `findPlayoffSuccessor`'s replacement is called from every place the old
  one was, and that no old single-successor code path survives half-migrated.

---

## Task 2: Playoff games in the Matches tab (frontend)

**Files:**
- Create: a shared round-label helper (e.g. `lib/ongoing-bracket.ts`) — extract `roundLabel` out of
  `components/ongoing/ongoing-bracket-tab.tsx` rather than duplicating it.
- Modify: `components/ongoing/ongoing-matches-tab.tsx`, `components/ongoing/ongoing-bracket-tab.tsx`
  (to import the extracted helper instead of keeping its own copy), all four `locales/*/common.json`
  if a new label string is needed (e.g. "3rd place").
- Depends on: Task 1 only for the `thirdPlace` field existing on the type (`lib/types.ts` — add
  `thirdPlace: boolean` to `OngoingGame`); does not depend on Task 1's backend logic being correct,
  since this task only renders whatever games the API already returns.

**Interfaces consumed:** `OngoingEvent.games` (already includes playoff games; this task changes
what the Matches tab does with `phase === "playoff"` ones, which it currently discards).

- [ ] **Step 1:** Add `thirdPlace: boolean` to the `OngoingGame` type in `lib/types.ts`.

- [ ] **Step 2:** Extract `roundLabel(t, round, totalRounds)` from `ongoing-bracket-tab.tsx` into a
  shared helper, imported by both that file and the Matches tab. Do not change its behavior while
  extracting — this is a pure move, verified by the Bracket tab rendering identically afterward.

- [ ] **Step 3:** In `ongoing-matches-tab.tsx`, add a second section below the existing group-stage
  rounds: playoff games (`phase === "playoff"`), grouped by `bracketRound` (using the shared helper
  for each group's label) with the `thirdPlace` game rendered as its own row labelled distinctly
  (add an i18n key for it in all four locales — write real Ukrainian, not an English placeholder).
  Both sections render through the existing `OngoingMatchCard`, unchanged.

- [ ] **Step 4:** Only show the playoff section when playoff games actually exist — an empty second
  heading with nothing under it is worse than no heading, same principle the Bracket tab already
  follows for its own visibility.

- [ ] **Step 5: Verify**

  ```bash
  cd volleyball-management-ui && npx tsc --noEmit && npm run lint && npm run build
  for f in locales/*/common.json; do node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" && echo "$f ok"; done
  ```

  Report the lint error/warning counts against the pre-existing baseline (7 errors / 24 warnings in
  files this task does not touch) — any new one is a regression.

---

## Task 3: The 3rd-place match in the Bracket tab (frontend)

**Files:** Modify `components/ongoing/ongoing-bracket-tab.tsx`; locale files for the new label.
**Depends on:** Task 1 (needs real `thirdPlace` games from the API to render against) and Task 2's
extracted `roundLabel` helper (import it, don't re-copy it).

- [ ] **Step 1:** Render the `thirdPlace` game as an extra column or row alongside the final —
  visually near it, since it's contested at the same point in the tournament, but clearly labelled
  "3rd place" (or the equivalent i18n key added in Task 2) rather than folded into `roundLabel`'s
  numeric-round logic, which has no concept of it.

- [ ] **Step 2:** Handle its absence gracefully — most brackets (< 4 qualifiers) have no 3rd-place
  row at all; render nothing for it in that case, not an empty box.

- [ ] **Step 3: Verify** — same commands as Task 2, Step 5.

---

## Task 4: Elimination-round tie placements (frontend, pure logic)

**Files:** Create `lib/ongoing-placements.ts` (or extend `lib/ongoing-standings.ts` if that reads
more naturally once you're in the file — your call, but don't split one cohesive concept across two
files either). Create its `.spec.ts`/test file matching this repo's existing test tooling for the
`lib/` directory (check how `ongoing-standings.ts` or `ongoing-date.ts` are tested, if at all, and
match that convention exactly rather than introducing a new one).

**Depends on:** nothing from Tasks 1–3 functionally (it's pure computation over `OngoingEvent`), but
needs the `thirdPlace` field on `OngoingGame` (Task 2, Step 1) to identify that game.

- [ ] **Step 1:** Implement the placement algorithm from the design spec §3 exactly: final → 1st/2nd;
  3rd-place match (if present) → 3rd/4th; every other round `r` (1 to `k-2`) → all losers tie at
  `N/2^r + 1`; non-qualifying group teams tie at `N+1`; `roundRobin` → the `computeStandings` order,
  no ties. Return something keyed by player id (both players of a team share their team's place),
  matching the `Record<placeString, playerId[]>` shape `CreateEventWithGamesDto.places` expects.

- [ ] **Step 2:** Test every branch explicitly with a constructed `OngoingEvent`: an 8-team bracket
  (verify quarterfinal losers all get "5"), a 4-team bracket with a 3rd-place match, a 2-team bracket
  (no 3rd-place match — verify no crash and no phantom placement for it), a `groupsPlayoff` event
  with non-qualifying group teams, and a plain `roundRobin` event.

- [ ] **Step 3: Verify** — same commands as Task 2, Step 5, plus running whatever test command covers
  this new file.

---

## Task 5: "Finish tournament" (frontend)

**Files:**
- Modify: `app/ongoing/[id]/page.tsx` (the button, admin-gated, enabled only when the tournament is
  actually complete per the design spec's per-scheme rule), `app/add-results/page.tsx` (read a
  one-shot `sessionStorage` prefill key on mount and `reset()` the form with it).
- Consumes: Task 4's placement function, the existing `CreateEventWithGamesDto` shape (read
  `lib/types.ts` / the add-results page's own `FormData` type — match whichever shape
  `createEventWithGamesMutation` actually expects, don't guess).

- [ ] **Step 1:** Write the payload-building function: `name`/`date`/`location` from the ongoing
  event (mind the UTC-midnight date contract this codebase already established — pin the UTC
  Y/M/D before formatting into whatever the add-results date input expects, do not call
  `.toISOString()` on a local-parsed Date), `games` from every played game across **both** phases
  (map each `team1Id`/`team2Id` through `event.teams` to that team's `player1.id`/`player2.id`), and
  `places` from Task 4.

- [ ] **Step 2:** "Finish tournament" button: admin-only, and only enabled once the tournament is
  actually over (`groupsPlayoff`: final — and 3rd-place match, if one exists — both played;
  `roundRobin`: every scheduled game played). Disabled or hidden otherwise; if disabled, say why
  (e.g. "the final hasn't been played yet") rather than leaving the admin to guess.

- [ ] **Step 3:** On click: write the built payload to a `sessionStorage` key, navigate to
  `/add-results`. On that page's mount, check for the key; if present, read it, clear it immediately
  (a stale leftover value must never silently reappear on a later visit), and `reset()` the form with
  it. Every field must remain normally editable afterward — this is a prefill, not a lock.

- [ ] **Step 4:** The ongoing tournament itself is not modified by this action — no "finished" flag,
  no archival, nothing deleted. Confirm this by reading your own diff: this task should touch no
  backend file and no `PATCH`/`DELETE` call against `/ongoing/*`.

- [ ] **Step 5: Verify** — same commands as Task 2, Step 5.

---

## Task 6: End-to-end verification

**Files:** none — verification only. Fresh implementer, no memory of building any of the above.

- [ ] **Step 1: Automated checks**

  ```bash
  cd volley-app-service && npm run test && npm run build
  cd ../volleyball-management-ui && npx tsc --noEmit && npm run lint && npm run build
  ```

- [ ] **Step 2: Live walkthrough** (backend on :3000, frontend on :3001 — check both ports are free
  or already running the current code before assuming either; do not kill a process without checking
  what it is and how old it is first)

  1. Create an 8-team tournament, `groupsPlayoff`, 2 groups of 4, 2 qualifiers each. Record every
     group result. Generate the playoff.
  2. Confirm a 3rd-place match row exists (bracketRound null, thirdPlace true) once generated.
  3. Confirm the Matches tab shows the group rounds **and** a playoff section with both semifinals
     labelled correctly, and (once it exists) the 3rd-place row — editable from there.
  4. Record both semifinals. Confirm the winners land in the final and the losers land in the
     3rd-place match.
  5. Try to edit a semifinal after the 3rd-place match has been recorded → refused. Try to edit it
     when only the final (not yet the 3rd-place match) has a result → also refused, since the normal
     successor is played. Clear the final, confirm you can now re-edit the semifinal, and that
     clearing empties both the final's slot and the 3rd-place row's slot it had filled.
  6. Record the 3rd-place match and the final. Click "Finish tournament", confirm `/add-results`
     opens pre-filled with every group **and** playoff game, correct 1st/2nd/3rd/4th, and confirm
     it's still fully editable before submitting.
  7. Separately: a single-group tournament with exactly 2 qualifiers (a bare final, no semifinal) —
     confirm no 3rd-place match is generated and the Bracket tab shows no phantom row for it.
  8. Separately: a `roundRobin` tournament — confirm "Finish tournament" enables only once every game
     is played, and that the prefilled placement matches the live Standings tab's order exactly.

- [ ] **Step 3: Clean up** — delete every tournament created during the walkthrough. Do **not** submit
  any of the "Finish tournament" prefilled forms to `/events/with-games` for real — that would write
  real rating history for made-up test players/games. Verify the prefill and editability only; back
  out before the final submit.

## Notes for every implementer (repeated for visibility)

- **Never migrate the shared remote database. Never call `agregateRankings()`. No git commands. Do
  not start or stop dev servers.**
