import { describe, it, expect } from 'vitest'
import {
  validateReport,
  validateSeverityEvidence,
  hasMisleadingFirebaseSecretClassification,
  hasSpeculativeMediumFinding,
  hasUnboundedAbsenceClaim,
} from '../../api/utils/reportValidation.js'
import { SECTION_TITLES_ORDER } from '../../api/prompts/seclens-output-contract-v2.js'
import { buildRepoDataFromFixture } from '../fixtures/buildRepoFixture.js'

function minimalValidReport() {
  const sections = SECTION_TITLES_ORDER.map((title, i) => {
    if (title === 'Key Findings (Prioritized)') {
      return `## ${title}\n\nNo findings were identified within the scanned scope.\n`
    }
    return `## ${title}\n\nSection content ${i + 1}. Use Not evidenced where applicable.\n`
  }).join('\n')

  return `# SecLens Security Report

- **Repository:** owner/repo (https://github.com/owner/repo)
- **Ref:** unknown
- **Generated:** 2026-04-28T12:00:00.000Z
- **Languages:** JavaScript
- **Summary Risk:** Low — limited scan scope.

${sections}
`
}

function fullReportWithKeyFindingsBody(keyFindingsInner) {
  const sections = SECTION_TITLES_ORDER.map((title, i) => {
    if (title === 'Key Findings (Prioritized)') {
      return `## ${title}\n\n${keyFindingsInner}\n`
    }
    return `## ${title}\n\nSection content ${i + 1}. Use Not evidenced where applicable.\n`
  }).join('\n')

  return `# SecLens Security Report

- **Repository:** owner/repo (https://github.com/owner/repo)
- **Ref:** unknown
- **Generated:** 2026-04-28T12:00:00.000Z
- **Languages:** JavaScript
- **Summary Risk:** Low — limited scan scope.

${sections}
`
}

