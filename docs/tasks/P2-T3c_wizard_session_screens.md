# P2-T3c — Wizard Session Screens (Morning / Evening / After-hours / Satellite) (task spec)

**Phase 2 · the income + counts capture.** The per-channel screens inside the T3b wizard that
capture what each session earned (money) and saw (counts), writing into the `sessions` and
`satellite_teams` portions of `draft_data`. **Posts NOTHING** — like Step 1, this stages draft
data only; the ledger posting + `daily_activity` writes happen at SUBMIT in T3d. The delivery
step (NVD + C-section advance), financial wrap-up, review, and submit are T3d. Close-balance is
T3e.

**Authorities:** `docs/tasks/Phase2_Revenue_Mapping_v2.md` §0b/§1 (RECONCILED to the 2150 model —
the canonical field→account routing); `draft-data_schema.ts` (the exact field shapes this
produces); `docs/tasks/wizard_design.md` Screen 2 Steps 2–5; `capabilities.ts` (which screens
appear); Iron Laws. On conflict, flag before coding.

---

## 1. The problem (one sentence)

For each channel the manager turned on in Step 1, the wizard must capture that session's patients,
services, and the money it earned — split across PI service income and RDF medicine/lab/logistic —
in fields a non-technical manager fills on a phone, staged into the draft, posting nothing yet.

## 2. Output contract

Inside the T3b wizard, the steps whose channel is in `channels_active` render real capture UI
(replacing their T3b placeholders). Each writes its slice of `draft_data`:

- **MORNING / EVENING** → `draft_data.sessions.MORNING` / `.EVENING` (OutdoorSessionSchema shape)
- **AFTERHOURS** → `draft_data.sessions.AFTERHOURS` (AfterhoursSessionSchema shape)
- **SATELLITE** → `draft_data.satellite_teams[]` — one screen per `TEAM_<n>` slot created in Step 1
  (SatelliteTeamSchema shape)

Each step saves its slice via the existing **save-draft** route (the T3b path — loose partial
storage, status stays DRAFT, entity-isolated server-side). No new write path; reuse T3b's.
**Nothing posts to the ledger or `daily_activity`** (that is T3d). The fund/account routing is
captured as the _destination_ of each field (so the data is correct and labelled), but the engine
does not fire here.

## 3. Field sets per screen (from the RECONCILED mapping §1 + the schema)

### Outdoor session — MORNING and EVENING (identical shape → ONE reusable component)

Schema: `OutdoorSessionSchema`. Fields:
| UI field | draft_data key | → destined account (T3d) | Fund | Notes |
|---|---|---|---|---|
| New patients | `patients_new` | — (stat only) | — | count |
| Old patients | `patients_old` | — (stat) | — | count |
| Total services | `services` | — (stat) | — | count |
| **Service charge (Tk)** | `service_charge` | 4010 PI-Outdoor | PI | the core income figure — highlight |
| RDF medicine sales (Tk) | `rdf_medicine_sales` | 4110 RDF-Medicine | RDF | |
| # lab tests | `lab_tests` | — (stat) | — | count |
| Lab revenue (Tk) | `lab_revenue` | 4120 RDF-Lab | RDF | |
| USG (by type) | `usg[]` | 4050 PI-USG | PI | see USG sub-section |

**USG sub-section** (`usg: UsgEntrySchema[]`, each `{type, count, revenue}`):

