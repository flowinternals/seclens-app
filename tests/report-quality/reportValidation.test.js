import { describe, it, expect } from 'vitest'
import {
  validateReport,
  validateSeverityEvidence,
  hasMisleadingFirebaseSecretClassification,
  hasSpeculativeMediumFinding,
  hasGenericKeyFindingAdmissionFailure,
  hasUnboundedAbsenceClaim,
  hasSummaryRiskInconsistentWithFindings,
  hasUnscopedGenericQuickWins,
  hasNoFindingsContradictoryGapAssertions,
  hasNotEvidencedRecommendationDrift,
  hasConsolidatedSummaryPostureMismatch,
  hasConsolidatedExecutiveCompletenessMismatch,
} from '../../lib/server/reportValidation.js'
import {
  SECTION_TITLES_ORDER,
  SECTION_PRIORITIZED_RECOMMENDATIONS,
} from '../../lib/prompts/seclens-output-contract-v2.js'
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

  it('accepts High finding evidence path for firestore.rules line ranges', () => {
    const inner = `### [High] Firestore rule bypass

**Category:** Broken Access Control
**Evidence:** \`firestore.rules:1-442\`
**Exploit path:** An unauthorized actor can target match /orgs/{orgId}/projects/{projectId} and update documents because the rule does not bind request.auth.token.orgId to orgId, enabling cross-tenant write tampering.
**Why it matters:** This allows unauthorized write access across organization boundaries.
**Fix (recommended):** Enforce orgId predicate checks on write operations in the cited match block.
`
    const r = validateReport(fullReportWithKeyFindingsBody(inner))
    expect(r.categories).not.toContain('SEVERITY_EVIDENCE')
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

  it('flags placeholder-only env template as secret exposure claim', () => {
    const inner = `### [Medium] Potential Exposure of Secrets

**Category:** Sensitive Data Exposure
**Evidence:** \`.env.example:1-54\`
**Why it matters:** The template includes placeholder values and setup guidance, which may expose secrets.
**Fix (recommended):** Remove the example entries.
`
    const report = fullReportWithKeyFindingsBody(inner)
    const r = validateReport(report)
    expect(hasMisleadingFirebaseSecretClassification(inner)).toBe(true)
    expect(r.categories).toContain('MISLEADING_SECRET_CLASSIFICATION')
  })

  it('flags env-template-only hardcoded secret framing from latest live defect artifact', () => {
    const inner = `### [Medium] Hardcoded Secrets in Configuration Files

**Category:** Configuration Management
**Evidence:** \`.env.example:1-54\`, \`gcp-mcp-server/.env.example:1-28\`
**Why it matters:** Hardcoded secrets or sensitive information in configuration files can lead to unauthorized access if these files are exposed or mismanaged.
**Fix (recommended):** Move secrets out of source-controlled configuration files.
`
    const report = fullReportWithKeyFindingsBody(inner)
    const r = validateReport(report)
    expect(hasMisleadingFirebaseSecretClassification(inner)).toBe(true)
    expect(r.categories).toContain('MISLEADING_SECRET_CLASSIFICATION')
  })

  it('accepts env-template-only Info configuration review without vulnerability framing', () => {
    const inner = `### [Info] Environment Template Configuration Review

**Category:** Configuration Review
**Evidence:** \`.env.example:1-54\`, \`gcp-mcp-server/.env.example:1-28\`
**Why it matters:** The referenced files appear to be templates with placeholder names and setup guidance. This evidence alone does not prove committed secret material.
**Fix (recommended):** Keep template values non-sensitive and verify real secrets are managed at runtime.
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

  it('flags Medium finding that says validation exists but "could be improved" (live DEFECT-004 replay)', () => {
    const inner = `### [Medium] Lack of Input Validation in API Endpoints

**Category:** Input Validation
**Evidence:** \`app/api/admin/add-recruiter/route.ts:1-111\`
**Why it matters:** Insufficient input validation can lead to various attacks, including injection attacks and data corruption. In the addRecruiter endpoint, while there is some validation using Zod, the overall handling of user input could be improved to ensure all fields are properly validated.
**Fix (recommended):** Implement comprehensive validation for all input fields across API endpoints, ensuring that all required fields are checked and that data types are enforced.
`
    const report = fullReportWithKeyFindingsBody(inner)
    const r = validateReport(report)
    expect(hasSpeculativeMediumFinding(inner)).toBe(true)
    expect(r.ok).toBe(false)
    expect(r.categories).toContain('SPECULATIVE_FINDING')
  })

  it('flags accepted-run generic Medium validation claim without named missing rule/trust boundary', () => {
    const inner = `### [Medium] Insufficient Input Validation in API Endpoints

**Category:** Input Validation
**Evidence:** \`app/api/admin/add-recruiter/route.ts:1-111\`
**Why it matters:** Insufficient input validation can lead to various attacks, including injection attacks and data corruption. The lack of strict validation on user inputs may allow malicious data to be processed by the application.
**Fix (recommended):** Implement stricter validation rules using libraries like \`zod\` or \`Joi\` to ensure all inputs conform to expected formats.
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

  it('flags generic rate-limiting advice in Key Findings without concrete file-level weakness (CR-005)', () => {
    const inner = `### [Low] Lack of Rate Limiting on API Endpoints

**Category:** Rate Limiting & Abuse Controls
**Evidence:** \`app/api/admin/add-recruiter/route.ts:1-111\`
**Why it matters:** Adding rate limiting would improve resilience against abuse.
**Fix (recommended):** Add throttling to public APIs.
`
    const report = fullReportWithKeyFindingsBody(inner)
    const r = validateReport(report)
    expect(hasGenericKeyFindingAdmissionFailure(inner)).toBe(true)
    expect(r.categories).toContain('KEY_FINDING_ADMISSION')
  })

  it('flags generic security-header advice in Key Findings without response-layer evidence (CR-005)', () => {
    const inner = `### [Info] Missing Security Headers

**Category:** Web Security Controls
**Evidence:** \`app/api/admin/add-recruiter/route.ts:1-111\`
**Why it matters:** Security headers should be implemented as a best practice.
**Fix (recommended):** Add CSP, HSTS, and X-Frame-Options headers.
`
    const report = fullReportWithKeyFindingsBody(inner)
    const r = validateReport(report)
    expect(hasGenericKeyFindingAdmissionFailure(inner)).toBe(true)
    expect(r.categories).toContain('KEY_FINDING_ADMISSION')
  })

  it('flags High validation finding without specific missing rule/trust boundary (CR-005)', () => {
    const inner = `### [High] Inadequate Input Validation

**Category:** Input Validation
**Evidence:** \`app/api/admin/add-recruiter/route.ts:1-111\`
**Exploit path:** Attackers can submit crafted input to endpoints.
**Why it matters:** Input validation may be insufficient and could allow abuse.
**Fix (recommended):** Strengthen validation using schema libraries.
`
    const report = fullReportWithKeyFindingsBody(inner)
    const r = validateReport(report)
    expect(hasGenericKeyFindingAdmissionFailure(inner)).toBe(true)
    expect(r.categories).toContain('KEY_FINDING_ADMISSION')
  })

  it('accepts Low key finding when a concrete missing control is named with scoped path evidence', () => {
    const inner = `### [Low] Missing CSP Header in Express Response Layer

**Category:** Web Security Controls
**Evidence:** \`server/app.js:1-120\`, \`server/middleware/securityHeaders.js:1-40\`
**Why it matters:** The Express bootstrap does not register Helmet/CSP middleware before route handlers, so responses can be returned without Content-Security-Policy headers for scanned server paths.
**Fix (recommended):** Register CSP middleware in the response pipeline before route registration and validate with integration tests.
`
    const report = fullReportWithKeyFindingsBody(inner)
    const r = validateReport(report)
    expect(hasGenericKeyFindingAdmissionFailure(inner)).toBe(false)
    expect(r.categories).not.toContain('KEY_FINDING_ADMISSION')
  })

  it('flags Medium runtime-control absence claim supported only by env template evidence', () => {
    const inner = `### [Medium] Insufficient Rate Limiting

**Category:** Abuse Controls
**Evidence:** \`gcp-mcp-server/.env.example:1-28\`
**Why it matters:** Rate limiting is not enforced.
**Fix (recommended):** Enable and configure throttling.
`
    const report = fullReportWithKeyFindingsBody(inner)
    const r = validateReport(report)
    expect(hasSpeculativeMediumFinding(inner)).toBe(true)
    expect(r.categories).toContain('SPECULATIVE_FINDING')
  })

  it('flags policy-style Medium CI/CD workflow hardening claim without concrete unsafe setting', () => {
    const inner = `### [Medium] CI/CD Security Practices

**Category:** CI/CD & Operational Hardening
**Evidence:** \`.github/workflows/ci-security.yml:1-51\`
**Why it matters:** The workflow could allow vulnerabilities to reach production and should be stricter.
**Fix (recommended):** Add additional checks.
`
    const report = fullReportWithKeyFindingsBody(inner)
    const r = validateReport(report)
    expect(hasSpeculativeMediumFinding(inner)).toBe(true)
    expect(r.categories).toContain('SPECULATIVE_FINDING')
  })

  it('accepts Medium CI/CD workflow finding when concrete unsafe setting is cited', () => {
    const inner = `### [Medium] CI gate allows medium vulnerabilities

**Category:** CI/CD & Operational Hardening
**Evidence:** \`.github/workflows/ci-security.yml:1-51\`
**Why it matters:** The workflow runs \`npm audit --audit-level=high\`, so vulnerabilities rated medium are not blocking in this gate and can be merged, which may allow known vulnerable dependencies into production.
**Fix (recommended):** Use \`npm audit --audit-level=moderate\` for blocking checks.
`
    const report = fullReportWithKeyFindingsBody(inner)
    const r = validateReport(report)
    expect(hasSpeculativeMediumFinding(inner)).toBe(false)
    expect(r.categories).not.toContain('SPECULATIVE_FINDING')
  })

  it('accepts Medium when Why uses ensure but states concrete weakness and unauthorized impact', () => {
    const inner = `### [Medium] Broken session binding

**Category:** Access control
**Evidence:** \`api/user.ts\`
**Why it matters:** The handler does not appear to validate the subject against the authenticated session, which enables unauthorized access to another user's profile. Ensure authorization is enforced before reads.
**Fix (recommended):** Resolve the principal from the session token only.
`
    const report = fullReportWithKeyFindingsBody(inner)
    expect(hasSpeculativeMediumFinding(inner)).toBe(false)
    expect(validateReport(report).categories).not.toContain('SPECULATIVE_FINDING')
  })

  it('does not flag Medium when hedge words appear only in Fix (recommended)', () => {
    const inner = `### [Medium] Missing Ownership Check in Credits Top-Up

**Category:** Broken Access Control
**Evidence:** \`functions/src/handlers/credits.ts\`
**Why it matters:** The endpoint accepts a target account id without validating ownership in this handler, which can allow an authenticated attacker to tamper with another account's credit balance.
**Fix (recommended):** Review access controls and ensure ownership is verified before processing top-up operations.
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

  it('accepts non-finding absence-adjacent wording when line-range path citations provide basis (CR-008)', () => {
    const report = fullReportWithKeyFindingsBody(`No findings were identified within the scanned scope.`)
      .replace(
        '## Rate Limiting & Abuse Controls\n\nSection content 8. Use Not evidenced where applicable.\n',
        '## Rate Limiting & Abuse Controls\n\nNo explicit rate limiting was identified in scanned excerpt `api/routes.ts:10-40`.\n'
      )
    expect(hasUnboundedAbsenceClaim(report)).toBe(false)
    expect(validateReport(report).categories).not.toContain('UNBOUNDED_ABSENCE_CLAIM')
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

  it('flags summary risk above highest finding without bounded rationale', () => {
    const inner = `### [Low] Insecure Handling of Personal Access Tokens

**Category:** Configuration Management
**Evidence:** \`cmd/github-mcp-server/main.go:1-115\`
**Why it matters:** The server requires a token and this can increase operational risk if mishandled.
**Fix (recommended):** Keep tokens in secure stores and rotate regularly.
`
    const report = fullReportWithKeyFindingsBody(inner).replace(
      '**Summary Risk:** Low — limited scan scope.',
      '**Summary Risk:** Medium — potential for misconfiguration and insufficient access control in server operations.'
    )
    const r = validateReport(report)
    expect(hasSummaryRiskInconsistentWithFindings(report, inner)).toBe(true)
    expect(r.categories).toContain('SUMMARY_RISK_INCONSISTENT')
  })

  it('accepts summary risk above findings when explicitly bounded by scan coverage rationale', () => {
    const inner = `### [Low] Insecure Handling of Personal Access Tokens

**Category:** Configuration Management
**Evidence:** \`cmd/github-mcp-server/main.go:1-115\`
**Why it matters:** The server requires a token and this can increase operational risk if mishandled.
**Fix (recommended):** Keep tokens in secure stores and rotate regularly.
`
    const report = fullReportWithKeyFindingsBody(inner).replace(
      '**Summary Risk:** Low — limited scan scope.',
      '**Summary Risk:** Medium — due to limited scanned coverage in this run (40 selected, many omitted), residual risk may be understated by the observed Low findings.'
    )
    const r = validateReport(report)
    expect(hasSummaryRiskInconsistentWithFindings(report, inner)).toBe(false)
    expect(r.categories).not.toContain('SUMMARY_RISK_INCONSISTENT')
  })

  it('flags summary risk Medium when Key Findings admits no findings without bounded rationale', () => {
    const report = fullReportWithKeyFindingsBody(`No findings were identified within the scanned scope.`).replace(
      '**Summary Risk:** Low — limited scan scope.',
      '**Summary Risk:** Medium — user-management and authorization concerns remain.'
    )
    const r = validateReport(report)
    expect(hasSummaryRiskInconsistentWithFindings(report, 'No findings were identified within the scanned scope.')).toBe(
      true
    )
    expect(r.categories).toContain('SUMMARY_RISK_INCONSISTENT')
  })

  it('flags generic unscoped Quick Wins directives without evidence basis', () => {
    const report = fullReportWithKeyFindingsBody(`No findings were identified within the scanned scope.`).replace(
      `## ${SECTION_PRIORITIZED_RECOMMENDATIONS}\n\nSection content 11. Use Not evidenced where applicable.\n`,
      `## ${SECTION_PRIORITIZED_RECOMMENDATIONS}\n\n1. Implement stricter authorization checks.\n2. Add duplicate organization checks.\n3. Enhance rate limiting for sensitive operations.\n`
    )
    const r = validateReport(report)
    expect(hasUnscopedGenericQuickWins(report)).toBe(true)
    expect(r.categories).toContain('QUICK_WINS_UNSCOPED')
  })

  it('accepts scoped Quick Wins when conditional and evidence-bounded', () => {
    const report = fullReportWithKeyFindingsBody(`No findings were identified within the scanned scope.`).replace(
      `## ${SECTION_PRIORITIZED_RECOMMENDATIONS}\n\nSection content 11. Use Not evidenced where applicable.\n`,
      `## ${SECTION_PRIORITIZED_RECOMMENDATIONS}\n\n1. For scanned \`functions/src/createUserAndInvite.ts\`, consider validating authorization boundary assumptions with targeted tests.\n2. If invite flows outside scanned files exist, consider extending rate limiting coverage.\n`
    )
    const r = validateReport(report)
    expect(hasUnscopedGenericQuickWins(report)).toBe(false)
    expect(r.categories).not.toContain('QUICK_WINS_UNSCOPED')
  })

  it('flags mixed Quick Wins when one scoped item coexists with generic imperative item', () => {
    const report = fullReportWithKeyFindingsBody(`No findings were identified within the scanned scope.`).replace(
      `## ${SECTION_PRIORITIZED_RECOMMENDATIONS}\n\nSection content 11. Use Not evidenced where applicable.\n`,
      `## ${SECTION_PRIORITIZED_RECOMMENDATIONS}\n\n1. For scanned \`functions/src/createUserAndInvite.ts\`, consider adding targeted authorization tests.\n2. Implement stricter authorization checks in user management functions.\n`
    )
    const r = validateReport(report)
    expect(hasUnscopedGenericQuickWins(report)).toBe(true)
    expect(r.categories).toContain('QUICK_WINS_UNSCOPED')
  })

  it('flags Quick Wins that only mention bare file path without line-cited basis', () => {
    const report = fullReportWithKeyFindingsBody(`No findings were identified within the scanned scope.`).replace(
      `## ${SECTION_PRIORITIZED_RECOMMENDATIONS}\n\nSection content 11. Use Not evidenced where applicable.\n`,
      `## ${SECTION_PRIORITIZED_RECOMMENDATIONS}\n\n1. Implement stricter input validation in \`functions/src/createUserAndInvite.ts\`.\n`
    )
    const r = validateReport(report)
    expect(hasUnscopedGenericQuickWins(report)).toBe(true)
    expect(r.categories).toContain('QUICK_WINS_UNSCOPED')
  })

  it('flags no-findings reports that assert concrete non-finding security gaps as facts', () => {
    const report = fullReportWithKeyFindingsBody(`No findings were identified within the scanned scope.`).replace(
      '## Web Security Controls\n\nSection content 6. Use Not evidenced where applicable.\n',
      '## Web Security Controls\n\nThere are still gaps in input validation and error handling that need to be addressed.\n'
    )
    const r = validateReport(report)
    expect(hasNoFindingsContradictoryGapAssertions(report, 'No findings were identified within the scanned scope.')).toBe(
      true
    )
    expect(r.categories).toContain('NO_FINDINGS_GAP_ASSERTION')
  })

  it('accepts no-findings reports when non-finding concerns are conditional/scoped', () => {
    const report = fullReportWithKeyFindingsBody(`No findings were identified within the scanned scope.`).replace(
      '## Web Security Controls\n\nSection content 6. Use Not evidenced where applicable.\n',
      '## Web Security Controls\n\nNot evidenced in scanned files included in this run. Coverage is limited, and additional validation/error-handling checks may be needed if present in omitted paths.\n'
    )
    const r = validateReport(report)
    expect(hasNoFindingsContradictoryGapAssertions(report, 'No findings were identified within the scanned scope.')).toBe(
      false
    )
    expect(r.categories).not.toContain('NO_FINDINGS_GAP_ASSERTION')
  })

  it('flags no-findings soft narrative gap assertions in Executive Summary', () => {
    const report = fullReportWithKeyFindingsBody(`No findings were identified within the scanned scope.`).replace(
      '## Executive Summary\n\nSection content 1. Use Not evidenced where applicable.\n',
      '## Executive Summary\n\nThere are areas that require attention in authorization and validation handling.\n'
    )
    const r = validateReport(report)
    expect(
      hasNoFindingsContradictoryGapAssertions(report, 'No findings were identified within the scanned scope.')
    ).toBe(true)
    expect(r.categories).toContain('NO_FINDINGS_GAP_ASSERTION')
  })

  it('flags no-findings broad rate-limit assertions stated as facts', () => {
    const report = fullReportWithKeyFindingsBody(`No findings were identified within the scanned scope.`).replace(
      '## Rate Limiting & Abuse Controls\n\nSection content 8. Use Not evidenced where applicable.\n',
      '## Rate Limiting & Abuse Controls\n\nAdditional measures are needed to cover all user-facing endpoints.\n'
    )
    const r = validateReport(report)
    expect(
      hasNoFindingsContradictoryGapAssertions(report, 'No findings were identified within the scanned scope.')
    ).toBe(true)
    expect(r.categories).toContain('NO_FINDINGS_GAP_ASSERTION')
  })

  it('flags no-findings soft advisory assertions like "should be considered"', () => {
    const report = fullReportWithKeyFindingsBody(`No findings were identified within the scanned scope.`).replace(
      '## Web Security Controls\n\nSection content 6. Use Not evidenced where applicable.\n',
      '## Web Security Controls\n\nAdditional measures such as CSP headers should be considered.\n'
    )
    const r = validateReport(report)
    expect(
      hasNoFindingsContradictoryGapAssertions(report, 'No findings were identified within the scanned scope.')
    ).toBe(true)
    expect(r.categories).toContain('NO_FINDINGS_GAP_ASSERTION')
  })

  it('flags directive recommendation drift after not-evidenced bounded statement', () => {
    const report = fullReportWithKeyFindingsBody(`No findings were identified within the scanned scope.`).replace(
      '## Rate Limiting & Abuse Controls\n\nSection content 8. Use Not evidenced where applicable.\n',
      '## Rate Limiting & Abuse Controls\n\nNot evidenced in scanned files included in this run. Coverage is limited to files selected for this scan, and omitted paths were not analyzed.\n\nImplement rate limiting on API endpoints to prevent abuse.\n'
    )
    const r = validateReport(report)
    expect(hasNotEvidencedRecommendationDrift(report)).toBe(true)
    expect(r.categories).toContain('NOT_EVIDENCED_DRIFT')
  })

  it('accepts conditional scope-limited guidance after not-evidenced bounded statement', () => {
    const report = fullReportWithKeyFindingsBody(`No findings were identified within the scanned scope.`).replace(
      '## Rate Limiting & Abuse Controls\n\nSection content 8. Use Not evidenced where applicable.\n',
      '## Rate Limiting & Abuse Controls\n\nNot evidenced in scanned files included in this run. Coverage is limited to files selected for this scan, and omitted paths were not analyzed.\n\nIf rate limiting exists outside the scanned paths, consider documenting enforcement boundaries and validating behavior in a targeted follow-up scan.\n'
    )
    const r = validateReport(report)
    expect(hasNotEvidencedRecommendationDrift(report)).toBe(false)
    expect(r.categories).not.toContain('NOT_EVIDENCED_DRIFT')
  })
})

