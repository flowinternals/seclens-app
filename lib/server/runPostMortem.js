/**
 * Admin-only post-mortem assessment for a SecLens run (CR-SECLENS-PIVOT-008).
 * Pure function over persisted run telemetry + optional in-memory job snapshot (dashboard).
 */

import {
  ADVISORY_CONTRACT_VERSION,
  ADVISORY_PROHIBITED_TERMS,
  advisoryStatusRequiresReasonCode,
} from '../shared/advisoryContract.js'
import { getDimensionDefinition } from '../shared/dimensions.js'
import { buildAdvisoryOutput, validateAdvisoryOutputContract } from './advisoryContractValidation.js'
import { looksLikeRepoPath, validateAiIdePrompt } from './aiPromptQuality.js'

const POST_MORTEM_SCHEMA = 1

function nowIso() {
  return new Date().toISOString()
}

function safeArray(value) {
  return Array.isArray(value) ? value : []
}

function toStr(v) {
  if (v == null) return ''
  if (typeof v === 'string') return v
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

function containsProhibitedLanguage(text) {
  if (typeof text !== 'string' || !text.trim()) return false
  const lower = text.toLowerCase()
  return ADVISORY_PROHIBITED_TERMS.some((term) => lower.includes(term))
}

function collectProhibitedPaths(value, path = '', found = []) {
  if (typeof value === 'string') {
    if (containsProhibitedLanguage(value)) found.push(path || '<string>')
    return found
  }
  if (Array.isArray(value)) {
    value.forEach((entry, i) => collectProhibitedPaths(entry, `${path}[${i}]`, found))
    return found
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      const p = path ? `${path}.${k}` : k
      collectProhibitedPaths(v, p, found)
    }
  }
  return found
}

function minimalRepoData(run) {
  const r = run?.repository && typeof run.repository === 'object' ? run.repository : {}
  return {
    url: r.url || '',
    owner: r.owner || '',
    repo: r.name || '',
    scannedRef: r.scannedRef || null,
    defaultBranch: r.defaultBranch || null,
    scannedSha: r.scannedSha || null,
  }
}

function normalizeRunStatus(status) {
  return String(status || '').toUpperCase()
}

/**
 * Older Firestore merges omitted `run.telemetry` while still persisting summaries + telemetryLogEntry.
 * When those fields are present and consistent, post-mortem can still audit ingestion and token usage.
 */
function denormalizedTelemetrySufficientForAudit(fileSel, telEntry, mus) {
  if (!fileSel || typeof fileSel !== 'object') return false
  const hasCounts =
    typeof fileSel.selectedFileCount === 'number' || typeof fileSel.omittedFileCount === 'number'
  if (!hasCounts) return false
  if (!telEntry || typeof telEntry !== 'object') return false
  if (telEntry.timestampUtc == null || !String(telEntry.timestampUtc).trim()) return false
  if (telEntry.repo == null || !String(telEntry.repo).trim()) return false
  if (telEntry.profile == null || !String(telEntry.profile).trim()) return false
  if (!mus || typeof mus !== 'object') return false
  if (typeof mus.totalTokens !== 'number' || mus.totalTokens <= 0) return false
  return true
}

function textLooksCircularOrVacuous(text) {
  const s = String(text || '').toLowerCase()
  if (!s.trim()) return false
  if (/follow the recommendation|follow recommendation/i.test(s)) return true
  if (/^fix anything you find$/i.test(s.trim())) return true
  if (/review the reviewed files/i.test(s) && s.length < 120) return true
  return false
}

/** Per-dimension checks on reconstructed advisory output - execution metadata is insufficient for TRUST. */
function addDeepOutputQualityAssertions(contract, dashboardDimensions, add) {
  if (!contract || !Array.isArray(contract.dimensions) || !contract.dimensions.length) return
  const rawById = new Map(
    safeArray(dashboardDimensions)
      .filter((d) => d && d.dimensionId)
      .map((d) => [String(d.dimensionId), d])
  )

  for (const cd of contract.dimensions) {
    const dimId = String(cd.dimensionId || 'unknown')
    const raw = rawById.get(dimId)
    const label = String(cd.label || dimId)

    if (cd.applicability === 'not_applicable' || String(cd.status || '').toUpperCase() === 'SKIPPED') {
      add(
        `pm.output.dim.${dimId}.scope`,
        'pass',
        'dimension_review',
        `${label}: not applicable / skipped - user-facing depth checks not required.`,
      )
      continue
    }

    const reviewed = safeArray(cd.reviewedFiles)
    const recs = safeArray(cd.recommendations)
    const prompts = safeArray(cd.aiPrompts)
    const tests = safeArray(cd.suggestedTests)
    const dimStatus = String(cd.status || '').toUpperCase()

    const summaryLine = `${label} [${dimId}]: status=${dimStatus} reviewedPaths=${reviewed.length} recommendations=${recs.length} prompts=${prompts.length} tests=${tests.length}`

    const issues = []

    if ((dimStatus === 'SUCCESS' || dimStatus === 'WARNING') && reviewed.length === 0) {
      issues.push('no_reviewed_paths_in_contract')
    }

    for (const r of recs) {
      const body = String(r.recommendation || '').trim()
      const title = String(r.title || '').trim()
      if (body.length > 0 && body.length < 36) issues.push('recommendation_body_too_short')
      const files = safeArray(r.files).map(String)
      const anchored = files.some((f) => looksLikeRepoPath(f))
      if (body.length > 0 && !anchored && dimStatus === 'SUCCESS') issues.push('recommendation_not_file_anchored')
      if (textLooksCircularOrVacuous(body) || textLooksCircularOrVacuous(title)) {
        issues.push('recommendation_circular_or_generic')
      }
    }

    for (const t of tests) {
      const pr = String(t.prompt || '').trim()
      if (pr.length > 0 && pr.length < 72) issues.push('test_prompt_too_short')
      if (textLooksCircularOrVacuous(pr)) issues.push('test_prompt_circular')
    }

    for (const p of prompts) {
      const v = validateAiIdePrompt(p, dimId)
      if (!v.ok) issues.push(`prompt_contract:${v.issues.join('+')}`)
    }

    const cov = raw?.coverage
    if (cov && Number(cov.omittedFilesRelevant) > 0) {
      issues.push(`security_relevant_files_omitted:${Number(cov.omittedFilesRelevant)}`)
    }

    let sev = 'pass'
    if (issues.some((i) => i.startsWith('prompt_contract:'))) sev = 'fail'
    else if (issues.length) sev = 'warn'

    add(`pm.output.dim.${dimId}.quality`, sev, 'dimension_review', summaryLine, issues.length ? issues.join('; ') : undefined)
  }
}