describe('validateReport', () => {
  it('accepts a minimal contract-compliant report', () => {
    const r = validateReport(minimalValidReport())
    expect(r.ok).toBe(true)
    expect(r.categories).toEqual([])
  })

  it('rejects wrong H1 title', () => {
    const bad = minimalValidReport().replace('# SecLens Security Report', '# Wrong Title')
    const r = validateReport(bad)
    expect(r.ok).toBe(false)
    expect(r.categories).toContain('STRUCTURE')
  })

  it('rejects GitHub PAT-like leakage', () => {
    const token = `github_pat_${'x'.repeat(22)}`
    const bad = `${minimalValidReport()}\n\n${token}\n`
    const r = validateReport(bad)
    expect(r.ok).toBe(false)
    expect(r.categories).toContain('LEAKAGE')
  })

  it('adds SEVERITY_EVIDENCE when High lacks exploit path (DEFECT-001)', () => {
    const inner = `### [High] API Key Exposure Risk

**Evidence:** \`api/utils/openai.js\`
**Why it matters:** Keys could matter.
**Fix (recommended):** Rotate keys.
`
    const r = validateReport(fullReportWithKeyFindingsBody(inner))
    expect(r.ok).toBe(false)
    expect(r.categories).toContain('SEVERITY_EVIDENCE')
  })

  it('accepts High finding with exploit path and required fields', () => {
    const inner = `### [High] Unsafe Route

**Category:** A01:2021 — Broken Access Control
**Evidence:** \`server/routes/admin.js\`
**Exploit path:** An unauthenticated caller can POST to /admin/delete because the handler does not verify session, leading to destructive action as coded in the excerpt.
**Why it matters:** Unauthorized state change.
**Fix (recommended):** Require auth middleware on the route.
`
    const r = validateReport(fullReportWithKeyFindingsBody(inner))
    expect(r.ok).toBe(true)
  })

  it('does not require exploit path for Medium findings', () => {
    const inner = `### [Medium] Style issue

**Evidence:** \`src/x.js\`
**Why it matters:** Minor.
**Fix (recommended):** Refactor.
`
    expect(validateSeverityEvidence(inner)).toBe(true)
  })

  it('flags misleading Firebase public config as secret exposure (DEFECT-003)', () => {
    const inner = `### [Low] Exposure of Environment Variables

**Category:** Configuration Management
**Evidence:** \`.env.example\`
**Why it matters:** The example environment file contains sensitive keys (e.g., NEXT_PUBLIC_FIREBASE_API_KEY) that could lead to unauthorized access to Firebase services.
**Fix (recommended):** Remove exposed values from examples.
`
    const report = fullReportWithKeyFindingsBody(inner)
    const r = validateReport(report)
    expect(hasMisleadingFirebaseSecretClassification(inner)).toBe(true)
    expect(r.ok).toBe(false)
    expect(r.categories).toContain('MISLEADING_SECRET_CLASSIFICATION')
  })

  it('accepts Firebase public config guidance when phrased as Info', () => {
    const inner = `### [Info] Firebase Client Configuration Review

**Category:** Configuration Review
**Evidence:** \`.env.example\`
**Why it matters:** Firebase client config values such as NEXT_PUBLIC_FIREBASE_API_KEY are normally public and not secret exposure by themselves. Review Firebase rules, App Check, allowed domains, and key restrictions.
**Fix (recommended):** Keep service-account credentials private and validate Firebase security rules.
`
    const report = fullReportWithKeyFindingsBody(inner)
    const r = validateReport(report)
    expect(hasMisleadingFirebaseSecretClassification(inner)).toBe(false)
    expect(r.categories).not.toContain('MISLEADING_SECRET_CLASSIFICATION')
  })

  it('flags conditional Medium finding without concrete weakness (DEFECT-004)', () => {
    const inner = `### [Medium] Insecure Handling of Secrets

**Category:** Configuration Management
**Evidence:** \`functions/src/config/params.ts\`
**Why it matters:** The repository uses Firebase secret management. However, if not properly configured, secrets could be exposed.
**Fix (recommended):** Review access controls for secret manager.
`
    const report = fullReportWithKeyFindingsBody(inner)
    const r = validateReport(report)
    expect(hasSpeculativeMediumFinding(inner)).toBe(true)
    expect(r.ok).toBe(false)
    expect(r.categories).toContain('SPECULATIVE_FINDING')
  })

  it('flags generic Medium validation claim without specific failure path (DEFECT-004)', () => {
    const inner = `### [Medium] Lack of Input Validation

**Category:** Input Validation
**Evidence:** \`functions/src/handlers/checkout.ts\`, \`functions/src/handlers/credits.ts\`
**Why it matters:** While there is some input validation, the handling could be further strengthened.
**Fix (recommended):** Consider adding stronger checks.
`
    const report = fullReportWithKeyFindingsBody(inner)
    const r = validateReport(report)
    expect(hasSpeculativeMediumFinding(inner)).toBe(true)
    expect(r.ok).toBe(false)
    expect(r.categories).toContain('SPECULATIVE_FINDING')
  })

  it('accepts Medium finding when concrete weakness and impact path are evidenced', () => {
    const inner = `### [Medium] Missing Ownership Check in Credits Top-Up

**Category:** Broken Access Control
**Evidence:** \`functions/src/handlers/credits.ts\`
**Why it matters:** The endpoint accepts a target account id without validating ownership in this handler, which can allow an authenticated attacker to tamper with another account's credit balance.
**Fix (recommended):** Enforce account ownership verification before processing top-up operations.
`
    const report = fullReportWithKeyFindingsBody(inner)
    const r = validateReport(report)
    expect(hasSpeculativeMediumFinding(inner)).toBe(false)
    expect(r.categories).not.toContain('SPECULATIVE_FINDING')
  })

  it('flags unbounded non-finding absence claims (DEFECT-006)', () => {
    const report = fullReportWithKeyFindingsBody(`No findings were identified within the scanned scope.`)
      .replace(
        '## Rate Limiting & Abuse Controls\n\nSection content 8. Use Not evidenced where applicable.\n',
        '## Rate Limiting & Abuse Controls\n\nNo explicit rate limiting controls were observed in the API.\n'
      )
    const r = validateReport(report)
    expect(hasUnboundedAbsenceClaim(report)).toBe(true)
    expect(r.ok).toBe(false)
    expect(r.categories).toContain('UNBOUNDED_ABSENCE_CLAIM')
  })

  it('accepts bounded non-finding claims with scanned scope basis', () => {
    const report = fullReportWithKeyFindingsBody(`No findings were identified within the scanned scope.`)
      .replace(
        '## Rate Limiting & Abuse Controls\n\nSection content 8. Use Not evidenced where applicable.\n',
        '## Rate Limiting & Abuse Controls\n\nNo per-route throttling was observed in scanned files: `api/openai/section.ts`, `api/openai/optimise-section-prompts.ts`. Coverage is limited to files included in this scan.\n'
      )
    const r = validateReport(report)
    expect(hasUnboundedAbsenceClaim(report)).toBe(false)
    expect(r.categories).not.toContain('UNBOUNDED_ABSENCE_CLAIM')
  })

  it('flags repository-level CI/CD absence claim without scan-bounded basis', () => {
    const report = fullReportWithKeyFindingsBody(`No findings were identified within the scanned scope.`)
      .replace(
        '## CI/CD & Operational Hardening\n\nSection content 5. Use Not evidenced where applicable.\n',
        '## CI/CD & Operational Hardening\n\nThe repository does not currently include CI/CD configurations.\n'
      )
    const r = validateReport(report)
    expect(hasUnboundedAbsenceClaim(report)).toBe(true)
    expect(r.categories).toContain('UNBOUNDED_ABSENCE_CLAIM')
  })

  it('accepts CI/CD absence claim when explicitly tied to scan coverage limits', () => {
    const report = fullReportWithKeyFindingsBody(`No findings were identified within the scanned scope.`)
      .replace(
        '## CI/CD & Operational Hardening\n\nSection content 5. Use Not evidenced where applicable.\n',
        '## CI/CD & Operational Hardening\n\nNot evidenced in scanned files. The scan did not include CI workflow files such as `.github/workflows/*`, so CI/CD hardening cannot be assessed from this run.\n'
      )
    const r = validateReport(report)
    expect(hasUnboundedAbsenceClaim(report)).toBe(false)
    expect(r.categories).not.toContain('UNBOUNDED_ABSENCE_CLAIM')
  })
})

describe('golden fixture repoData loaders', () => {
  it('loads tiny-react-safe', () => {
    const d = buildRepoDataFromFixture('tiny-react-safe')
    expect(d.files.length).toBeGreaterThan(0)
    expect(d.files.some((f) => f.path.endsWith('package.json'))).toBe(true)
  })

  it('loads node-express-issues with unmistakable fake secret (no real token prefixes)', () => {
    const d = buildRepoDataFromFixture('node-express-issues')
    const joined = d.files.map((f) => f.content).join('\n')
    expect(joined).toContain('FAKE_TEST_SECRET_DO_NOT_USE')
    expect(joined).not.toMatch(/\bghp_[a-zA-Z0-9]{20,}\b/)
    expect(joined).not.toMatch(/\bgithub_pat_[a-zA-Z0-9_]{20,}\b/i)
  })
})