- Show **PP** by default (one row: # patients + revenue).
- "**+ Add USG type**" reveals the others — LOWER / WHOLE / ANOMALY — each its own
  `{type, count, revenue}` row.
- All types route to **4050** (the `type` is a statistics dimension, not a separate account).
- Only include USG entries with count or revenue > 0 in the saved array (don't persist empty rows).

Morning and Evening are the SAME component, parameterised by channel key (`MORNING`/`EVENING`),
each with its own USG array. (CHA's single session uses the `MORNING` key; its display label may
read "Outdoor"/"Day Clinic" — a label prop, not a separate component.)

### After-hours — AFTERHOURS (its own simpler shape)

Schema: `AfterhoursSessionSchema`. No new/old split, no lab, no USG. Fields:
| UI field | draft_data key | → destined account (T3d) | Fund |
|---|---|---|---|
| # customers | `patients` | — (stat) | — |
| Service charge (Tk) | `service_charge` | 4010 PI-Outdoor | PI |
| RDF medicine sales (Tk) | `rdf_medicine_sales` | 4110 RDF-Medicine | RDF |
| Logistic sales (Tk) | `logistic_sales` | 4130 RDF-Logistic | RDF |
_After-hours RDF and Logistic are SEPARATE fields → 4110 + 4130 (per mapping §1)._

### Satellite teams — one screen per TEAM\_<n> (outdoor shape, team-tagged)

Schema: `SatelliteTeamSchema` (same fields as outdoor + a `team` token). One step per team slot
created in Step 1 (the `satellite_teams[]` stubs). Fields identical to the outdoor session, EXCEPT
the service charge routes to a different account:
| UI field | draft_data key | → destined account (T3d) | Fund |
|---|---|---|---|
| `patients_new/old`, `services` | (same) | — (stat, tagged team=n) | — |
| **Service charge (Tk)** | `service_charge` | **4040 PI-Satellite** | PI |
| `rdf_medicine_sales` | (same) | 4110 RDF-Medicine | RDF |
| `lab_tests` / `lab_revenue` | (same) | 4120 RDF-Lab | RDF |
| `usg[]` | (same) | 4050 PI-USG | PI |

- The `team` field is already `TEAM_<n>` from Step 1; preserve it, don't regenerate.
- Each team screen is titled "Satellite — Team n".
- Satellite service charge → **4040** (its own account, so satellite income is separable);
  RDF/Lab/USG share the common accounts, the team tag separates them in stats. (Mapping §1.)

## 4. What stays out (boundaries — do not build)

- **NO posting.** No `submitRevenueDay`, no engine call, no `journal_lines`, no `daily_activity`
  writes. This task only writes `draft_data`. (Iron Laws 1/2 not engaged — there are no committed
  numbers yet, only staged draft figures.)
- **Delivery step** (NVD same-day + C-section advance) — T3d.
- **Financial wrap-up** (deposit, cash-in-hand, reconciliation) — T3d.
- **Review & Submit** + the read-only view — T3d.
- **C-section income fields must NOT appear anywhere** — per the reconciled mapping, C-section
  captures only cases + advance at daily entry (T3d delivery step), and its income is the discharge
  bill (T3e). Do not add service_charge/RDF/logistics fields to any C-section UI. (This is the
  thing the old mapping got wrong; the reconciled §1/§3 is the authority.)

## 5. Validation / data rules

- Money fields: Taka, `NUMERIC` semantics; default 0; no negatives (schema enforces `.min(0)`).
  Counts: non-negative integers.
- Reuse the engine's paisa discipline at SUBMIT (T3d), NOT here — here the figures are just staged
  draft numbers. But store them as the manager typed (numbers), matching the schema field types.
- A channel that is ON but left all-zero is valid (a session ran but earned nothing recorded) —
  don't force non-zero. The reconciliation/scrutiny catches genuine gaps later.
- Persist each session's slice on Save & Continue (per-step save, reusing T3b's save-draft). On
  resume, rehydrate each session screen from its `draft_data` slice (same round-trip T3b proved).
- Only persist USG rows with count or revenue > 0.

## 6. UX (mobile-first, per wizard_design Step 2)

- ONE clean scrollable screen per session, sectioned: _Patients & services_ → _Service charge_
  (navy-highlighted, the core income) → _Medicine & lab_ → _USG_. After-hours is the shorter form.
- 44px touch targets, 16px min font, navy/Inter. Number inputs phone-friendly (numeric keypad).
- The service-charge field is visually the anchor (it's the PI income the manager most associates
  with "what we earned").
- Step header shows "Step N of M · <channel label>"; Back / Save & Continue footer (from T3b).

## 7. Reuse, don't reinvent

- The save-draft route + loose partial persistence + entity isolation — T3b's, unchanged.
- The channel-token vocabulary — `channels.ts` (T3b). Session keys MORNING/EVENING/AFTERHOURS match
  `draft_data.sessions`; satellite writes `satellite_teams`.
- Capabilities decide which session screens exist — already wired in T3b's step computation; T3c
  fills the placeholders with real UI, doesn't re-derive the step set.
- House style from the admin/manager shell.

## 8. Tests / verification

- Outdoor component produces a schema-valid `sessions.MORNING` slice: patients/services as counts,
  service_charge/rdf/lab as money, usg[] only non-empty rows. Same for EVENING.
- After-hours produces a valid `sessions.AFTERHOURS` slice (patients, service_charge, rdf, logistic
  — no lab/usg keys).
- Satellite: N team screens from Step 1's count; each writes a `satellite_teams[i]` with the
  correct `TEAM_<n>` tag preserved; service_charge present (destined 4040).
- USG: PP shows by default; adding LOWER/WHOLE/ANOMALY appends rows; empty rows not persisted; all
  carry their `type`.
- Round-trip: fill Morning + a Satellite team, Save & Continue through, leave, reopen → every field
  rehydrates from draft_data (browser-verify against Supabase, the T3b-proven path).
- NOTHING posts: assert no journal_entries / daily_activity rows created by these steps (count
  before/after a full draft save — unchanged). This is the Law 2 guard for T3c.
- No C-section income fields render anywhere (guard against the old model creeping back).
- Browser (Sayeed gate): JAL day → Morning screen captures all fields, USG +Add works, Save &
  Continue advances; Satellite with 2 teams → 2 team screens; after-hours shorter form; CHA day →
  only the single outdoor (Morning) + satellite screens, no evening/afterhours. Reopen → all
  rehydrate. Ledger untouched.

## 9. Definition of done

For each active channel, the manager captures that session's counts + money on a clean phone
screen, the figures route to the correct destined accounts (captured/labelled, not yet posted),
USG uses PP-default + add-more, satellite renders one screen per team with service charge → 4040,
after-hours has its own shorter shape, C-section income appears nowhere, every slice saves to
`draft_data` and rehydrates on resume, and nothing touches the ledger or daily_activity. Then:
CONTEXT.md session block + LEARNINGS if any durable quirk. Do NOT commit until Sayeed
browser-verifies.

---

### Plan-first

Return a plan before building: the reusable outdoor-session component + how Morning/Evening/Satellite
share it (and where they diverge — the 4040 service-charge destination, the team tag, the CHA label);
the after-hours component; the USG PP-default/add-more sub-component; how each step reads/writes its
draft_data slice via T3b's save-draft and rehydrates on resume; the per-step state model within
WizardClient; and your test list (incl. the no-posting guard and the no-C-section-income guard).
If satellite makes the task too large, propose splitting it off. Wait for approval. Do not commit.