function buildNarrativeWhatWorkedWell(assertions, run, contractCheck, dashboardPresent) {
  const lines = []
  const status = normalizeRunStatus(run?.status)
  if (status) {
    lines.push(
      `Execution outcome: ${status}${
        dashboardPresent && contractCheck?.ok && !contractCheck?.skipped
          ? ' - dashboard payloads were present for structured advisory replay.'
          : ' - without a full dimension dashboard, only telemetry/summary signals were available (insufficient to judge advisory usefulness).'
      }`,
    )
  }

  const deepPass = assertions.filter(
    (a) => a.severity === 'pass' && a.id.startsWith('pm.output.dim.') && a.id.endsWith('.quality')
  ).length
  const deepWarn = assertions.filter(
    (a) => a.severity === 'warn' && a.id.startsWith('pm.output.dim.') && a.id.endsWith('.quality')
  ).length
  if (deepPass) {
    lines.push(
      `Advisory depth: ${deepPass} applicable dimension(s) passed file anchoring, prompt shape, and test-prompt specificity checks${deepWarn ? ` (${deepWarn} dimension(s) raised warnings)` : ''}.`,
    )
  }

  if (contractCheck?.ok && !contractCheck?.skipped) {
    lines.push(
      `Advisory contract reconstruction validates (${ADVISORY_CONTRACT_VERSION}) including serialized prohibited-language scan on the contract object.`,
    )
  }

  if (assertions.some((a) => a.id === 'pm.report_validation' && a.severity === 'pass')) {
    lines.push('Structured report validation on the persisted snapshot reported ok.')
  }

  const metaPasses = assertions.filter((a) => a.category === 'telemetry_completeness' && a.severity === 'pass').length
  if (metaPasses) {
    lines.push(
      `Telemetry / ingestion metadata: ${metaPasses} check(s) passed (lifecycle evidence - token counts and field presence are not quality signals on their own).`,
    )
  }

  if (lines.length < 2) {
    return assertions
      .filter((a) => a.severity === 'pass')
      .slice(0, 14)
      .map((a) => a.message)
  }
  return lines
}

function sortDimsByCatalog(dims) {
  return [...safeArray(dims)].sort((a, b) => {
    const oa = getDimensionDefinition(a?.dimensionId)?.order ?? 999
    const ob = getDimensionDefinition(b?.dimensionId)?.order ?? 999
    if (oa !== ob) return oa - ob
    return String(a?.dimensionId || '').localeCompare(String(b?.dimensionId || ''))
  })
}

function describeDimensionFailure(reasonCode, lastError) {
  const code = reasonCode || 'UNKNOWN'
  const errSnip = lastError ? String(lastError).slice(0, 480) : ''
  const table = {
    DIMENSION_ANALYSIS_FAILED: {
      why: 'The dimension analysis pass exited with failure or did not complete.',
      impact: 'Recommendations and IDE prompts for this dimension are unreliable or absent.',
      next: 'Inspect dashboard.dimensionRuntime[lastError] and model logs for this dimensionId; retry or widen evidence.',
    },
    AI_PROMPT_QUALITY_FAILED: {
      why: 'Every generated IDE prompt failed validation (paths, length, or anti-generic gates).',
      impact: 'User-facing prompts for this dimension were suppressed.',
      next: 'Review evidence targets and recommendation text; adjust prompt builder inputs and re-run.',
    },
    AI_PROMPT_QUALITY_WARNING: {
      why: 'Some IDE prompts were invalid and withheld; dimension downgraded to WARNING.',
      impact: 'Partial advisory output - fewer prompts than recommendations imply.',
      next: 'Review withheld prompts and evidence coverage for this dimension.',
    },
    ADVISORY_ARTIFACTS_INCOMPLETE: {
      why: 'Applicable dimension finished without required recommendations, prompts, or tests after synthesis.',
      impact: 'Stakeholders cannot rely on a complete advisory bundle for this dimension.',
      next: 'Investigate dimension synthesis, caps, and omission counters; re-run with broader retention if needed.',
    },
    FILE_OMITTED_BY_CAP: {
      why: 'Evidence was trimmed by bundle or prompt limits (partial progress).',
      impact: 'Coverage is incomplete versus full repo risk surface.',
      next: 'Re-run with broader file retention or manually review omitted paths.',
    },
    DIMENSION_NO_RELEVANT_FILES: {
      why: 'No evidence paths met applicability for this dimension in this repo snapshot.',
      impact: 'No applicable advisory work product was required for this dimension.',
      next: 'Confirm repo profile and evidence selection; expand scan if this dimension should apply.',
    },
  }
  const row =
    table[code] ||
    (errSnip
      ? {
          why: `See runtime signal: ${errSnip}`,
          impact: 'Advisory output for this dimension may be incomplete or withheld.',
          next: 'Inspect scan logs and dashboard for this dimensionId.',
        }
      : {
          why: 'See dashboard dimension progress/status and contract reasonCode.',
          impact: 'Advisory output for this dimension may be incomplete or withheld.',
          next: 'Review dimension in admin scan UI and supporting logs.',
        })
  return row
}

/**
 * @returns {{ lines: string[], failedIds: string[] }}
 */
