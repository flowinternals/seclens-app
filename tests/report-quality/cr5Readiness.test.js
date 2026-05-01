import { describe, expect, it } from 'vitest'
import {
  evaluateCr5Readiness,
  parseTelemetryLog,
  readOracleOutcomesFromFolder,
} from '../../lib/server/cr5Readiness.js'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('parseTelemetryLog', () => {
  it('parses telemetry markdown table rows', () => {
    const md = [
      '| Timestamp (UTC) | Repo | Profile | Max Files | Bytes/File | Total Evidence Bytes | Tree Cap | Selected/Omitted | Cap Hits | Duration | Contract | Validation | Critic | Draft In | Draft Out | Critic In | Critic Out | Total Tokens | Est. Cost USD | QA Verdict | Correlation ID |',
      '|---|---|---|---:|---:|---:|---:|---|---|---|---|---|---|---:|---:|---:|---:|---:|---:|---|---|',
      '| 2026-05-01 01:00 | `foo/bar` | `custom` | - | - | - | - | - | - | - | `2.0.5` | OK | No | 1 | 1 | 0 | 0 | 2 | 0.00001 | `Validator OK / QA concerns` | `abc` |',
    ].join('\n')

    const rows = parseTelemetryLog(md)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual({
      timestamp: '2026-05-01 01:00',
      repo: 'foo/bar',
      qaVerdict: 'Validator OK / QA concerns',
      correlationId: 'abc',
    })
  })
})

describe('evaluateCr5Readiness', () => {
  it('fails readiness when launch gate has <=20 passing repos', () => {
    const telemetryRows = [
      { timestamp: '2026-05-01 01:00', repo: 'foo/bar', qaVerdict: 'Closure-grade' },
      { timestamp: '2026-05-01 02:00', repo: 'foo/bar', qaVerdict: 'Closure-grade' },
    ]
    const oracleOutcomes = [
      {
        repo: 'foo/bar',
        recall: 0.91,
        criticalHighAllFound: true,
        reportQualityAccepted: true,
        telemetryComplete: true,
        pass: true,
        issueCount: 2,
        hasCanonicalIssueEvidence: true,
      },
    ]
    const report = evaluateCr5Readiness({ telemetryRows, oracleOutcomes, nonRegressionGreen: true })
    expect(report.readinessPassed).toBe(false)
    expect(report.launchGatePassed).toBe(false)
  })

  it('fails closed when Critical/High status is unknown', () => {
    const report = evaluateCr5Readiness({
      telemetryRows: [],
      oracleOutcomes: [
        {
          repo: 'foo/bar',
          recall: 0.95,
          criticalHighAllFound: null,
          reportQualityAccepted: true,
          telemetryComplete: true,
          pass: true,
          issueCount: 2,
          hasCanonicalIssueEvidence: true,
        },
      ],
      nonRegressionGreen: true,
    })
    expect(report.criticalHighRuleRespected).toBe(false)
    expect(report.readinessPassed).toBe(false)
  })

  it('treats zero expected Critical/High issues as satisfying the rule', () => {
    const report = evaluateCr5Readiness({
      telemetryRows: [],
      oracleOutcomes: [
        {
          repo: 'foo/bar',
          recall: null,
          criticalHighAllFound: true,
          reportQualityAccepted: true,
          telemetryComplete: true,
          pass: false,
          issueCount: 2,
          hasCanonicalIssueEvidence: true,
        },
      ],
      nonRegressionGreen: true,
    })
    expect(report.criticalHighRuleRespected).toBe(true)
  })

  it('requires passing oracle repos to also be consistently passing in telemetry', () => {
    const telemetryRows = [
      { timestamp: '2026-05-01 01:00', repo: 'foo/bar', qaVerdict: 'Quality-gate fail' },
      { timestamp: '2026-05-01 02:00', repo: 'foo/bar', qaVerdict: 'Quality-gate fail' },
    ]
    const oracleOutcomes = Array.from({ length: 21 }, (_, i) => ({
      repo: i === 0 ? 'foo/bar' : `repo/${i}`,
      recall: 0.95,
      criticalHighAllFound: true,
      reportQualityAccepted: true,
      telemetryComplete: true,
      pass: true,
      issueCount: 3,
      comparedIssueCount: 3,
      hasCanonicalIssueEvidence: true,
    }))
    const report = evaluateCr5Readiness({ telemetryRows, oracleOutcomes, nonRegressionGreen: true })
    expect(report.allPassingReposTelemetryConsistent).toBe(false)
    expect(report.launchGatePassed).toBe(false)
    expect(report.readinessPassed).toBe(false)
  })

  it('does not count summary-only oracle entries without full per-issue comparison outcomes', () => {
    const telemetryRows = [
      { timestamp: '2026-05-01 01:00', repo: 'foo/bar', qaVerdict: 'Closure-grade' },
      { timestamp: '2026-05-01 02:00', repo: 'foo/bar', qaVerdict: 'Closure-grade' },
    ]
    const report = evaluateCr5Readiness({
      telemetryRows,
      oracleOutcomes: [
        {
          repo: 'foo/bar',
          recall: 1.0,
          criticalHighAllFound: true,
          reportQualityAccepted: true,
          telemetryComplete: true,
          pass: true,
          issueCount: 3,
          comparedIssueCount: 0,
          hasCanonicalIssueEvidence: true,
        },
      ],
      nonRegressionGreen: true,
    })
    expect(report.oracleCoverage.passingRepos).toBe(0)
    expect(report.readinessPassed).toBe(false)
  })
})

