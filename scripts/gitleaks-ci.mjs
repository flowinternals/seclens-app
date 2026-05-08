/**
 * Runs Gitleaks with a JSON report, prints an advisory when the intentional
 * canary file is matched, and exits non-zero only for other findings.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..')
const CANARY_BASENAME = 'secrets-scan-test-file.txt'
const ADVISORY_FINGERPRINTS = new Set([
  // Intentional fixture-only fake secret from Stage 1 history.
  '551bba9255f40d1af0eea3d40be39dae1d366bb7:tests/fixtures/repos/node-express-issues/server.js:generic-secret:10',
  // Historical false positives: identifier/env-var references, not credential values.
  'e2f3afad30a2f646747e4afebeaa6cf2fd6a345d:api/auth/provision-account.js:generic-secret:89',
  '304053a7eddbe1163d939fb439ec536b2c635516:api/auth/provision-account.js:generic-secret:89',
  '304053a7eddbe1163d939fb439ec536b2c635516:api/billing/webhook.js:generic-secret:73',
])

function resolveGitleaksBinary() {
  const explicit = process.env.GITLEAKS_PATH
  if (explicit) return explicit
  const names = process.platform === 'win32' ? ['gitleaks.exe', 'gitleaks'] : ['gitleaks']
  for (const name of names) {
    const local = join(REPO_ROOT, name)
    const r = spawnSync(local, ['version'], { encoding: 'utf8' })
    if (r.status === 0) return local
  }
  for (const name of names) {
    const r = spawnSync(name, ['version'], { encoding: 'utf8' })
    if (r.status === 0) return name
  }
  return null
}

function isCanaryFinding(f) {
  const file = f.File || ''
  return (
    file === CANARY_BASENAME ||
    file.endsWith(`/${CANARY_BASENAME}`) ||
    file.endsWith(`\\${CANARY_BASENAME}`)
  )
}

function isAdvisoryFixtureFinding(f) {
  const fingerprint = f.Fingerprint || ''
  return ADVISORY_FINGERPRINTS.has(fingerprint)
}

function githubNotice(message) {
  const line = message.replace(/\r?\n/g, ' ').replace(/%/g, '%25')
  console.log(`::notice title=Secrets scanner canary::${line}`)
}

const gitleaks = resolveGitleaksBinary()
if (!gitleaks) {
  console.error(
    'gitleaks not found. Install from https://github.com/gitleaks/gitleaks/releases or set GITLEAKS_PATH to the binary.'
  )
  process.exit(2)
}

const reportPath = join(tmpdir(), `gitleaks-ci-${process.pid}-${Date.now()}.json`)
const args = [
  'detect',
  '--source',
  REPO_ROOT,
  '-f',
  'json',
  '-r',
  reportPath,
  '--exit-code',
  '0',
  '--redact',
]

const run = spawnSync(gitleaks, args, { cwd: REPO_ROOT, encoding: 'utf8', stdio: 'inherit' })
if (run.error) {
  console.error(run.error.message)
  process.exit(2)
}
if (run.status !== 0) {
  console.error('gitleaks exited unexpectedly despite --exit-code 0')
  process.exit(2)
}

let findings = []
try {
  findings = JSON.parse(readFileSync(reportPath, 'utf8'))
} catch {
  console.error('Could not read or parse gitleaks JSON report at', reportPath)
  process.exit(2)
} finally {
  try {
    unlinkSync(reportPath)
  } catch {
    /* ignore */
  }
}

if (!Array.isArray(findings)) {
  console.error('Unexpected gitleaks report shape (expected JSON array)')
  process.exit(2)
}

const canaryFindings = findings.filter(isCanaryFinding)
const advisoryFixtureFindings = findings.filter(isAdvisoryFixtureFinding)
const otherFindings = findings.filter((f) => !isCanaryFinding(f) && !isAdvisoryFixtureFinding(f))

if (canaryFindings.length > 0) {
  const msg =
    `Secrets scanner advisory: intentional dummy "${CANARY_BASENAME}" was detected (${canaryFindings.length} finding(s)). ` +
    'This confirms rule matching on the known test artifact; it is not treated as a credential incident.'
  console.log(`\n${msg}\n`)
  if (process.env.GITHUB_ACTIONS === 'true') githubNotice(msg)
}

if (advisoryFixtureFindings.length > 0) {
  const msg =
    `Secrets scanner advisory: known fixture-only historical finding(s) detected (${advisoryFixtureFindings.length}). ` +
    'These are intentionally synthetic test artifacts and are not treated as credential incidents.'
  console.log(`\n${msg}\n`)
  if (process.env.GITHUB_ACTIONS === 'true') githubNotice(msg)
}

if (otherFindings.length > 0) {
  // Emit structured details for CI troubleshooting so we can quickly
  // identify and allowlist intentional fixtures without weakening rules.
  console.error('\nNon-advisory gitleaks finding fingerprints:')
  for (const f of otherFindings) {
    const fp = f.Fingerprint || '<no-fingerprint>'
    const file = f.File || '<no-file>'
    const ruleId = f.RuleID || '<no-rule>'
    const line = typeof f.StartLine === 'number' ? String(f.StartLine) : '<no-line>'
    console.error(`- ${fp} | ${file} | ${ruleId} | ${line}`)
  }
  console.error(
    `\nGitleaks reported ${otherFindings.length} other finding(s). Fix or allowlist before merge.\n`
  )
  process.exit(1)
}

process.exit(0)
