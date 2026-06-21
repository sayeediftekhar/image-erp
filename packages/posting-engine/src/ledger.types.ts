import { z } from 'zod';

const UuidSchema = z.string().uuid();
const FundEnum = z.enum(['PI', 'RDF', 'HQ', 'TB_CARE']);

const LineSchema = z
  .object({
    accountCode: z.string().min(3).max(12),
    fund: FundEnum,
    debit: z.number().nonnegative(),
    credit: z.number().nonnegative(),
    partyId: UuidSchema.optional(),
  })
  .refine((l) => (l.debit > 0) !== (l.credit > 0), {
    message:
      'each line must have exactly one of debit or credit > 0 (not both, not neither)',
  });

export const PostTransactionSchema = z.object({
  entityId: UuidSchema,
  entryDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'entryDate must be YYYY-MM-DD')
    .refine((s) => {
      const [yr, mo, dy] = s.split('-').map(Number);
      const d = new Date(Date.UTC(yr, mo - 1, dy));
      return (
        d.getUTCFullYear() === yr &&
        d.getUTCMonth() === mo - 1 &&
        d.getUTCDate() === dy
      );
    }, 'entryDate is not a valid calendar date'),
  description: z.string().min(1),
  ref: z.string().optional(),
  sourceModule: z.string().default('MANUAL'),
  sourceId: UuidSchema.optional(),
  lines: z.array(LineSchema).min(2),
});

export type PostTransactionInput = z.infer<typeof PostTransactionSchema>;
export type JournalStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'POSTED' | 'REVERSED';
