# Clinic Service Matrix (authoritative reference)

Single source for per-entity capabilities. Consumed by:
- `apps/web/src/lib/capabilities.ts` — capabilities module (T3b+ wizard steps, nav adaptation)
- `docs/tasks/wizard_design.md` — screen/step design
- `docs/tasks/P2-T3-shell_manager_shell_nav_dashboard.md` — nav adaptation spec

Last updated: 2026-06-22 (CHA confirmed; satellite confirmed all-five-clinics; source: Sayeed)

## Matrix

| Entity | Code | Morning | Evening | Afterhours | Satellite | NVD | C-section |
|--------|------|---------|---------|------------|-----------|-----|-----------|
| Jalalabad  | JAL | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Nasirabad  | NAS | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Amanbazar  | AMB | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| Kattali    | KAT | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| Chandgaon  | CHA | ✓ | — | — | ✓ | — | — |

## Notes

**CHA — confirmed:** Chandgaon is a single 9–5 outdoor clinic. It runs one daily session
(MORNING slot in draft_data) plus satellite. No evening, no afterhours, no delivery channel.
The wizard label for CHA's MORNING session may read "Outdoor" or "Day Clinic" to avoid
confusing it with a morning-only partial day — this is a T3c display concern, not a schema
concern (the `sessions.MORNING` key is correct for all entities).

**Deliveries in nav/dashboard:** Visible only for clinics with C-section tracking (JAL/NAS).
NVD (AMB/KAT) produces no `delivery_balance` rows (same-day income, no advance held), so
the Deliveries surface would be structurally empty for AMB/KAT — hidden from their nav.

**Satellite — confirmed all five clinics:** Satellite runs at all five clinics; team count
is dynamic (set per-day in wizard Step 1), not a capability flag. The `satellite` field in
capabilities.ts is therefore `true` for all entities and may be simplified or removed when
T3b is built, since it never gates anything.

**Pilot entity:** JAL (Jalalabad) is the most complex — all capabilities. All others are
subsets. Build and test against JAL; verify subsets by capability flags, not entity-specific code.
