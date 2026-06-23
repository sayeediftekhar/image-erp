import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getEntityCapabilities, hasDeliveries } from '@/lib/capabilities'
import { pool } from '@/lib/db/pool'
import { getDhakaToday } from '@/lib/revenue/classify'
import { computeBalanceConsequence } from '@/lib/revenue/close-balance'
import DischargeForm from './DischargeForm'

function tk(taka: number): string {
  return 'Tk ' + Math.round(taka).toLocaleString('en-IN')
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

interface BalanceRow {
  id:                      string
  entity_id:               string
  patient_name:            string
  receipt_no:              string | null
  phone:                   string | null
  status:                  'OPEN' | 'CLOSED'
  advance_paid:            number
  expected_balance:        number
  expected_date:           string | null
  closed_date:             string | null
  final_service_charge:    number | null
  final_rdf_amount:        number | null
  final_logistics_amount:  number | null
  final_balance_paid:      number | null
  admission_date:          string
}

export default async function DeliveryBalancePage({
  params,
}: {
  params: { id: string }
}) {
  const supabase = createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: appUser } = await supabase
    .from('app_users')
    .select('role, entity_id')
    .eq('id', user.id)
    .single()

  if (!appUser || appUser.role !== 'ENTRY' || !appUser.entity_id) redirect('/home')

  const { data: entity } = await supabase
    .from('entities')
    .select('code')
    .eq('id', appUser.entity_id)
    .single()

  const caps = getEntityCapabilities(entity?.code ?? '')
  if (!hasDeliveries(caps)) redirect('/dashboard')

  // ── Entity-scoped fetch (AND entity_id = $2) ─────────────────────────────
  // A JAL manager who has a NAS balance UUID gets 0 rows → redirected.
  // No error page, no information leakage: "not found" and "wrong entity"
  // are indistinguishable to the client.
  const { rows } = await pool.query<BalanceRow>(
    `SELECT
       db.id,
       db.entity_id,
       db.patient_name,
       db.receipt_no,
       db.phone,
       db.status,
       db.advance_paid::float             AS advance_paid,
       db.expected_balance::float         AS expected_balance,
       db.expected_date::text             AS expected_date,
       db.closed_date::text               AS closed_date,
       db.final_service_charge::float     AS final_service_charge,
       db.final_rdf_amount::float         AS final_rdf_amount,
       db.final_logistics_amount::float   AS final_logistics_amount,
       db.final_balance_paid::float       AS final_balance_paid,
       rd.revenue_date::text              AS admission_date
     FROM public.delivery_balance db
     LEFT JOIN public.revenue_day rd ON rd.id = db.revenue_day_id
     WHERE db.id = $1 AND db.entity_id = $2`,
    [params.id, appUser.entity_id],
  )

  if (rows.length === 0) redirect('/deliveries')
  const balance = rows[0]

  const dhakaToday = getDhakaToday()

  // ── Closed read-only view ─────────────────────────────────────────────────
  if (balance.status === 'CLOSED') {
    const sc     = balance.final_service_charge    ?? 0
    const rdf    = balance.final_rdf_amount        ?? 0
    const log    = balance.final_logistics_amount  ?? 0
    const totalBill = sc + rdf + log
    const balancePaid = balance.final_balance_paid ?? 0
    const consequence = computeBalanceConsequence(balance.advance_paid, totalBill)

    return (
      <div className="min-h-full flex flex-col">
        <div
          className="px-4 pt-5 pb-6"
          style={{ background: 'linear-gradient(145deg, #07043a 0%, #0F0A52 55%, #1a0c7a 100%)' }}
        >
          <p className="text-white/60 text-xs font-medium uppercase tracking-widest mb-1">Discharge</p>
          <h1 className="text-white text-2xl font-bold leading-tight">{balance.patient_name}</h1>
          <p className="text-white/60 text-sm mt-1">
            Closed {balance.closed_date ? fmtDate(balance.closed_date) : ''}
          </p>
        </div>

        <div className="flex-1 bg-gray-50 rounded-t-3xl -mt-3 px-4 pt-5 pb-6 space-y-5">
          {/* Context */}
          <section className="bg-white rounded-2xl border border-gray-200 p-4 space-y-2 text-sm">
            {balance.receipt_no && (
              <div className="flex justify-between text-gray-600">
                <span>Receipt / reg. no.</span>
                <span className="font-medium text-gray-800">{balance.receipt_no}</span>
              </div>
            )}
            {balance.phone && (
              <div className="flex justify-between text-gray-600">
                <span>Phone</span>
                <span className="font-medium text-gray-800">{balance.phone}</span>
              </div>
            )}
            <div className="flex justify-between text-gray-600">
              <span>Admitted</span>
              <span className="font-medium text-gray-800">{fmtDate(balance.admission_date)}</span>
            </div>
            <div className="flex justify-between text-gray-600">
              <span>Advance held</span>
              <span className="font-medium text-gray-800">{tk(balance.advance_paid)}</span>
            </div>
          </section>

          {/* Final bill */}
          <section className="bg-white rounded-2xl border border-gray-200 p-4 space-y-2 text-sm">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Final bill</p>
            {sc   > 0 && <div className="flex justify-between text-gray-600"><span>Service + seat (4030)</span><span className="font-medium text-gray-800">{tk(sc)}</span></div>}
            {rdf  > 0 && <div className="flex justify-between text-gray-600"><span>Medicines / consumables (4110)</span><span className="font-medium text-gray-800">{tk(rdf)}</span></div>}
            {log  > 0 && <div className="flex justify-between text-gray-600"><span>Logistics (4130)</span><span className="font-medium text-gray-800">{tk(log)}</span></div>}
            <div className="border-t border-gray-100 pt-2 flex justify-between font-semibold text-gray-800">
              <span>Total bill</span>
              <span>{tk(totalBill)}</span>
            </div>
          </section>

          {/* Cash consequence */}
          <div className={`rounded-2xl p-4 text-sm font-semibold ${
            consequence.type === 'collect'
              ? 'bg-green-50 text-green-800 border border-green-200'
              : 'bg-amber-50 text-amber-800 border border-amber-200'
          }`}>
            {consequence.type === 'collect'
              ? consequence.amount > 0
                ? `Collected ${tk(consequence.amount)} from patient`
                : 'Exact match — no additional cash collected'
              : `Refunded ${tk(consequence.amount)} to patient`}
          </div>

          <a
            href="/deliveries"
            className="block text-center text-sm font-medium text-gray-500 py-2"
          >
            ← Back to balances
          </a>
        </div>
      </div>
    )
  }

  // ── Open → discharge form ─────────────────────────────────────────────────
  return (
    <DischargeForm
      balance={{
        id:             balance.id,
        patient_name:   balance.patient_name,
        receipt_no:     balance.receipt_no,
        phone:          balance.phone,
        advance_paid:   balance.advance_paid,
        admission_date: balance.admission_date,
      }}
      dhakaToday={dhakaToday}
    />
  )
}
