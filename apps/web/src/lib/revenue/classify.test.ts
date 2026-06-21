import { classifyDays, DayViewModel } from './classify';

// ── Helpers ───────────────────────────────────────────────────────────────────

function row(
  id: string,
  date: string,
  status: 'DRAFT' | 'SUBMITTED',
  total_revenue: string | null = null,
) {
  return { id, revenue_date: date, status, total_revenue };
}

function stateOf(days: DayViewModel[], date: string) {
  return days.find(d => d.date === date)?.state;
}

// ── Classification logic ──────────────────────────────────────────────────────

describe('classifyDays', () => {
  // Use a fixed month so tests are date-independent.
  // todayDhaka = '2026-06-15' throughout these tests (unless overridden).
  const TODAY = '2026-06-15';
  const YEAR = 2026;
  const MONTH = 6;

  it('A — no row for a past date → MISSING', () => {
    const days = classifyDays([], TODAY, YEAR, MONTH);
    expect(stateOf(days, '2026-06-01')).toBe('MISSING');
    expect(stateOf(days, '2026-06-14')).toBe('MISSING');
  });

  it('B — today (Dhaka) with no row → MISSING (not FUTURE)', () => {
    const days = classifyDays([], TODAY, YEAR, MONTH);
    expect(stateOf(days, TODAY)).toBe('MISSING');
  });

  it('C — date after today → FUTURE (omitted from results)', () => {
    const days = classifyDays([], TODAY, YEAR, MONTH);
    expect(days.find(d => d.date === '2026-06-16')).toBeUndefined();
    expect(days.find(d => d.date === '2026-06-30')).toBeUndefined();
  });

  it('D — DRAFT row → DRAFT with revenueDayId', () => {
    const days = classifyDays([row('r1', '2026-06-10', 'DRAFT')], TODAY, YEAR, MONTH);
    const d = days.find(d => d.date === '2026-06-10')!;
    expect(d.state).toBe('DRAFT');
    expect(d.revenueDayId).toBe('r1');
  });

  it('E — SUBMITTED row with total_revenue > 0 → ENTERED', () => {
    const days = classifyDays([row('r2', '2026-06-05', 'SUBMITTED', '57650.00')], TODAY, YEAR, MONTH);
    const d = days.find(d => d.date === '2026-06-05')!;
    expect(d.state).toBe('ENTERED');
    expect(d.totalRevenue).toBeCloseTo(57650);
  });

  it('F — SUBMITTED row with total_revenue = 0 → CLOSED', () => {
    const days = classifyDays([row('r3', '2026-06-06', 'SUBMITTED', '0.00')], TODAY, YEAR, MONTH);
    const d = days.find(d => d.date === '2026-06-06')!;
    expect(d.state).toBe('CLOSED');
  });

  it('F2 — SUBMITTED row with null total_revenue → CLOSED (treats null as 0)', () => {
    const days = classifyDays([row('r4', '2026-06-07', 'SUBMITTED', null)], TODAY, YEAR, MONTH);
    const d = days.find(d => d.date === '2026-06-07')!;
    expect(d.state).toBe('CLOSED');
  });

  // ── Ordering ──────────────────────────────────────────────────────────────

  it('G — ordering: MISSING then DRAFT then ENTERED/CLOSED', () => {
    const rows = [
      row('e1', '2026-06-01', 'SUBMITTED', '1000'),  // ENTERED
      row('d1', '2026-06-02', 'DRAFT'),               // DRAFT
      row('c1', '2026-06-03', 'SUBMITTED', '0'),      // CLOSED
      // 2026-06-04 missing
    ];
    const days = classifyDays(rows, TODAY, YEAR, MONTH);

    const states = days.slice(0, 4).map(d => d.state);
    // MISSING block first (June 4 through 15 missing, but only 04–14 + June 04 for this)
    // then DRAFT (June 02), then ENTERED (June 01), then CLOSED (June 03)
    const missingDates = days.filter(d => d.state === 'MISSING').map(d => d.date);
    const draftDates   = days.filter(d => d.state === 'DRAFT').map(d => d.date);
    const enteredDates = days.filter(d => d.state === 'ENTERED').map(d => d.date);
    const closedDates  = days.filter(d => d.state === 'CLOSED').map(d => d.date);

    // All MISSING before any DRAFT; all DRAFT before any ENTERED/CLOSED
    const firstDraft   = days.findIndex(d => d.state === 'DRAFT');
    const firstEntered = days.findIndex(d => d.state === 'ENTERED');
    const firstClosed  = days.findIndex(d => d.state === 'CLOSED');
    const lastMissing  = days.map(d => d.state).lastIndexOf('MISSING');

    expect(lastMissing).toBeLessThan(firstDraft);
    expect(firstDraft).toBeLessThan(Math.min(firstEntered, firstClosed));

    // Within each group: ascending date order
    expect(missingDates).toEqual([...missingDates].sort());
    expect(draftDates).toEqual([...draftDates].sort());
    expect(enteredDates).toEqual([...enteredDates].sort());
    expect(closedDates).toEqual([...closedDates].sort());
  });

  // ── Dhaka boundary ────────────────────────────────────────────────────────

  it('H — Dhaka boundary: date == todayDhaka is MISSING (not FUTURE)', () => {
    // Simulate the edge case: todayDhaka is June 19 (already June 20 in UTC).
    // The key invariant is that classifyDays uses the provided todayDhaka string,
    // not the server UTC clock. As long as getDhakaToday() is called server-side
    // and passed here, the classification is correct regardless of UTC offset.
    const dhaka = '2026-06-19';
    const days = classifyDays([], dhaka, 2026, 6);

    // June 19 = today in Dhaka → MISSING (has no row)
    expect(stateOf(days, '2026-06-19')).toBe('MISSING');
    // June 20 = future (not yet today in Dhaka) → omitted
    expect(days.find(d => d.date === '2026-06-20')).toBeUndefined();
  });

  it('H2 — Dhaka boundary: if todayDhaka were June 18, June 19 is FUTURE', () => {
    const dhaka = '2026-06-18';
    const days = classifyDays([], dhaka, 2026, 6);

    expect(stateOf(days, '2026-06-18')).toBe('MISSING');
    expect(days.find(d => d.date === '2026-06-19')).toBeUndefined();
  });

  // ── End-of-month ──────────────────────────────────────────────────────────

  it('I — days beyond month-end never appear', () => {
    // June has 30 days; July 1 should never appear in a June query
    const today = '2026-06-30';
    const days = classifyDays([], today, 2026, 6);
    expect(days.every(d => d.date <= '2026-06-30')).toBe(true);
    expect(days.length).toBe(30); // all 30 June days are <= today
  });

  it('J — future month: today is in May, June shows no actionable days', () => {
    const days = classifyDays([], '2026-05-31', 2026, 6);
    expect(days.length).toBe(0); // all June days are future
  });

  // ── Entity isolation (structural) ─────────────────────────────────────────

  it('K — classifyDays is parameterised by entity: rows for a different entity are never passed', () => {
    // The Server Component fetches rows filtered by appUser.entity_id (not a URL param).
    // This test documents the invariant: classifyDays operates purely on the rows given;
    // entity isolation is enforced upstream (Server Component + Supabase RLS).
    // A row with a different entity_id would never reach classifyDays for an ENTRY user.
    const jalRow = row('j1', '2026-06-01', 'SUBMITTED', '1000');
    const days = classifyDays([jalRow], TODAY, YEAR, MONTH);
    expect(stateOf(days, '2026-06-01')).toBe('ENTERED');

    // If no rows are passed (wrong entity filtered out), day shows as MISSING
    const daysNoRows = classifyDays([], TODAY, YEAR, MONTH);
    expect(stateOf(daysNoRows, '2026-06-01')).toBe('MISSING');
  });
});
