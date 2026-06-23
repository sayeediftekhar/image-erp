import { validateBdPhone, validateRequiredText } from './validation'

describe('validateBdPhone', () => {
  test('blank → ok (phone is optional)', () => {
    expect(validateBdPhone('')).toEqual({ ok: true, value: '' })
  })

  test('whitespace-only → ok', () => {
    expect(validateBdPhone('   ')).toEqual({ ok: true, value: '' })
  })

  test('valid BD mobile (11 digits, 01 prefix) → ok', () => {
    expect(validateBdPhone('01723934427')).toEqual({ ok: true, value: '01723934427' })
  })

  test('with spaces/dashes → ok if valid after stripping', () => {
    expect(validateBdPhone('017-2393-4427')).toEqual({ ok: true, value: '01723934427' })
  })

  test('10 digits → error', () => {
    const r = validateBdPhone('0172393442')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/BD mobile/i)
  })

  test('12 digits → error', () => {
    expect(validateBdPhone('017239344271').ok).toBe(false)
  })

  test('not starting with 01 → error', () => {
    expect(validateBdPhone('02123456789').ok).toBe(false)
  })

  test('starts with 01 but only 9 digits → error', () => {
    expect(validateBdPhone('012345678').ok).toBe(false)
  })
})

describe('validateRequiredText', () => {
  test('non-empty string → ok', () => {
    expect(validateRequiredText('Alice', 'Name')).toEqual({ ok: true, value: 'Alice' })
  })

  test('empty → error with label', () => {
    const r = validateRequiredText('', 'Patient name')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain('required')
      expect(r.error).toContain('Patient name')
    }
  })

  test('whitespace-only → error', () => {
    expect(validateRequiredText('   ', 'Patient name').ok).toBe(false)
  })

  test('trims leading/trailing whitespace from value', () => {
    const r = validateRequiredText('  Alice  ', 'Name')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toBe('Alice')
  })
})
