# P2-T3g — Day-Setup: Mark-Closed Button + Session Relabels (task spec)

**Phase 2 · small manager-UX fixes.** Two display-only relabels and one restored action. Low-risk:
no schema change, no ledger logic change, no posting change. Restores the mark-closed action that
became buried when the calendar (T3f-A) replaced the scrolling list, and which the completeness gate
(T3f-B) makes important again (marking holidays closed is how a manager clears the gate).

**Authorities:** the wizard Step 1 day-setup (channels-active toggles); the existing mark-closed
zero-day path (T3a — a marked-closed day = a SUBMITTED day with total_revenue 0, no stats rows); the
existing confirm-dialog pattern in the codebase; the channel keys MORNING/EVENING (unchanged). On
conflict, flag.

---

## 1. The problem (one sentence)

A manager needs an obvious one-action way to mark a day closed (holiday / no activity) from the
day-setup step — buried since the calendar replaced the list — and two session labels read "clinic"
where "session" is clearer.

## 2. Changes (all three)

### 2a. Mark-closed button on the day-setup step

- A single button, **centered**, placed **above "Save & Continue"** on the Step 1 day-setup screen
  (the channels-active toggles screen).
- **Always visible** (regardless of whether any channels are toggled on) — a manager who realises
  mid-setup the day should be closed shouldn't have to toggle everything off first.
- **Distinct colour** from "Save & Continue" — a neutral/secondary style (e.g. grey/slate or muted
  amber), NOT the primary accent (that's Save & Continue) and NOT red (closing a holiday is normal,
  not destructive). It should read as clearly available but visually subordinate to the primary
  action.
- Label: something like "Mark day as closed (holiday / no activity)".
- Tapping → a **confirm pop-up** (see 2b). On confirm → the existing mark-closed zero-day path runs
  (a SUBMITTED day, total_revenue 0, no income entry, no stats rows) and returns to the calendar
  (where the day now shows grey/closed). On cancel → back to day-setup, nothing changed.

### 2b. Confirm pop-up (adaptive text)

The confirm message adapts to whether channels are currently toggled on, because the consequence
differs:

- **No channels selected:** "Confirm mark [date] as closed?"
- **One or more channels selected:** a discard-warning variant — e.g. "[date] has channels selected.
  Mark as closed and discard them?" — so the manager isn't surprised to lose the selections they
  started.
- Same button, same always-visible placement; only the confirm text branches on channel state.
- Reuse the existing confirm-dialog pattern (the same `<dialog>` style used elsewhere in the wizard /
  the old mark-closed). Tone is a normal confirmation, not an error.
- Format [date] human-readably (e.g. "15 June 2026"), not the raw YYYY-MM-DD.

### 2c. Session relabels (display-only)

- "Morning clinic" → "Morning session"
- "Evening clinic" → "Evening session"
- DISPLAY TEXT ONLY. The channel keys (MORNING, EVENING) in channels_active, the schema, the
  routing, and everything downstream are UNCHANGED. This is a label swap on the toggle/step text.
- After-hours is NOT touched (deliberately kept as "After-hours" — venue is a future per-record
  attribute, not a channel rename).

## 3. Interaction with the gate (T3f-B)

- The mark-closed button lives INSIDE the wizard/day-setup, which a manager only reaches for an
  UNGATED day (the gate blocks reaching the wizard for a gated day — server-enforced). So a gated
  day is resolved by first being in a month that's enterable; mark-closed here is the tool for
  resolving days in the CURRENT enterable month and for clearing a prior month's missing days when
  the manager navigates into that (pre-gate or grace-window) month. No special gate-handling needed
  in this button — the gate already governs whether the wizard opens at all.
- Confirm the mark-closed action goes through the same server path as before (it's a write — it must
  respect the same gate backstop the submit path does, if applicable, so a gated day can't be
  marked-closed to bypass... actually marking closed RESOLVES a day, which is what the gate WANTS, so
  it should be ALLOWED even within the resolving month — verify the existing mark-closed route isn't
  accidentally gate-blocked in a way that stops a manager clearing the gate). Flag if the gate
  backstop on the write path would block a legitimate mark-closed used to clear the gate.

## 4. What stays out

- Any schema / channel-key / routing change (display-only relabels).
- After-hours rename (decided against).
- Bulk mark-closed (possible future enhancement; per-day is the scope now).
- The future per-record venue dropdown (patient-management module, later).

## 5. Tests / verification

- The mark-closed button renders centered above Save & Continue on day-setup, always visible,
  distinct colour.
- Tapping with no channels selected → confirm "Confirm mark [date] as closed?"; confirm → day marked
  closed (SUBMITTED, zero revenue, no stats), calendar shows grey.
- Tapping with channels selected → discard-warning confirm; confirm → selections discarded, day
  marked closed; cancel → selections intact.
- "Morning session" / "Evening session" labels render; channel keys still MORNING/EVENING (a
  submitted day's data still maps correctly — verify a morning entry still posts to 4010 etc.,
  proving the key didn't change).
- The marked-closed day appears correctly on the calendar (grey/closed) and in the count header
  (counts as resolved, not missing) — which means it also clears the gate for that month.
- Browser (Sayeed): mark a holiday closed from day-setup (both with and without channels toggled);
  confirm it greys on the calendar and reduces the missing count; confirm the session labels read
  "session"; confirm a normal morning entry still posts correctly (label change didn't touch routing);
  confirm marking days closed in an incomplete prior month clears the gate (ties to T3f-B).

## 6. Definition of done

The day-setup step shows an always-visible, centered, distinctly-coloured "Mark day as closed" button
above Save & Continue, with an adaptive confirm pop-up (plain when no channels selected, discard-warning
when channels are on) that runs the existing zero-day path; "Morning/Evening clinic" now read
"Morning/Evening session" (display-only, keys unchanged); after-hours untouched. Posts only the
existing zero-day entry; no schema change. Then: CONTEXT.md session note. Do NOT commit until Sayeed
browser-verifies.

---

### Plan-first

Return a plan: where the mark-closed button mounts on Step 1, its styling (distinct from Save &
Continue), the confirm-dialog reuse + adaptive text, the wire to the existing mark-closed zero-day
path, the two label string changes (confirming the keys are untouched), the gate-interaction check
(that mark-closed used to clear the gate isn't itself gate-blocked), and the test list. Wait for
approval. Do not commit.
