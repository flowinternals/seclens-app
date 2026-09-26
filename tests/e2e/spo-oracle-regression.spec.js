import { test, expect } from '@playwright/test'
import { readFileSync, existsSync } from 'fs'
import { resolve, dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { resolveExpectedE2EModel } from '../../lib/shared/e2eModel.js'
import {
  exitCodeForOracleScore,
  renderOracleOutcomeMarkdown,
  scoreOracleReport,
} from '../../lib/server/oracleScore.js'
import {
  assertArtifactsDoNotContainSecrets,
  createRunArtifactDir,
  promoteOutcomeToAssets,
  writeJson,
  writeText,
} from './helpers/artifacts.js'
import {
  buildScanUrl,
  evaluateBaselineGuard,
  resolveGithubRefSha,
} from './helpers/baseline.js'
import { pollScanJobUntilTerminal } from './helpers/pollJob.js'
import {
  loadFirebaseE2eCreds,
  loadGithubTokenForTarget,
  resolveE2eTarget,
} from './helpers/target.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '../..')

const LIVE =
  process.env.SECLENS_E2E_LIVE === '1' ||
  process.env.SECLENS_E2E_LIVE === 'true' ||
  process.env.SECLENS_E2E_SPO_LIVE === '1' ||
  process.env.SECLENS_E2E_SPO_LIVE === 'true'

function loadMarkersForTarget(target) {
  const explicit = process.env.SECLENS_ORACLE_MARKERS_PATH
  const assetsRoot = process.env.SECLENS_ASSETS_ROOT
  const isSpo = /ITC2-AUS\/SPO_Management/i.test(`${target.owner}/${target.repo}`)
  const candidates = [
    explicit,
    isSpo && assetsRoot
      ? join(
          assetsRoot,
          'testing',
          'automated-tests',
          'ITC2-AUS-SPO_Management-oracle-markers.json'
        )
      : null,
    isSpo
      ? resolve(
          'D:/Assets/flowinternals-seclens-app-Assets/testing/automated-tests/ITC2-AUS-SPO_Management-oracle-markers.json'
        )
      : null,
  ].filter(Boolean)

  for (const path of candidates) {
    if (existsSync(path)) {
      return { markers: JSON.parse(readFileSync(path, 'utf8')), markersPath: path }
    }
  }

  // Public / non-oracle targets: harness-only scoring (no AC issues).
  return {
    markers: {
      schemaVersion: 2,
      repo: `${target.owner}/${target.repo}`,
      issues: [],
      passThreshold: { allCriticalHighFound: true, minFindRate: 0.8 },
      devProfile: { oracleMode: 'record' },
    },
    markersPath: null,
  }
}

async function clearSensitiveFields(page) {
  for (const testId of ['scan-github-token', 'login-password', 'login-email']) {
    const loc = page.getByTestId(testId)
    if (await loc.count()) {
      await loc.fill('').catch(() => {})
    }
  }
}

test.describe('AUTO-REPO-001 Playwright repo oracle', () => {
  test.beforeEach(() => {
    test.skip(
      !LIVE,
      'Set SECLENS_E2E_LIVE=1 (or SECLENS_E2E_SPO_LIVE=1) with Firebase + OpenAI env to run the live oracle.'
    )
  })

  test('record-mode scan + section-scoped oracle score', async ({ page }) => {
    const firebase = loadFirebaseE2eCreds()
    expect(firebase, 'Firebase e2e creds (security/secrets/e2e-firebase.txt)').toBeTruthy()
    const { email, password } = firebase

    const target = resolveE2eTarget()
    const githubToken = loadGithubTokenForTarget(target)
    if (target.isPrivate) {
      expect(githubToken, 'repo-bound or SECLENS_E2E_GITHUB_TOKEN required for private repo').toBeTruthy()
    }

    const apiBase = process.env.SECLENS_E2E_API_BASE_URL || 'http://localhost:3001'
    const oracleMode = process.env.SECLENS_E2E_ORACLE_MODE || 'record'
    const baselineMode =
      process.env.SECLENS_E2E_BASELINE_MODE || (target.baselineSha ? 'strict' : 'allow-drift')
    const deadlineMs = Number(process.env.SECLENS_E2E_SCAN_DEADLINE_MS || 40 * 60 * 1000)

    const modelResolve = resolveExpectedE2EModel()
    expect(modelResolve.ok, modelResolve.error || 'model resolve').toBe(true)
    const requestedModel = modelResolve.requestedModel

    const tip = await resolveGithubRefSha({
      owner: target.owner,
      repo: target.repo,
      ref: target.ref,
      token: githubToken || undefined,
    })
    const resolvedRef = tip.ref || target.ref || 'HEAD'
    const baseline = evaluateBaselineGuard({
      resolvedSha: tip.sha,
      baselineSha: target.baselineSha,
      mode: baselineMode,
    })
    expect(baseline.proceed, baseline.reason || 'baseline guard').toBe(true)

    const { markers, markersPath } = loadMarkersForTarget(target)
    const runId = new Date().toISOString().replace(/[:.]/g, '-')
    const artifactDir = createRunArtifactDir(repoRoot, runId)
    const scanUrl = buildScanUrl({
      owner: target.owner,
      repo: target.repo,
      sha: baseline.resolvedSha,
      ref: resolvedRef,
      mode: baselineMode,
    })

    let capturedAuthHeader = null
    let startedJobId = null

    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url().includes('/api/scan-jobs')) {
        capturedAuthHeader = req.headers().authorization || capturedAuthHeader
      }
    })

    await page.goto('/login')
    await page.getByTestId('login-email').fill(email)
    await page.getByTestId('login-password').fill(password)
    await page.getByTestId('login-submit').click()
    await expect(page.getByTestId('scan-form')).toBeVisible({ timeout: 60_000 })
    await clearSensitiveFields(page)

    await page.getByTestId('analysis-model-select').selectOption(requestedModel)
    await expect(page.getByTestId('analysis-model-select')).toHaveValue(requestedModel)

    await page.getByTestId('scan-repo-url').fill(scanUrl)
    if (target.isPrivate) {
      await page.getByTestId('scan-private-toggle').check()
      await page.getByTestId('scan-github-token').fill(githubToken)
    } else {
      // Public repo: leave private unchecked; optional token not pasted into UI.
      if (await page.getByTestId('scan-private-toggle').isChecked()) {
        await page.getByTestId('scan-private-toggle').uncheck()
      }
    }

    const scanResponsePromise = page.waitForResponse(
      (res) => res.url().includes('/api/scan-jobs') && res.request().method() === 'POST',
      { timeout: 120_000 }
    )
    await page.getByTestId('scan-run-button').click()
    const scanResponse = await scanResponsePromise
    const startBody = await scanResponse.json()
    startedJobId = startBody.jobId
    expect(startedJobId, 'jobId from scan-jobs POST').toBeTruthy()

    if (target.isPrivate) {
      const tokenInput = page.getByTestId('scan-github-token')
      // Field is disabled while the scan runs — clear via DOM so traces don't retain the PAT.
      await tokenInput.evaluate((el) => {
        el.removeAttribute('disabled')
        el.value = ''
        el.setAttribute('value', '')
        el.dispatchEvent(new Event('input', { bubbles: true }))
      }).catch(() => {})
    }

    const pollStarted = Date.now()
    const terminal = await pollScanJobUntilTerminal({
      baseUrl: apiBase,
      jobId: startedJobId,
      absoluteDeadlineMs: deadlineMs,
      getAuthHeaders: async () => {
        if (!capturedAuthHeader) throw new Error('Missing Authorization header from scan start')
        return { Authorization: capturedAuthHeader }
      },
    })

    await clearSensitiveFields(page)

    writeJson(join(artifactDir, 'poll-terminal.json'), {
      status: terminal.status,
      jobId: startedJobId,
      payload: terminal.payload,
      target: { ...target, ref: resolvedRef },
      scanUrl,
    })

    if (terminal.status !== 'completed') {
      writeJson(join(artifactDir, 'scorecard.json'), {
        harnessStatus: 'failed',
        scanStatus: terminal.status,
        oracleStatus: 'not_scored',
        gateStatus: 'not_applicable',
        reason: `Scan did not complete: ${terminal.status}`,
        target,
      })
      throw new Error(`Scan did not complete: ${terminal.status}`)
    }

    const job = terminal.payload
    expect(job.jobId).toBe(startedJobId)
    expect(String(job.status).toLowerCase()).toBe('completed')
    expect(job.analysisModel || job.telemetry?.analysisModel).toBeTruthy()

    const resolvedModel = job.analysisModel || job.requestedAnalysisModel
    expect(resolvedModel, 'resolved analysis model on job').toBe(requestedModel)

    const resolvedSha =
      job.repository?.scannedSha ||
      job.dashboard?.repository?.scannedSha ||
      baseline.resolvedSha
    const reportMarkdown =
      (typeof job.report === 'string' && job.report) ||
      (typeof job.dashboard?.report === 'string' && job.dashboard.report) ||
      ''

    expect(reportMarkdown.length, 'report markdown present').toBeGreaterThan(0)

    const score = scoreOracleReport({
      reportMarkdown,
      markers,
      meta: {
        harnessStatus: 'ok',
        scanStatus: 'completed',
        oracleMode,
        baselineComparison: baseline.baselineComparison,
        requestedModel,
        resolvedModel,
        requestedRef: resolvedRef,
        resolvedSha,
        baselineSha: target.baselineSha,
        localOutcomePath: join(artifactDir, 'oracle-outcome.md'),
        canonicalWrite: 'skipped',
      },
    })

    const outcomeMd = renderOracleOutcomeMarkdown(score, {
      repo: `${target.owner}/${target.repo}`,
      title: `${target.owner}/${target.repo} Oracle Outcome`,
    })
    writeText(join(artifactDir, 'oracle-outcome.md'), outcomeMd)
    writeJson(join(artifactDir, 'scorecard.json'), {
      ...score,
      markersPath,
      scanUrl,
      target,
      durationMs: Date.now() - pollStarted,
      jobId: startedJobId,
    })
    writeText(join(artifactDir, 'report.md'), reportMarkdown)

    let canonicalWrite = 'skipped'
    let canonicalOutcomePath = null
    if (process.env.SECLENS_ASSETS_ROOT && process.env.SECLENS_E2E_PROMOTE === '1') {
      const date = new Date().toISOString().slice(0, 10)
      const slug = `${target.owner}-${target.repo}`.replace(/[^\w.-]+/g, '_')
      const promoted = promoteOutcomeToAssets({
        localOutcomePath: join(artifactDir, 'oracle-outcome.md'),
        assetsRoot: process.env.SECLENS_ASSETS_ROOT,
        fileName: `${slug}-oracle-outcome-${date}.md`,
      })
      canonicalOutcomePath = promoted.canonicalOutcomePath
      canonicalWrite = 'ok'
      writeJson(join(artifactDir, 'scorecard.json'), {
        ...score,
        canonicalOutcomePath,
        canonicalWrite,
        markersPath,
        scanUrl,
        target,
        durationMs: Date.now() - pollStarted,
        jobId: startedJobId,
      })
    }

    assertArtifactsDoNotContainSecrets(
      [resolve(__dirname, 'test-results')],
      [githubToken, password, email].filter(Boolean)
    )

    expect(score.harnessStatus).toBe('ok')
    expect(exitCodeForOracleScore(score)).toBe(
      oracleMode === 'gate' && score.gateStatus === 'failed' ? 2 : 0
    )

    test.info().annotations.push({
      type: 'oracleStatus',
      description: `${target.owner}/${target.repo} ${score.oracleStatus}; findRate=${score.findRate}; canonicalWrite=${canonicalWrite}`,
    })
  })
})
