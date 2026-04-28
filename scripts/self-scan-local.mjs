#!/usr/bin/env node
/**
 * Local working-tree self-scan — writes normalized evidence bundle JSON for comparison between runs.
 * Usage: node scripts/self-scan-local.mjs [path-to-repo-root]
 * Env: SECLENS_SELF_SCAN_OUT — output directory (default: <repo>/.seclens-self-scan)
 */

import 'dotenv/config'
import { mkdirSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import { buildLocalEvidenceSnapshot } from '../lib/server/localIngestion.js'

const repoRoot = resolve(process.argv[2] || process.cwd())

const outDir = resolve(process.env.SECLENS_SELF_SCAN_OUT || join(repoRoot, '.seclens-self-scan'))

const displayName = process.env.SECLENS_SELF_SCAN_LABEL
const { bundle, apiIngestion } = buildLocalEvidenceSnapshot(
  repoRoot,
  displayName ? { displayName } : {}
)

mkdirSync(outDir, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const payload = {
  generatedAt: new Date().toISOString(),
  repoRoot,
  apiIngestion,
  /** Full normalized evidence bundle for QA diff (paths, omissions, excerpts, citations, coverage). */
  bundle,
  bundleSummary: {
    scannedRef: bundle.repository.scannedRef,
    inventory: bundle.inventory,
    coverage: bundle.coverage,
    evidenceFileCount: bundle.evidence.length,
  },
}

writeFileSync(join(outDir, `evidence-snapshot-${stamp}.json`), JSON.stringify(payload, null, 2))
writeFileSync(join(outDir, 'evidence-latest.json'), JSON.stringify(payload, null, 2))

console.log(JSON.stringify(apiIngestion, null, 2))
console.error(`Wrote ${join(outDir, 'evidence-latest.json')}`)
