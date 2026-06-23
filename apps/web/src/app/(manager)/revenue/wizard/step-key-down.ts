import type React from 'react'

/**
 * Event delegation handler for wizard step containers (attach to the
 * `data-wizard-step` div via onKeyDown).
 *
 * Enter on an input or textarea advances focus to the next focusable element
 * in the step — standard form keyboard navigation without an HTML <form>.
 * Enter on buttons, selects, and other elements is left to native behaviour.
 */
export function stepKeyDown(e: React.KeyboardEvent<HTMLElement>): void {
  if (e.key !== 'Enter') return
  const target = e.target as HTMLElement
  if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') return
  e.preventDefault()
  const container = target.closest('[data-wizard-step]') as HTMLElement | null
  if (!container) return
  const focusable = Array.from(
    container.querySelectorAll<HTMLElement>(
      'input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
    ),
  )
  const idx = focusable.indexOf(target)
  if (idx >= 0 && idx < focusable.length - 1) focusable[idx + 1].focus()
}