describe('hasConsolidatedSummaryPostureMismatch (DEFECT-004)', () => {
  function consolidatedShell(summaryRiskMiddle, dimensionProgressBlock) {
    return `# SecLens Consolidated Report

- **Repository:** a/b (https://github.com/a/b)
- **Ref:** main
- **Generated:** 2026-05-01T12:00:00.000Z
- **Languages:** JavaScript
- **Summary Risk:** ${summaryRiskMiddle}

## Executive Posture Summary

Body.

## Confirmed Protections

- x

## Priority Risks Requiring Review

- x

## Dimension Summaries

### Example dimension

${dimensionProgressBlock}
- **Status:** unknown

## Prioritized Next Actions

1. x

## Confidence & Coverage

- x

## Evidence Appendix

- x
`
  }

  it('flags Ready to launch when a dimension is partial', () => {
    const md = consolidatedShell('Ready to launch - label', '- **Progress:** partial')
    expect(hasConsolidatedSummaryPostureMismatch(md)).toBe(true)
  })

  it('returns false for Needs additional review with partial dimensions', () => {
    const md = consolidatedShell('Needs additional review - label', '- **Progress:** partial')
    expect(hasConsolidatedSummaryPostureMismatch(md)).toBe(false)
  })

  it('flags Ready with caution when any dimension is partial (DEFECT-004 tightened critic gate)', () => {
    const md = consolidatedShell('Ready with caution - label', '- **Progress:** partial')
    expect(hasConsolidatedSummaryPostureMismatch(md)).toBe(true)
  })

  it('flags optimistic summary when executive shows incomplete dimension completion', () => {
    const md = `# SecLens Consolidated Report

- **Repository:** a/b (https://github.com/a/b)
- **Ref:** main
- **Generated:** 2026-05-01T12:00:00.000Z
- **Languages:** JavaScript
- **Summary Risk:** Ready with caution - label

## Executive Posture Summary

SecLens completed 5 of 8 planned security dimensions for this repository. This run surfaced 0 confirmed issue(s).

## Confirmed Protections

- x

## Priority Risks Requiring Review

- x

## Dimension Summaries

### D

- **Progress:** ready
- **Status:** healthy

## Prioritized Next Actions

1. x

## Confidence & Coverage

- x

## Evidence Appendix

- x
`
    expect(hasConsolidatedExecutiveCompletenessMismatch(md)).toBe(true)
    const r = validateReport(md)
    expect(r.categories).toContain('SUMMARY_RISK_INCONSISTENT')
  })

  it('surfaces mismatch via validateReport on consolidated layout', () => {
    const md = consolidatedShell('Ready to launch - label', '- **Progress:** failed')
    const r = validateReport(md)
    expect(r.categories).toContain('SUMMARY_RISK_INCONSISTENT')
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
