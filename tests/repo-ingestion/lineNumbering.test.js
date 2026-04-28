import { describe, it, expect } from 'vitest'
import {
  splitLines,
  excerptWithinByteBudget,
  formatCitationRange,
  sliceLines,
} from '../../lib/server/lineNumbering.js'

describe('lineNumbering', () => {
  it('produces stable line splitting', () => {
    const lines = splitLines('a\r\nb\nc')
    expect(lines).toEqual(['a', 'b', 'c'])
  })

  it('formats path:start-end citations', () => {
    expect(formatCitationRange('src/x.ts', 3, 10)).toBe('src/x.ts:3-10')
  })

  it('excerptWithinByteBudget preserves real line ranges', () => {
    const lines = splitLines('one\ntwo\nthree')
    const ex = excerptWithinByteBudget(lines, 100)
    expect(ex.startLine).toBe(1)
    expect(ex.endLine).toBeGreaterThanOrEqual(1)
    expect(ex.text).toContain('one')
  })

  it('sliceLines addresses 1-based inclusive ranges', () => {
    const lines = splitLines('a\nb\nc')
    const s = sliceLines(lines, 2, 3)
    expect(s.startLine).toBe(2)
    expect(s.endLine).toBe(3)
    expect(s.text).toBe('b\nc')
  })
})
