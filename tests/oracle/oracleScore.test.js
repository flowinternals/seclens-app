import { describe, expect, it } from 'vitest'
import {
  exitCodeForOracleScore,
  renderOracleOutcomeMarkdown,
  scoreIssueAgainstSections,
  scoreOracleReport,
  splitFindingSections,
} from '../../lib/server/oracleScore.js'
import { getCheapestOpenAIModelId, resolveExpectedE2EModel } from '../../lib/shared/e2eModel.js'

const baseIssue = {
  id: 'SPO-AC-001',
  severity: 'critical',
  mandatory: true,
  title: 'authz gap',
  anyOfPathHints: ['updateUserInContext', 'functions/src/userManagement.ts'],
  mustMatchAll: [
    { type: 'regex', pattern: 'updateUserInContext|removeUserFromContext', flags: 'i' },
    { type: 'regex', pattern: 'authoriz|project.?member|unauthoriz', flags: 'i' },
  ],
  rejectIfOnly: ['generic RBAC', 'RBAC may need tightening'],
}

function markersWith(issues) {
  return {
    schemaVersion: 2,
    baselineSha: '8bbb1efaf2cfa638f66fbf769a4c6ddda1cbc4da',
    passThreshold: { allCriticalHighFound: true, minFindRate: 0.8 },
    devProfile: { oracleMode: 'record' },
    issues,
  }
}

describe('e2eModel cheapest / resolve', () => {
  it('resolves gpt-5-nano as cheapest catalog model', () => {
    expect(getCheapestOpenAIModelId()).toBe('gpt-5-nano')
  })

  it('fails closed on unknown override before spend', () => {
    const result = resolveExpectedE2EModel({ overrideModelId: 'not-a-real-model' })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/Unknown or unsupported/)
  })

  it('accepts catalog override', () => {
    const result = resolveExpectedE2EModel({ overrideModelId: 'gpt-4o-mini' })
    expect(result).toEqual({ ok: true, requestedModel: 'gpt-4o-mini', source: 'override' })
  })
})

describe('splitFindingSections', () => {
  it('splits on ### headings', () => {
    const md = ['# Report', '', '### Finding A', 'body a', '', '### Finding B', 'body b'].join('\n')
    const sections = splitFindingSections(md)
    expect(sections.some((s) => s.heading === 'Finding A')).toBe(true)
    expect(sections.some((s) => s.heading === 'Finding B')).toBe(true)
  })
})

describe('scoreIssueAgainstSections', () => {
  it('true positive when all signals are in one finding', () => {
    const report = [
      '### Authz gap',
      'The exported updateUserInContext callable lacks authorization for project members.',
      'See functions/src/userManagement.ts.',
    ].join('\n')
    const sections = splitFindingSections(report)
    const scored = scoreIssueAgainstSections(baseIssue, sections)
    expect(scored.outcome).toBe('found')
    expect(scored.matchedPathHint).toBeTruthy()
    expect(scored.matchedSnippets.length).toBeGreaterThan(0)
  })

  it('cross-section false positive stays missed', () => {
    const report = [
      '### Symbols only',
      'Mentions updateUserInContext in passing.',
      '',
      '### Impact only',
      'There is an authorization gap for project members somewhere.',
    ].join('\n')
    const sections = splitFindingSections(report)
    const scored = scoreIssueAgainstSections(baseIssue, sections)
    expect(scored.outcome).not.toBe('found')
  })

  it('generic rejectIfOnly text is missed', () => {
    const report = [
      '### Hygiene',
      'RBAC may need tightening. Consider generic RBAC review.',
    ].join('\n')
    const sections = splitFindingSections(report)
    const scored = scoreIssueAgainstSections(baseIssue, sections)
    expect(scored.outcome).toBe('missed')
  })

  it('partial match when only some signals present in one section', () => {
    const report = [
      '### Partial',
      'updateUserInContext is still exported from userManagement.',
    ].join('\n')
    const sections = splitFindingSections(report)
    const scored = scoreIssueAgainstSections(baseIssue, sections)
    expect(scored.outcome).toBe('partially found')
    expect(scored.missing.length).toBeGreaterThan(0)
  })
})

describe('scoreOracleReport + exit codes', () => {
  it('record mode exits 0 even when all missed', () => {
    const score = scoreOracleReport({
      reportMarkdown: '### Empty\nNothing relevant.',
      markers: markersWith([baseIssue]),
      meta: { oracleMode: 'record', harnessStatus: 'ok', scanStatus: 'completed' },
    })
    expect(score.oracleStatus).toBe('all_missed')
    expect(score.gateStatus).toBe('not_applicable')
    expect(exitCodeForOracleScore(score)).toBe(0)
  })

  it('gate mode exits 2 on mandatory miss', () => {
    const score = scoreOracleReport({
      reportMarkdown: '### Empty\nNothing relevant.',
      markers: markersWith([baseIssue]),
      meta: { oracleMode: 'gate', harnessStatus: 'ok', scanStatus: 'completed' },
    })
    expect(score.gateStatus).toBe('failed')
    expect(exitCodeForOracleScore(score)).toBe(2)
  })

  it('harness failure exits 1', () => {
    const score = scoreOracleReport({
      reportMarkdown: '### Empty\nNothing.',
      markers: markersWith([baseIssue]),
      meta: { oracleMode: 'record', harnessStatus: 'failed', scanStatus: 'timeout' },
    })
    expect(exitCodeForOracleScore(score)).toBe(1)
  })

  it('renders CR5-shaped outcome markdown', () => {
    const score = scoreOracleReport({
      reportMarkdown: [
        '### Authz',
        'updateUserInContext lacks authorization for project members in functions/src/userManagement.ts',
      ].join('\n'),
      markers: markersWith([baseIssue]),
      meta: {
        oracleMode: 'record',
        requestedModel: 'gpt-5-nano',
        resolvedModel: 'gpt-5-nano',
        baselineComparison: 'equivalent',
      },
    })
    const md = renderOracleOutcomeMarkdown(score)
    expect(md).toContain('### SPO-AC-001')
    expect(md).toContain('outcome: `found`')
    expect(md).toContain('harnessStatus: `ok`')
  })
})
