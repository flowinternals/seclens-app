import { describe, it, expect } from 'vitest'
import { redactSensitiveTokens } from '../../lib/server/scanJobs.js'

describe('scanJobs live-artifact redaction', () => {
  it('redacts GitHub PAT-like tokens recursively', () => {
    const make = (prefix, len = 24) => `${prefix}${'x'.repeat(len)}`
    const input = {
      error: `failure with ${make('github_pat_')}`,
      nested: {
        auth: `token ${make('ghp_')}`,
      },
      arr: [make('ghs_'), 123],
    }
    const out = redactSensitiveTokens(input)
    const rendered = JSON.stringify(out)
    expect(rendered).not.toContain('github_pat_')
    expect(rendered).toContain('[REDACTED_TOKEN]')
  })
})
