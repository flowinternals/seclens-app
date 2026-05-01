import { describe, it, expect } from 'vitest'
import {
  buildAdversarialReasoningBlock,
  candidateNeedsAdversarialChallenge,
  inferHighSignalClasses,
} from '../../lib/server/adversarialReasoning.js'

describe('adversarial reasoning framework (CR-2.1-006)', () => {
  it('maps pass family to high-signal question classes', () => {
    const classes = inferHighSignalClasses('invite_token_claims', ['functions/src/invite/accept.ts'])
    expect(classes).toContain('bearer_identifier')
    expect(classes).toContain('public_entrypoint')
  })

  it('builds adversarial prompt block with required challenge fields', () => {
    const block = buildAdversarialReasoningBlock('rate_limiting_abuse_controls', ['lib/server/rateLimit.js'])
    expect(block).toContain('claimed_security_property')
    expect(block).toContain('trust_assumption')
    expect(block).toContain('bypass_or_uncertainty')
  })

  it('flags high-signal candidates by topic or citation path', () => {
    expect(candidateNeedsAdversarialChallenge({ topic: 'auth', evidence_citations: [] })).toBe(true)
    expect(
      candidateNeedsAdversarialChallenge({
        topic: 'dependency',
        evidence_citations: ['lib/server/rateLimit.js:1-20'],
      })
    ).toBe(true)
    expect(
      candidateNeedsAdversarialChallenge({
        topic: 'dependency',
        evidence_citations: ['docs/notes.md:1-5'],
      })
    ).toBe(false)
  })
})
