import { Pool } from 'pg';
import { z } from 'zod';
import { LedgerService, RevenueService, DraftDataSchema } from '@image-erp/posting-engine';

export class MarkClosedError extends Error {
  constructor(
    public readonly code: 'ALREADY_SUBMITTED' | 'HAS_DRAFT_DATA',
    message: string,
  ) {
    super(message);
    this.name = 'MarkClosedError';
  }
}

// Returns true when draft_data has no actionable revenue or patient counts.
// False positives (treating data as non-empty when it is empty) cause an unnecessary
// rejection; false negatives (treating non-empty as empty) would silently overwrite
// entered data. This function errs on the safe side: if parse fails, treat as non-empty.
function isDraftDataEmpty(raw: unknown): boolean {
  if (raw === null || raw === undefined) return true;
  const result = DraftDataSchema.safeParse(raw);
  if (!result.success) return false; // unparseable → treat as non-empty, refuse to overwrite
  const d = result.data;

  for (const sess of [d.sessions.MORNING, d.sessions.EVENING]) {
    if (!sess) continue;
    if (
      sess.patients_new > 0 || sess.patients_old > 0 || sess.services > 0 ||
      sess.service_charge > 0 || sess.rdf_medicine_sales > 0 ||
      sess.lab_revenue > 0 || sess.usg.length > 0
    ) return false;
  }
  if (d.sessions.AFTERHOURS) {
    const s = d.sessions.AFTERHOURS;
    if (
      s.patients > 0 || s.service_charge > 0 ||
      s.rdf_medicine_sales > 0 || s.logistic_sales > 0
    ) return false;
  }
  if (d.satellite_teams.length > 0) return false;
  if (d.delivery.nvd) {
    const n = d.delivery.nvd;
    if (n.cases > 0 || n.service_charge > 0 || n.rdf_revenue > 0 || n.logistic_revenue > 0)
      return false;
  }
  if (d.delivery.csection) {
    if (d.delivery.csection.cases > 0 || d.delivery.csection.balances.length > 0)
      return false;
  }
  if (d.other_income.length > 0) return false;
  return true;
}

// Marks a day as closed (holiday / no revenue) by:
//   1. Ensuring a DRAFT revenue_day exists with empty draft_data.
//   2. Calling submitRevenueDay (zero income → SUBMITTED, total_revenue=0, no journal lines).
//
// Safety non-negotiables:
//   - ALREADY_SUBMITTED: day is already submitted → reject (409 at route layer).
//   - HAS_DRAFT_DATA: DRAFT row has real entered data → reject (400), row untouched.
//
// The pool must have service_role / BYPASSRLS access: submitRevenueDay uses a DRAFT→SUBMITTED
// flip that the ENTRY user's authenticated RLS policy blocks on purpose.
export async function markClosedDay(
  pool: Pool,
  actorId: string,
  entityId: string,
  date: string,
): Promise<{ revenueDayId: string }> {
  z.string().uuid('actorId must be a UUID').parse(actorId);
  z.string().uuid('entityId must be a UUID').parse(entityId);
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD').parse(date);

  const client = await pool.connect();
  let revenueDayId: string;

  try {
    await client.query('BEGIN');

    const { rows } = await client.query<{
      id: string; status: string; draft_data: unknown;
    }>(
      `SELECT id, status, draft_data
       FROM public.revenue_day
       WHERE entity_id = $1 AND revenue_date = $2
       FOR UPDATE`,
      [entityId, date],
    );

    if (rows.length > 0) {
      const row = rows[0];

      if (row.status === 'SUBMITTED') {
        throw new MarkClosedError('ALREADY_SUBMITTED', `${date} is already submitted`);
      }

      // DRAFT exists: only proceed if draft_data is empty/zero
      if (!isDraftDataEmpty(row.draft_data)) {
        throw new MarkClosedError(
          'HAS_DRAFT_DATA',
          `${date} has entered data — cannot mark closed without reviewing it first`,
        );
      }

      revenueDayId = row.id;
    } else {
      // Missing day: look up entity_code (required by DraftDataSchema) then create DRAFT
      const { rows: entityRows } = await client.query<{ code: string }>(
        'SELECT code FROM public.entities WHERE id = $1',
        [entityId],
      );
      if (entityRows.length === 0) throw new Error(`entity ${entityId} not found`);

      const zeroDraftData = {
        revenue_date: date,
        entity_code: entityRows[0].code,
        financial: {
          bank_deposit: { made: false },
          cash_advance: {},
          cash_in_hand_counted: 0,
        },
      };

      const { rows: ins } = await client.query<{ id: string }>(
        `INSERT INTO public.revenue_day
           (entity_id, revenue_date, status, draft_data, created_by)
         VALUES ($1, $2, 'DRAFT', $3::jsonb, $4)
         RETURNING id`,
        [entityId, date, JSON.stringify(zeroDraftData), actorId],
      );
      revenueDayId = ins[0].id;
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  // submitRevenueDay manages its own transaction; zero-income day posts no journal lines.
  const ledger = new LedgerService(pool);
  const revenue = new RevenueService(pool, ledger);
  await revenue.submitRevenueDay(revenueDayId, actorId);

  return { revenueDayId };
}
