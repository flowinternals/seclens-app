import { describe, expect, it } from 'vitest'
import {
  containsSecretMaskGlyph,
  maskSecret,
  SECRET_MASK_GLYPH,
} from '../../src/utils/maskSecret.js'

/**
 * Regression contract for CR-SECLENS-PIVOT-011 (GitHub token display masking).
 * Runs with `npm run test:oracle` alongside other automated-regression helper tests.
 * Real PATs must never appear fully in the intake field display string.
 */
describe('AUTO regression: GitHub token display masking', () => {
  const samplePat = 'ghp_tFKEnEfg4tsRXfdUSv7NY4Q0LCk2l42FsSCx'

  it('masks classic ghp_ PATs to first 7 + last 7 with obscured middle', () => {
    const displayed = maskSecret(samplePat)

    expect(displayed).toBe(
      `${samplePat.slice(0, 7)}${SECRET_MASK_GLYPH.repeat(samplePat.length - 14)}${samplePat.slice(-7)}`
    )
    expect(displayed.startsWith('ghp_tFK')).toBe(true)
    expect(displayed.endsWith('42FsSCx')).toBe(true)
    expect(displayed).not.toBe(samplePat)
    expect(displayed.includes(samplePat.slice(7, -7))).toBe(false)
  })

  it('keeps the raw token usable for submit while display is masked', () => {
    const displayed = maskSecret(samplePat)
    const submitToken = samplePat.trim()

    expect(submitToken).toBe(samplePat)
    expect(displayed).not.toBe(submitToken)
    expect(containsSecretMaskGlyph(displayed)).toBe(true)
    expect(containsSecretMaskGlyph(submitToken)).toBe(false)
  })

  it('rejects writing masked display glyphs back into token state', () => {
    const displayed = maskSecret(samplePat)
    // Mimic InputPanel Option A guard: never accept a change that contains the mask glyph.
    const nextFromBadEdit = `${displayed}x`
    expect(containsSecretMaskGlyph(nextFromBadEdit)).toBe(true)

    let token = samplePat
    if (!nextFromBadEdit || containsSecretMaskGlyph(nextFromBadEdit)) {
      // ignore — state unchanged
    } else {
      token = nextFromBadEdit
    }
    expect(token).toBe(samplePat)
  })

  it('allows clear + whole-field replace without glyph corruption', () => {
    let token = samplePat
    const clear = ''
    if (!clear) token = ''
    expect(token).toBe('')

    const replacement = 'github_pat_11AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
    expect(containsSecretMaskGlyph(replacement)).toBe(false)
    token = replacement
    expect(maskSecret(token).startsWith('github_')).toBe(true)
    expect(maskSecret(token)).not.toBe(token)
    expect(token).toBe(replacement)
  })

  it('short-token rule: length ≤ 14 stays fully visible (no false ends)', () => {
    expect(maskSecret('ghp_tFK42FsSCx')).toBe('ghp_tFK42FsSCx') // 14
    expect(maskSecret('short')).toBe('short')
    expect(maskSecret('abcdefghijklmno')).not.toBe('abcdefghijklmno') // 15 → masked
  })
})
