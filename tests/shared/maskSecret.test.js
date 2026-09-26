import { describe, it, expect } from 'vitest'
import {
  maskSecret,
  containsSecretMaskGlyph,
  SECRET_MASK_GLYPH,
  SECRET_MASK_PREFIX_LEN,
  SECRET_MASK_SUFFIX_LEN,
} from '../../src/utils/maskSecret.js'

describe('maskSecret', () => {
  it('returns empty for non-strings and empty string', () => {
    expect(maskSecret('')).toBe('')
    expect(maskSecret(null)).toBe('')
    expect(maskSecret(undefined)).toBe('')
    expect(maskSecret(42)).toBe('')
  })

  it('shows full value when length is at most prefix+suffix (short-token rule)', () => {
    const exact = 'a'.repeat(SECRET_MASK_PREFIX_LEN + SECRET_MASK_SUFFIX_LEN)
    expect(maskSecret(exact)).toBe(exact)
    expect(maskSecret('short')).toBe('short')
    expect(maskSecret('ghp_tFK')).toBe('ghp_tFK')
  })

  it('keeps first 7 and last 7 visible and masks the middle', () => {
    const raw = 'ghp_tFKEnEfg4tsRXfdUSv7NY4Q0LCk2l42FsSCx'
    const masked = maskSecret(raw)
    expect(masked.startsWith('ghp_tFK')).toBe(true)
    expect(masked.endsWith('42FsSCx')).toBe(true)
    expect(masked.length).toBe(raw.length)
    expect(masked.slice(7, -7)).toBe(SECRET_MASK_GLYPH.repeat(raw.length - 14))
    expect(masked).not.toBe(raw)
    expect(masked.includes('EnEfg4tsRXfdUSv7NY4Q0LCk')).toBe(false)
  })

  it('masks immediately once length exceeds 14', () => {
    const raw = 'abcdefghijklmno' // 15 → prefix 7 + 1 glyph + suffix 7
    expect(maskSecret(raw)).toBe('abcdefg' + SECRET_MASK_GLYPH + 'ijklmno')
  })

  it('accepts custom prefix/suffix/glyph', () => {
    expect(maskSecret('abcdefghij', { prefix: 2, suffix: 2, glyph: '*' })).toBe('ab******ij')
  })
})

describe('containsSecretMaskGlyph', () => {
  it('detects mask glyph so callers can reject writing display into state', () => {
    expect(containsSecretMaskGlyph('ghp_tFK••••42FsSCx')).toBe(true)
    expect(containsSecretMaskGlyph('ghp_tFKEnEfg4tsRXfdUSv7NY4Q0LCk2l42FsSCx')).toBe(false)
    expect(containsSecretMaskGlyph('')).toBe(false)
    expect(containsSecretMaskGlyph(null)).toBe(false)
  })
})
