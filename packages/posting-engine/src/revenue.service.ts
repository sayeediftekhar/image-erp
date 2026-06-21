import { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { LedgerService } from './ledger.service';
import { PostTransactionInput } from './ledger.types';
import { DraftDataSchema, DraftData } from './draft-data.schema';

// ── Income line computation (Iron Law 1 — pure arithmetic, no DB) ─────────────

interface IncomeResult {
  input: PostTransactionInput;
  total: number; // piCash + rdfCash in Taka
}

function buildIncomeInput(
  entityId: string,
  entryDate: string,
  sourceId: string,
  data: DraftData,
): IncomeResult | null {
  let amt4010 = 0; // PI-Outdoor: all sessions' service_charge
  let amt4020 = 0; // PI-NVD
  // 4030 PI-C-Section: NOT posted at admission; income recognised on discharge
  //   via closeDeliveryBalance (P2-T2b).
  let amt4040 = 0; // PI-Satellite: teams' service_charge
  let amt4050 = 0; // PI-USG: all usg[].revenue (all sessions + teams)
  let amt4090 = 0; // PI-Other
  let amt4110 = 0; // RDF-Medicine: rdf_medicine_sales (sessions + teams) + nvd rdf_revenue
  let amt4120 = 0; // RDF-Lab: lab_revenue (sessions + teams)
  let amt4130 = 0; // RDF-Logistic: AFTERHOURS.logistic_sales + nvd logistic_revenue

  if (data.sessions.MORNING) {
    amt4010 += data.sessions.MORNING.service_charge;
    amt4110 += data.sessions.MORNING.rdf_medicine_sales;
    amt4120 += data.sessions.MORNING.lab_revenue;
    for (const u of data.sessions.MORNING.usg) amt4050 += u.revenue;
  }
  if (data.sessions.EVENING) {
    amt4010 += data.sessions.EVENING.service_charge;
    amt4110 += data.sessions.EVENING.rdf_medicine_sales;
    amt4120 += data.sessions.EVENING.lab_revenue;
    for (const u of data.sessions.EVENING.usg) amt4050 += u.revenue;
  }
  if (data.sessions.AFTERHOURS) {
    amt4010 += data.sessions.AFTERHOURS.service_charge;
    amt4110 += data.sessions.AFTERHOURS.rdf_medicine_sales;
    amt4130 += data.sessions.AFTERHOURS.logistic_sales;
  }

  for (const team of data.satellite_teams) {
    amt4040 += team.service_charge;
    amt4110 += team.rdf_medicine_sales;
    amt4120 += team.lab_revenue;
    for (const u of team.usg) amt4050 += u.revenue;
  }

  // NVD: same-day income — patient pays in full on delivery day.
  if (data.delivery.nvd) {
    amt4020 += data.delivery.nvd.service_charge;
    amt4110 += data.delivery.nvd.rdf_revenue;
    amt4130 += data.delivery.nvd.logistic_revenue;
  }
  // C-section: no income at admission.
  //   The advance is a separate posting (buildCsectionAdvanceInput → Dr 1010 / Cr 2150).
  //   Income (4030 / 4110 / 4130) is recognised only at discharge via closeDeliveryBalance.
  // safe_delivery: removed — was the spreadsheet cross-check sum, double-counting NVD + C-section.

  for (const item of data.other_income) amt4090 += item.amount;

  // Cash debits by fund — each fund's debit = Σ that fund's income credits.
  // Balance-by-construction: Σ debit = piCash + rdfCash = Σ credit.
  const piCash  = amt4010 + amt4020 + amt4040 + amt4050 + amt4090;
  const rdfCash = amt4110 + amt4120 + amt4130;

  // Use integer paisa to avoid float imprecision in the total
  const totalPaisa = Math.round(piCash * 100) + Math.round(rdfCash * 100);
  if (totalPaisa === 0) return null; // zero-income day: no entry to post

  // Filter zero amounts — LineSchema requires exactly one of debit/credit > 0
  const lines: PostTransactionInput['lines'] = [];
  if (piCash  > 0) lines.push({ accountCode: '1010', fund: 'PI',  debit: piCash,  credit: 0 });
  if (rdfCash > 0) lines.push({ accountCode: '1020', fund: 'RDF', debit: rdfCash, credit: 0 });
  if (amt4010 > 0) lines.push({ accountCode: '4010', fund: 'PI',  debit: 0, credit: amt4010 });
  if (amt4020 > 0) lines.push({ accountCode: '4020', fund: 'PI',  debit: 0, credit: amt4020 });
  if (amt4040 > 0) lines.push({ accountCode: '4040', fund: 'PI',  debit: 0, credit: amt4040 });
  if (amt4050 > 0) lines.push({ accountCode: '4050', fund: 'PI',  debit: 0, credit: amt4050 });
  if (amt4090 > 0) lines.push({ accountCode: '4090', fund: 'PI',  debit: 0, credit: amt4090 });
  if (amt4110 > 0) lines.push({ accountCode: '4110', fund: 'RDF', debit: 0, credit: amt4110 });
  if (amt4120 > 0) lines.push({ accountCode: '4120', fund: 'RDF', debit: 0, credit: amt4120 });
  if (amt4130 > 0) lines.push({ accountCode: '4130', fund: 'RDF', debit: 0, credit: amt4130 });

  return {
    input: {
      entityId,
      entryDate,
      description: `Revenue: ${entryDate}`,
      ref: `REV-${entryDate}`,
      sourceModule: 'REVENUE_ENTRY',
      sourceId,
      lines,
    },
    total: totalPaisa / 100,
  };
}

function buildDepositInput(
  entityId: string,
  entryDate: string,
  sourceId: string,
  data: DraftData,
): PostTransactionInput | null {
  const { bank_deposit: bd } = data.financial;
  if (!bd.made) return null;

  const lines: PostTransactionInput['lines'] = [];
  if (bd.pi_amount  > 0) lines.push({ accountCode: '1110', fund: 'PI',  debit: bd.pi_amount,  credit: 0 });
  if (bd.rdf_amount > 0) lines.push({ accountCode: '1120', fund: 'RDF', debit: bd.rdf_amount, credit: 0 });
  if (bd.pi_amount  > 0) lines.push({ accountCode: '1010', fund: 'PI',  debit: 0, credit: bd.pi_amount  });
  if (bd.rdf_amount > 0) lines.push({ accountCode: '1020', fund: 'RDF', debit: 0, credit: bd.rdf_amount });

  if (lines.length < 2) return null; // both amounts zero despite made=true

  return {
    entityId,
    entryDate,
    description: `Bank deposit: ${entryDate}`,
    ref: `DEP-${entryDate}`,
    sourceModule: 'REVENUE_ENTRY',
    sourceId,
    lines,
  };
}

function buildAdvanceInput(
  entityId: string,
  entryDate: string,
  sourceId: string,
  data: DraftData,
): PostTransactionInput | null {
  const { cash_advance: ca } = data.financial;
  if (ca.amount <= 0) return null;

  // 1015 (Petty Cash Float) is a PI asset — Dr side always PI.
  // Cr side: cash from whichever fund (defaults PI, rarely RDF per spec).
  const fund = ca.fund ?? 'PI';
  const cashAccount = fund === 'PI' ? '1010' : '1020';

  return {
    entityId,
    entryDate,
    description: `Cash advance: ${entryDate}`,
    ref: `ADV-${entryDate}`,
    sourceModule: 'REVENUE_ENTRY',
    sourceId,
    lines: [
      { accountCode: '1015', fund: 'PI',  debit: ca.amount, credit: 0 },
      { accountCode: cashAccount, fund,   debit: 0, credit: ca.amount },
    ],
  };
}

// One combined entry summing all C-section advances for the day.
// Dr 1010/PI = Σ advances (cash received); Cr 2150/PI = Σ advances (liability held).
// Balanced by construction: two equal-and-opposite lines.
// Income NOT recognised here — deferred to closeDeliveryBalance at discharge.
function buildCsectionAdvanceInput(
  entityId: string,
  entryDate: string,
  sourceId: string,
  data: DraftData,
): PostTransactionInput | null {
  const total = (data.delivery.csection?.balances ?? [])
    .reduce((s, b) => s + b.advance, 0);
  if (total <= 0) return null;

  return {
    entityId,
    entryDate,
    description: `C-section advance: ${entryDate}`,
    ref: `CSA-${entryDate}`,
    sourceModule: 'REVENUE_ENTRY',
    sourceId,
    lines: [
      { accountCode: '1010', fund: 'PI', debit: total,  credit: 0 },
      { accountCode: '2150', fund: 'PI', debit: 0, credit: total },
    ],
  };
}

// ── Close-balance types ───────────────────────────────────────────────────────

export interface CloseFinalBill {
  service_charge:    number; // PI income → 4030 (C-section service fee)
  seat_rent:         number; // PI income → 4030 (folds into same account)
  rdf_amount:        number; // RDF medicine/consumables → 4110
  logistics_amount:  number; // RDF logistics → 4130
}

const CloseFinalBillSchema = z.object({
  service_charge:   z.number().min(0),
  seat_rent:        z.number().min(0).default(0),
  rdf_amount:       z.number().min(0).default(0),
  logistics_amount: z.number().min(0).default(0),
}).refine(
  d => d.service_charge + d.seat_rent + d.rdf_amount + d.logistics_amount > 0,
  { message: 'total bill must be > 0 to close a delivery balance' },
);

export interface CloseResult {
  deliveryBalanceId: string;
  closeEntryId:      string;
  totalBill:         number;
  advance:           number;
  balancePaid:       number; // positive = new cash received; negative = refund out
}

export interface FlaggedBalance {
  id:               string;
  entity_id:        string;
  patient_name:     string;
  receipt_no:       string | null;
  delivery_type:    string;
  advance_paid:     number;
  expected_balance: number;
  expected_date:    string | null;
  admission_date:   string;
  days_open:        number;
}

// ── Service ───────────────────────────────────────────────────────────────────

export interface SubmitResult {
  revenueDayId:            string;
  incomeEntryId:           string | null;
  csectionAdvanceEntryId:  string | null;
  totalRevenue:            number;
  dailyActivityRows:       number;
  deliveryBalanceRows:     number;
}

export class RevenueService {
  constructor(
    private readonly pool: Pool,
    private readonly ledgerService: LedgerService,
  ) {}

  async submitRevenueDay(revenueDayId: string, actorId: string): Promise<SubmitResult> {
    const rdId  = z.string().uuid('revenueDayId must be a valid UUID').parse(revenueDayId);
    const actor = z.string().uuid('actorId must be a valid UUID').parse(actorId);

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // ── Step 1: Lock the revenue_day (mirrors promoteEntry FOR UPDATE pattern) ──
      // revenue_date::text: pg maps DATE columns to JS Date objects by default;
      // cast to text here so entryDate stays a 'YYYY-MM-DD' string throughout.
      const { rows: dayRows } = await client.query<{
        id: string; entity_id: string; revenue_date: string;
        status: string; draft_data: unknown;
      }>(
        `SELECT id, entity_id, revenue_date::text AS revenue_date, status, draft_data
         FROM public.revenue_day WHERE id = $1 FOR UPDATE`,
        [rdId],
      );
      if (dayRows.length === 0) throw new Error(`revenue_day ${rdId} not found`);
      const day = dayRows[0];

      // ── Step 2: Idempotency guard ──────────────────────────────────────────────
      if (day.status !== 'DRAFT') {
        throw new Error(
          `revenue_day ${rdId} is already ${day.status} — cannot re-submit`,
        );
      }

      // ── Step 3: Validate draft_data (server-side; never trust the client) ──────
      const data = DraftDataSchema.parse(day.draft_data);

      // ── Step 4: Post income entry (if day has any revenue) ────────────────────
      const incomeResult = buildIncomeInput(day.entity_id, day.revenue_date, rdId, data);
      const totalRevenue = incomeResult?.total ?? 0;
      let incomeEntryId: string | null = null;
      if (incomeResult) {
        incomeEntryId = await this.ledgerService.postTransactionOnClient(
          client, incomeResult.input, actor,
        );
      }

      // ── Step 5: Post deposit entry (conditional) ───────────────────────────────
      const depositInput = buildDepositInput(day.entity_id, day.revenue_date, rdId, data);
      if (depositInput) {
        await this.ledgerService.postTransactionOnClient(client, depositInput, actor);
      }

      // ── Step 6: Post petty-cash advance entry (conditional) ───────────────────
      const advanceInput = buildAdvanceInput(day.entity_id, day.revenue_date, rdId, data);
      if (advanceInput) {
        await this.ledgerService.postTransactionOnClient(client, advanceInput, actor);
      }

      // ── Step 6b: Post C-section advance entry (Dr 1010/PI, Cr 2150/PI) ────────
      // Advance cash is held as a LIABILITY (2150), not recognised as income.
      // Income is deferred to the discharge bill (closeDeliveryBalance).
      const csectionAdvInput = buildCsectionAdvanceInput(day.entity_id, day.revenue_date, rdId, data);
      let csectionAdvanceEntryId: string | null = null;
      if (csectionAdvInput) {
        csectionAdvanceEntryId = await this.ledgerService.postTransactionOnClient(
          client, csectionAdvInput, actor,
        );
      }

      // ── Step 7: Write daily_activity rows (COUNTS) ────────────────────────────
      const dailyActivityRows = await this.writeDailyActivity(
        client, day.entity_id, day.revenue_date, rdId, data, actor,
      );

      // ── Step 8: Write delivery_balance rows (OPEN) ────────────────────────────
      const deliveryBalanceRows = await this.writeDeliveryBalances(
        client, day.entity_id, rdId, data, actor,
      );

      // ── Step 9: Flip revenue_day to SUBMITTED ─────────────────────────────────
      // journal_entry_id = income entry (null for zero-income day).
      // total_revenue = computed sum (authoritative, never the manager's stated figure).
      // touch trigger: coalesce(auth.uid()=null, NEW.updated_by=actor) = actor ✓
      await client.query(
        `UPDATE public.revenue_day
         SET status = 'SUBMITTED',
             journal_entry_id = $1,
             total_revenue = $2,
             submitted_at = now(),
             updated_by = $3
         WHERE id = $4`,
        [incomeEntryId, totalRevenue.toFixed(2), actor, rdId],
      );

      await client.query('COMMIT');
      return {
        revenueDayId: rdId,
        incomeEntryId,
        csectionAdvanceEntryId,
        totalRevenue,
        dailyActivityRows,
        deliveryBalanceRows,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // Closes a C-section delivery balance on discharge day.
  // Posts the itemized discharge bill (income recognised here, NOT at admission),
  // releases the 2150 Patient Advances liability, and records any cash balance or refund.
  //
  // Balance-by-construction:
  //   Case balance ≥ 0: Σ Dr = advance + balance = totalBill = Σ Cr ✓
  //   Case balance < 0: Σ Dr = advance; Σ Cr = −balance + totalBill = advance ✓
  //
  // Fund-cash note: all discharge cash routes to 1010/PI as a deliberate simplification.
  // The RDF income portions (4110/4130) do NOT carry matching RDF cash — a known
  // PI/RDF fund-cash distortion deferred to Phase 4/5 to resolve against real data
  // (touches the PI/RDF bank reconciliation). See CONTEXT.md carried-forward gaps.
  async closeDeliveryBalance(
    deliveryBalanceId: string,
    finalBill: CloseFinalBill,
    dischargeDate: string,
    actorId: string,
  ): Promise<CloseResult> {
    const dbId   = z.string().uuid('deliveryBalanceId must be a valid UUID').parse(deliveryBalanceId);
    const date   = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dischargeDate must be YYYY-MM-DD').parse(dischargeDate);
    const actor  = z.string().uuid('actorId must be a valid UUID').parse(actorId);
    const bill   = CloseFinalBillSchema.parse(finalBill);

    const bill4030 = bill.service_charge + bill.seat_rent;
    const bill4110 = bill.rdf_amount;
    const bill4130 = bill.logistics_amount;
    const totalBill = bill4030 + bill4110 + bill4130;

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Lock the delivery_balance row; must be OPEN
      const { rows } = await client.query<{
        id: string; entity_id: string; patient_name: string;
        advance_paid: string; status: string;
      }>(
        `SELECT id, entity_id, patient_name, advance_paid::text, status
         FROM public.delivery_balance WHERE id = $1 FOR UPDATE`,
        [dbId],
      );
      if (rows.length === 0) throw new Error(`delivery_balance ${dbId} not found`);
      const db = rows[0];

      if (db.status !== 'OPEN') {
        throw new Error(
          `delivery_balance ${dbId} is already ${db.status} — cannot close again (idempotency guard)`,
        );
      }

      const advance     = Number(db.advance_paid);
      const balancePaid = totalBill - advance; // positive = patient pays; negative = refund

      // Build lines (zero-filtered — LineSchema XOR requires exactly one side > 0)
      const lines: PostTransactionInput['lines'] = [];
      if (advance > 0)      lines.push({ accountCode: '2150', fund: 'PI',  debit: advance,        credit: 0 });
      if (balancePaid > 0)  lines.push({ accountCode: '1010', fund: 'PI',  debit: balancePaid,    credit: 0 });
      if (balancePaid < 0)  lines.push({ accountCode: '1010', fund: 'PI',  debit: 0, credit: -balancePaid });
      if (bill4030 > 0)     lines.push({ accountCode: '4030', fund: 'PI',  debit: 0, credit: bill4030 });
      if (bill4110 > 0)     lines.push({ accountCode: '4110', fund: 'RDF', debit: 0, credit: bill4110 });
      if (bill4130 > 0)     lines.push({ accountCode: '4130', fund: 'RDF', debit: 0, credit: bill4130 });

      const closeEntryId = await this.ledgerService.postTransactionOnClient(
        client,
        {
          entityId:     db.entity_id,
          entryDate:    date,
          description:  `Discharge: ${db.patient_name}`,
          ref:          `DIS-${dbId.slice(0, 8)}`,
          sourceModule: 'DELIVERY_CLOSE',
          sourceId:     dbId,
          lines,
        },
        actor,
      );

      await client.query(
        `UPDATE public.delivery_balance
         SET status                = 'CLOSED',
             closed_date           = $1,
             final_service_charge  = $2,
             final_rdf_amount      = $3,
             final_logistics_amount= $4,
             final_balance_paid    = $5,
             close_entry_id        = $6,
             updated_by            = $7
         WHERE id = $8`,
        [date,
         bill4030.toFixed(2), bill4110.toFixed(2), bill4130.toFixed(2),
         balancePaid.toFixed(2),
         closeEntryId, actor, dbId],
      );

      await client.query('COMMIT');
      return { deliveryBalanceId: dbId, closeEntryId, totalBill, advance, balancePaid };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // Returns OPEN delivery balances whose admission date (revenue_day.revenue_date)
  // exceeds the delivery_balance_flag_days setting. Uses revenue_date, NOT created_at,
  // because managers commonly submit 2-3 days late (batch entry pattern).
  async getFlaggedOpenBalances(entityId?: string): Promise<FlaggedBalance[]> {
    const { rows } = await this.pool.query<FlaggedBalance & { days_open: number }>(
      `SELECT
         db.id,
         db.entity_id,
         db.patient_name,
         db.receipt_no,
         db.delivery_type,
         db.advance_paid::float    AS advance_paid,
         db.expected_balance::float AS expected_balance,
         db.expected_date::text    AS expected_date,
         rd.revenue_date::text     AS admission_date,
         (CURRENT_DATE - rd.revenue_date)::int AS days_open
       FROM public.delivery_balance db
       JOIN public.revenue_day rd ON rd.id = db.revenue_day_id
       WHERE db.status = 'OPEN'
         AND (CURRENT_DATE - rd.revenue_date)::int > (
               SELECT value::integer
               FROM public.settings
               WHERE key = 'delivery_balance_flag_days'
             )
         AND ($1::uuid IS NULL OR db.entity_id = $1)
       ORDER BY rd.revenue_date`,
      [entityId ?? null],
    );
    return rows;
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private async writeDailyActivity(
    client: PoolClient,
    entityId: string,
    activityDate: string,
    revenueDayId: string,
    data: DraftData,
    actorId: string,
  ): Promise<number> {
    const rows: Array<{ channel: string; service: string; metric: string; value: number }> = [];

    if (data.sessions.MORNING) {
      const s = data.sessions.MORNING;
      if (s.patients_new > 0) rows.push({ channel: 'MORNING', service: 'OUTDOOR', metric: 'patients_new', value: s.patients_new });
      if (s.patients_old > 0) rows.push({ channel: 'MORNING', service: 'OUTDOOR', metric: 'patients_old', value: s.patients_old });
      if (s.services     > 0) rows.push({ channel: 'MORNING', service: 'OUTDOOR', metric: 'services',     value: s.services });
      if (s.lab_tests    > 0) rows.push({ channel: 'MORNING', service: 'LAB',     metric: 'lab_tests',    value: s.lab_tests });
      for (const u of s.usg) {
        if (u.count > 0) rows.push({ channel: 'MORNING', service: `USG_${u.type}`, metric: 'usg_count', value: u.count });
      }
    }

    if (data.sessions.EVENING) {
      const s = data.sessions.EVENING;
      if (s.patients_new > 0) rows.push({ channel: 'EVENING', service: 'OUTDOOR', metric: 'patients_new', value: s.patients_new });
      if (s.patients_old > 0) rows.push({ channel: 'EVENING', service: 'OUTDOOR', metric: 'patients_old', value: s.patients_old });
      if (s.services     > 0) rows.push({ channel: 'EVENING', service: 'OUTDOOR', metric: 'services',     value: s.services });
      if (s.lab_tests    > 0) rows.push({ channel: 'EVENING', service: 'LAB',     metric: 'lab_tests',    value: s.lab_tests });
      for (const u of s.usg) {
        if (u.count > 0) rows.push({ channel: 'EVENING', service: `USG_${u.type}`, metric: 'usg_count', value: u.count });
      }
    }

    if (data.sessions.AFTERHOURS) {
      const s = data.sessions.AFTERHOURS;
      if (s.patients > 0) rows.push({ channel: 'AFTERHOURS', service: 'OUTDOOR', metric: 'patients', value: s.patients });
    }

    for (const team of data.satellite_teams) {
      const ch = team.team;
      if (team.patients_new > 0) rows.push({ channel: ch, service: 'OUTDOOR', metric: 'patients_new', value: team.patients_new });
      if (team.patients_old > 0) rows.push({ channel: ch, service: 'OUTDOOR', metric: 'patients_old', value: team.patients_old });
      if (team.services     > 0) rows.push({ channel: ch, service: 'OUTDOOR', metric: 'services',     value: team.services });
      if (team.lab_tests    > 0) rows.push({ channel: ch, service: 'LAB',     metric: 'lab_tests',    value: team.lab_tests });
      for (const u of team.usg) {
        if (u.count > 0) rows.push({ channel: ch, service: `USG_${u.type}`, metric: 'usg_count', value: u.count });
      }
    }

    if (data.delivery.nvd && data.delivery.nvd.cases > 0) {
      rows.push({ channel: 'STATIC', service: 'NVD', metric: 'cases', value: data.delivery.nvd.cases });
    }
    if (data.delivery.csection && data.delivery.csection.cases > 0) {
      rows.push({ channel: 'STATIC', service: 'CSECTION', metric: 'cases', value: data.delivery.csection.cases });
    }

    for (const row of rows) {
      await client.query(
        `INSERT INTO public.daily_activity
           (entity_id, activity_date, channel, service, metric, value,
            source, revenue_day_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,'MANUAL_AGGREGATE',$7,$8)
         ON CONFLICT (entity_id, activity_date, channel, service, metric)
         DO UPDATE SET
           value = EXCLUDED.value,
           revenue_day_id = EXCLUDED.revenue_day_id,
           updated_by = EXCLUDED.created_by,
           updated_at = now()`,
        [entityId, activityDate, row.channel, row.service, row.metric,
         row.value.toString(), revenueDayId, actorId],
      );
    }

    return rows.length;
  }

  private async writeDeliveryBalances(
    client: PoolClient,
    entityId: string,
    revenueDayId: string,
    data: DraftData,
    actorId: string,
  ): Promise<number> {
    const csectionBalances = data.delivery.csection?.balances ?? [];
    let count = 0;

    for (const b of csectionBalances) {
      await client.query(
        `INSERT INTO public.delivery_balance
           (entity_id, revenue_day_id, receipt_no, patient_name, phone,
            delivery_type, advance_paid, expected_balance, expected_date,
            status, created_by)
         VALUES ($1,$2,$3,$4,$5,'CSECTION',$6,$7,$8,'OPEN',$9)`,
        [entityId, revenueDayId, b.receipt_no ?? null, b.patient_name,
         b.phone ?? null, b.advance.toFixed(2), b.expected_balance.toFixed(2),
         b.expected_date ?? null, actorId],
      );
      count++;
    }

    // safe_delivery removed from schema; SAFE-type rows reserved for future use.
    return count;
  }
}
