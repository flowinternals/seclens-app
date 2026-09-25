/**
 * Safe alternative to `npm audit fix`.
 *
 * On npm 10.x, `npm audit fix` can crash inside Arborist `#loadPeerSet` with
 * `Cannot read properties of null (reading 'edgesOut')` when remounting Vitest
 * (and packages that declare `vitest@*` optional peers such as @vitejs/devtools*).
 * See npm/cli#9787 and DEFECT-MVP5-006.
 *
 * Remediations belong in package.json (exact pins + overrides) and are applied
 * with a normal install — never via audit-fix ideal-tree rebuild.
 */
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

function run(command, args, { allowNonZero = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  if (result.error) throw result.error
  if (!allowNonZero && result.status !== 0) {
    process.exit(result.status ?? 1)
  }
  return result
}

console.log('[audit:fix] Skipping `npm audit fix` (npm 10 Arborist edgesOut crash with Vitest peers).')
console.log('[audit:fix] Applying package.json pins/overrides via `npm install`…')
run('npm', ['install', '--no-fund', '--no-audit'])

console.log('[audit:fix] Re-running `npm audit` (non-zero exit means findings remain, not a tooling crash)…')
const audit = run('npm', ['audit'], { allowNonZero: true })

console.log('[audit:fix] Production gate (`npm audit --omit=dev --audit-level=moderate`)…')
const prod = run('npm', ['audit', '--omit=dev', '--audit-level=moderate'], { allowNonZero: true })

if (prod.status !== 0) {
  console.error('[audit:fix] Production audit gate failed. Bump direct deps or extend overrides; do not run `npm audit fix`.')
  process.exit(prod.status ?? 1)
}

if (audit.status !== 0) {
  console.log('[audit:fix] Dev/transitive findings remain (often firebase-tools). Record disposition; avoid `--force` unless intentionally major-bumping.')
  process.exit(0)
}

console.log('[audit:fix] No vulnerabilities reported.')
