# Task Spec — P1-T6b: Ledger index set (migration 0007)

**Mode for Claude Code: PLAN ONLY first. Write no code until Sayeed approves the plan.**

## Problem (one sentence)

The ledger tables need indexes on the columns reports and analytics filter by, added
now before transaction volume builds (cheap now; the queries stay fast as data grows).

## Output contract

One migration `supabase/migrations/0007_ledger_indexes.sql` — `CREATE INDEX` only,
no schema or data changes. Use `if not exists` on each so the migration is re-runnable.

Indexes to create:

**journal_entries**

- `(entity_id)` — filter by clinic
- `(entry_date)` — filter by period (the common analytics axis)
- `(status)` — exclude DRAFT / REVERSED in reports
- `(entity_id, entry_date)` — composite; "this clinic, this period" jumps straight to the rows
- `(reverses_entry_id)` — find an entry's reversal / walk the reversal chain
- `(source_module, source_id)` — trace a GL entry back to its originating module doc

**journal_lines**

- `(entry_id)` — the header→lines join (every report uses it)
- `(account_code)` — filter/group by account
- `(fund)` — filter/group by fund
- `(party_id)` — vendor / debtor / instrument drill-down

Naming: clear and conventional, e.g. `idx_journal_entries_entity_date`,
`idx_journal_lines_account_code`.

## Relevant files (read before write)

- `supabase/migrations/0004_ledger_core.sql` (the columns being indexed)
- `CONTEXT.md`

## Iron Laws in play

- None directly. This is performance structure. It changes no data, no access, no balance
  logic — indexes only affect query speed, never query results.

## Applicable LEARNINGS

- Indexes are the 90% speed answer at IMAGE's scale; data volume itself is never the
  bottleneck, missing indexes are.

## Done-criteria (the test `0007_ledger_indexes_test.sql` must prove)

1. Each expected index exists — query `pg_indexes` and assert all 10 index names are present
   on the two tables.
2. Idempotency: the migration runs twice with no error (`create index if not exists`).
3. Full regression: 0001–0006 test suites still green (indexes change nothing functional).

## On completion

End with exactly one status. Bring diff + status back to the Architect.
Next: T5 (posting engine — first NestJS code, built against the seeded chart).
