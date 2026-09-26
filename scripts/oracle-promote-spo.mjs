#!/usr/bin/env node
/**
 * Verified promotion of a local oracle outcome into Assets unit-acceptance-criteria.
 *
 * Usage:
 *   node scripts/oracle-promote-spo.mjs --local <oracle-outcome.md>
 *
 * Requires SECLENS_ASSETS_ROOT.
 */
import { resolve } from 'path'
import { promoteOutcomeToAssets } from '../tests/e2e/helpers/artifacts.js'

function argValue(flag) {
  const idx = process.argv.indexOf(flag)
  if (idx === -1) return null
  return process.argv[idx + 1] || null
}

const local = argValue('--local')
const assetsRoot = process.env.SECLENS_ASSETS_ROOT
if (!local || !assetsRoot) {
  console.error(
    'Usage: SECLENS_ASSETS_ROOT=... node scripts/oracle-promote-spo.mjs --local <oracle-outcome.md>'
  )
  process.exit(1)
}

const date = new Date().toISOString().slice(0, 10)
const result = promoteOutcomeToAssets({
  localOutcomePath: resolve(local),
  assetsRoot,
  fileName: `ITC2-AUS-SPO_Management-oracle-outcome-${date}.md`,
})
console.log(JSON.stringify(result, null, 2))
