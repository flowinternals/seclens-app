#!/usr/bin/env node
import { readFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import {
  parseTelemetryLog,
  readOracleOutcomesFromFolder,
  evaluateCr5Readiness,
} from '../lib/server/cr5Readiness.js'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')
const defaultAssetsRoot = resolve(repoRoot, '..', '..', 'Assets', 'flowinternals-seclens-app-Assets')
const assetsRoot = resolve(process.env.SECLENS_ASSETS_ROOT || defaultAssetsRoot)

const telemetryPath = resolve(
  process.env.SECLENS_TELEMETRY_LOG ||
    join(assetsRoot, 'design', 'mvp4 - launch-readiness', 'SCAN-TELEMETRY-LOG.md')
)
const oracleFolder = resolve(
  process.env.SECLENS_ORACLE_FOLDER ||
    join(assetsRoot, 'testing', 'unit-acceptance-criteria')
)

try {
  const telemetryRows = parseTelemetryLog(readFileSync(telemetryPath, 'utf8'))
  const oracleOutcomes = readOracleOutcomesFromFolder(oracleFolder)
  const report = evaluateCr5Readiness({
    telemetryRows,
    oracleOutcomes,
    nonRegressionGreen: process.env.SECLENS_NON_REGRESSION_GREEN !== 'false',
  })

  console.log(JSON.stringify(report, null, 2))
  if (!report.readinessPassed) process.exitCode = 1
} catch (error) {
  console.error(`CR5 readiness check failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 2
}
