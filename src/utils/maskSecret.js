/**
 * Display-only secret masking. Never use the return value as storage or submit source of truth.
 */

export const SECRET_MASK_GLYPH = '•'
export const SECRET_MASK_PREFIX_LEN = 7
export const SECRET_MASK_SUFFIX_LEN = 7

/**
 * Mask a secret for UI display: keep prefix/suffix visible, obscure the middle.
 * Short-token rule: when length ≤ prefix+suffix, show the full value (no false ends).
 *
 * @param {unknown} value
 * @param {{ prefix?: number, suffix?: number, glyph?: string }} [options]
 * @returns {string}
 */
export function maskSecret(value, options = {}) {
  if (typeof value !== 'string' || value.length === 0) return ''

  const prefix = Number.isFinite(options.prefix) ? options.prefix : SECRET_MASK_PREFIX_LEN
  const suffix = Number.isFinite(options.suffix) ? options.suffix : SECRET_MASK_SUFFIX_LEN
  const glyph =
    typeof options.glyph === 'string' && options.glyph.length > 0
      ? options.glyph
      : SECRET_MASK_GLYPH

  if (prefix < 0 || suffix < 0) return value
  if (value.length <= prefix + suffix) return value

  const middleLen = value.length - prefix - suffix
  return value.slice(0, prefix) + glyph.repeat(middleLen) + value.slice(value.length - suffix)
}

/**
 * True when a display string includes the mask glyph (must never be written into token state).
 * @param {unknown} value
 * @param {string} [glyph]
 * @returns {boolean}
 */
export function containsSecretMaskGlyph(value, glyph = SECRET_MASK_GLYPH) {
  return typeof value === 'string' && value.includes(glyph)
}
