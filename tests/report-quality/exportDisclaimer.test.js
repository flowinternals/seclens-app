import { describe, expect, it } from 'vitest'
import {
  MANDATORY_EXPORT_DISCLAIMER,
  appendMandatoryDisclaimer,
  markdownToPlainText,
  prepareMarkdown,
} from '../../lib/server/downloadUtils.js'

describe('export disclaimer handling', () => {
  it('appends the mandatory disclaimer once for markdown exports', () => {
    const base = '# SecLens Consolidated Report\n\n## Recommendations\n\n- item'
    const withDisclaimer = appendMandatoryDisclaimer(base)

    expect(withDisclaimer).toContain('## Disclaimer')
    expect(withDisclaimer).toContain(MANDATORY_EXPORT_DISCLAIMER)
    expect(appendMandatoryDisclaimer(withDisclaimer)).toBe(withDisclaimer)
  })

  it('includes the mandatory disclaimer in sanitized markdown output', () => {
    const prepared = prepareMarkdown('# Header')
    expect(prepared).toContain(MANDATORY_EXPORT_DISCLAIMER)
  })

  it('includes the mandatory disclaimer in plain text output', () => {
    const text = markdownToPlainText(appendMandatoryDisclaimer('# Header'))
    expect(text).toContain('SecLens is a repository security advisory tool.')
  })
})
