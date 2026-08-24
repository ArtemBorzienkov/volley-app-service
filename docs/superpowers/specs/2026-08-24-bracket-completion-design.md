# Design: playoff matches in the Matches tab, a 3rd-place match, elimination-round placements, and a "Finish tournament" handoff to the rating engine

## Context

Four related requests, all extending the groups + playoff feature shipped earlier today:

1. Playoff games currently only appear in the Bracket tab. They should also appear in the Matches
   tab, editable from either place — same underlying data, two views.
2. The bracket should include a 3rd-place match between the two semifinal losers.
3. When a bracket round larger than the semifinal is eliminated with no consolation match (e.g. a
   quarterfinal), all of that round's losers should share one tied placement — the user's own
   examples: 4 quarterfinal losers all take 5th; 8 round-of-16 losers all take 9th.
4. A "Finish tournament" action that produces the same full results submission the operator today
   builds by hand on `/add-results` (event name/date/location, every game score, every team's final
   placement) — currently a manual, error-prone re-entry of data the app already has.

## Current state (confirmed by reading the code, not assumed)

- `OngoingGame` has no loser concept anywhere. `updateGameScore` derives
  `winnerId = team1Points > team2Points ? team1Id : team2Id` inline and advances it into the next
  round via `findPlayoffSuccessor`; nothing computes or stores a loser.
- `bracket.ts#buildBracketGames` builds exactly `2^k - 1` games for a `2^k`-team bracket, with no
  extra game for 3rd place.
- The Matches tab (`ongoing-matches-tab.tsx`) filters to `game.phase === "group"` only; playoff games
  are invisible there. `OngoingMatchCard` itself is phase-agnostic — it already renders and edits any
  game passed to it, so exposing playoff games there is a filtering/grouping change, not a new card.
- `roundLabel()` in the Bracket tab derives a label purely from distance-to-final (`FINAL`,
  `SEMIFINALS`, `QUARTERFINALS`, else `Round N`). It has no slot for a 3rd-place row.
- `POST /events/with-games` (`CreateEventWithGamesDto`) already accepts exactly the shape the
  operator fills in by hand: `{ name, date, location?, places?: Record<placeString, playerId[]>, games: [{team1Player1Id, team1Player2Id, team2Player1Id, team2Player2Id, team1Points, team2Points}] }`.
  It requires player ids to already exist, validates team composition, and updates ratings per game —
  but does **not** call `agregateRankings()` and does **not** touch `EventMember`. `places` is stored
  verbatim as JSON on `Event.data`; nothing derives it from game results.

## Decisions

### 1. Playoff games in the Matches tab

Extend the tab to render two independent sections instead of one:
- **Group stage** — unchanged: `phase === "group"` games grouped by `round`.
- **Playoff** — new: `phase === "playoff"` games grouped by `bracketRound`, using the *same* round-
  label logic as the Bracket tab (extract `roundLabel` into a shared helper, e.g.
  `lib/ongoing-bracket.ts`, imported by both tabs — this codebase's DRY convention is strict about
  not duplicating logic like this twice). The 3rd-place game (see below) renders as its own row
  labelled "3rd place", not folded into a numbered round.

Both sections use the existing `OngoingMatchCard` unchanged. This is the lowest-risk piece of the
four: no backend change, no new component, pure reuse.

### 2. A 3rd-place match

**Only exists when the bracket has a real semifinal round**, i.e. the qualifier count is ≥ 4. A
2-team bracket (a single final, reachable via a single group of 3 with `qualifiersPerGroup: 2`, for
example) has no semifinal and therefore no 3rd-place match — there is nothing to seed it with.

**Schema**: add `thirdPlace Boolean @default(false) @map("third_place")` to `OngoingGame`. A sentinel
value inside `bracketRound` was considered and rejected — it would silently corrupt
`findPlayoffSuccessor`'s `bracketRound + 1` arithmetic and every place that assumes `bracketRound`
values are contiguous starting at 1. A dedicated boolean keeps the existing geometry untouched and
makes the one exceptional row explicit everywhere it's queried.

**Generation**: `generatePlayoff`, after building the normal bracket, additionally inserts one more
`phase: 'playoff', thirdPlace: true, bracketRound: null, bracketSlot: null, team1Id: null, team2Id: null`
row when the qualifier count is ≥ 4. Both slots start empty, exactly like a normal successor slot —
they fill in when the semifinals are scored.

**Advancement**: generalize `findPlayoffSuccessor` (singular) into a function that returns the set of
this game's successors — normally exactly one (the next round), zero for the final, but **two** for
a semifinal game when a 3rd-place row exists: the normal successor (winner) and the 3rd-place row
(loser). "Is this a semifinal" is `bracketRound === maxBracketRound - 1`, where `maxBracketRound` is
read from the event's playoff games in the same query that finds successors. The 3rd-place row's slot
mapping mirrors the existing parity rule: the semifinal at the lower `bracketSlot` writes `team1Id`,
the other writes `team2Id` (arbitrary but fixed, matching how the normal successor's parity is
arbitrary but fixed today).

