import 'reflect-metadata';
import { Injectable, Inject } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import {
  PostTransactionSchema,
  PostTransactionInput,
  JournalStatus,
} from './ledger.types';
import { DATABASE_POOL } from '../database/database.providers';

@Injectable()
export class LedgerService {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  // isReversal is engine-set, never exposed to HTTP callers. T5c's reverseEntry
  // passes true; every normal postTransaction call uses the default false.
  async postTransaction(input: unknown, actorId: unknown, isReversal = false): Promise<string> {
    // Validate actor before anything else — clear Law-3 error before input parsing
    const actor = z
      .string()
      .uuid('actorId must be a valid UUID (Law 3: no unattributed write)')
      .parse(actorId);

    const parsed = PostTransactionSchema.parse(input);

    this.checkBalance(parsed.lines);

    const status = await this.determineStatus(parsed, isReversal);

    return this.writeEntry(parsed, status, actor);
  }

  // ── SINGLE EXTENSIBLE POINT ────────────────────────────────────────────────
  // All status-routing logic lives here and nowhere else. Three rules (any one
  // triggers PENDING_APPROVAL): (1) reversal; (2) entry total ≥ high-value
  // threshold from settings; (3) any line touches a requires_approval=true account.
  // Threshold read live from the DB on every call — it is data, not a constant.
  // Comparison is integer-paisa: Math.round(Taka × 100), same rounding as
  // checkBalance, so the two guards can never disagree on an entry's total.
  private async determineStatus(
    input: PostTransactionInput,
    isReversal: boolean,
  ): Promise<JournalStatus> {
    // Rule 3 checked first — short-circuits with no DB queries
    if (isReversal) return 'PENDING_APPROVAL';

    const totalDebitPaisa = input.lines.reduce(
      (s, l) => s + Math.round(l.debit * 100),
      0,
    );
    const codes = input.lines.map((l) => l.accountCode);

    // One round-trip: threshold from settings + flagged-account check
    const { rows } = await this.pool.query<{
      threshold: unknown;
      has_flagged_account: boolean;
    }>(
      `SELECT
         (SELECT value FROM public.settings
           WHERE key = 'high_value_approval_threshold') AS threshold,
         EXISTS (
           SELECT 1 FROM public.accounts
           WHERE code = ANY($1) AND requires_approval = true
         ) AS has_flagged_account`,
      [codes],
    );

    // Rule 1: value threshold
    // Number() handles both jsonb-parsed number and any edge-case string return.
    // Multiplied by 100 and rounded → integer paisa; compared as integers (no float).
    const thresholdPaisa = Math.round(Number(rows[0].threshold) * 100);
    if (totalDebitPaisa >= thresholdPaisa) return 'PENDING_APPROVAL';

    // Rule 2: approval-flagged account
    if (rows[0].has_flagged_account) return 'PENDING_APPROVAL';

    return 'POSTED';
  }
  // ──────────────────────────────────────────────────────────────────────────

  // Belt-and-suspenders consistency: the paisa sum compared here and the rounded
  // string written in writeEntry derive from the same Math.round(x*100) operation.
  // What was checked is exactly what the DB receives, so the in-code guard and the
  // DB deferred balance trigger can never disagree on whether an entry is balanced.
  private checkBalance(lines: PostTransactionInput['lines']): void {
    const dr = lines.reduce((s, l) => s + Math.round(l.debit  * 100), 0);
    const cr = lines.reduce((s, l) => s + Math.round(l.credit * 100), 0);
    if (dr !== cr) {
      throw new Error(
        `entry unbalanced: Σdebit ${(dr / 100).toFixed(2)} ≠ Σcredit ${(cr / 100).toFixed(2)}`,
      );
    }
  }

  private async writeEntry(
    input: PostTransactionInput,
    status: JournalStatus,
    actorId: string,
  ): Promise<string> {
    const client: PoolClient = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO public.journal_entries
           (entity_id, entry_date, description, ref, status,
            source_module, source_id, entered_at, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),$8)
         RETURNING id`,
        [
          input.entityId,
          input.entryDate,
          input.description,
          input.ref ?? null,
          status,
          input.sourceModule ?? 'MANUAL',
          input.sourceId ?? null,
          actorId,
        ],
      );
      const entryId = rows[0].id;

      for (const line of input.lines) {
        // Derive the stored value from the same paisa rounding as checkBalance:
        // Math.round(x*100) → exact integer → /100 → .toFixed(2) → lossless string.
        // Raw JS float never reaches NUMERIC; no drift between what was checked
        // and what is stored.
        const debitStr  = (Math.round(line.debit  * 100) / 100).toFixed(2);
        const creditStr = (Math.round(line.credit * 100) / 100).toFixed(2);

        await client.query(
          `INSERT INTO public.journal_lines
             (entry_id, account_code, party_id, fund, debit, credit, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            entryId,
            line.accountCode,
            line.partyId ?? null,
            line.fund,
            debitStr,
            creditStr,
            actorId,
          ],
        );
      }

      await client.query('COMMIT');
      return entryId;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}
