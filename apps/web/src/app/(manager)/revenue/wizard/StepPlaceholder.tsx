interface Props {
  label: string
  phase: 'T3c' | 'T3d'
}

export default function StepPlaceholder({ label, phase }: Props) {
  return (
    <div className="flex flex-col items-center justify-center min-h-64 px-6 py-12 text-center space-y-3">
      <div
        className="w-14 h-14 rounded-full flex items-center justify-center text-2xl"
        style={{ background: '#F0EDFF' }}
      >
        📋
      </div>
      <h3 className="text-gray-900 text-lg font-bold">{label}</h3>
      <p className="text-gray-500 text-sm leading-relaxed max-w-xs">
        Field entry for {label.toLowerCase()} is coming in{' '}
        <span className="font-semibold text-gray-700">{phase}</span>.
      </p>
    </div>
  )
}