function buildDimensionPostMortemInventory({ dashboard, dims, contract, dimSum, runStatus, add }) {
  const lines = []
  const failedIds = []
  if (!dims.length) {
    return { lines, failedIds }
  }

  const contractById = new Map(
    contract?.dimensions ? contract.dimensions.map((d) => [String(d.dimensionId), d]) : []
  )
  const runtimeRoot =
    dashboard?.dimensionRuntime && typeof dashboard.dimensionRuntime === 'object'
      ? dashboard.dimensionRuntime
      : {}

  const reviewedSummary = Number(dimSum?.dimensionsReviewed ?? NaN)
  const totalSummary = Number(dimSum?.totalDimensions ?? NaN)
  let anyRawFailed = false

  for (const raw of sortDimsByCatalog(dims)) {
    const id = String(raw?.dimensionId || '?')
    const cd = contractById.get(id)
    const rt = runtimeRoot[id] || runtimeRoot[raw.dimensionId]
    const progress = String(raw?.progress || '').toLowerCase()
    if (progress === 'failed') anyRawFailed = true

    const contractStatus = cd ? String(cd.status || '').toUpperCase() : ''
    const effectiveFailed = progress === 'failed' || contractStatus === 'FAILED'

    const reasonCode =
      (cd?.reasonCode && String(cd.reasonCode)) ||
      (effectiveFailed && progress === 'failed' ? 'DIMENSION_ANALYSIS_FAILED' : '') ||
      ''

    const displayStatus =
      contractStatus ||
      (progress === 'failed'
        ? 'FAILED'
        : progress === 'completed'
          ? 'SUCCESS'
          : progress
            ? progress.toUpperCase()
            : 'UNKNOWN')

    const reviewedFiles =
      safeArray(raw?.evidence?.reviewedPaths).length ||
      (Number.isFinite(Number(raw?.coverage?.reviewedFiles)) ? Number(raw.coverage.reviewedFiles) : 0) ||
      safeArray(cd?.reviewedFiles).length

    const recN = cd ? safeArray(cd.recommendations).length : safeArray(raw?.recommendations).length
    const promptN = cd ? safeArray(cd.aiPrompts).length : 0
    const testN = cd ? safeArray(cd.suggestedTests).length : recN

    const rcLine =
      cd?.reasonCode && String(cd.reasonCode).trim()
        ? String(cd.reasonCode)
        : progress === 'failed'
          ? 'DIMENSION_ANALYSIS_FAILED'
          : 'n/a'

    lines.push(`Dimension: ${id}`)
    if (raw?.label) lines.push(`Label: ${raw.label}`)
    lines.push(`Status: ${displayStatus}`)
    lines.push(`Applicability: ${cd?.applicability ?? raw?.applicability?.status ?? 'unknown'}`)
    lines.push(`Files reviewed: ${reviewedFiles}`)
    lines.push(`Recommendations: ${recN}`)
    lines.push(`Prompts: ${promptN}`)
    lines.push(`Tests: ${testN}`)
    lines.push(`Reason code: ${rcLine}`)

    if (effectiveFailed) {
      failedIds.push(id)
      const expl = describeDimensionFailure(reasonCode || rcLine, rt?.lastError)
      lines.push(`Why it failed: ${expl.why}`)
      lines.push(`Impact: ${expl.impact}`)
      lines.push(`Next action: ${expl.next}`)
      if (rt?.lastError != null && String(rt.lastError).trim()) {
        lines.push(`Runtime detail: ${toStr(rt.lastError).slice(0, 600)}`)
      }
      add(
        `pm.dimension.${id}.failed`,
        'fail',
        'dimension_review',
        `Dimension ${id} failed (${reasonCode || rcLine || 'see dashboard'}).`,
        rt?.lastError != null ? toStr(rt.lastError).slice(0, 400) : undefined
      )
    } else {
      const dashStatus = String(raw?.status || '').toLowerCase()
      let assessment = 'review'
      if (contractStatus === 'SUCCESS' && (progress === 'completed' || !progress)) assessment = 'good'
      if (contractStatus === 'WARNING' || dashStatus === 'attention' || dashStatus === 'review_needed') {
        assessment = 'needs attention'
      }
      if (String(cd?.applicability || raw?.applicability?.status || '') === 'not_applicable') {
        assessment = 'not applicable'
      }
      lines.push(`Assessment: ${assessment}`)
    }

    lines.push('')
  }

  if (
    normalizeRunStatus(runStatus) === 'SUCCESS' &&
    Number.isFinite(reviewedSummary) &&
    Number.isFinite(totalSummary) &&
    reviewedSummary >= totalSummary &&
    totalSummary > 0 &&
    anyRawFailed
  ) {
    add(
      'pm.dimension_summary_vs_dashboard',
      'fail',
      'dimension_review',
      'dimensionSummary reports all dimensions reviewed, but at least one dashboard dimension has progress=failed - summaries contradict live dimension rows.',
      `dimensionsReviewed=${reviewedSummary} totalDimensions=${totalSummary}`,
    )
  }

  return { lines, failedIds }
}

/**
 * @param {object} run
 * @returns {object}
 */
