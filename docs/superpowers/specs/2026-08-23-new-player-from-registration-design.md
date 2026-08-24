# Create a player from the registration form

**Date:** 2026-08-23
**Scope:** frontend only — `volleyball-management-ui`.
**Builds on:** `2026-08-23-tournament-registration-design.md`.

## Problem

The register-a-team dialog offers two dropdowns of existing players. If someone's partner is not
in the database, registration is a dead end: the dialog gives no way to add them, and the only
create-player UI lives on the admin-gated `/add-results` page. Self-service registration is not
self-service if half the pairs cannot be expressed.

## Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Who may create a player | **Anyone**, same as registration | User-confirmed. A registration flow that requires an admin halfway through is not self-service. |
| Fields | **Name + gender** | Gender matters for mixed tournaments. Avatar is omitted — it is optional in the API and pure friction here. |
| UI shape | **Inline row inside the existing dialog**, not a nested dialog | The register dialog is already modal; a Radix `Dialog` inside a `Dialog` fights over focus and dismissal. |
| Which slot gets filled | The one whose **"+" was clicked** | Unambiguous. Mirrors how `/add-results` tracks the field it is filling. |
| Auto-select mechanism | **Read the id from the POST response** | Not a timer. See below. |

## Accepted risk

`POST /players` is unauthenticated, and this exposes it to every visitor. Consequences, stated
plainly and accepted by the user:

- Anyone can add arbitrary rows to the global `players` table, which every section of the app reads.
- **There is no delete-player endpoint**, so a typo or a duplicate ("Artem" vs "Artem B.") is
  permanent short of direct DB access.
- No duplicate-name check exists server-side; two players may share a name.

This is consistent with the already-accepted open-registration model for a private club app. It is
not defensible if the app ever becomes public.

## Design

In `components/ongoing/register-team-dialog.tsx`, each player `<select>` gains a small **+** button.
Clicking it reveals one inline row — a name `Input`, an optional gender `Select` (male/female), and
Add / Cancel — and records which slot triggered it. On success the dialog:

1. takes the created player's `id` **from the mutation response**,
2. sets it into the remembered slot,
3. invalidates `["players"]` so the dropdowns refresh.

**Step 1 is a deliberate improvement over the existing pattern.** `/add-results` sets its field
inside a `setTimeout` that "waits a bit for the players list to refresh" — a race dressed as a fix.
`POST /players` returns the created player, so the id is available immediately and no timer is
needed. Do not copy the timer.

The name is required and trimmed; Add stays disabled until it is non-empty. The server's error
message surfaces in the dialog rather than a bare status code. The existing rules are untouched:
players already registered in that tournament stay filtered out, the two selects cannot offer the
same person, and Register stays disabled until two distinct players are chosen.

## Testing

No test runner exists in this repo. Verified with `npx tsc --noEmit`, `npm run lint` (must hold at
the 7 pre-existing errors), `npm run build`, and a live browser walkthrough: create a player from
the dialog, confirm it lands in the triggering slot, and complete a registration with it.

## Out of scope

Editing or deleting players; duplicate-name detection; avatar; any authentication.
