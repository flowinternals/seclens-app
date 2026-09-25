import { describe, expect, it } from 'vitest'
import { escapeMarkdownTableCell } from '../../lib/server/markdownTableEscape.js'

describe('escapeMarkdownTableCell', () => {
  it('escapes backslashes before pipes', () => {
    expect(escapeMarkdownTableCell('a|b')).toBe('a\\|b')
    expect(escapeMarkdownTableCell('a\\b')).toBe('a\\\\b')
    expect(escapeMarkdownTableCell('a\\|b')).toBe('a\\\\\\|b')
  })

  it('collapses newlines to spaces', () => {
    expect(escapeMarkdownTableCell('a\nb\r\nc')).toBe('a b c')
  })
})
