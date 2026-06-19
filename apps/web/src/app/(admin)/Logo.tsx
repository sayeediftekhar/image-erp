'use client'

import Image from 'next/image'
import { useState } from 'react'

// PNG confirmed RGBA with transparent background — sits cleanly on navy without a circle.
export default function Logo() {
  const [error, setError] = useState(false)

  if (error) {
    return (
      <div className="w-10 h-10 flex-shrink-0 flex items-center justify-center">
        <span className="text-white font-bold text-sm select-none">IE</span>
      </div>
    )
  }

  return (
    <div className="w-10 h-10 flex-shrink-0 flex items-center justify-center">
      <Image
        src="/image-logo.png"
        alt="IMAGE"
        width={40}
        height={40}
        className="object-contain"
        onError={() => setError(true)}
        priority
      />
    </div>
  )
}