export function buildRunPostMortem(run) {
  const assessedAtIso = nowIso()
  const assertions = []
  const runId = run && (run.runId || run.jobId) ? String(run.runId || run.jobId) : null

  const add = (id, severity, category, message, detail) => {
    const row = { id, severity, category, message }
    if (detail !== undefined && detail !== null && detail !== '') {
      row.detail = typeof detail === 'string' ? detail : toStr(detail)
    }
    assertions.push(row)
  }

  if (!run || typeof run !== 'object') {
    add('pm.run_present', 'fail', 'run_status', 'Run payload is missing or not an object.')
    return finalizeReport({
      assessedAtIso,
      runId: null,
      assertions,
      run: null,
      contractCheck: { ok: false, skipped: true, reason: 'No run object' },
      skippedDimensions: [],
      failedDimensions: [],
      capHits: [],
      dashboardPresent: false,
      dimensionInventoryLines: [],
    })
  }

  add('pm.run_present', 'pass', 'run_status', 'Run object present.')

  if (!runId) {
    add('pm.run_id', 'fail', 'run_status', 'Neither runId nor jobId is set.')
  } else {
    add('pm.run_id', 'pass', 'run_status', `Resolved run identifier: ${runId}`)
  }

  const status = normalizeRunStatus(run.status)
  const telemetry = run.telemetry && typeof run.telemetry === 'object' ? run.telemetry : null
  const telIngest = telemetry?.ingestion && typeof telemetry.ingestion === 'object' ? telemetry.ingestion : null
  const fileSel = run.fileSelectionSummary && typeof run.fileSelectionSummary === 'object' ? run.fileSelectionSummary : null
  const dimSum =
    run.dimensionSummary && typeof run.dimensionSummary === 'object' ? run.dimensionSummary : null
  const telEntry =
    run.telemetryLogEntry && typeof run.telemetryLogEntry === 'object' ? run.telemetryLogEntry : null
  const mus = run.modelUsageSummary && typeof run.modelUsageSummary === 'object' ? run.modelUsageSummary : null
  const dashboard = run.dashboard && typeof run.dashboard === 'object' ? run.dashboard : null
  const dims = safeArray(dashboard?.dimensions)
  const reasonCode = typeof run.reasonCode === 'string' ? run.reasonCode.trim() : ''

  // --- Terminal state & reason codes ---
  if (status === 'RUNNING' || !status) {
    add(
      'pm.terminal_status',
      'warn',
      'run_status',
      'Run does not appear terminal (status RUNNING or empty). Post-mortem is best-effort on partial data.',
      `status=${run.status ?? '(missing)'}`
    )
  } else {
    add('pm.terminal_status', 'pass', 'run_status', `Run reached a terminal status: ${status}`)
  }

  if (advisoryStatusRequiresReasonCode(status)) {
    if (!reasonCode) {
      add(
        'pm.reason_code_required',
        'fail',
        'run_status',
        `Status ${status} requires an explicit reasonCode per advisory policy.`,
        `reasonCode=${run.reasonCode ?? '(missing)'}`
      )
    } else {
      add('pm.reason_code_required', 'pass', 'run_status', `reasonCode present for ${status}: ${reasonCode}`)
    }
  } else if (reasonCode) {
    add('pm.reason_code_optional', 'pass', 'run_status', `reasonCode present (optional for ${status}): ${reasonCode}`)
  }

  const completedAt = run.completedAt || run.updatedAt || null
  if (status !== 'RUNNING' && status) {
    if (!completedAt) {
      add(
        'pm.completion_timestamp',
        'warn',
        'timestamps',
        'No completedAt; using updatedAt for ordering may hide true completion time.',
        `updatedAt=${run.updatedAt ?? '(missing)'}`
      )
    } else {
      add('pm.completion_timestamp', 'pass', 'timestamps', `Completion/anchor timestamp present: ${completedAt}`)
    }
  }

  // --- Repository profile ---
  const repo = run.repository
  if (!repo || typeof repo !== 'object' || (!repo.owner && !repo.name && !repo.displayName)) {
    add('pm.repository_profile', 'warn', 'repository_profile', 'Repository metadata is thin or missing.')
  } else {
    add(
      'pm.repository_profile',
      'pass',
      'repository_profile',
      `Repository: ${repo.displayName || `${repo.owner}/${repo.name}` || 'present'}`
    )
  }

  // --- Stage / runState coherence ---
  const runState = String(run.runState || dashboard?.runState || '').toLowerCase()
  if (dashboard && runState) {
    if (status === 'SUCCESS' && runState !== 'completed') {
      add(
        'pm.run_state_vs_status',
        'warn',
        'stage_outcomes',
        'Top-level status is SUCCESS but dashboard runState is not completed.',
        `runState=${runState}`
      )
    } else if (status === 'FAILED' && runState !== 'failed') {
      add(
        'pm.run_state_vs_status',
        'warn',
        'stage_outcomes',
        'Top-level status is FAILED but dashboard runState is not failed.',
        `runState=${runState}`
      )
    } else {
      add('pm.run_state_vs_status', 'pass', 'stage_outcomes', `runState "${runState}" aligns with recorded status.`)
    }
  } else if (!dashboard) {
    const structuredDims =
      telemetry?.structured &&
      typeof telemetry.structured.dimensionCount === 'number' &&
      telemetry.structured.dimensionCount > 0
    const summaryAligned =
      dimSum &&
      Number(dimSum.totalDimensions) > 0 &&
      Number(dimSum.dimensionsReviewed) === Number(dimSum.totalDimensions)
    if (structuredDims && summaryAligned) {
      add(
        'pm.dashboard_snapshot',
        'pass',
        'stage_outcomes',
        'No serialized dashboard object on this document; dimensionSummary and telemetry.structured agree - counts-only verification (per-dimension narratives and advisory contract replay require dashboard payloads on the run or an in-memory scan job merge).'
      )
    } else {
      add(
        'pm.dashboard_snapshot',
        'warn',
        'stage_outcomes',
        'No dashboard snapshot on this run - cannot reconcile dimensions beyond summaries (persist dashboard on scan completion, run post-mortem while the job is still in memory, or supply complete dimensionSummary plus structured telemetry).'
      )
    }
  }

  // --- Telemetry blob ---
  if (!telemetry) {
    if (denormalizedTelemetrySufficientForAudit(fileSel, telEntry, mus)) {
      add(
        'pm.telemetry_blob',
        'pass',
        'telemetry_completeness',
        'No structured run.telemetry object; ingestion and token usage verified from fileSelectionSummary, modelUsageSummary, and telemetryLogEntry (legacy Firestore persist shape).'
      )
    } else {
      add(
        'pm.telemetry_blob',
        status === 'SUCCESS' ? 'fail' : 'warn',
        'telemetry_completeness',
        'No telemetry object on run - cannot verify lifecycle, ingestion, or token usage.'
      )
    }
  } else {
    add('pm.telemetry_blob', 'pass', 'telemetry_completeness', 'Telemetry object present.')
    if (telemetry.schemaVersion !== 1 && telemetry.schemaVersion != null) {
      add(
        'pm.telemetry_schema_version',
        'warn',
        'telemetry_completeness',
        'Unexpected telemetry.schemaVersion (expected 1 for scan lifecycle rows).',
        `schemaVersion=${telemetry.schemaVersion}`
      )
    } else {
      add('pm.telemetry_schema_version', 'pass', 'telemetry_completeness', 'telemetry.schemaVersion is compatible.')
    }

    if (!telemetry.profile && !telemetry.runState) {
      add('pm.telemetry_profile', 'warn', 'telemetry_completeness', 'Telemetry lacks profile/runState hints.')
    } else {
      add(
        'pm.telemetry_profile',
        'pass',
        'telemetry_completeness',
        `profile=${telemetry.profile ?? '(n/a)'} outcome=${telemetry.outcome ?? '(n/a)'}`
      )
    }

    const corr = telemetry.correlationId || run.correlationId
    if (!corr) {
      add('pm.correlation_id', 'warn', 'telemetry_completeness', 'No correlationId on telemetry or run for trace linking.')
    } else {
      add('pm.correlation_id', 'pass', 'telemetry_completeness', `correlationId: ${corr}`)
    }

    if (telemetry.outcome === 'failed' && status === 'SUCCESS') {
      add(
        'pm.lifecycle_outcome_mismatch',
        'fail',
        'telemetry_completeness',
        'telemetry.outcome is failed but run.status is SUCCESS - inconsistent lifecycle.'
      )
    } else if (telemetry.outcome === 'completed' && status === 'FAILED') {
      add(
        'pm.lifecycle_outcome_mismatch',
        'warn',
        'telemetry_completeness',
        'telemetry.outcome is completed but run.status is FAILED - check failure path overlay.'
      )
    } else {
      add('pm.lifecycle_outcome_coherence', 'pass', 'telemetry_completeness', 'Lifecycle outcome is not blatantly incompatible with run.status.')
    }
  }

  // --- Master critical files / file selection ---
  const selected =
    telIngest?.selectedFileCount ?? fileSel?.selectedFileCount ?? null
  const omitted = telIngest?.omittedFileCount ?? fileSel?.omittedFileCount ?? null
  if (selected == null && omitted == null) {
    add(
      'pm.file_counts',
      'warn',
      'file_coverage',
      'selectedFileCount / omittedFileCount not available from telemetry or fileSelectionSummary.'
    )
  } else {
    add(
      'pm.file_counts',
      'pass',
      'file_coverage',
      `Selection counts present: selected=${selected ?? '?'}, omitted=${omitted ?? '?'}`
    )
  }

  const capHits = safeArray(telIngest?.capHits || fileSel?.capHits)
  if (capHits.length > 0) {
    add(
      'pm.cap_hits',
      'warn',
      'file_coverage',
      'Ingestion cap hits recorded - coverage may be truncated versus full repo.',
      capHits.join(', ')
    )
  } else {
    add('pm.cap_hits', 'pass', 'file_coverage', 'No ingestion cap hits recorded.')
  }

  const cov = telIngest?.coverage
  if (cov && typeof cov === 'object') {
    const anyCap =
      cov.maxFilesCapHit || cov.maxBytesPerFileCapHit || cov.maxTotalBytesCapHit || cov.maxTreeSizeCapHit
    if (anyCap) {
      add(
        'pm.coverage_flags',
        'warn',
        'file_coverage',
        'Coverage flags indicate one or more hard caps were hit.',
        JSON.stringify(cov)
      )
    } else {
      add('pm.coverage_flags', 'pass', 'file_coverage', 'No coverage cap flags set on telemetry.ingestion.coverage.')
    }
  }

  if (
    status === 'SUCCESS' &&
    !dashboard &&
    selected != null &&
    selected > 0
  ) {
    add(
      'pm.file_paths_manifest',
      'warn',
      'file_coverage',
      'Selection counts are present but no dashboard payload on the run - cannot list representative paths, omission rationale per tier, or map files into dimensions from persisted telemetry alone.',
    )
  }

  // --- Dimension classification / summaries ---
  if (!dimSum && !dims.length) {
    add(
      'pm.dimension_summary',
      'warn',
      'dimension_review',
      'No dimensionSummary and no dashboard dimensions - cannot verify full dimension posture.'
    )
  } else if (dimSum) {
    const reviewed = Number(dimSum.dimensionsReviewed ?? NaN)
    const total = Number(dimSum.totalDimensions ?? NaN)
    if (Number.isFinite(reviewed) && Number.isFinite(total) && reviewed > total) {
      add('pm.dimension_counts_inconsistent', 'fail', 'dimension_review', 'dimensionsReviewed exceeds totalDimensions.')
    } else if (
      Number.isFinite(reviewed) &&
      Number.isFinite(total) &&
      status === 'SUCCESS' &&
      reviewed < total
    ) {
      add(
        'pm.dimensions_incomplete_success',
        'fail',
        'dimension_review',
        'Run marked SUCCESS but not all dimensions were reviewed per dimensionSummary.',
        `dimensionsReviewed=${reviewed} totalDimensions=${total}`
      )
    } else if (Number.isFinite(reviewed) && Number.isFinite(total)) {
      add(
        'pm.dimension_counts',
        'pass',
        'dimension_review',
        `Dimension counts: reviewed=${reviewed} total=${total}`
      )
    }
    const sd = dimSum.statusDistribution
    if (sd && typeof sd === 'object') {
      const failedLike = Number(sd.failed ?? sd.review_needed ?? 0)
      if (failedLike > 0 && status === 'SUCCESS') {
        add(
          'pm.status_distribution_vs_success',
          'warn',
          'dimension_review',
          'statusDistribution shows attention/review_needed style failures while run is SUCCESS.',
          JSON.stringify(sd)
        )
      }
    }
  }

  const rd = dashboard?.reportReadinessReasons
  if (Array.isArray(rd) && rd.length > 0) {
    add(
      'pm.report_readiness_reasons',
      status === 'SUCCESS' ? 'warn' : 'pass',
      'report_export',
      'Dashboard lists report readiness gaps.',
      rd.join(' | ')
    )
  }

  if (dashboard && dashboard.consolidatedReportAvailable === false) {
    add(
      'pm.consolidated_report',
      'warn',
      'report_export',
      'consolidatedReportAvailable is false - export/readiness may be degraded.'
    )
  }

  // Per-dimension table when dashboard exists (inventory + explicit failures appended after contract replay)
  const skippedDimensions = []
  let failedDimensions = []
  for (const d of dims) {
    const app = String(d?.applicability?.status || '').toLowerCase()
    if (app === 'not_applicable') skippedDimensions.push(d?.label || d?.dimensionId || '?')
  }
  if (skippedDimensions.length) {
    add(
      'pm.skipped_dimensions',
      'pass',
      'skipped_work',
      `Dimensions marked not_applicable (skipped): ${skippedDimensions.length}`,
      skippedDimensions.slice(0, 12).join(', ')
    )
  }

  // --- Model usage ---
  const totalTok =
    mus?.totalTokens ??
    telemetry?.tokenUsage?.total?.total_tokens ??
    telEntry?.totalTokens ??
    null
  if (totalTok != null && totalTok > 0) {
    add('pm.token_usage', 'pass', 'advisory_quality', `Total tokens recorded: ${totalTok}`)
  } else if (status === 'SUCCESS') {
    add(
      'pm.token_usage',
      'warn',
      'advisory_quality',
      'SUCCESS run shows zero or missing token totals - verify modelUsageSummary / telemetry.tokenUsage.'
    )
  } else {
    add('pm.token_usage', 'warn', 'advisory_quality', 'Token totals missing (may be expected on failure paths).')
  }

  const rv = run.reportValidation && typeof run.reportValidation === 'object' ? run.reportValidation : null
  if (rv) {
    if (rv.ok === false) {
      add(
        'pm.report_validation',
        'fail',
        'advisory_quality',
        'reportValidation.ok is false - structured report failed validation.',
        [...safeArray(rv.finalValidationCategories), ...safeArray(rv.initialValidationCategories)].join(', ')
      )
    } else {
      add('pm.report_validation', 'pass', 'advisory_quality', 'reportValidation.ok is true.')
    }
    const st = rv.structuredTelemetry
    if (st && typeof st === 'object') {
      if (st.lowInformationReport) {
        add(
          'pm.low_information_report',
          'warn',
          'advisory_quality',
          'Structured telemetry flags lowInformationReport - treat narrative as weak.'
        )
      }
      if (st.reportValueGatePassed === false) {
        add('pm.report_value_gate', 'fail', 'advisory_quality', 'reportValueGatePassed is false.')
      } else if (st.reportValueGatePassed === true) {
        add('pm.report_value_gate', 'pass', 'advisory_quality', 'reportValueGatePassed is true.')
      }
      if (typeof st.genericRecommendationCount === 'number' && st.genericRecommendationCount > 3) {
        add(
          'pm.generic_recommendations',
          'warn',
          'advisory_quality',
          'High genericRecommendationCount - output may be boilerplate-heavy.',
          String(st.genericRecommendationCount)
        )
      }
    }
  } else if (status === 'SUCCESS' && dashboard?.runState === 'completed') {
    add(
      'pm.report_validation',
      'warn',
      'advisory_quality',
      'No reportValidation object on run snapshot - cannot confirm validator outcome.'
    )
  }

  // --- Telemetry log row ---
  if (!telEntry) {
    add(
      'pm.telemetry_log_entry',
      'warn',
      'telemetry_completeness',
      'telemetryLogEntry missing - SCAN-TELEMETRY-LOG style row was not persisted on run.'
    )
  } else {
    const need = ['timestampUtc', 'repo', 'profile']
    const missing = need.filter((k) => telEntry[k] == null || telEntry[k] === '')
    if (missing.length) {
      add(
        'pm.telemetry_log_entry_fields',
        'warn',
        'telemetry_completeness',
        'telemetryLogEntry is missing useful fields.',
        `missing: ${missing.join(', ')}`
      )
    } else {
      add('pm.telemetry_log_entry_fields', 'pass', 'telemetry_completeness', 'telemetryLogEntry has core display fields.')
    }
  }

  // --- Warnings / errors vs status ---
  const warnings = safeArray(run.warnings)
  const errors = safeArray(run.errors)
  if (status === 'FAILED' && errors.length === 0 && !run.error) {
    add(
      'pm.errors_array',
      'warn',
      'run_status',
      'FAILED status but errors array is empty and no legacy error string.'
    )
  }
  if (errors.length > 0) {
    add(
      'pm.errors_recorded',
      'fail',
      'failures',
      `Recorded errors (${errors.length}).`,
      errors.map((e) => String(e).slice(0, 500)).join(' | ')
    )
  }
  if (warnings.length > 0) {
    add(
      'pm.warnings_recorded',
      'warn',
      'warnings',
      `Recorded warnings (${warnings.length}).`,
      warnings.map((w) => toStr(w).slice(0, 400)).join(' | ')
    )
  }
  if (typeof run.error === 'string' && run.error.trim()) {
    add('pm.legacy_error_string', 'fail', 'failures', 'Legacy error field present.', run.error.slice(0, 800))
  }

  // --- Advisory contract reconstruction ---
  let builtAdvisoryContract = null
  let contractCheck
  if (dashboard && dims.length > 0) {
    try {
      const contract = buildAdvisoryOutput({
        repoData: minimalRepoData(run),
        dashboard,
      })
      builtAdvisoryContract = contract
      const validation = validateAdvisoryOutputContract(contract)
      contractCheck = { ...validation, skipped: false }
      if (contractCheck.ok) {
        add(
          'pm.advisory_contract',
          'pass',
          'contract_compliance',
          `Advisory contract validation passed (${ADVISORY_CONTRACT_VERSION}).`
        )
      } else {
        add(
          'pm.advisory_contract',
          'fail',
          'contract_compliance',
          'Reconstructed advisory output failed contract validation.',
          safeArray(contractCheck.errors).join(' | ')
        )
      }

      const promptQualityFailedDims = safeArray(contract.dimensions).filter(
        (d) => d.reasonCode === 'AI_PROMPT_QUALITY_FAILED'
      )
      if (promptQualityFailedDims.length > 0) {
        add(
          'pm.ai_prompt_quality_gate',
          'fail',
          'advisory_quality',
          'One or more dimensions failed the AI IDE prompt quality gate (no valid prompts for user output).',
          'REJECT_OUTPUT'
        )
      }
      const promptWarnDims = safeArray(contract.dimensions).filter(
        (d) => d.reasonCode === 'AI_PROMPT_QUALITY_WARNING'
      )
      if (promptWarnDims.length > 0) {
        add(
          'pm.ai_prompt_quality_partial',
          'warn',
          'advisory_quality',
          'Some invalid IDE prompts were withheld; dimension marked WARNING (AI_PROMPT_QUALITY_WARNING).'
        )
      }
      for (const dim of safeArray(contract.dimensions)) {
        for (const p of safeArray(dim.aiPrompts)) {
          const v = validateAiIdePrompt(p, dim.dimensionId)
          if (!v.ok) {
            add(
              'pm.ai_prompt_contract_leak',
              'fail',
              'advisory_quality',
              'Invalid AI IDE prompt reached user contract output (should have been filtered).',
              v.issues.join(', ')
            )
          }
        }
      }
      addDeepOutputQualityAssertions(contract, dims, add)
    } catch (err) {
      add(
        'pm.advisory_contract',
        'fail',
        'contract_compliance',
        'Exception while building/validating advisory contract.',
        err instanceof Error ? err.message : String(err)
      )
      contractCheck = { ok: false, errors: [String(err)], skipped: false }
    }
  } else {
    contractCheck = {
      ok: true,
      errors: [],
      skipped: true,
      reason:
        'No dashboard dimensions array on this run - advisory contract reconstruction needs per-dimension payloads (persisted at scan completion or merged from the in-memory job).',
    }
    add(
      'pm.advisory_contract',
      'warn',
      'contract_compliance',
      'Skipped full advisory contract replay - no dimension payloads on this run (store dashboard on completion and/or request post-mortem while the scan job is still resident).'
    )
  }

  let dimensionInventoryLines = []
  if (dashboard && dims.length > 0) {
    const inv = buildDimensionPostMortemInventory({
      dashboard,
      dims,
      contract: builtAdvisoryContract,
      dimSum,
      runStatus: status,
      add,
    })
    dimensionInventoryLines = inv.lines
    failedDimensions = inv.failedIds
    if (failedDimensions.length) {
      add(
        'pm.failed_dimensions',
        'fail',
        'dimension_review',
        `One or more dimensions failed (${failedDimensions.length}): ${failedDimensions.join(', ')}.`,
        'See per-dimension inventory blocks and pm.dimension.<id>.failed assertions.',
      )
    }
  }

  // --- Prohibited terminology (all string fields on report, errors, telemetry, dashboard, reconstructed contract) ---
  const prohibitedSurfaces = []
  if (typeof run.report === 'string' && containsProhibitedLanguage(run.report)) {
    prohibitedSurfaces.push('run.report')
  }
  const errBlobForPm = errors.map((e) => String(e)).join('\n')
  if (containsProhibitedLanguage(errBlobForPm)) {
    prohibitedSurfaces.push('run.errors')
  }
  collectProhibitedPaths(run.telemetry || {}, 'telemetry', prohibitedSurfaces)
  if (dashboard && typeof dashboard === 'object') {
    collectProhibitedPaths(dashboard, 'dashboard', prohibitedSurfaces)
  }
  if (builtAdvisoryContract && typeof builtAdvisoryContract === 'object') {
    collectProhibitedPaths(builtAdvisoryContract, 'advisoryContract', prohibitedSurfaces)
  }
  if (prohibitedSurfaces.length) {
    add(
      'pm.prohibited_language',
      'fail',
      'contract_compliance',
      'Prohibited scanner-confirmation phrasing found in string fields (full scan: report, errors, telemetry, dashboard, reconstructed advisory contract).',
      [...new Set(prohibitedSurfaces)].join(', ')
    )
  } else {
    add(
      'pm.prohibited_language',
      'pass',
      'contract_compliance',
      'No prohibited advisory phrases in fully scanned surfaces (report, errors, telemetry, dashboard, advisory contract).',
    )
  }

  const hasDashboardDimensions =
    Boolean(dashboard && Array.isArray(dashboard.dimensions) && dashboard.dimensions.length > 0)

  return finalizeReport({
    assessedAtIso,
    runId,
    assertions,
    run,
    contractCheck,
    skippedDimensions,
    failedDimensions,
    capHits,
    dashboardPresent: hasDashboardDimensions,
    dimensionInventoryLines,
  })
}

