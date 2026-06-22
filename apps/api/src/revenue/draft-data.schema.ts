import { z } from 'zod';

// ── Sub-schemas ───────────────────────────────────────────────────────────────

const UsgEntrySchema = z.object({
  type:    z.enum(['LOWER', 'WHOLE', 'PP', 'ANOMALY']),
  count:   z.number().int().min(0),
  revenue: z.number().min(0),
});

// MORNING + EVENING sessions have identical shape (patients split new/old, lab, USG)
const OutdoorSessionSchema = z.object({
  patients_new:        z.number().int().min(0).default(0),
  patients_old:        z.number().int().min(0).default(0),
  services:            z.number().int().min(0).default(0),
  service_charge:      z.number().min(0).default(0),
  rdf_medicine_sales:  z.number().min(0).default(0),
  lab_tests:           z.number().int().min(0).default(0),
  lab_revenue:         z.number().min(0).default(0),
  usg:                 z.array(UsgEntrySchema).default([]),
});

// AFTERHOURS: no new/old split, no lab, no USG — has logistic_sales instead
const AfterhoursSessionSchema = z.object({
  patients:            z.number().int().min(0).default(0),
  service_charge:      z.number().min(0).default(0),
  rdf_medicine_sales:  z.number().min(0).default(0),
  logistic_sales:      z.number().min(0).default(0),
});

const SatelliteTeamSchema = z.object({
  team:                z.string().regex(/^TEAM_\d+$/, 'team must match TEAM_<n>'),
  patients_new:        z.number().int().min(0).default(0),
  patients_old:        z.number().int().min(0).default(0),
  services:            z.number().int().min(0).default(0),
  service_charge:      z.number().min(0).default(0),
  rdf_medicine_sales:  z.number().min(0).default(0),
  lab_tests:           z.number().int().min(0).default(0),
  lab_revenue:         z.number().min(0).default(0),
  usg:                 z.array(UsgEntrySchema).default([]),
});

// Admission-day fields only: advance paid + patient record for follow-up.
// expected_balance / expected_date are the manager's estimates at admission;
// both are optional because the final bill is unknowable until discharge.
// Actual income is recognised at discharge via closeDeliveryBalance.
const DeliveryBalanceEntrySchema = z.object({
  receipt_no:       z.string().optional(),
  patient_name:     z.string().min(1),
  phone:            z.string().optional(),
  advance:          z.number().min(0),
  expected_balance: z.number().min(0).default(0),
  expected_date:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected_date must be YYYY-MM-DD').optional(),
});

const NvdSchema = z.object({
  cases:            z.number().int().min(0).default(0),
  service_charge:   z.number().min(0).default(0),
  rdf_revenue:      z.number().min(0).default(0),
  logistic_revenue: z.number().min(0).default(0),
});

// C-section admission shape: case count + advance records only.
// Income fields (service_charge, rdf_revenue, logistic_revenue) are NOT captured
// at admission — they belong to the itemized discharge bill (closeDeliveryBalance).
const CsectionSchema = z.object({
  cases:    z.number().int().min(0).default(0),
  balances: z.array(DeliveryBalanceEntrySchema).default([]),
});

// safe_delivery removed: it was the spreadsheet cross-check sum for NVD + C-section
// combined (manually totalled by the manager). In the ERP, NVD and C-section are each
// tracked separately, so retaining safe_delivery would double-count both streams.

const OtherIncomeEntrySchema = z.object({
  description: z.string().min(1),
  amount:      z.number().min(0),
});

const BankDepositSchema = z.object({
  made:       z.boolean(),
  pi_amount:  z.number().min(0).default(0),
  rdf_amount: z.number().min(0).default(0),
});

const CashAdvanceSchema = z.object({
  amount:      z.number().min(0).default(0),
  fund:        z.enum(['PI', 'RDF']).nullable().default(null),
  description: z.string().nullable().default(null),
});

const FinancialSchema = z.object({
  bank_deposit:          BankDepositSchema,
  cash_advance:          CashAdvanceSchema,
  cash_in_hand_counted:  z.number().min(0),
  reconciliation_notes:  z.string().nullable().default(null),
});

// Sub-schema exports for regression tests (no-C-section-income guard + shape checks).
export { UsgEntrySchema, OutdoorSessionSchema, AfterhoursSessionSchema, SatelliteTeamSchema, CsectionSchema };

// ── Root schema ───────────────────────────────────────────────────────────────

export const DraftDataSchema = z.object({
  revenue_date:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'revenue_date must be YYYY-MM-DD'),
  entity_code:      z.string().min(2).max(10),
  channels_active:  z.array(z.string()).default([]),
  sessions: z.object({
    MORNING:    OutdoorSessionSchema.optional(),
    EVENING:    OutdoorSessionSchema.optional(),
    AFTERHOURS: AfterhoursSessionSchema.optional(),
  }).default({}),
  satellite_teams:  z.array(SatelliteTeamSchema).default([]),
  delivery: z.object({
    nvd:      NvdSchema.optional(),
    csection: CsectionSchema.optional(),
  }).default({}),
  other_income:     z.array(OtherIncomeEntrySchema).default([]),
  financial:        FinancialSchema,
});

export type DraftData = z.infer<typeof DraftDataSchema>;
