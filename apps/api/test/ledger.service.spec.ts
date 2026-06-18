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
});
