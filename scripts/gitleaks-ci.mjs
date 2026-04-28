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

function resolveGitleaksBinary() {
  const explicit = process.env.GITLEAKS_PATH
  if (explicit) return explicit
  const names = process.platform === 'win32' ? ['gitleaks.exe', 'gitleaks'] : ['gitleaks']
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
const otherFindings = findings.filter((f) => !isCanaryFinding(f))

if (canaryFindings.length > 0) {
  const msg =
    `Secrets scanner advisory: intentional dummy "${CANARY_BASENAME}" was detected (${canaryFindings.length} finding(s)). ` +
    'This confirms rule matching on the known test artifact; it is not treated as a credential incident.'
  console.log(`\n${msg}\n`)
  if (process.env.GITHUB_ACTIONS === 'true') githubNotice(msg)
}

if (otherFindings.length > 0) {
  console.error(
    `\nGitleaks reported ${otherFindings.length} other finding(s). Fix or allowlist before merge.\n`
  )
  process.exit(1)
}

process.exit(0)
