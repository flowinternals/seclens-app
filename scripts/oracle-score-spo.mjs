#!/usr/bin/env node
/**
 * Re-score an existing SPO report against oracle markers (no live scan).
 *
 * Usage:
 *   node scripts/oracle-score-spo.mjs --report path/to/report.md [--out dir]
 *
 * Env:
 *   SECLENS_ORACLE_MARKERS_PATH / SECLENS_ASSETS_ROOT
 *   SECLENS_E2E_ORACLE_MODE=record|gate
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs'
import { resolve, join } from 'path'
import {
  exitCodeForOracleScore,
  renderOracleOutcomeMarkdown,
  scoreOracleReport,
} from '../lib/server/oracleScore.js'

function argValue(flag) {
  const idx = process.argv.indexOf(flag)
  if (idx === -1) return null
  return process.argv[idx + 1] || null
}

function loadMarkers() {
  const explicit = process.env.SECLENS_ORACLE_MARKERS_PATH || argValue('--markers')
  const assetsRoot = process.env.SECLENS_ASSETS_ROOT
  const candidates = [
    explicit,
    assetsRoot
      ? join(
          assetsRoot,
          'testing',
          'automated-tests',
          'ITC2-AUS-SPO_Management-oracle-markers.json'
        )
      : null,
    resolve(
      'D:/Assets/flowinternals-seclens-app-Assets/testing/automated-tests/ITC2-AUS-SPO_Management-oracle-markers.json'
    ),
  ].filter(Boolean)
  for (const path of candidates) {
    if (path && existsSync(path)) {
      return JSON.parse(readFileSync(path, 'utf8'))
    }
  }
  throw new Error('Markers not found. Set SECLENS_ORACLE_MARKERS_PATH or SECLENS_ASSETS_ROOT.')
}

const reportPath = argValue('--report')
if (!reportPath) {
  console.error('Usage: node scripts/oracle-score-spo.mjs --report <report.md> [--out <dir>]')
  process.exit(1)
}

const outDir = resolve(argValue('--out') || '.seclens-live-validation/spo-oracle/rescore')
mkdirSync(outDir, { recursive: true })
const reportMarkdown = readFileSync(resolve(reportPath), 'utf8')
const markers = loadMarkers()
const score = scoreOracleReport({
  reportMarkdown,
  markers,
  meta: {
    harnessStatus: 'ok',
    scanStatus: 'completed',
    oracleMode: process.env.SECLENS_E2E_ORACLE_MODE || 'record',
    localOutcomePath: join(outDir, 'oracle-outcome.md'),
    canonicalWrite: 'skipped',
  },
})

const md = renderOracleOutcomeMarkdown(score)
writeFileSync(join(outDir, 'oracle-outcome.md'), md, 'utf8')
writeFileSync(join(outDir, 'scorecard.json'), `${JSON.stringify(score, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({ outDir, oracleStatus: score.oracleStatus, findRate: score.findRate }, null, 2))
process.exit(exitCodeForOracleScore(score))
