import 'reflect-metadata';
import { Pool } from 'pg';
import { LedgerService } from '../src/ledger/ledger.service';

const DB_URL =
  process.env.DATABASE_URL ?? 'postgresql:///erp_test?host=/tmp';

const ACTOR_ID = '11111111-1111-1111-1111-111111111111';

describe('LedgerService.postTransaction', () => {
  let pool: Pool;
  let service: LedgerService;
  let jalEntityId: string;
  const createdIds: string[] = [];

  beforeAll(async () => {
    pool = new Pool({ connectionString: DB_URL });
    service = new LedgerService(pool);
    const { rows } = await pool.query(
      "SELECT id FROM public.entities WHERE code = 'JAL'",
    );
    jalEntityId = rows[0].id as string;
  });

  afterEach(async () => {
    for (const id of createdIds) {
      // POSTED entries block direct DELETE (immutability trigger).
      // Promote to REVERSED first (status-only UPDATE is the one allowed mutation),
      // then delete. Non-POSTED entries are unaffected by the UPDATE WHERE clause.
      await pool.query(
        "UPDATE public.journal_entries SET status='REVERSED' WHERE id=$1 AND status='POSTED'",
        [id],
      );
      await pool.query('DELETE FROM public.journal_entries WHERE id=$1', [id]);
    }
    createdIds.length = 0;
  });

  afterAll(async () => {
    // Safety net for any leaked POSTED entries (e.g. from a mid-test failure)
    await pool.query(
      "UPDATE public.journal_entries SET status='REVERSED' WHERE description LIKE '[T5-TEST]%' AND status='POSTED'",
    );
    await pool.query(
      "DELETE FROM public.journal_entries WHERE description LIKE '[T5-TEST]%'",
    );
    await pool.end();
  });

  // ── Criterion 1: valid balanced 2-line entry ─────────────────────────────
  it('posts a balanced 2-line entry: returns a UUID, status=POSTED, created_by stamped on header and both lines', async () => {
    const entryId = await service.postTransaction(
      {
        entityId: jalEntityId,
        entryDate: '2026-06-18',
        description: '[T5-TEST] Balanced 2-line',
        lines: [
          { accountCode: '1010', fund: 'PI',  debit: 5000, credit: 0 },
          { accountCode: '2010', fund: 'RDF', debit: 0,    credit: 5000 },
        ],
      },
      ACTOR_ID,
    );
    createdIds.push(entryId);

    expect(typeof entryId).toBe('string');
    expect(entryId).toHaveLength(36);

    const entry = await pool.query(
      'SELECT status, created_by FROM public.journal_entries WHERE id = $1',
      [entryId],
    );
    expect(entry.rows[0].status).toBe('POSTED');
    expect(entry.rows[0].created_by).toBe(ACTOR_ID);

    const lines = await pool.query(
      'SELECT created_by FROM public.journal_lines WHERE entry_id = $1',
      [entryId],
    );
    expect(lines.rows).toHaveLength(2);
    lines.rows.forEach((r) => expect(r.created_by).toBe(ACTOR_ID));
  });

  // ── Criterion 2: unbalanced → in-code rejection, no DB write ─────────────
  it('rejects an unbalanced entry with a clear error and writes nothing to the DB', async () => {
    await expect(
      service.postTransaction(
        {
          entityId: jalEntityId,
          entryDate: '2026-06-18',
          description: '[T5-TEST] Unbalanced',
          lines: [
            { accountCode: '1010', fund: 'PI',  debit: 5000, credit: 0 },
            { accountCode: '2010', fund: 'RDF', debit: 0,    credit: 4800 },
          ],
        },
        ACTOR_ID,
      ),
    ).rejects.toThrow(/unbalanced/);

    const { rows } = await pool.query(
      "SELECT count(*)::int AS n FROM public.journal_entries WHERE description = '[T5-TEST] Unbalanced'",
    );
    expect(rows[0].n).toBe(0);
  });

  // ── Criterion 3: Zod validation (four cases) ─────────────────────────────
  it('rejects a negative debit (Zod: nonnegative)', async () => {
    await expect(
      service.postTransaction(
        {
          entityId: jalEntityId,
          entryDate: '2026-06-18',
          description: '[T5-TEST] Negative debit',
          lines: [
            { accountCode: '1010', fund: 'PI',  debit: -100, credit: 0 },
            { accountCode: '2010', fund: 'RDF', debit: 0,    credit: 100 },
          ],
        },
        ACTOR_ID,
      ),
    ).rejects.toThrow();
  });

  it('rejects a line with both debit and credit > 0 (Zod refine: XOR)', async () => {
    await expect(
      service.postTransaction(
        {
          entityId: jalEntityId,
          entryDate: '2026-06-18',
          description: '[T5-TEST] Both sides',
          lines: [
            { accountCode: '1010', fund: 'PI',  debit: 100, credit: 50 },
            { accountCode: '2010', fund: 'RDF', debit: 0,   credit: 50 },
          ],
        },
        ACTOR_ID,
      ),
    ).rejects.toThrow();
  });

  it('rejects fewer than 2 lines (Zod: min(2))', async () => {
    await expect(
      service.postTransaction(
        {
          entityId: jalEntityId,
          entryDate: '2026-06-18',
          description: '[T5-TEST] Single line',
          lines: [{ accountCode: '1010', fund: 'PI', debit: 100, credit: 0 }],
        },
        ACTOR_ID,
      ),
    ).rejects.toThrow();
  });

  it('rejects a missing entityId (Zod: uuid required)', async () => {
    await expect(
      service.postTransaction(
        {
          entryDate: '2026-06-18',
          description: '[T5-TEST] No entity',
          lines: [
            { accountCode: '1010', fund: 'PI',  debit: 100, credit: 0 },
            { accountCode: '2010', fund: 'RDF', debit: 0,   credit: 100 },
          ],
        },
        ACTOR_ID,
      ),
    ).rejects.toThrow();
  });

  // ── Criterion 4: float exactness ─────────────────────────────────────────
  it('handles float-prone sums without drift: 0.1 + 0.2 balances against 0.3', async () => {
    // Naive JS: 0.1 + 0.2 = 0.30000000000000004 ≠ 0.3
    // Paisa path: Math.round(0.1*100) + Math.round(0.2*100) = 10 + 20 = 30
    //             Math.round(0.3*100) = 30  → 30 === 30 ✓
    const entryId = await service.postTransaction(
      {
        entityId: jalEntityId,
        entryDate: '2026-06-18',
        description: '[T5-TEST] Float precision',
        lines: [
          { accountCode: '1010', fund: 'PI',  debit: 0.10, credit: 0 },
          { accountCode: '1010', fund: 'PI',  debit: 0.20, credit: 0 },
          { accountCode: '2010', fund: 'RDF', debit: 0,    credit: 0.30 },
        ],
      },
      ACTOR_ID,
    );
    createdIds.push(entryId);
    expect(entryId).toBeDefined();
  });

  // ── Criterion 5: null actorId → rejected before any DB call (Law 3) ──────
  it('rejects a null actorId before any DB interaction (Law 3)', async () => {
    // Zod rejects null with "Expected string, received null" before uuid check.
    // Either way the call throws before touching the pool — Law 3 enforced.
    await expect(
      service.postTransaction(
        {
          entityId: jalEntityId,
          entryDate: '2026-06-18',
          description: '[T5-TEST] Null actor',
          lines: [
            { accountCode: '1010', fund: 'PI',  debit: 100, credit: 0 },
            { accountCode: '2010', fund: 'RDF', debit: 0,   credit: 100 },
          ],
        },
        null,
      ),
    ).rejects.toThrow();

    const { rows } = await pool.query(
      "SELECT count(*)::int AS n FROM public.journal_entries WHERE description = '[T5-TEST] Null actor'",
    );
    expect(rows[0].n).toBe(0);
  });

  // ── Criterion 6: entity and fund stored correctly ─────────────────────────
  it('stores the correct entityId on the header and fund on each line', async () => {
    const entryId = await service.postTransaction(
      {
        entityId: jalEntityId,
        entryDate: '2026-06-18',
        description: '[T5-TEST] Entity+fund check',
        lines: [
          { accountCode: '1010', fund: 'PI',  debit: 200, credit: 0 },
          { accountCode: '2010', fund: 'RDF', debit: 0,   credit: 200 },
        ],
      },
      ACTOR_ID,
    );
    createdIds.push(entryId);

    const entry = await pool.query(
      'SELECT entity_id FROM public.journal_entries WHERE id = $1',
      [entryId],
    );
    expect(entry.rows[0].entity_id).toBe(jalEntityId);

    const lines = await pool.query(
      'SELECT fund FROM public.journal_lines WHERE entry_id = $1 ORDER BY debit DESC',
      [entryId],
    );
    expect(lines.rows[0].fund).toBe('PI');
    expect(lines.rows[1].fund).toBe('RDF');
  });

  // ── Criterion 7: DB deferred trigger as backstop ─────────────────────────
  it('DB deferred balance trigger rejects an unbalanced entry even if the in-code check is bypassed', async () => {
    const client = await pool.connect();
    let threwOnBalance = false;
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO public.journal_entries
           (entity_id, entry_date, description, status, entered_at, created_by, source_module)
         VALUES ($1, '2026-06-18', '[T5-TEST] DB backstop', 'POSTED', NOW(), $2, 'MANUAL')
         RETURNING id`,
        [jalEntityId, ACTOR_ID],
      );
      const entryId = rows[0].id;
      // Insert only the debit side — intentionally unbalanced
      await client.query(
        `INSERT INTO public.journal_lines
           (entry_id, account_code, fund, debit, credit, created_by)
         VALUES ($1, '1010', 'PI', '100.00', '0.00', $2)`,
        [entryId, ACTOR_ID],
      );
      // Force the deferred trigger: it runs immediately instead of at COMMIT
      await client.query('SET CONSTRAINTS ALL IMMEDIATE');
      // If we reach COMMIT the test must fail
      await client.query('COMMIT');
    } catch (err) {
      threwOnBalance = true;
      await client.query('ROLLBACK');
      expect((err as Error).message).toMatch(/unbalanced/i);
    } finally {
      client.release();
    }
    expect(threwOnBalance).toBe(true);
  });

  // ── Criterion 8: optional fields stored correctly ─────────────────────────
  it('stores ref, sourceModule, and sourceId when provided', async () => {
    const SOURCE_ID = '99999999-9999-9999-9999-999999999999';
    const entryId = await service.postTransaction(
      {
        entityId: jalEntityId,
        entryDate: '2026-06-18',
        description: '[T5-TEST] Optional fields',
        ref: 'INV-2026-001',
        sourceModule: 'PAYROLL',
        sourceId: SOURCE_ID,
        lines: [
          { accountCode: '1010', fund: 'PI',  debit: 100, credit: 0 },
          { accountCode: '2010', fund: 'RDF', debit: 0,   credit: 100 },
        ],
      },
      ACTOR_ID,
    );
    createdIds.push(entryId);

    const { rows } = await pool.query(
      'SELECT ref, source_module, source_id FROM public.journal_entries WHERE id = $1',
      [entryId],
    );
    expect(rows[0].ref).toBe('INV-2026-001');
    expect(rows[0].source_module).toBe('PAYROLL');
    expect(rows[0].source_id).toBe(SOURCE_ID);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // P1-T5b — Approval gate
  // All amounts in Taka (BDT); internal comparisons use integer paisa (× 100).
  // Seeded threshold: Tk 50,000 = 5,000,000 paisa.
  // Flagged account used: '3010' (Fund Balance — PI, requires_approval=true).
  // Counter-account: '1010' (Cash in Hand — PI, requires_approval=false).
  // ═══════════════════════════════════════════════════════════════════════════
  describe('approval gate (P1-T5b)', () => {

    // ── Gate test 1: routine entry → POSTED ────────────────────────────────
    it('routes a routine entry (below threshold, unflagged accounts, not reversal) to POSTED', async () => {
      const entryId = await service.postTransaction(
        {
          entityId: jalEntityId,
          entryDate: '2026-06-18',
          description: '[T5-TEST] Gate routine',
          lines: [
            { accountCode: '1010', fund: 'PI',  debit: 49999, credit: 0 },
            { accountCode: '2010', fund: 'RDF', debit: 0,     credit: 49999 },
          ],
        },
        ACTOR_ID,
      );
      createdIds.push(entryId);

      const { rows } = await pool.query(
        'SELECT status FROM public.journal_entries WHERE id = $1',
        [entryId],
      );
      expect(rows[0].status).toBe('POSTED');
    });

    // ── Gate test 2: above threshold → PENDING_APPROVAL ────────────────────
    it('routes a high-value entry (total > threshold) to PENDING_APPROVAL', async () => {
      const entryId = await service.postTransaction(
        {
          entityId: jalEntityId,
          entryDate: '2026-06-18',
          description: '[T5-TEST] Gate above threshold',
          lines: [
            { accountCode: '1010', fund: 'PI',  debit: 50001, credit: 0 },
            { accountCode: '2010', fund: 'RDF', debit: 0,     credit: 50001 },
          ],
        },
        ACTOR_ID,
      );
      createdIds.push(entryId);

      const { rows } = await pool.query(
        'SELECT status FROM public.journal_entries WHERE id = $1',
        [entryId],
      );
      expect(rows[0].status).toBe('PENDING_APPROVAL');
    });

    // ── Gate test 3: exactly at threshold → PENDING_APPROVAL (≥ boundary) ──
    // Also directly proves the jsonb → Number() → paisa parse:
    // settings.value for 'high_value_approval_threshold' must yield exactly
    // 5,000,000 paisa (not just "routing happens to land right").
    it('routes entry exactly at Tk 50,000 to PENDING_APPROVAL; threshold parses to exactly 5,000,000 paisa', async () => {
      // Direct parse proof — read the live setting and assert the paisa value
      const { rows: settingRows } = await pool.query(
        "SELECT value FROM public.settings WHERE key = 'high_value_approval_threshold'",
      );
      const thresholdPaisa = Math.round(Number(settingRows[0].value) * 100);
      expect(thresholdPaisa).toBe(5_000_000); // Tk 50,000 × 100 = 5,000,000 paisa exactly

      // Routing proof at the ≥ boundary (5,000,000 paisa ≥ 5,000,000 paisa → PA)
      const entryId = await service.postTransaction(
        {
          entityId: jalEntityId,
          entryDate: '2026-06-18',
          description: '[T5-TEST] Gate exactly at threshold',
          lines: [
            { accountCode: '1010', fund: 'PI',  debit: 50000, credit: 0 },
            { accountCode: '2010', fund: 'RDF', debit: 0,     credit: 50000 },
          ],
        },
        ACTOR_ID,
      );
      createdIds.push(entryId);

      const { rows } = await pool.query(
        'SELECT status FROM public.journal_entries WHERE id = $1',
        [entryId],
      );
      expect(rows[0].status).toBe('PENDING_APPROVAL');
    });

    // ── Gate test 4: one paisa below threshold → POSTED ────────────────────
    // Tk 49,999.99 = 4,999,999 paisa < 5,000,000 paisa → POSTED (strict < boundary)
    it('routes entry one paisa below threshold (Tk 49,999.99 = 4,999,999 paisa) to POSTED', async () => {
      const entryId = await service.postTransaction(
        {
          entityId: jalEntityId,
          entryDate: '2026-06-18',
          description: '[T5-TEST] Gate one paisa below',
          lines: [
            { accountCode: '1010', fund: 'PI',  debit: 49999.99, credit: 0 },
            { accountCode: '2010', fund: 'RDF', debit: 0,        credit: 49999.99 },
          ],
        },
        ACTOR_ID,
      );
      createdIds.push(entryId);

      const { rows } = await pool.query(
        'SELECT status FROM public.journal_entries WHERE id = $1',
        [entryId],
      );
      expect(rows[0].status).toBe('POSTED');
    });

    // ── Gate test 5: flagged account → PENDING_APPROVAL ────────────────────
    // Tk 100 << threshold; only trigger is requires_approval=true on '3010'.
    it('routes entry touching a requires_approval=true account to PENDING_APPROVAL (Tk 100, below threshold)', async () => {
      const entryId = await service.postTransaction(
        {
          entityId: jalEntityId,
          entryDate: '2026-06-18',
          description: '[T5-TEST] Gate flagged account',
          lines: [
            { accountCode: '1010', fund: 'PI', debit: 100, credit: 0 },
            { accountCode: '3010', fund: 'PI', debit: 0,   credit: 100 },
          ],
        },
        ACTOR_ID,
      );
      createdIds.push(entryId);

      const { rows } = await pool.query(
        'SELECT status FROM public.journal_entries WHERE id = $1',
        [entryId],
      );
      expect(rows[0].status).toBe('PENDING_APPROVAL');
    });

    // ── Gate test 6: reversal → PENDING_APPROVAL ───────────────────────────
    // isReversal=true (engine-set flag); amount and accounts are routine.
    it('routes a reversal (isReversal=true) to PENDING_APPROVAL regardless of amount', async () => {
      const entryId = await service.postTransaction(
        {
          entityId: jalEntityId,
          entryDate: '2026-06-18',
          description: '[T5-TEST] Gate reversal',
          lines: [
            { accountCode: '1010', fund: 'PI',  debit: 100, credit: 0 },
            { accountCode: '2010', fund: 'RDF', debit: 0,   credit: 100 },
          ],
        },
        ACTOR_ID,
        true, // isReversal — engine-set, not user input
      );
      createdIds.push(entryId);

      const { rows } = await pool.query(
        'SELECT status FROM public.journal_entries WHERE id = $1',
        [entryId],
      );
      expect(rows[0].status).toBe('PENDING_APPROVAL');
    });

    // ── Gate test 7: data-driven threshold ─────────────────────────────────
    // Change the setting to Tk 200, post Tk 250 (below original Tk 50,000 but
    // above new threshold), confirm routing follows the live setting value.
    it('reads threshold live from settings: changing the setting changes routing', async () => {
      await pool.query(
        "UPDATE public.settings SET value = '200'::jsonb WHERE key = 'high_value_approval_threshold'",
      );
      try {
        // Tk 250 = 25,000 paisa > 20,000 paisa (new threshold of Tk 200)
        const entryId = await service.postTransaction(
          {
            entityId: jalEntityId,
            entryDate: '2026-06-18',
            description: '[T5-TEST] Gate data-driven threshold',
            lines: [
              { accountCode: '1010', fund: 'PI',  debit: 250, credit: 0 },
              { accountCode: '2010', fund: 'RDF', debit: 0,   credit: 250 },
            ],
          },
          ACTOR_ID,
        );
        createdIds.push(entryId);

        const { rows } = await pool.query(
          'SELECT status FROM public.journal_entries WHERE id = $1',
          [entryId],
        );
        expect(rows[0].status).toBe('PENDING_APPROVAL');
      } finally {
        // Restore original threshold — always, even on assertion failure
        await pool.query(
          "UPDATE public.settings SET value = '50000'::jsonb WHERE key = 'high_value_approval_threshold'",
        );
      }
    });

  }); // end describe('approval gate (P1-T5b)')

  // ═══════════════════════════════════════════════════════════════════════════
  // P1-T5c — reverseEntry
  // Cleanup order is load-bearing: reversal row has reverses_entry_id FK (ON DELETE
  // RESTRICT) pointing to the original. Reversal must be cleaned up first, then
  // the original flipped POSTED→REVERSED (immutability trigger requires this) then
  // deleted. Pattern: createdIds.push(reversalId, originalId) — afterEach iterates
  // in push order and handles the POSTED→REVERSED flip for each POSTED entry.
  // ═══════════════════════════════════════════════════════════════════════════
  describe('reverseEntry (P1-T5c)', () => {

    // ── T5c-1: basic reversal creates correct PENDING_APPROVAL entry ────────
    it('creates a PENDING_APPROVAL reversing entry with swapped lines, reverses_entry_id, and same entity/accounts/funds', async () => {
      const originalId = await service.postTransaction(
        {
          entityId: jalEntityId,
          entryDate: '2026-06-18',
          description: '[T5-TEST] Rev T5c-1 original',
          lines: [
            { accountCode: '1010', fund: 'PI',  debit: 1000, credit: 0 },
            { accountCode: '2010', fund: 'RDF', debit: 0,    credit: 1000 },
          ],
        },
        ACTOR_ID,
      );

      const reversalId = await service.reverseEntry(originalId, ACTOR_ID);

      // Reversal first → removes FK reference; original second → afterEach flips POSTED→REVERSED
      createdIds.push(reversalId, originalId);

      // Header assertions
      const { rows: [rev] } = await pool.query(
        'SELECT entity_id, status, reverses_entry_id FROM public.journal_entries WHERE id = $1',
        [reversalId],
      );
      expect(rev.status).toBe('PENDING_APPROVAL');
      expect(rev.reverses_entry_id).toBe(originalId);
      expect(rev.entity_id).toBe(jalEntityId);

      // Line swap assertions — sort by account_code for stable correlation
      const { rows: origLines } = await pool.query(
        'SELECT account_code, fund, debit, credit FROM public.journal_lines WHERE entry_id = $1 ORDER BY account_code',
        [originalId],
      );
      const { rows: revLines } = await pool.query(
        'SELECT account_code, fund, debit, credit FROM public.journal_lines WHERE entry_id = $1 ORDER BY account_code',
        [reversalId],
      );
      expect(revLines).toHaveLength(origLines.length);
      for (let i = 0; i < origLines.length; i++) {
        expect(revLines[i].account_code).toBe(origLines[i].account_code);
        expect(revLines[i].fund).toBe(origLines[i].fund);
        expect(revLines[i].debit).toBe(origLines[i].credit);   // swapped
        expect(revLines[i].credit).toBe(origLines[i].debit);   // swapped
      }
    });

    // ── T5c-2: original stays POSTED — reverseEntry does not flip it ────────
    it('leaves the original entry POSTED after reverseEntry (flip belongs to T5d)', async () => {
      const originalId = await service.postTransaction(
        {
          entityId: jalEntityId,
          entryDate: '2026-06-18',
          description: '[T5-TEST] Rev T5c-2 original',
          lines: [
            { accountCode: '1010', fund: 'PI',  debit: 500, credit: 0 },
            { accountCode: '2010', fund: 'RDF', debit: 0,   credit: 500 },
          ],
        },
        ACTOR_ID,
      );

      const reversalId = await service.reverseEntry(originalId, ACTOR_ID);
      createdIds.push(reversalId, originalId);

      const { rows: [orig] } = await pool.query(
        'SELECT status FROM public.journal_entries WHERE id = $1',
        [originalId],
      );
      expect(orig.status).toBe('POSTED');
    });

    // ── T5c-3: DRAFT entry → rejected ──────────────────────────────────────
    // DRAFT entry inserted directly (postTransaction always creates POSTED/PA).
    it('rejects reversal of a DRAFT entry with a clear error mentioning DRAFT', async () => {
      const { rows: [{ id: draftId }] } = await pool.query(
        `INSERT INTO public.journal_entries
           (entity_id, entry_date, description, status, source_module, created_by)
         VALUES ($1, '2026-06-18', '[T5-TEST] Rev T5c-3 draft', 'DRAFT', 'MANUAL', $2)
         RETURNING id`,
        [jalEntityId, ACTOR_ID],
      );
      createdIds.push(draftId);

      await expect(service.reverseEntry(draftId, ACTOR_ID)).rejects.toThrow(/DRAFT/);
    });

    // ── T5c-4: PENDING_APPROVAL entry → rejected ────────────────────────────
    it('rejects reversal of a PENDING_APPROVAL entry with a clear error mentioning PENDING_APPROVAL', async () => {
      // Flagged account routes the entry to PENDING_APPROVAL
      const paId = await service.postTransaction(
        {
          entityId: jalEntityId,
          entryDate: '2026-06-18',
          description: '[T5-TEST] Rev T5c-4 PA entry',
          lines: [
            { accountCode: '1010', fund: 'PI', debit: 100, credit: 0 },
            { accountCode: '3010', fund: 'PI', debit: 0,   credit: 100 },
          ],
        },
        ACTOR_ID,
      );
      createdIds.push(paId);

      await expect(service.reverseEntry(paId, ACTOR_ID)).rejects.toThrow(/PENDING_APPROVAL/);
    });

    // ── T5c-5: REVERSED entry → rejected ───────────────────────────────────
    // UPDATE POSTED→REVERSED directly (immutability trigger allows status-only change).
    it('rejects reversal of a REVERSED entry with a clear error mentioning REVERSED', async () => {
      const originalId = await service.postTransaction(
        {
          entityId: jalEntityId,
          entryDate: '2026-06-18',
          description: '[T5-TEST] Rev T5c-5 to-reverse',
          lines: [
            { accountCode: '1010', fund: 'PI',  debit: 200, credit: 0 },
            { accountCode: '2010', fund: 'RDF', debit: 0,   credit: 200 },
          ],
        },
        ACTOR_ID,
      );
      // Flip to REVERSED (simulates post-approval state; trigger allows POSTED→REVERSED)
      await pool.query(
        "UPDATE public.journal_entries SET status = 'REVERSED' WHERE id = $1 AND status = 'POSTED'",
        [originalId],
      );
      createdIds.push(originalId); // already REVERSED, afterEach UPDATE does nothing, DELETE works

      await expect(service.reverseEntry(originalId, ACTOR_ID)).rejects.toThrow(/REVERSED/);
    });

    // ── T5c-6: double-reversal blocked ─────────────────────────────────────
    // First call succeeds; second call on the same POSTED entry is rejected because
    // the guard sees the existing reversal (original is still POSTED between T5c and T5d).
    it('rejects a second reverseEntry call on the same entry (double-reversal guard)', async () => {
      const originalId = await service.postTransaction(
        {
          entityId: jalEntityId,
          entryDate: '2026-06-18',
          description: '[T5-TEST] Rev T5c-6 double',
          lines: [
            { accountCode: '1010', fund: 'PI',  debit: 300, credit: 0 },
            { accountCode: '2010', fund: 'RDF', debit: 0,   credit: 300 },
          ],
        },
        ACTOR_ID,
      );

      const reversalId = await service.reverseEntry(originalId, ACTOR_ID);
      createdIds.push(reversalId, originalId);

      await expect(service.reverseEntry(originalId, ACTOR_ID))
        .rejects.toThrow(/already has a reversing entry/);
    });

    // ── T5c-7: actor stamped on header and all lines ────────────────────────
    it('stamps the actorId as created_by on the reversal header and every line', async () => {
      const originalId = await service.postTransaction(
        {
          entityId: jalEntityId,
          entryDate: '2026-06-18',
          description: '[T5-TEST] Rev T5c-7 actor',
          lines: [
            { accountCode: '1010', fund: 'PI',  debit: 400, credit: 0 },
            { accountCode: '2010', fund: 'RDF', debit: 0,   credit: 400 },
          ],
        },
        ACTOR_ID,
      );

      const reversalId = await service.reverseEntry(originalId, ACTOR_ID);
      createdIds.push(reversalId, originalId);

      const { rows: [header] } = await pool.query(
        'SELECT created_by FROM public.journal_entries WHERE id = $1',
        [reversalId],
      );
      expect(header.created_by).toBe(ACTOR_ID);

      const { rows: lines } = await pool.query(
        'SELECT created_by FROM public.journal_lines WHERE entry_id = $1',
        [reversalId],
      );
      expect(lines.length).toBeGreaterThan(0);
      lines.forEach((l) => expect(l.created_by).toBe(ACTOR_ID));
    });

  }); // end describe('reverseEntry (P1-T5c)')

  // ═══════════════════════════════════════════════════════════════════════════
  // P1-T5d — promoteEntry
  // One transaction covers all guards + both status flips.
  // Approver users are inserted in beforeAll (app_users has no require_actor trigger)
  // and removed in afterAll. ACTOR_ID is inserted as ADMIN so test 4 (self-approval)
  // can prove Guard C fires, not Guard B — the approver is a valid ADMIN.
  // Cleanup: entries approved to POSTED need the two-step afterEach flip;
  // entries in failed promote attempts stay PA and delete directly.
  // Reversal-related cleanup: push reversalId before originalId (FK constraint).
  // ═══════════════════════════════════════════════════════════════════════════
  describe('promoteEntry (P1-T5d)', () => {
    const ADMIN_APPROVER_ID = '22222222-2222-2222-2222-222222222222';
    const HQ_FINANCE_ID     = '33333333-3333-3333-3333-333333333333';
    const ENTRY_USER_ID     = '44444444-4444-4444-4444-444444444444';

    // Shortcut: a PA entry via the flagged-account route (Tk 100, well below threshold)
    async function makePaEntry(desc: string): Promise<string> {
      return service.postTransaction(
        {
          entityId: jalEntityId,
          entryDate: '2026-06-18',
          description: desc,
          lines: [
            { accountCode: '1010', fund: 'PI', debit: 100, credit: 0 },
            { accountCode: '3010', fund: 'PI', debit: 0,   credit: 100 },
          ],
        },
        ACTOR_ID,
      );
    }

    beforeAll(async () => {
      // ON CONFLICT DO UPDATE (not DO NOTHING): psql test suite (0001_dimension_schema_test.sql)
      // leaves app_users rows for these same UUIDs with different roles. DO UPDATE ensures
      // the role and entity_id are correct for T5d regardless of prior DB state.
      // ADMIN/HQ_FINANCE: entity_id must be NULL (app_users entry_user_has_entity CHECK)
      // ENTRY: entity_id must NOT be null (same constraint)
      await pool.query(
        "INSERT INTO public.app_users (id, full_name, role, entity_id, active) VALUES ($1, 'ACTOR as ADMIN', 'ADMIN', NULL, true) ON CONFLICT (id) DO UPDATE SET role = 'ADMIN', entity_id = NULL, active = true",
        [ACTOR_ID],
      );
      await pool.query(
        "INSERT INTO public.app_users (id, full_name, role, entity_id, active) VALUES ($1, 'Test ADMIN Approver', 'ADMIN', NULL, true) ON CONFLICT (id) DO UPDATE SET role = 'ADMIN', entity_id = NULL, active = true",
        [ADMIN_APPROVER_ID],
      );
      await pool.query(
        "INSERT INTO public.app_users (id, full_name, role, entity_id, active) VALUES ($1, 'Test HQ Finance', 'HQ_FINANCE', NULL, true) ON CONFLICT (id) DO UPDATE SET role = 'HQ_FINANCE', entity_id = NULL, active = true",
        [HQ_FINANCE_ID],
      );
      await pool.query(
        "INSERT INTO public.app_users (id, full_name, role, entity_id, active) VALUES ($1, 'Test Entry User', 'ENTRY', $2, true) ON CONFLICT (id) DO UPDATE SET role = 'ENTRY', entity_id = $2, active = true",
        [ENTRY_USER_ID, jalEntityId],
      );
    });

    afterAll(async () => {
      await pool.query(
        'DELETE FROM public.app_users WHERE id = ANY($1)',
        [[ACTOR_ID, ADMIN_APPROVER_ID, HQ_FINANCE_ID, ENTRY_USER_ID]],
      );
    });

    // ── T5d-1: ADMIN can approve → POSTED ──────────────────────────────────
    it('ADMIN approves a PENDING_APPROVAL entry → status becomes POSTED', async () => {
      const paId = await makePaEntry('[T5-TEST] Promote T5d-1 ADMIN');
      await service.promoteEntry(paId, ADMIN_APPROVER_ID);
      createdIds.push(paId); // now POSTED → afterEach flips POSTED→REVERSED then deletes

      const { rows: [row] } = await pool.query(
        'SELECT status FROM public.journal_entries WHERE id = $1', [paId],
      );
      expect(row.status).toBe('POSTED');
    });

    // ── T5d-2: HQ_FINANCE can also approve → POSTED ─────────────────────────
    it('HQ_FINANCE approves a PENDING_APPROVAL entry → status becomes POSTED', async () => {
      const paId = await makePaEntry('[T5-TEST] Promote T5d-2 HQ_FINANCE');
      await service.promoteEntry(paId, HQ_FINANCE_ID);
      createdIds.push(paId);

      const { rows: [row] } = await pool.query(
        'SELECT status FROM public.journal_entries WHERE id = $1', [paId],
      );
      expect(row.status).toBe('POSTED');
    });

    // ── T5d-3: ENTRY role cannot approve ────────────────────────────────────
    it('rejects approval by an ENTRY user (Guard B — role check): "not authorised"', async () => {
      const paId = await makePaEntry('[T5-TEST] Promote T5d-3 ENTRY');
      createdIds.push(paId); // stays PA → afterEach UPDATE does nothing → DELETE direct

      await expect(service.promoteEntry(paId, ENTRY_USER_ID))
        .rejects.toThrow(/not authorised/);
    });

    // ── T5d-4: self-approval blocked — proves Guard C, not Guard B ──────────
    // ACTOR_ID is ADMIN (passes Guard B). Guard C must fire with the
    // separation-of-duties message — the test asserts that specific message to
    // confirm the path taken, not just that something threw.
    it('rejects self-approval with the separation-of-duties message (Guard C fires, not Guard B)', async () => {
      const paId = await makePaEntry('[T5-TEST] Promote T5d-4 self-approval');
      createdIds.push(paId);

      await expect(service.promoteEntry(paId, ACTOR_ID))
        .rejects.toThrow(/separation of duties/);
    });

    // ── T5d-5: approving a reversal flips BOTH entries in one call ──────────
    it('approving a reversal: reversal→POSTED and original→REVERSED atomically', async () => {
      const originalId = await service.postTransaction(
        {
          entityId: jalEntityId,
          entryDate: '2026-06-18',
          description: '[T5-TEST] Promote T5d-5 original',
          lines: [
            { accountCode: '1010', fund: 'PI',  debit: 100, credit: 0 },
            { accountCode: '2010', fund: 'RDF', debit: 0,   credit: 100 },
          ],
        },
        ACTOR_ID,
      );
      const reversalId = await service.reverseEntry(originalId, ACTOR_ID);
      await service.promoteEntry(reversalId, ADMIN_APPROVER_ID);

      // Reversal first (FK): reversalId POSTED→REVERSED→DELETE; originalId REVERSED→DELETE
      createdIds.push(reversalId, originalId);

      const { rows: [rev] } = await pool.query(
        'SELECT status FROM public.journal_entries WHERE id = $1', [reversalId],
      );
      const { rows: [orig] } = await pool.query(
        'SELECT status FROM public.journal_entries WHERE id = $1', [originalId],
      );
      expect(rev.status).toBe('POSTED');
      expect(orig.status).toBe('REVERSED');
    });

    // ── T5d-6: atomicity — original not POSTED → whole promote rolls back ───
    it('rolls back entirely when the original is not POSTED; reversal remains PENDING_APPROVAL', async () => {
      const originalId = await service.postTransaction(
        {
          entityId: jalEntityId,
          entryDate: '2026-06-18',
          description: '[T5-TEST] Promote T5d-6 original',
          lines: [
            { accountCode: '1010', fund: 'PI',  debit: 100, credit: 0 },
            { accountCode: '2010', fund: 'RDF', debit: 0,   credit: 100 },
          ],
        },
        ACTOR_ID,
      );
      const reversalId = await service.reverseEntry(originalId, ACTOR_ID);

      // Simulate original having been reversed by another path
      await pool.query(
        "UPDATE public.journal_entries SET status = 'REVERSED' WHERE id = $1 AND status = 'POSTED'",
        [originalId],
      );

      // Reversal first: reversalId (PA→DELETE direct); originalId (REVERSED→DELETE direct)
      createdIds.push(reversalId, originalId);

      await expect(service.promoteEntry(reversalId, ADMIN_APPROVER_ID))
        .rejects.toThrow(/original entry.*not POSTED/);

      const { rows: [rev] } = await pool.query(
        'SELECT status FROM public.journal_entries WHERE id = $1', [reversalId],
      );
      expect(rev.status).toBe('PENDING_APPROVAL');
    });

    // ── T5d-7a: already-POSTED entry rejected ───────────────────────────────
    it('rejects promoteEntry on an already-POSTED entry (only PENDING_APPROVAL can be approved)', async () => {
      const postedId = await service.postTransaction(
        {
          entityId: jalEntityId,
          entryDate: '2026-06-18',
          description: '[T5-TEST] Promote T5d-7a already-POSTED',
          lines: [
            { accountCode: '1010', fund: 'PI',  debit: 100, credit: 0 },
            { accountCode: '2010', fund: 'RDF', debit: 0,   credit: 100 },
          ],
        },
        ACTOR_ID,
      );
      createdIds.push(postedId); // POSTED → afterEach flips→deletes

      await expect(service.promoteEntry(postedId, ADMIN_APPROVER_ID))
        .rejects.toThrow(/only PENDING_APPROVAL/);
    });

    // ── T5d-7b: DRAFT entry rejected ────────────────────────────────────────
    it('rejects promoteEntry on a DRAFT entry (only PENDING_APPROVAL can be approved)', async () => {
      const { rows: [{ id: draftId }] } = await pool.query(
        `INSERT INTO public.journal_entries
           (entity_id, entry_date, description, status, source_module, created_by)
         VALUES ($1, '2026-06-18', '[T5-TEST] Promote T5d-7b DRAFT', 'DRAFT', 'MANUAL', $2)
         RETURNING id`,
        [jalEntityId, ACTOR_ID],
      );
      createdIds.push(draftId); // DRAFT → afterEach UPDATE does nothing → DELETE direct

      await expect(service.promoteEntry(draftId, ADMIN_APPROVER_ID))
        .rejects.toThrow(/only PENDING_APPROVAL/);
    });

    // ── T5d-7c: REVERSED entry rejected ─────────────────────────────────────
    it('rejects promoteEntry on a REVERSED entry (only PENDING_APPROVAL can be approved)', async () => {
      const id = await service.postTransaction(
        {
          entityId: jalEntityId,
          entryDate: '2026-06-18',
          description: '[T5-TEST] Promote T5d-7c REVERSED',
          lines: [
            { accountCode: '1010', fund: 'PI',  debit: 100, credit: 0 },
            { accountCode: '2010', fund: 'RDF', debit: 0,   credit: 100 },
          ],
        },
        ACTOR_ID,
      );
      await pool.query(
        "UPDATE public.journal_entries SET status = 'REVERSED' WHERE id = $1 AND status = 'POSTED'",
        [id],
      );
      createdIds.push(id); // REVERSED → afterEach UPDATE does nothing → DELETE direct

      await expect(service.promoteEntry(id, ADMIN_APPROVER_ID))
        .rejects.toThrow(/only PENDING_APPROVAL/);
    });

    // ── T5d-8: updated_by stamped as approverId (attribution of approval) ───
    it('stamps updated_by = approverId on the approved entry', async () => {
      const paId = await makePaEntry('[T5-TEST] Promote T5d-8 updated_by');
      await service.promoteEntry(paId, ADMIN_APPROVER_ID);
      createdIds.push(paId);

      const { rows: [row] } = await pool.query(
        'SELECT updated_by FROM public.journal_entries WHERE id = $1', [paId],
      );
      expect(row.updated_by).toBe(ADMIN_APPROVER_ID);
    });

    // ── T5d-9: entry not found → clear error ────────────────────────────────
    it('rejects promoteEntry with a clear "not found" error for a non-existent entry', async () => {
      await expect(
        service.promoteEntry('00000000-0000-0000-0000-000000000099', ADMIN_APPROVER_ID),
      ).rejects.toThrow(/not found/);
    });

  }); // end describe('promoteEntry (P1-T5d)')

  // ═══════════════════════════════════════════════════════════════════════════
  // P1-T5e — rejectEntry
  // Same three guards as promoteEntry but flips to REJECTED (not POSTED).
  // REJECTED is terminal (0008 trigger blocks further UPDATE/DELETE), so test
  // cleanup requires trigger-disable for any REJECTED entry — handled in this
  // describe's afterAll, which runs before the outer afterAll. This guarantees
  // the outer afterAll's broad DELETE WHERE description LIKE '[T5-TEST]%' never
  // encounters a REJECTED row (which would abort the whole DELETE statement).
  //
  // Tracking arrays (local to this describe):
  //   t5eRejectedIds — entries that ended in REJECTED status
  //   t5eOriginalIds — POSTED originals paired with a REJECTED reversal;
  //                    cleaned after their REJECTED reversal is removed (FK RESTRICT)
  //
  // Approver users: T5d afterAll removed them; re-inserted with ON CONFLICT DO NOTHING.
  // ═══════════════════════════════════════════════════════════════════════════
  describe('rejectEntry (P1-T5e)', () => {
    const ADMIN_APPROVER_ID = '22222222-2222-2222-2222-222222222222';
    const HQ_FINANCE_ID     = '33333333-3333-3333-3333-333333333333';
    const ENTRY_USER_ID     = '44444444-4444-4444-4444-444444444444';

    const t5eRejectedIds: string[] = [];
    const t5eOriginalIds: string[] = [];

    async function makePaEntry(desc: string): Promise<string> {
      return service.postTransaction(
        {
          entityId: jalEntityId,
          entryDate: '2026-06-18',
          description: desc,
          lines: [
            { accountCode: '1010', fund: 'PI', debit: 100, credit: 0 },
            { accountCode: '3010', fund: 'PI', debit: 0,   credit: 100 },
          ],
        },
        ACTOR_ID,
      );
    }

    beforeAll(async () => {
      // T5d afterAll removed these users; re-insert with DO UPDATE so the role is
      // correct even if T5d afterAll didn't run (e.g. mid-beforeAll failure on a prior run).
      await pool.query(
        "INSERT INTO public.app_users (id, full_name, role, entity_id, active) VALUES ($1, 'ACTOR as ADMIN', 'ADMIN', NULL, true) ON CONFLICT (id) DO UPDATE SET role = 'ADMIN', entity_id = NULL, active = true",
        [ACTOR_ID],
      );
      await pool.query(
        "INSERT INTO public.app_users (id, full_name, role, entity_id, active) VALUES ($1, 'Test ADMIN Approver', 'ADMIN', NULL, true) ON CONFLICT (id) DO UPDATE SET role = 'ADMIN', entity_id = NULL, active = true",
        [ADMIN_APPROVER_ID],
      );
      await pool.query(
        "INSERT INTO public.app_users (id, full_name, role, entity_id, active) VALUES ($1, 'Test HQ Finance', 'HQ_FINANCE', NULL, true) ON CONFLICT (id) DO UPDATE SET role = 'HQ_FINANCE', entity_id = NULL, active = true",
        [HQ_FINANCE_ID],
      );
      await pool.query(
        "INSERT INTO public.app_users (id, full_name, role, entity_id, active) VALUES ($1, 'Test Entry User', 'ENTRY', $2, true) ON CONFLICT (id) DO UPDATE SET role = 'ENTRY', entity_id = $2, active = true",
        [ENTRY_USER_ID, jalEntityId],
      );
    });

    afterAll(async () => {
      // REJECTED entries cannot be DELETEd through the normal afterEach path:
      // the 0008 trigger raises on any DELETE of a REJECTED row. Disable both
      // immutability triggers, purge the entries (cascades to lines), then
      // re-enable. Must finish before the outer afterAll runs.
      if (t5eRejectedIds.length > 0) {
        await pool.query('ALTER TABLE public.journal_entries DISABLE TRIGGER trg_journal_entries_immutable');
        await pool.query('ALTER TABLE public.journal_lines   DISABLE TRIGGER trg_journal_lines_immutable');
        await pool.query(
          'DELETE FROM public.journal_entries WHERE id = ANY($1)',
          [t5eRejectedIds],
        );
        await pool.query('ALTER TABLE public.journal_lines   ENABLE TRIGGER trg_journal_lines_immutable');
        await pool.query('ALTER TABLE public.journal_entries ENABLE TRIGGER trg_journal_entries_immutable');
      }
      // POSTED originals paired with now-gone REJECTED reversals: FK RESTRICT is
      // lifted; use the normal two-step flip then delete.
      for (const id of t5eOriginalIds) {
        await pool.query(
          "UPDATE public.journal_entries SET status = 'REVERSED' WHERE id = $1 AND status = 'POSTED'",
          [id],
        );
        await pool.query('DELETE FROM public.journal_entries WHERE id = $1', [id]);
      }
      await pool.query(
        'DELETE FROM public.app_users WHERE id = ANY($1)',
        [[ACTOR_ID, ADMIN_APPROVER_ID, HQ_FINANCE_ID, ENTRY_USER_ID]],
      );
    });

    // ── T5e-1: ADMIN rejects PA entry ───────────────────────────────────────
    it('ADMIN rejects a PENDING_APPROVAL entry → status REJECTED, reason stored, updated_by = approver', async () => {
      const paId = await makePaEntry('[T5-TEST] Reject T5e-1 ADMIN');
      const returned = await service.rejectEntry(paId, ADMIN_APPROVER_ID, 'duplicate expense claim');
      t5eRejectedIds.push(paId);

      expect(returned).toBe(paId);

      const { rows: [row] } = await pool.query(
        'SELECT status, rejection_reason, updated_by FROM public.journal_entries WHERE id = $1',
        [paId],
      );
      expect(row.status).toBe('REJECTED');
      expect(row.rejection_reason).toBe('duplicate expense claim');
      expect(row.updated_by).toBe(ADMIN_APPROVER_ID);
    });

    // ── T5e-2: reject with no reason → rejection_reason null ────────────────
    it('rejects with no reason provided → status REJECTED, rejection_reason null (reason is optional)', async () => {
      const paId = await makePaEntry('[T5-TEST] Reject T5e-2 no reason');
      await service.rejectEntry(paId, ADMIN_APPROVER_ID); // reason omitted
      t5eRejectedIds.push(paId);

      const { rows: [row] } = await pool.query(
        'SELECT status, rejection_reason FROM public.journal_entries WHERE id = $1',
        [paId],
      );
      expect(row.status).toBe('REJECTED');
      expect(row.rejection_reason).toBeNull();
    });

    // ── T5e-3: ENTRY user cannot reject (Guard B) ───────────────────────────
    it('rejects rejection by an ENTRY user (Guard B — role check): "not authorised"', async () => {
      const paId = await makePaEntry('[T5-TEST] Reject T5e-3 ENTRY');
      createdIds.push(paId); // rejectEntry fails → stays PA → afterEach deletes directly

      await expect(service.rejectEntry(paId, ENTRY_USER_ID))
        .rejects.toThrow(/not authorised/);
    });

    // ── T5e-4: self-rejection blocked — proves Guard C, not Guard B ──────────
    // ACTOR_ID is ADMIN (passes Guard B). Must fail with separation-of-duties,
    // not with the role-ineligibility message.
    it('rejects self-rejection with the separation-of-duties message (Guard C fires, not Guard B)', async () => {
      const paId = await makePaEntry('[T5-TEST] Reject T5e-4 self-reject');
      createdIds.push(paId);

      await expect(service.rejectEntry(paId, ACTOR_ID))
        .rejects.toThrow(/separation of duties/);
    });

    // ── T5e-5a: already-POSTED → "only PENDING_APPROVAL" ───────────────────
    it('rejects rejectEntry on a POSTED entry (only PENDING_APPROVAL can be rejected)', async () => {
      const postedId = await service.postTransaction(
        {
          entityId: jalEntityId,
          entryDate: '2026-06-18',
          description: '[T5-TEST] Reject T5e-5a POSTED',
          lines: [
            { accountCode: '1010', fund: 'PI',  debit: 100, credit: 0 },
            { accountCode: '2010', fund: 'RDF', debit: 0,   credit: 100 },
          ],
        },
        ACTOR_ID,
      );
      createdIds.push(postedId); // POSTED → afterEach two-step flip+delete

      await expect(service.rejectEntry(postedId, ADMIN_APPROVER_ID))
        .rejects.toThrow(/only PENDING_APPROVAL/);
    });

    // ── T5e-5b: DRAFT → "only PENDING_APPROVAL" ─────────────────────────────
    it('rejects rejectEntry on a DRAFT entry (only PENDING_APPROVAL can be rejected)', async () => {
      const { rows: [{ id: draftId }] } = await pool.query(
        `INSERT INTO public.journal_entries
           (entity_id, entry_date, description, status, source_module, created_by)
         VALUES ($1, '2026-06-18', '[T5-TEST] Reject T5e-5b DRAFT', 'DRAFT', 'MANUAL', $2)
         RETURNING id`,
        [jalEntityId, ACTOR_ID],
      );
      createdIds.push(draftId); // DRAFT → afterEach UPDATE does nothing → DELETE direct

      await expect(service.rejectEntry(draftId, ADMIN_APPROVER_ID))
        .rejects.toThrow(/only PENDING_APPROVAL/);
    });

    // ── T5e-5c: REVERSED → "only PENDING_APPROVAL" ──────────────────────────
    it('rejects rejectEntry on a REVERSED entry (only PENDING_APPROVAL can be rejected)', async () => {
      const id = await service.postTransaction(
        {
          entityId: jalEntityId,
          entryDate: '2026-06-18',
          description: '[T5-TEST] Reject T5e-5c REVERSED',
          lines: [
            { accountCode: '1010', fund: 'PI',  debit: 100, credit: 0 },
            { accountCode: '2010', fund: 'RDF', debit: 0,   credit: 100 },
          ],
        },
        ACTOR_ID,
      );
      await pool.query(
        "UPDATE public.journal_entries SET status = 'REVERSED' WHERE id = $1 AND status = 'POSTED'",
        [id],
      );
      createdIds.push(id); // REVERSED → afterEach UPDATE does nothing → DELETE direct

      await expect(service.rejectEntry(id, ADMIN_APPROVER_ID))
        .rejects.toThrow(/only PENDING_APPROVAL/);
    });

    // ── T5e-5d: already-REJECTED → "only PENDING_APPROVAL" ──────────────────
    // First rejectEntry call succeeds; second call fails on Guard A (status=REJECTED).
    it('rejects rejectEntry on an already-REJECTED entry (only PENDING_APPROVAL can be rejected)', async () => {
      const paId = await makePaEntry('[T5-TEST] Reject T5e-5d already-REJECTED');
      await service.rejectEntry(paId, ADMIN_APPROVER_ID, 'first rejection');
      t5eRejectedIds.push(paId); // now REJECTED — trigger-disable cleanup in afterAll

      await expect(service.rejectEntry(paId, ADMIN_APPROVER_ID))
        .rejects.toThrow(/only PENDING_APPROVAL/);
    });

    // ── T5e-6: rejecting a reversal — original stays POSTED ─────────────────
    // Contrast with promoteEntry (T5d-5) which flips the original to REVERSED.
    // A rejected reversal = "we decided not to reverse"; the original stays live.
    it('rejecting a REVERSAL: reversal → REJECTED, original stays POSTED and is untouched', async () => {
      const originalId = await service.postTransaction(
        {
          entityId: jalEntityId,
          entryDate: '2026-06-18',
          description: '[T5-TEST] Reject T5e-6 original',
          lines: [
            { accountCode: '1010', fund: 'PI',  debit: 100, credit: 0 },
            { accountCode: '2010', fund: 'RDF', debit: 0,   credit: 100 },
          ],
        },
        ACTOR_ID,
      );
      const reversalId = await service.reverseEntry(originalId, ACTOR_ID);

      await service.rejectEntry(reversalId, ADMIN_APPROVER_ID, 'decided to keep the original');
      // reversalId is REJECTED — trigger-disable cleanup in afterAll
      // originalId is POSTED  — cleaned in afterAll after reversal is removed (FK RESTRICT)
      t5eRejectedIds.push(reversalId);
      t5eOriginalIds.push(originalId);

      const { rows: [rev] } = await pool.query(
        'SELECT status FROM public.journal_entries WHERE id = $1', [reversalId],
      );
      const { rows: [orig] } = await pool.query(
        'SELECT status FROM public.journal_entries WHERE id = $1', [originalId],
      );
      expect(rev.status).toBe('REJECTED');
      expect(orig.status).toBe('POSTED');
    });

  }); // end describe('rejectEntry (P1-T5e)')
});