function finalizeReport({
  assessedAtIso,
  runId,
  assertions,
  run,
  contractCheck,
  skippedDimensions,
  failedDimensions,
  capHits,
  dashboardPresent,
  dimensionInventoryLines,
}) {
  const counts = assertions.reduce(
    (acc, a) => {
      acc[a.severity] = (acc[a.severity] || 0) + 1
      return acc
    },
    { pass: 0, warn: 0, fail: 0 }
  )

  const fails = assertions.filter((a) => a.severity === 'fail')
  const warns = assertions.filter((a) => a.severity === 'warn')

  const status = normalizeRunStatus(run?.status)
  let recommendedNextAction = 'INVESTIGATE'
  if (fails.some((f) => f.id === 'pm.run_present')) {
    recommendedNextAction = 'REJECT'
  } else if (
    fails.some(
      (f) =>
        f.category === 'contract_compliance' ||
        f.category === 'failures' ||
        (f.category === 'advisory_quality' && f.severity === 'fail')
    )
  ) {
    recommendedNextAction = 'REJECT'
  } else if (fails.length > 0) {
    recommendedNextAction = 'RERUN'
  } else if (status === 'FAILED') {
    recommendedNextAction = 'RERUN'
  } else if (fails.length === 0 && status === 'SUCCESS' && contractCheck.skipped) {
    recommendedNextAction = 'INSUFFICIENT_QUALITY_EVIDENCE'
  } else if (warns.length === 0 && status === 'SUCCESS' && !contractCheck.skipped) {
    recommendedNextAction = 'TRUST'
  } else if (warns.length > 0 && fails.length === 0) {
    recommendedNextAction = status === 'SUCCESS' ? 'INVESTIGATE' : 'RERUN'
  }

  const executiveVerdict = buildExecutiveVerdict({ status, counts, recommendedNextAction, fails, warns })

  const developerDiagnosticNotes = buildDevNotes({ run, dashboardPresent, contractCheck })
  const sections = buildSections({
    assertions,
    executiveVerdict,
    recommendedNextAction,
    skippedDimensions,
    failedDimensions,
    capHits,
    contractCheck,
    developerDiagnosticNotes,
    run,
    dashboardPresent,
    dimensionInventoryLines,
  })

  return {
    schemaVersion: POST_MORTEM_SCHEMA,
    assessedAtIso,
    runId,
    executiveVerdict,
    recommendedNextAction,
    assertionSummary: counts,
    assertions,
    sections,
    developerDiagnosticNotes,
  }
}

