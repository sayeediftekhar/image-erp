import type { ParseResult } from './money-input'

export type { ParseResult }

/**
 * Validate a BD mobile phone number.
 * Format: 11 digits, starts with "01" (e.g. 01712345678).
 * Strips spaces, dashes, and other non-digit chars before checking.
 * Empty string is ok — phone is optional in all current forms.
 */
export function validateBdPhone(raw: string): ParseResult<string> {
  if (raw === '' || raw.trim() === '') return { ok: true, value: '' }
  const digits = raw.replace(/\D/g, '')
  if (digits.length !== 11 || !digits.startsWith('01')) {
    return { ok: false, error: 'Enter a valid BD mobile number (e.g. 01712345678)' }
  }
  return { ok: true, value: digits }
}

/**
 * Validate that a text field is non-empty.
 * Trims whitespace before checking; returns the trimmed value on success.
 */
export function validateRequiredText(raw: string, label: string): ParseResult<string> {
  if (raw.trim() === '') return { ok: false, error: `${label} is required` }
  return { ok: true, value: raw.trim() }
}
