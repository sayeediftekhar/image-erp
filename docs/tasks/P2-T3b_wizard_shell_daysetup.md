# P2-T3b — Wizard Shell + Draft Lifecycle + Step 1 Day-Setup (task spec)

**Phase 2 · the wizard skeleton.** Builds the multi-step container the Revenue "Start"/"Continue"
button opens (replacing the T3b placeholder), the save-as-draft + resume lifecycle into
`revenue_day.draft_data`, and **Step 1 only** — the channels-active toggles that decide which later
steps appear. NO per-channel field capture (Morning/Evening/After-hours/Satellite/Delivery
screens) — that is P2-T3c/d. This task makes the wizard exist, persist, resume, and adapt; the
steps that capture money/counts come next.

**Authorities:** `docs/tasks/wizard_design.md` Screen 2 (esp. Step 1); `draft-data.schema.ts` (the
contract this produces); `docs/reference/clinic_service_matrix.md` + `capabilities.ts` (per-clinic
step adaptation — the single source); `IMAGE_ERP_Build_Guidelines.md` Iron Laws. On conflict, flag
before coding.

---

## 1. The problem (one sentence)
A manager taps a Missing/Draft day and needs a guided wizard that opens for that date, lets them
declare which service channels ran (so the wizard only asks about what happened), saves their
progress so they can leave and resume, and posts nothing until they finish.

## 2. Output contract
Inside the existing `(manager)` shell, at the wizard route (the placeholder from T3a, e.g.
`(manager)/revenue/wizard`):
- Opens for a specific date passed from the management list (Missing → new draft; Draft → resume).
- A **step container** with step navigation (Back / Next / Save-draft), per-clinic adaptive step
  set, and a progress indicator.
- **Step 1 — Day setup**: date (prefilled, read-only or editable per §5) + "which channels ran
  today" toggles, adapted to the clinic's capabilities. The toggles populate `channels_active` and
  determine which later steps will appear.
- **Draft persistence:** every Save-draft (and Next) writes the partial `draft_data` to
  `revenue_day.draft_data` with `status='DRAFT'`. NOTHING posts to the ledger in this task. Resume
  reads `draft_data` back and rehydrates the wizard.
- Later steps (2…N) exist as **labelled placeholders** in this task ("Morning — coming in T3c")
  so the step skeleton and navigation are real and walkable, but field capture is not built.

This task does NOT call `submitRevenueDay`. Submit is wired in T3d. The wizard's final step here is
a placeholder, not a real submit.

## 3. The draft lifecycle (the spine of this task)
Reuse the existing `revenue_day` DRAFT model (P2-T1/T2). Lifecycle:
- **Missing day → "Start":** create (or upsert) a `revenue_day` row for (entity, date) with
  `status='DRAFT'` and a minimal `draft_data` (revenue_date + entity_code + empty defaults). The
  wizard opens on Step 1.
- **Draft day → "Continue":** load the existing `revenue_day.draft_data`, rehydrate the wizard to
  where the manager left off (at minimum, reopen at Step 1 with channels-active restored; deeper
  step-resume is a nice-to-have, not required this task).