function buildExecutiveVerdict({ status, counts, recommendedNextAction, fails, warns }) {
  let headline
  if (fails.length > 0) {
    headline = `Run assessment: FAILED checks (${fails.length}) - do not treat as clean success.`
  } else if (recommendedNextAction === 'INSUFFICIENT_QUALITY_EVIDENCE') {
    headline =
      'Run assessment: lifecycle SUCCESS but no advisory dashboard payload to judge usefulness - treat as INSUFFICIENT_QUALITY_EVIDENCE until payloads are persisted or replayed.'
  } else if (warns.length > 0) {
    headline = `Run assessment: ${warns.length} warning(s) - metadata may look healthy while advisory depth or coverage is weak; review before trusting.`
  } else {
    headline = `Run assessment: checks passed (${counts.pass || 0}) including advisory output depth where data allowed.`
  }

  let trustLevel = 'medium'
  if (fails.length > 0) trustLevel = 'low'
  else if (recommendedNextAction === 'INSUFFICIENT_QUALITY_EVIDENCE') trustLevel = 'low'
  else if (recommendedNextAction === 'TRUST') trustLevel = 'high'
  else if (warns.length > 3) trustLevel = 'low'
  else if (warns.length > 0) trustLevel = 'low'

  return {
    headline,
    trustLevel,
    status,
    recommendedNextAction,
    failedAssertions: fails.map((f) => f.id),
    warningAssertions: warns.map((w) => w.id),
  }
}

