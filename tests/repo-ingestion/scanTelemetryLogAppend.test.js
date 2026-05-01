import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { parseTelemetryLog } from '../../lib/server/cr5Readiness.js'
import { tryAppendScanTelemetryLog } from '../../lib/server/scanTelemetryLogAppend.js'

const TABLE_HEADER =
  '| Timestamp (UTC) | Repo | Profile | Max Files | Bytes/File | Total Evidence Bytes | Tree Cap | Selected/Omitted | Cap Hits | Duration | Contract | Validation | Critic | Draft In | Draft Out | Critic In | Critic Out | Total Tokens | Est. Cost USD | QA Verdict | Correlation ID | Analysis Model |'
const TABLE_SEP =
  '|---|---|---|---:|---:|---:|---:|---|---|---|---|---|---|---:|---:|---:|---:|---:|---:|---|---|---|'

describe('tryAppendScanTelemetryLog', () => {
  let prevTelemetryLog
  let prevAppend
  let tmpDir

  beforeEach(() => {
    prevTelemetryLog = process.env.SECLENS_TELEMETRY_LOG
    prevAppend = process.env.SECLENS_TELEMETRY_LOG_APPEND
    delete process.env.SECLENS_TELEMETRY_LOG_APPEND
    tmpDir = mkdtempSync(join(tmpdir(), 'seclens-telemetry-'))
  })

  afterEach(() => {
    if (prevTelemetryLog === undefined) delete process.env.SECLENS_TELEMETRY_LOG
    else process.env.SECLENS_TELEMETRY_LOG = prevTelemetryLog
    if (prevAppend === undefined) delete process.env.SECLENS_TELEMETRY_LOG_APPEND
    else process.env.SECLENS_TELEMETRY_LOG_APPEND = prevAppend
    try {
      rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      // ignore
    }
  })

  it('appends a 21-column row before ## Exceptional run notes', () => {
    const logPath = join(tmpDir, 'SCAN-TELEMETRY-LOG.md')
    writeFileSync(
      logPath,
      `${TABLE_HEADER}\n${TABLE_SEP}\n\n## Exceptional run notes\n\nnotes\n`,
      'utf8'
    )
    process.env.SECLENS_TELEMETRY_LOG = logPath

    tryAppendScanTelemetryLog({
      analysisResult: { correlationId: 'corr-test-1', reportContractVersion: '2.0.0' },
      repoData: {
        owner: 'acme',
        repo: 'demo',
        url: 'https://github.com/acme/demo',
        ingestion: { selectedFileCount: 1, omittedFileCount: 0, capHits: [] },
        evidenceBundle: { evidence: [], coverage: null, inventory: null },
      },
      requestStartedAtMs: Date.now() - 5000,
    })

    const out = readFileSync(logPath, 'utf8')
    const rows = parseTelemetryLog(out)
    expect(rows.length).toBeGreaterThanOrEqual(1)
    const last = rows[rows.length - 1]
    expect(last.repo).toBe('acme/demo')
    expect(last.correlationId).toBe('corr-test-1')
    expect(last.qaVerdict).toMatch(/Validator OK|QA/)

    const appendedLine = out
      .split('\n')
      .find((line) => line.includes('`acme/demo`') && line.includes('corr-test-1'))
    expect(appendedLine).toBeTruthy()
    const cells = appendedLine
      .trim()
      .slice(1, -1)
      .split('|')
      .map((c) => c.trim())
    expect(cells.length).toBeGreaterThanOrEqual(21)
  })

  it('does not write when SECLENS_TELEMETRY_LOG_APPEND is false', () => {
    const logPath = join(tmpDir, 'SCAN-TELEMETRY-LOG.md')
    const initial = `${TABLE_HEADER}\n${TABLE_SEP}\n\n## Exceptional run notes\n`
    writeFileSync(logPath, initial, 'utf8')
    process.env.SECLENS_TELEMETRY_LOG = logPath
    process.env.SECLENS_TELEMETRY_LOG_APPEND = 'false'

    tryAppendScanTelemetryLog({
      analysisResult: { correlationId: 'skip-me' },
      repoData: {
        owner: 'x',
        repo: 'y',
        url: 'https://github.com/x/y',
        ingestion: {},
        evidenceBundle: { evidence: [] },
      },
      requestStartedAtMs: Date.now(),
    })

    expect(readFileSync(logPath, 'utf8')).toBe(initial)
  })
})
