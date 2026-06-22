'use client'

import { useState } from 'react'

interface AfterhoursData {
  patients:           number
  service_charge:     number
  rdf_medicine_sales: number
  logistic_sales:     number
}

function parseInitialData(raw: unknown): AfterhoursData {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const d = raw as Record<string, unknown>
    return {
      patients:           typeof d.patients === 'number' ? d.patients : 0,
      service_charge:     typeof d.service_charge === 'number' ? d.service_charge : 0,
      rdf_medicine_sales: typeof d.rdf_medicine_sales === 'number' ? d.rdf_medicine_sales : 0,
      logistic_sales:     typeof d.logistic_sales === 'number' ? d.logistic_sales : 0,
    }
  }
  return { patients: 0, service_charge: 0, rdf_medicine_sales: 0, logistic_sales: 0 }
}

function numVal(raw: string, integer: boolean): number {
  const v = integer ? parseInt(raw || '0', 10) : parseFloat(raw || '0')
  return isNaN(v) || v < 0 ? 0 : v
}

interface Props {
  initialData: unknown
  onSave:      (slice: unknown) => Promise<void>
  isSaving:    boolean
  saveError:   string | null
}

export default function AfterhoursSession({ initialData, onSave, isSaving, saveError }: Props) {
  const init = parseInitialData(initialData)

  const [patients,         setPatients]         = useState(init.patients)
  const [serviceCharge,    setServiceCharge]    = useState(init.service_charge)
  const [rdfMedicineSales, setRdfMedicineSales] = useState(init.rdf_medicine_sales)
  const [logisticSales,    setLogisticSales]    = useState(init.logistic_sales)

  async function handleSave() {
    await onSave({
      patients,
      service_charge:     serviceCharge,
      rdf_medicine_sales: rdfMedicineSales,
      logistic_sales:     logisticSales,
    })
  }

  const inputClass = 'w-full min-h-[44px] rounded-xl border border-gray-300 px-4 text-base bg-white'

  return (
    <div className="p-5 space-y-6">
      <h2 className="text-gray-900 text-lg font-bold">After-hours</h2>

      {/* Customers */}
      <section className="space-y-4">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Customers</p>
        <div className="space-y-1">
          <label className="text-sm font-medium text-gray-700"># Customers</label>
          <input type="number" inputMode="numeric" min={0} placeholder="0"
            value={patients || ''}
            onChange={e => setPatients(numVal(e.target.value, true))}
            className={inputClass}
          />
        </div>
      </section>

      {/* Service charge — navy-highlighted */}
      <div className="rounded-2xl p-4" style={{ background: '#07043a' }}>
        <label className="block text-sm font-semibold text-white/80 mb-1">
          Service charge (Tk){'  '}
          <span className="text-white/50 font-normal text-xs">→ 4010 PI-Outdoor</span>
        </label>
        <input
          type="number" inputMode="decimal" min={0} placeholder="0"
          aria-label="Service charge"
          value={serviceCharge || ''}
          onChange={e => setServiceCharge(numVal(e.target.value, false))}
          className="w-full min-h-[44px] rounded-xl bg-white/10 border border-white/20 px-4 text-white text-lg font-bold placeholder-white/30"
        />
      </div>

      {/* RDF */}
      <section className="space-y-4">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">RDF</p>

        <div className="space-y-1">
          <label className="text-sm font-medium text-gray-700">
            RDF medicine sales (Tk) <span className="text-xs text-gray-400 font-normal">→ 4110</span>
          </label>
          <input type="number" inputMode="decimal" min={0} placeholder="0"
            value={rdfMedicineSales || ''}
            onChange={e => setRdfMedicineSales(numVal(e.target.value, false))}
            className={inputClass}
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium text-gray-700">
            Logistic sales (Tk) <span className="text-xs text-gray-400 font-normal">→ 4130</span>
          </label>
          <input type="number" inputMode="decimal" min={0} placeholder="0"
            value={logisticSales || ''}
            onChange={e => setLogisticSales(numVal(e.target.value, false))}
            className={inputClass}
          />
        </div>
      </section>

      {saveError && (
        <p className="text-red-600 text-sm font-medium" role="alert">{saveError}</p>
      )}

      <button
        type="button"
        onClick={handleSave}
        disabled={isSaving}
        className="w-full min-h-[44px] rounded-xl font-semibold text-sm text-white disabled:opacity-40 transition-opacity"
        style={{ background: '#13007D' }}
      >
        {isSaving ? 'Saving…' : 'Save & Continue →'}
      </button>
    </div>
  )
}