- **Save-draft:** writes the current wizard state into `draft_data` (Zod-validated against
  `DraftDataSchema` as a *partial-tolerant* parse — see §6), keeps `status='DRAFT'`, returns to the
  management list OR stays on the step (manager's choice via the button).
- **No posting:** `status` never leaves DRAFT in this task. The day shows as "Draft" (amber) on the
  management list — which T3a already renders.
- **Write path & auth:** the draft write goes through an authenticated server route (or server
  action) that enforces entity isolation server-side (ENTRY → own entity, forged param ignored),
  exactly as T3a's mark-closed route does. Reuse that pattern; do not invent a second auth path.
  The draft write is a plain table write (it does NOT touch journal_lines — Law 2 is not engaged
  until submit in T3d), but it still carries `created_by`/`updated_by` (Law 3).

## 4. Step 1 — Day setup (the only real step in this task)
Per `wizard_design.md` Step 1. The toggles are driven by the clinic's capabilities from
`capabilities.ts` (NOT hard-coded). For the signed-in manager's clinic, show toggles ONLY for
channels that clinic can run:

| Toggle | Shown when (capability) | Produces in channels_active | Drives later step |
|---|---|---|---|
| Outdoor — Morning | caps.sessions.morning | `MORNING` | Step 2 (T3c) |
| Outdoor — Evening | caps.sessions.evening | `EVENING` | Step 3 (T3c) |
| After-hours | caps.sessions.afterhours | `AFTERHOURS` | Step 4 (T3c) |
| Satellite (+ # teams) | caps.satellite | `SATELLITE` + team count | Steps 5…N (T3c) |
| Delivery | caps.delivery.nvd OR caps.delivery.csection | `DELIVERY` | Delivery step (T3d) |

- **CHA** resolves to Morning + Satellite toggles only (no evening, afterhours, or delivery) — the
  matrix drives this; no CHA-specific code.
- **Satellite is "ran? + how many teams"**: when Satellite is on, capture an integer team count
  (default per matrix note; dynamic, manager-adjustable). This count determines how many
  `TEAM_<n>` entries T3c will create — Step 1 records the count; the per-team screens are T3c.
- A **fully-closed day** = no toggles on → no channels → effectively a zero day. (Note: the
  management list already has a one-tap "mark closed" for full holidays; the wizard's no-channels
  path is the same outcome reached the long way. Don't duplicate the mark-closed write logic — if
  the manager turns everything off and proceeds, it can route to the same zero-day result, OR Step
  1 can nudge them to use mark-closed. State your choice in the plan.)

**Canonical channel tokens (T3b defines these — pin them):** `MORNING`, `EVENING`, `AFTERHOURS`,
`SATELLITE`, `DELIVERY`. These must match the `sessions`/`delivery` keys in `draft-data.schema.ts`
(MORNING/EVENING/AFTERHOURS sessions; nvd/csection under delivery). Export the channel-token
constants from a single module so T3c reads the same tokens — no string drift.

## 5. Date handling
- The date comes from the management list (the tapped day). Prefill it; the manager should not
  free-type a date that mismatches the day they tapped. Editable-date is OUT of scope (the list is
  the date picker; T3a's "enter a past date" is handled by tapping that past day).
- `revenue_date` in `draft_data` must be the tapped date, Dhaka-correct (already resolved by T3a's
  flow). Don't re-derive today here.

## 6. Schema / validation (against the real contract)
`draft-data.schema.ts` is the contract. Notes that bind this task:
- `channels_active: z.array(z.string())` — the schema does NOT constrain the values, so **T3b owns
  the channel-token vocabulary** (§4). Keep tokens consistent with the session/delivery keys.
- `financial` is **required** with `bank_deposit.made` and `cash_in_hand_counted` having no
  defaults. A mid-wizard draft won't have real financial data yet. So the **stored draft_data may
  be a partial** that does NOT fully satisfy `DraftDataSchema.parse()`. Decide and state the
  approach: either (a) store draft_data loosely (the column is jsonb; full DraftDataSchema.parse is
  only required at SUBMIT in T3d), persisting whatever the wizard has so far; or (b) seed a valid
  financial stub (made:false, cash_in_hand_counted:0) so every draft parses. **Recommendation: (a)
  store partials loosely during DRAFT; enforce full DraftDataSchema.parse only at submit (T3d).**
  The draft is staging, not a posting. Confirm in plan.
- Step 1 only writes `revenue_date`, `entity_code`, `channels_active`, and (if satellite) the team
  count → it can pre-create empty `satellite_teams` slots OR leave that to T3c. State which.
- No money is computed or posted (Iron Law 1/2 not engaged this task).

## 7. Reuse, don't reinvent
- Capabilities from `capabilities.ts` (the matrix) — single source; the same one the nav uses.
- The `(manager)` shell (T3-shell) frames the wizard — it renders inside, not standalone.
- The draft write route mirrors T3a's mark-closed route (auth + entity isolation server-side).
- House style: navy/Inter, 44px targets, 16px min, mobile-first. The wizard is a phone surface.

## 8. Explicitly OUT of scope (do not build)
- Per-channel field capture: Morning/Evening/After-hours session screens, Satellite team screens
  (T3c).
- Delivery step (NVD + C-section advance), financial wrap-up, review/submit, and the
  `submitRevenueDay` wiring (T3d).
- Any ledger posting (T3d).
- Close-balance / ageing (T3e).
- Mapping-doc §1/§3/§7 reconciliation is a **gate before T3c**, not this task — but do NOT build
  T3c field capture here, so it doesn't bite yet.

## 9. Tests / verification
- Step 1 toggles adapt to clinic: a JAL session shows all toggles; **CHA shows only Morning +
  Satellite**; KAT shows Satellite (the corrected matrix). Unit-test the capabilities→toggles
  mapping.
- channels_active output: toggling Morning + Satellite(2 teams) produces
  `channels_active=['MORNING','SATELLITE']` (+ team count recorded) — assert the tokens match the
  pinned vocabulary.
- Draft round-trip: Start a Missing day → set channels → Save-draft → row is DRAFT with the
  channels persisted in draft_data → reopen → channels restored. Assert nothing posted (no
  journal_entries with this source_id).
- Entity isolation on the draft write: ENTRY user for JAL cannot create/update a NAS draft (forged
  param ignored; server-side).
- Resume: a Draft day opens the wizard with channels_active rehydrated.
- Browser-verify (Sayeed gate): JAL day → wizard opens, Step 1 toggles correct, set channels,
  Save-draft, leave, reopen from the list → state restored, day shows Draft. CHA day → only
  Morning + Satellite offered. No posting occurs (check the ledger is untouched).

## 10. Definition of done
A manager taps a day → the wizard opens inside the manager shell → Step 1 offers only the channels
their clinic runs → they toggle what ran (and team count if satellite) → Save-draft persists to
`revenue_day.draft_data` as DRAFT with the correct channel tokens → they can leave and resume →
later steps are walkable placeholders → nothing is posted to the ledger. Entity-isolated,
capabilities-driven, schema-consistent. Then: CONTEXT.md session block + LEARNINGS if any durable
quirk. Do NOT commit until Sayeed browser-verifies.

---

### Plan-first
Return a plan before building: the wizard component/route structure and how it mounts in the
shell; the step-state model (how steps are represented and navigated); the draft read/write route
(reusing T3a's auth pattern) and the partial-draft persistence decision (§6 — loose vs stubbed);
the channel-token constants module; how Step 1 reads capabilities and produces channels_active +
team count; the closed-day path decision (§4); and your test list. Wait for approval. Do not bundle
commit/push.
