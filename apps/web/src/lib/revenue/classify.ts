export type DayState = 'MISSING' | 'DRAFT' | 'ENTERED' | 'CLOSED' | 'FUTURE';

export interface DayViewModel {
  date: string;        // YYYY-MM-DD
  state: DayState;
  totalRevenue?: number;
  revenueDayId?: string;
}

interface RevenueRow {
  id: string;
  revenue_date: string;   // YYYY-MM-DD (cast as text from pg)
  status: string;
  total_revenue: string | number | null;
}

// Produces every actionable day in [year, month] classified by state.
// todayDhaka must come from the server (Asia/Dhaka clock) — never the browser.
// Returned order: MISSING, then DRAFT (attention zone), then ENTERED + CLOSED (submitted zone),
// all in ascending date order within each group. FUTURE days are omitted.
export function classifyDays(
  rows: ReadonlyArray<RevenueRow>,
  todayDhaka: string,
  year: number,
  month: number,
): DayViewModel[] {
  const rowByDate = new Map<string, RevenueRow>();
  for (const r of rows) {
    const dateKey = typeof r.revenue_date === 'string'
      ? r.revenue_date.slice(0, 10)
      : r.revenue_date;
    rowByDate.set(dateKey, r);
  }

  const daysInMonth = new Date(year, month, 0).getDate();
  const lastDay = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;
  const cutoff = todayDhaka < lastDay ? todayDhaka : lastDay;

  const missing: DayViewModel[] = [];
  const draft: DayViewModel[] = [];
  const entered: DayViewModel[] = [];
  const closed: DayViewModel[] = [];

  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

    if (date > cutoff) continue; // future (or beyond month-end): omit

    const row = rowByDate.get(date);

    if (!row) {
      missing.push({ date, state: 'MISSING' });
      continue;
    }

    if (row.status === 'DRAFT') {
      draft.push({ date, state: 'DRAFT', revenueDayId: row.id });
      continue;
    }

    if (row.status === 'SUBMITTED') {
      const rev = Number(row.total_revenue ?? 0);
      if (rev > 0) {
        entered.push({ date, state: 'ENTERED', totalRevenue: rev, revenueDayId: row.id });
      } else {
        closed.push({ date, state: 'CLOSED', revenueDayId: row.id });
      }
    }
  }

  return [...missing, ...draft, ...entered, ...closed];
}

// Server-only: resolve today in Asia/Dhaka — never trust the browser clock.
export function getDhakaToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' });
}
