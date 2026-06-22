'use client'

import { useState } from 'react'
import { filterUsgEntries, type UsgEntry } from '@/lib/revenue/draft-merge'
import UsgSection from './UsgSection'

interface OutdoorSessionData {
  patients_new:       number
  patients_old:       number
  services:           number
  service_charge:     number
  rdf_medicine_sales: number
  lab_tests:          number
  lab_revenue:        number
  usg:                UsgEntry[]
}

function parseInitialData(raw: unknown): OutdoorSessionData {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const d = raw as Record<string, unknown>
    const usgRaw = Array.isArray(d.usg) && d.usg.length > 0
      ? d.usg as UsgEntry[]
      : [{ type: 'PP' as const, count: 0, revenue: 0 }]
    return {
      patients_new:       typeof d.patients_new === 'number' ? d.patients_new : 0,
      patients_old:       typeof d.patients_old === 'number' ? d.patients_old : 0,
      services:           typeof d.services === 'number' ? d.services : 0,
      service_charge:     typeof d.service_charge === 'number' ? d.service_charge : 0,
      rdf_medicine_sales: typeof d.rdf_medicine_sales === 'number' ? d.rdf_medicine_sales : 0,
      lab_tests:          typeof d.lab_tests === 'number' ? d.lab_tests : 0,
      lab_revenue:        typeof d.lab_revenue === 'number' ? d.lab_revenue : 0,
      usg: usgRaw,
    }
  }
  return {
    patients_new: 0, patients_old: 0, services: 0,
    service_charge: 0, rdf_medicine_sales: 0,
    lab_tests: 0, lab_revenue: 0,
    usg: [{ type: 'PP', count: 0, revenue: 0 }],
  }
}

function numVal(raw: string, integer: boolean): number {
  const v = integer ? parseInt(raw || '0', 10) : parseFloat(raw || '0')
  return isNaN(v) || v < 0 ? 0 : v
}

interface Props {
  channel:     'MORNING' | 'EVENING' | 'SATELLITE'
  label:       string
  initialData: unknown
  teamToken?:  string   // 'TEAM_1', 'TEAM_2' etc. — SATELLITE only; preserved in saved slice
  onSave:      (slice: unknown) => Promise<void>
  isSaving:    boolean
  saveError:   string | null
}

export default function OutdoorSession({
  channel, label, initialData, teamToken, onSave, isSaving, saveError,
}: Props) {
  const init = parseInitialData(initialData)

  const [patientsNew,      setPatientsNew]      = useState(init.patients_new)
  const [patientsOld,      setPatientsOld]      = useState(init.patients_old)
  const [services,         setServices]         = useState(init.services)
  const [serviceCharge,    setServiceCharge]    = useState(init.service_charge)
  const [rdfMedicineSales, setRdfMedicineSales] = useState(init.rdf_medicine_sales)
  const [labTests,         setLabTests]         = useState(init.lab_tests)
  const [labRevenue,       setLabRevenue]       = useState(init.lab_revenue)
  const [usgEntries,       setUsgEntries]       = useState<UsgEntry[]>(init.usg)

  const isSatellite = channel === 'SATELLITE'
  const serviceChargeHint = isSatellite ? '→ 4040 PI-Satellite' : '→ 4010 PI-Outdoor'

  async function handleSave() {
    const base = {
      patients_new:       patientsNew,
      patients_old:       patientsOld,
      services,
      service_charge:     serviceCharge,
      rdf_medicine_sales: rdfMedicineSales,
      lab_tests:          labTests,
      lab_revenue:        labRevenue,
      usg:                filterUsgEntries(usgEntries),
    }
    await onSave(isSatellite && teamToken ? { team: teamToken, ...base } : base)
  }

  const inputClass = 'w-full min-h-[44px] rounded-xl border border-gray-300 px-4 text-base bg-white'

  return (
    <div className="p-5 space-y-6">
      <h2 className="text-gray-900 text-lg font-bold">{label}</h2>

      {/* Patients & services */}
      <section className="space-y-4">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Patients & services</p>

        <div className="space-y-1">
          <label className="text-sm font-medium text-gray-700">New patients</label>
          <input type="number" inputMode="numeric" min={0} placeholder="0"
            value={patientsNew || ''}
            onChange={e => setPatientsNew(numVal(e.target.value, true))}
            className={inputClass}
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium text-gray-700">Old patients</label>
          <input type="number" inputMode="numeric" min={0} placeholder="0"
            value={patientsOld || ''}
            onChange={e => setPatientsOld(numVal(e.target.value, true))}
            className={inputClass}
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium text-gray-700">Total services</label>
          <input type="number" inputMode="numeric" min={0} placeholder="0"
            value={services || ''}
            onChange={e => setServices(numVal(e.target.value, true))}
            className={inputClass}
          />
        </div>
      </section>

      {/* Service charge — navy-highlighted, the core income figure */}
      <div className="rounded-2xl p-4" style={{ background: '#07043a' }}>
        <label className="block text-sm font-semibold text-white/80 mb-1">
          Service charge (Tk){'  '}
          <span className="text-white/50 font-normal text-xs">{serviceChargeHint}</span>
        </label>
        <input
          type="number" inputMode="decimal" min={0} placeholder="0"
          aria-label="Service charge"
          value={serviceCharge || ''}
          onChange={e => setServiceCharge(numVal(e.target.value, false))}
          className="w-full min-h-[44px] rounded-xl bg-white/10 border border-white/20 px-4 text-white text-lg font-bold placeholder-white/30"
        />
      </div>

      {/* Medicine & lab (RDF) */}
      <section className="space-y-4">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
          Medicine & lab <span className="text-gray-400 font-normal normal-case">(RDF)</span>
        </p>

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
          <label className="text-sm font-medium text-gray-700"># Lab tests</label>
          <input type="number" inputMode="numeric" min={0} placeholder="0"
            value={labTests || ''}
            onChange={e => setLabTests(numVal(e.target.value, true))}
            className={inputClass}
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium text-gray-700">
            Lab revenue (Tk) <span className="text-xs text-gray-400 font-normal">→ 4120</span>
          </label>
          <input type="number" inputMode="decimal" min={0} placeholder="0"
            value={labRevenue || ''}
            onChange={e => setLabRevenue(numVal(e.target.value, false))}
            className={inputClass}
          />
        </div>
      </section>

      {/* USG */}
      <UsgSection value={usgEntries} onChange={setUsgEntries} />

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