function buildSections({
  assertions,
  executiveVerdict,
  recommendedNextAction,
  skippedDimensions,
  failedDimensions,
  capHits,
  contractCheck,
  developerDiagnosticNotes,
  run,
  dashboardPresent,
  dimensionInventoryLines,
}) {
  const byCat = (cat) => assertions.filter((a) => a.category === cat)
  const lines = (arr) => arr.map((a) => `- [${a.severity.toUpperCase()}] ${a.message}${a.detail ? ` - ${a.detail}` : ''}`)

  const whatWorkedNarrative = buildNarrativeWhatWorkedWell(assertions, run, contractCheck, dashboardPresent)
  const notWorked = assertions.filter((a) => a.severity === 'warn').map((a) => `${a.message}${a.detail ? ` (${a.detail})` : ''}`)

  return {
    executiveRunVerdict: [
      executiveVerdict.headline,
      `Trust level (automated): ${executiveVerdict.trustLevel}`,
      `Recommended next action: ${recommendedNextAction}`,
    ],
    whatWorkedWell:
      whatWorkedNarrative.length > 0 ? whatWorkedNarrative : ['No passing checks recorded (inspect raw assertions).'],
    whatDidNotWorkWell: notWorked.length ? notWorked : ['No warning-level issues flagged.'],
    failures: lines(assertions.filter((a) => a.severity === 'fail')),
    warnings: lines(assertions.filter((a) => a.severity === 'warn')),
    skippedWork:
      skippedDimensions.length > 0
        ? [
            `Dimensions classified not_applicable / skipped: ${skippedDimensions.length}`,
            skippedDimensions.slice(0, 30).join(', '),
          ]
        : ['No explicit skipped dimensions enumerated (or no dashboard snapshot).'],
    fileCoverageReview: lines(byCat('file_coverage')).concat(
      capHits.length ? [`Cap hits detail: ${capHits.join(', ')}`] : []
    ),
    dimensionReview: (dimensionInventoryLines?.length
      ? ['- Per-dimension inventory -', ...dimensionInventoryLines, '- Automated dimensional assertions -']
      : ['No per-dimension inventory (persist or merge a dashboard snapshot on the run).']
    ).concat(lines(byCat('dimension_review'))),
    advisoryOutputQualityReview: lines(byCat('advisory_quality')),
    telemetryCompletenessReview: lines(byCat('telemetry_completeness')),
    contractComplianceReview: lines(byCat('contract_compliance')).concat(
      contractCheck.skipped ? [`Note: ${contractCheck.reason || 'Contract replay skipped'}`] : []
    ),
    recommendedNextAction: [
      `Engine recommendation: ${recommendedNextAction}`,
      recommendedNextAction === 'TRUST'
        ? 'Suitable for regression baselines only after advisory depth checks passed with zero warnings.'
        : recommendedNextAction === 'RERUN'
          ? 'Re-run with same repo after fixing upstream failures or caps.'
          : recommendedNextAction === 'REJECT'
            ? 'Do not use outputs for stakeholder sign-off until contract/language failures are resolved.'
            : recommendedNextAction === 'INSUFFICIENT_QUALITY_EVIDENCE'
              ? 'Persist or merge dashboard payloads, then re-run post-mortem - token counts and reportValidation alone do not prove usefulness.'
              : 'Review warning details and narrow unknowns before trusting.',
    ],
    developerDiagnosticNotes,
  }
}

function buildDevNotes({ run, dashboardPresent, contractCheck }) {
  const notes = []
  if (!run) {
    notes.push('No run payload - diagnostic skipped.')
    return notes
  }
  if (!dashboardPresent) {
    notes.push(
      'No dimension dashboard payload on this run - per-dimension advisory replay was skipped; summaries and structured telemetry may still be consistent.'
    )
  }
  if (contractCheck.skipped) {
    notes.push(contractCheck.reason || 'Advisory contract replay skipped.')
  }
  const tel = run.telemetry
  if (tel?.priorRunTelemetry) {
    notes.push('telemetry.priorRunTelemetry present - failure path retained partial prior telemetry.')
  }
  notes.push(`Post-mortem schema: ${POST_MORTEM_SCHEMA} (assertions are additive; ids stable for diffing).`)
  return notes
}
