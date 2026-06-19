'use client'

import Image from 'next/image'
import { useState } from 'react'

// PNG artwork is navy-colored — white circle container makes it visible on the navy sidebar.
export default function Logo() {
  const [error, setError] = useState(false)

  return (
    <div className="rounded-full bg-white p-1.5 w-10 h-10 flex-shrink-0 flex items-center justify-center overflow-hidden">
      {error ? (
        <span className="text-navy-vivid font-bold text-sm select-none">IE</span>
      ) : (
        <Image
          src="/image-logo.png"
          alt="IMAGE"
          width={28}
          height={28}
          className="object-contain"
          onError={() => setError(true)}
          priority
        />
      )}
    </div>
  )
}