**Rule 3/4 generalize, they don't duplicate.** Both `updateGameScore` and `clearGameResult` already
funnel through one successor lookup and one "successor already played → refuse" check. That check
becomes "any successor already played → refuse" over the (now up to two) successors, and the
advancement write becomes "write to every successor" (winner to the normal one, loser to the
3rd-place one). No second copy of the rule-4 message or the geometry is created — same constant,
same helper, now iterating 0–2 results instead of 0–1.

### 3. Elimination-round tie placement

For a completed bracket of size `N = 2^k` (`k` = `totalRounds`):

- **Final** (`bracketRound = k`): winner = 1st, loser = 2nd.
- **3rd-place match**, if it exists: winner = 3rd, loser = 4th.
- **Every other round** `r` from 1 to `k - 2` (i.e. excluding the final and the semifinal, which are
  resolved individually above): all of that round's losers tie at place `N / 2^r + 1`.
  - Quarterfinal (`r = k - 2` in an 8-team bracket, `r = 1`): 4 losers, place `8/2 + 1 = 5`. Matches
    the user's own example exactly.
  - Round of 16 (`r = 1` in a 16-team bracket): 8 losers, place `16/2 + 1 = 9`. Matches the user's
    second example.
- **Group-stage teams that did not qualify for the playoff**: tie at place `N + 1`, immediately after
  the last playoff placement. This is the simplest defensible default — treat "failed to qualify" as
  one more elimination tier below the bracket itself — and is called out here explicitly since the
  user didn't specify it; easy to change if a different rule is wanted.
- **A `roundRobin` tournament** has no bracket at all: place every team by the existing
  `computeStandings` order (wins, then point differential, then points scored) — the same comparator
  already used for the live standings table, so the two never disagree. This comparator always
  produces a total order (its own point-scored tiebreak is the last word), so no ties are emitted for
  round robin.

This placement logic is pure, has no side effects, and is the direct input to `places` in request 4.
It is implemented once in the frontend (`lib/ongoing-standings.ts` or a new
`lib/ongoing-placements.ts`) since every input it needs (`event.games`, `event.teams`,
`event.config`) is already present in the `OngoingEvent` the detail page already loads — no new
backend endpoint is needed to compute it.

### 4. "Finish tournament"

**Reuses the existing, already-reviewed `/add-results` page and its `POST /events/with-games`
endpoint rather than adding a second, parallel path into the rating engine.** This is a deliberate
safety choice, not just a reuse-before-creating convention: `CLAUDE.md` calls the rating chain "the
single most important invariant" in this codebase — order-dependent, expensive to repair
(`agregateRankings()` resets every player's rank and replays the entire game history), and there is
no test database, so any bug in a brand-new submission path would be discovered by corrupting real
rating data. Feeding the existing, human-reviewed form is strictly safer than adding a second
auto-submitting write path, at no cost in "simplest possible" terms — it is in fact less new code.

Concretely: an admin-only **"Finish tournament"** button on the ongoing event page, enabled once the
tournament is actually over —
`config.scheme === 'groupsPlayoff'` ⇒ the final (and the 3rd-place match, if one exists) has a
result; `config.scheme === 'roundRobin'` ⇒ every scheduled game has a result. Clicking it:

1. Computes the `CreateEventWithGamesDto`-shaped payload client-side from data already loaded:
   `name`/`date`/`location` from the ongoing event, `games` from every played game across **both**
   phases (mapping each team id through the roster to its two player ids), and `places` from the
   section-3 algorithm above, keyed by player id per the existing `Record<placeString, playerId[]>`
   shape.
2. Hands that payload to `/add-results` via a one-shot `sessionStorage` key (written just before
   navigating, read and cleared on that page's mount) and navigates there.
3. `/add-results` prefills its existing `react-hook-form` state via `reset(prefill)` instead of its
   normal empty defaults — every field remains editable, and submission goes through the exact same
   `createEventWithGamesMutation` it already uses today. No new backend code is needed for this part
   at all.

The ongoing tournament itself is untouched by this action — it is not archived, deleted, or marked
"finished" anywhere. This mirrors today's manual process exactly (an operator re-types the same data
into the same form) and is intentionally the smallest change that removes the re-typing.

## Out of scope

- Marking an ongoing tournament as "finished"/archived, or preventing further edits to it after this
  action runs. Not requested; adding it would need a rule for what "editable after finishing" means
  and the user didn't ask for that.
- A consolation bracket for round-of-16-or-earlier losers. The user explicitly described those
  losers as tying for one place, not playing further.
- `EventMember` linkage or any other change to `/events/with-games` itself — it is reused exactly as
  it exists today.
