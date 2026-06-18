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

  async postTransaction(input: unknown, actorId: unknown): Promise<string> {
    // Validate actor before anything else — clear Law-3 error before input parsing
    const actor = z
      .string()
      .uuid('actorId must be a valid UUID (Law 3: no unattributed write)')
      .parse(actorId);

    const parsed = PostTransactionSchema.parse(input);

    this.checkBalance(parsed.lines);

    const status = this.determineStatus(parsed);

    return this.writeEntry(parsed, status, actor);
  }

  // ── SINGLE EXTENSIBLE POINT ────────────────────────────────────────────────
  // T5b replaces ONLY this method body to add the approval gate (value threshold,
  // reversal flag, source_module=COGS). postTransaction() is untouched; the entire
  // status routing decision lives here and nowhere else.
  private determineStatus(_input: PostTransactionInput): JournalStatus {
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
