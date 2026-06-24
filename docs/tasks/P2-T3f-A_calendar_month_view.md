# P2-T3f-A — Revenue Management: Calendar Month-View (task spec)

**Phase 2 · manager UX redesign.** Replace the scrolling status-list on the Revenue Management page
with a **month-grid calendar** — each day a status-coloured tile, tap to open the right screen, no
scrolling. Presentation only: reuses the existing day-status logic (`classifyDays` from T3a), touches
no backend, posts nothing. The **completeness gate** (prior-month-resolved enforcement + admin
override) is a SEPARATE follow-up task (T3f-B) that layers on this view — build this gate-ready but do
NOT build the gate here.

**Authorities:** the existing Revenue Management page + `classifyDays` (T3a); the ManagerShell house
style (T3-shell); `getDhakaToday` (Dhaka-local "today", server-side). On conflict, flag.

---

## 1. The problem (one sentence)

A manager catching up on entries needs to see a whole month at a glance — which days are done, draft,
or missing — and tap straight into any day, instead of scrolling a sorted list that buries the gaps.

## 2. Output contract

The Revenue Management page (`/revenue`) renders a **month calendar grid** for the selected month:

- Each day = a tile coloured by status (see §3).
- Tapping a tile opens the correct screen for that day's status (see §4).
- Prev/next month navigation; defaults to the current month (Dhaka-local). A "jump to today" control.
- A count summary header (Submitted / Draft / Missing) for the visible month — the at-a-glance
  "how caught up am I," with Missing in red as the nudge.
- Mobile-first (managers are on phones); reuses house style.
- Posts nothing; reads the same day-status data the list used.

## 3. Day-tile status → colour (reuse classifyDays)

| Status    | Colour                      | Meaning                                                    |
| --------- | --------------------------- | ---------------------------------------------------------- |
| SUBMITTED | green                       | day entered + posted                                       |
| DRAFT     | yellow/amber                | started, not submitted                                     |
| MISSING   | red                         | a past day (≤ today) with no entry — the catch-up nudge    |
| CLOSED    | grey                        | marked-closed zero day (holiday/full closure)              |
| FUTURE    | blank/neutral, not tappable | a day after today (can't enter a day that hasn't happened) |

- "Today" is Dhaka-local, resolved server-side (`getDhakaToday`) — NOT browser/UTC.
- MISSING applies only to past days (≤ today). Future days are neutral and non-interactive.
- A day's status comes from `classifyDays` — do NOT re-derive status logic; reuse the single source.

## 4. Tap behaviour per status

| Tile status       | Tap opens                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------ |
| MISSING (red)     | the wizard for that date (start entry)                                                                       |
| DRAFT (yellow)    | the wizard for that date (resume draft)                                                                      |
| SUBMITTED (green) | the read-only day view (`/revenue/day/[date]`)                                                               |
| CLOSED (grey)     | read-only indication it's closed (a marked-closed zero day); optionally a "this day was marked closed" panel |
| FUTURE            | not tappable                                                                                                 |

- These routes already exist (wizard, read-only day view) — wire the tiles to them; don't rebuild.

## 5. Month navigation

- Prev / next month arrows. Default view = current month (Dhaka-local).
- "Today" / "jump to current month" control for a manager who navigated away.
- Managers enter late (batch, days behind) — so navigating to recent past months must be easy and
  obvious. No artificial limit on navigating backward (they may need to fix an old day); forward nav
  may stop at the current month (no point entering future months).

## 6. Layout (mobile-first)

- A real month grid (weeks as rows, days as columns) — standard calendar shape, sized for a phone.
- Tiles show the day number + a status colour; optionally a tiny marker (e.g. the day's total for
  submitted days, or a dot). Keep tiles legible at phone width; don't cram.
- Count summary header above the grid (Submitted N · Draft N · Missing N), Missing in red.
- House style (navy/Inter, 44px touch targets, AAA contrast) from the manager shell.
- The whole tile is the touch target (44px min), not a small inner button.

## 7. Build gate-ready (for T3f-B, do NOT build the gate now)

The completeness gate (next task) will need:

- A per-month "is this month fully resolved?" signal (no MISSING days in a past month). Shape the
  month-data so a "missing count for month X" is cheaply derivable (the count header already needs
  this) — T3f-B will reuse it.
- The day-tile and month-state as components the gate can decorate (e.g. a locked/greyed treatment +
  a nudge pop-up) WITHOUT restructuring. Keep the tile's status presentation separable from a future
  "gated/locked" overlay.
  Do NOT implement: the 10-day grace logic, the prior-month-complete enforcement, the nudge pop-up, the
  wizard-entry block, or the admin override. Those are T3f-B. Just don't paint yourself into a corner.

## 8. What stays out

- The completeness gate + admin override (T3f-B).
- Any posting / ledger / engine involvement (this is presentation).
- The mark-closed action itself already exists (T3a) — reuse it; tapping a missing day → wizard,
  which already offers mark-closed for a zero day.

## 9. Tests / verification

- The grid renders the correct month, correct number of days, weeks aligned.
- Each day shows the colour matching its classifyDays status; future days neutral + non-tappable;
  past missing days red.
- Tap routing: missing/draft → wizard for that date; submitted → read-only day view; future → no-op.
- Month nav: prev/next works; defaults to current Dhaka-local month; jump-to-today returns.
- Count header matches the grid (Submitted/Draft/Missing counts correct for the month).
- Mobile layout: legible at phone width, 44px targets.
- Browser (Sayeed gate): a month with a mix of submitted/draft/missing/closed days renders correctly;
  tapping each status opens the right screen; navigating months works; today is Dhaka-correct;
  CHA (no delivery) and JAL both render (the calendar is entity-agnostic presentation).

## 10. Definition of done

The Revenue Management page shows a tappable month-grid calendar with status-coloured days, opening
the correct screen per status, with month navigation defaulting to the current Dhaka-local month and a
count summary header — replacing the scrolling list, no scrolling needed to see a month. Built so the
completeness gate (T3f-B) can layer on without rework. Posts nothing. Then: CONTEXT.md session block.
Do NOT commit until Sayeed browser-verifies.

---

### Plan-first

Return a plan: the calendar grid component (month layout, tile rendering, status→colour via
classifyDays); month-navigation state; tap-routing per status; the count header; how the month-data is
shaped so T3f-B's gate can reuse the "missing days in month" signal and decorate tiles; and the test
list. Confirm what replaces vs augments the current RevenueManagementClient. Wait for approval. Do not
commit.
