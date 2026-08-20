# AGENTS

Working agreement for AI agents in this repository. This file covers **how to work**;
[`CLAUDE.md`](CLAUDE.md) covers **what this codebase is** (commands, architecture, conventions) and
[`README.md`](README.md) covers the domain. Read both before making a change.

Nothing here depends on an external skill or plugin being installed.

## Before writing code

**Understand the request before designing, and design before implementing.** For anything beyond a
one-line fix:

1. Explore the actual code — read the files you are about to change, and the callers of what you are
   about to change. Do not design against an assumption about what a function does.
2. Ask about anything genuinely ambiguous, one question at a time. Prefer concrete options with a
   recommendation over open-ended questions.
3. State the design — flow, files touched, error handling, tests — and get agreement before writing
   code. Scale it to the change: two sentences for something small.
4. For a design worth keeping, write it to `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`.

**Check whether the thing already exists.** Endpoints, helpers, and validation in this repo are often
already present but incomplete — `DELETE /events/:id` existed and was broken long before it looked
like a missing feature. Completing an existing route beats adding a parallel one.

## Implementing

**Test first.** Write the failing test, run it, and read the failure before writing the
implementation. A test that has never failed proves nothing — it may assert the wrong thing entirely.

**Make the red honest.** A test that fails with `TypeError: x is not a function` because a mock is
incomplete is not a real red; fix the mock so the failure shows the actual behavioral gap. The
failure message should name the bug.

**Minimal code to pass.** No speculative options, parameters, or abstraction layers for needs nobody
has stated.

**Match the surrounding code.** Naming, structure, comment density, and error style come from the
neighbouring file, not from another project.

## Verifying

**Evidence before assertions.** Never report work as done, fixed, or passing without having run the
command and read the output. Quote it.

For this repo that means, at minimum:

```bash
npx jest <the spec you touched>
npm run test        # nothing else regressed
npm run build       # the only typecheck
npm run lint        # clean on the files you touched
```

**Mutate to prove coverage.** When the point of a change is an ordering, cascade, or invariant
contract, break the production code deliberately and confirm a test fails. Watch out for identical
code blocks elsewhere in the same file — a text-anchored mutation can land somewhere harmless and
report "uncaught" when the tests are in fact fine.

**Report faithfully.** If something is unverified, say which part and why. If a step was skipped,
say so. Do not describe a manual check you did not run.

## Debugging

Find the cause before proposing a fix. Read the actual error, form a hypothesis, and test the
hypothesis against the code — do not pattern-match a plausible-looking fix onto a symptom. When a
bug is found, write the failing test that reproduces it first, so the fix is proven and cannot
regress.

Trace backwards. A constraint violation surfacing in a delete path usually originates in a migration
or a schema default several steps away.

## Repository-specific hazards

Read these before touching data. Details are in [`CLAUDE.md`](CLAUDE.md).

- **The rating chain is order-dependent.** Any write that inserts, mutates, or removes a game
  invalidates every later game's rank. Local arithmetic cannot repair it; only a full
  `agregateRankings()` replay can.
- **`agregateRankings()` is destructive.** It zeroes every `player_stats` row and deletes every
  `game_player_rank` row before rebuilding. Never call it casually, and never inside another
  transaction.
- **`DATABASE_URL` may point at a shared database.** Check which one is active before running
  anything that writes. There is no separate test database, so real-Prisma tests would mutate live
  data — unit-test against a mocked `PrismaService`.
- **`game_player_rank`'s FK is `ON DELETE RESTRICT`.** Deletes that cascade through `games` abort
  unless the rank rows go first, in the same transaction.
- **Request bodies are not validated.** There is no global `ValidationPipe`, so the DTO decorators
  are inert. Validate in the service; do not assume input is well-formed.
- **No authentication.** Every endpoint is open. Do not assume a caller has been authorized.

## Boundaries

**Do not run any git command** — no `add`, `commit`, `push`, or `checkout` — unless explicitly asked
in a direct message. This holds even when the work is finished and a commit seems like the obvious
next step.

**Do not widen scope.** Fix what was asked. When you spot a real adjacent problem, say so and let it
be a separate decision rather than folding it in silently. When part of the requested scope turns out
to be blocked, finish everything else and state plainly what was left out.

**Confirm before destructive or outward-facing actions** — deleting data, rewriting shared state,
anything that leaves this machine. Approval for one such action is not approval for the next.

## Writing

**Comments: short and essential only.** Explain the *why* the code cannot state — an ordering
constraint, a non-obvious invariant, a deliberate deviation. One or two lines. Never restate the next
line.

**Prose: no filler.** Do not pad reports with restatements of the request, and do not claim
significance the work does not have.