describe('readOracleOutcomesFromFolder', () => {
  it('derives recall and critical/high results from per-issue outcomes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cr5-'))
    try {
      writeFileSync(
        join(dir, 'foo-bar-acceptance-criteria.md'),
        [
          '- Repo: `foo/bar`',
          '- Report quality accepted: Yes',
          '- Telemetry complete: Yes',
          '- Final verdict: Pass',
          '',
          '| Issue ID | Severity | Outcome |',
          '|---|---|---|',
          '| SEC-001 | Critical | found |',
          '| SEC-002 | High | found |',
          '| SEC-003 | Medium | missed |',
        ].join('\n')
      )

      const outcomes = readOracleOutcomesFromFolder(dir)
      expect(outcomes).toHaveLength(1)
      expect(outcomes[0].repo).toBe('foo/bar')
      expect(outcomes[0].issueCount).toBe(3)
      expect(outcomes[0].foundCount).toBe(2)
      expect(outcomes[0].recall).toBeCloseTo(2 / 3, 5)
      expect(outcomes[0].criticalHighAllFound).toBe(true)
      expect(outcomes[0].hasCanonicalIssueEvidence).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('parses canonical multiline AC issue blocks', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cr5-'))
    try {
      writeFileSync(
        join(dir, 'foo-bar-acceptance-criteria.md'),
        [
          '## Summary',
          '- repo: `foo/bar`',
          '',
          '## Expected issues',
          '',
          '### FOO-001',
          '- severity: `Critical`',
          '- mandatory pass flag: `true`',
          '',
          '### FOO-002',
          '- severity: `Low`',
          '- mandatory pass flag: `false`',
          '',
          '## Notes',
          '- no per-issue comparison outcomes yet',
        ].join('\n')
      )

      const outcomes = readOracleOutcomesFromFolder(dir)
      expect(outcomes).toHaveLength(1)
      expect(outcomes[0].repo).toBe('foo/bar')
      expect(outcomes[0].issueCount).toBe(2)
      expect(outcomes[0].hasCanonicalIssueEvidence).toBe(true)
      expect(outcomes[0].criticalHighAllFound).toBe(null)
      expect(outcomes[0].comparedIssueCount).toBe(0)
      expect(outcomes[0].recall).toBe(null)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
