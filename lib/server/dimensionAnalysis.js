import {
  DIMENSION_CATALOG,
  SCAN_PENDING_APPLICABILITY,
  createDashboardPayload,
  createEmptyDimensionResult,
  getDimensionDefinition,
  getDimensionDefinitionByPassFamily,
} from '../shared/dimensions.js'
import { buildDimensionApplicability } from '../shared/repoProfile.js'

function toArray(value) {
  return Array.isArray(value) ? value : []
}

function uniqueStrings(values) {
  return [...new Set(toArray(values).map((value) => String(value || '').trim()).filter(Boolean))]
}

function escapeMarkdownTableCell(value) {
  return String(value ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n+/g, ' ')
    .trim()
}

/** Notes column: hide repetitive “applicable” boilerplate; keep real not-applicable explanations. */
function applicabilityNoteForReport(dimension) {
  const status = dimension?.applicability?.status
  const rationale = String(dimension?.applicability?.rationale || '').trim()
  if (status === 'not_applicable') {
    return rationale || '—'
  }
  if (!rationale) return '—'
  if (/^Applicability is derived from detected repository profile/i.test(rationale)) return '—'
  if (/^Weighted from repo profile fit and in-scope evidence\.?$/i.test(rationale)) return '—'
  return rationale
}

function buildApplicabilityMarkdownTable(dimensions) {
  if (!dimensions.length) return '_No dimensions in this report._'
  const header = '| Dimension | Weight | Status | Notes |'
  const sep = '| :--- | ---: | :--- | :--- |'
  const rows = dimensions.map((dimension) => {
    const pct = Math.round((dimension?.applicability?.weight || 0) * 100)
    const statusLabel = dimension?.applicability?.status === 'not_applicable' ? 'Not applicable' : 'Applicable'
    const note = applicabilityNoteForReport(dimension)
    return `| ${escapeMarkdownTableCell(dimension.label)} | ${pct}% | ${escapeMarkdownTableCell(statusLabel)} | ${escapeMarkdownTableCell(note)} |`
  })
  return [header, sep, ...rows].join('\n')
}

function deriveConfidence({ reviewedFiles, capLimited, findings, observedControls, unverifiedControls }) {
  if (reviewedFiles <= 0) return 'low'
  if (capLimited) return reviewedFiles >= 4 ? 'medium' : 'low'
  if (findings.length > 0) return 'high'
  if (observedControls.length > 0 && unverifiedControls.length === 0) return 'high'
  if (observedControls.length > 0 || unverifiedControls.length > 0) return 'medium'
  return reviewedFiles >= 3 ? 'medium' : 'low'
}

function deriveStatus({
  findings,
  observedControls,
  unverifiedControls,
  recommendations,
  reviewedFiles,
  capLimited,
}) {
  if (findings.length > 0) return 'review_needed'
  if (unverifiedControls.length > 0 || recommendations.length > 0) return 'attention'
  if (reviewedFiles <= 0 || capLimited) return 'unknown'
  if (observedControls.length > 0) return 'healthy'
  return 'healthy'
}

function controlLine(item, fallback) {
  return (
    item?.claim ||
    item?.title ||
    item?.text ||
    fallback
  )
}

function topCitationsFromItems(items) {
  return uniqueStrings(
    toArray(items).flatMap((item) => toArray(item?.evidence_citations || item?.topCitations || []))
  )
}

function citationsFromEvidencePaths(paths, evidenceByPath) {
  return uniqueStrings(
    paths.map((path) => {
      const evidence = evidenceByPath.get(path)
      const snippet = evidence?.snippets?.[0]
      if (!snippet) return null
      return `${path}:${snippet.startLine}-${snippet.endLine}`
    })
  )
}

function pluralize(count, noun) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

function buildCoverageSummary(label, runtime, reviewedFiles, omittedFilesRelevant, capLimited) {
  if (runtime?.progress === 'failed') {
    return `Review of ${label.toLowerCase()} did not complete, and this dimension requires a retry before launch sign-off.`
  }
  if (reviewedFiles === 0) {
    return `No directly relevant files were retained for ${label.toLowerCase()}, so this dimension requires expanded review before launch sign-off.`
  }

  const coverageParts = [`Reviewed ${pluralize(reviewedFiles, 'file')} directly related to ${label.toLowerCase()}`]
  if (capLimited || omittedFilesRelevant > 0) {
    coverageParts.push(`${pluralize(omittedFilesRelevant, 'additional relevant file')} were omitted by prompt or bundle limits`)
  }
  return `${coverageParts.join('; ')}.`
}

function buildSummary({
  label,
  reviewedPaths,
  findings,
  observedControls,
  unverifiedControls,
  recommendations,
  runtime,
  capLimited,
}) {
  const reviewedCount = reviewedPaths.length
  const topObserved = observedControls[0]
  const topUnverified = unverifiedControls[0]
  const topFinding = findings[0]
  const topRecommendation = recommendations[0]

  const whatWasReviewed =
    runtime?.progress === 'failed'
      ? `The ${label.toLowerCase()} pass did not finish cleanly, so its evidence should be treated as incomplete.`
      : reviewedCount > 0
        ? `SecLens reviewed ${pluralize(reviewedCount, 'path')} for ${label.toLowerCase()} and retained citations for the strongest evidence it found.`
        : `SecLens did not retain directly relevant reviewed paths for ${label.toLowerCase()} in this run.`

  const whatLooksStrong =
    topObserved
      ? controlLine(topObserved, 'At least one control looked present in the reviewed evidence.')
      : findings.length === 0 && unverifiedControls.length === 0 && reviewedCount > 0
        ? `The reviewed evidence did not surface an obvious break in ${label.toLowerCase()}, but that is not the same as a hard security guarantee.`
        : 'No control was strong enough to call confirmed from the retained evidence alone.'

  const whatRemainsUnclear =
    topFinding
      ? controlLine(topFinding, 'A concrete issue needs follow-up.')
      : topUnverified
        ? controlLine(topUnverified, 'One or more expected controls could not be confirmed from the retained evidence.')
        : capLimited
          ? 'Coverage limits trimmed relevant evidence, so this dimension needs an expanded pass before launch sign-off.'
          : reviewedCount === 0
            ? `This dimension needs expanded evidence coverage because SecLens did not retain directly relevant evidence for ${label.toLowerCase()}.`
            : 'This dimension requires targeted reviewer validation before launch sign-off.'

  const whatToCheckNext =
    topRecommendation
      ? controlLine(topRecommendation, 'Follow the highest-priority recommendation for this dimension.')
      : topFinding
        ? 'Confirm the cited issue in the reviewed path, then check nearby code for the same pattern.'
        : topUnverified
          ? 'Manually verify the control claimed above in the cited files before treating this dimension as healthy.'
          : capLimited
            ? 'Re-run with broader evidence retention or review omitted files manually before signing this dimension off.'
            : 'Use the retained citations as a spot-check sample before treating this dimension as complete.'

  return {
    whatWasReviewed,
    whatLooksStrong,
    whatRemainsUnclear,
    whatToCheckNext,
  }
}

export function createInitialDimensionRunState() {
  return Object.fromEntries(
    DIMENSION_CATALOG.map((dimension) => [
      dimension.id,
      {
        startedAt: null,
        completedAt: null,
        lastError: null,
      },
    ])
  )
}

export function createQueuedDashboard(repository) {
  const dimensions = DIMENSION_CATALOG.map((dimension) =>
    createEmptyDimensionResult(dimension.id, { applicability: { ...SCAN_PENDING_APPLICABILITY } })
  )
  return createDashboardPayload({
    repository,
    dimensions,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    runState: 'queued',
    dimensionRuntime: createInitialDimensionRunState(),
  })
}

export function assembleDimensionResult({
  dimensionId,
  repoProfile = null,
  admitted,
  reviewedPaths = [],
  reviewedEvidence = [],
  promptTrimmedEvidenceCount = 0,
  runtime = {},
  coverage = {},
}) {
  const definition = getDimensionDefinition(dimensionId)
  if (!definition) {
    throw new Error(`Cannot assemble unknown dimension: ${dimensionId}`)
  }

  const findings = toArray(admitted?.findings)
  const observedControls = toArray(admitted?.observedControls)
  const unverifiedControls = toArray(admitted?.unverifiedControls)
  const recommendations = [...toArray(admitted?.recommendations), ...toArray(admitted?.quickWins)]
  const evidenceByPath = new Map(toArray(reviewedEvidence).map((item) => [item.path, item]))
  const topCitations = uniqueStrings([
    ...topCitationsFromItems(findings),
    ...topCitationsFromItems(observedControls),
    ...topCitationsFromItems(unverifiedControls),
    ...topCitationsFromItems(recommendations),
    ...citationsFromEvidencePaths(reviewedPaths, evidenceByPath),
  ]).slice(0, 8)

  const reviewedFileCount = reviewedPaths.length
  const omittedFilesRelevant = Math.max(0, Number(promptTrimmedEvidenceCount || 0))
  const capLimited =
    !!coverage?.maxFilesCapHit ||
    !!coverage?.maxBytesPerFileCapHit ||
    !!coverage?.maxTotalBytesCapHit ||
    !!coverage?.maxTreeSizeCapHit ||
    omittedFilesRelevant > 0

  const confidence = deriveConfidence({
    reviewedFiles: reviewedFileCount,
    capLimited,
    findings,
    observedControls,
    unverifiedControls,
  })

  const status = runtime.progress === 'failed'
    ? 'unknown'
    : deriveStatus({
        findings,
        observedControls,
        unverifiedControls,
        recommendations,
        reviewedFiles: reviewedFileCount,
        capLimited,
      })

  const coverageSummary = buildCoverageSummary(
    definition.label,
    runtime,
    reviewedFileCount,
    omittedFilesRelevant,
    capLimited
  )

  return createEmptyDimensionResult(dimensionId, {
    status,
    progress: runtime.progress || 'ready',
    findings,
    observedControls,
    unverifiedControls,
    recommendations,
    coverage: {
      reviewedFiles: reviewedFileCount,
      omittedFilesRelevant,
      capLimited,
      confidence,
      coverageSummary,
    },
    evidence: {
      topCitations,
      reviewedPaths: uniqueStrings(reviewedPaths),
    },
    applicability: buildDimensionApplicability({
      dimensionId,
      repoProfile,
      reviewedFileCount,
      runtimeProgress: runtime.progress || 'ready',
    }),
    summary: buildSummary({
      label: definition.label,
      reviewedPaths,
      findings,
      observedControls,
      unverifiedControls,
      recommendations,
      runtime,
      capLimited,
    }),
  })
}

export function assembleSkippedDimensionResult(dimensionId, reason = 'no_relevant_evidence', repoProfile = null) {
  const definition = getDimensionDefinition(dimensionId)
  if (!definition) {
    throw new Error(`Cannot assemble unknown dimension: ${dimensionId}`)
  }

  const fallbackMessage =
    reason === 'no_relevant_evidence'
      ? `This run did not include directly relevant files for ${definition.label.toLowerCase()}.`
      : `SecLens could not complete ${definition.label.toLowerCase()} because there was not enough relevant evidence.`

  const isMissingEvidence = reason === 'no_relevant_evidence'
  const applicability = isMissingEvidence
    ? buildDimensionApplicability({
        dimensionId,
        repoProfile,
        reviewedFileCount: 0,
        runtimeProgress: 'ready',
      })
    : {
        status: 'not_applicable',
        weight: 0,
        rationale: fallbackMessage,
        required: false,
      }
  const isNotApplicable = applicability.status === 'not_applicable'
  // no_relevant_evidence is an evidence-coverage gap, not an LLM/runtime failure — use partial so
  // summarizeDashboard still counts the dimension as reviewed and export is not blocked (DEFECT-003 / GUI export).
  return createEmptyDimensionResult(dimensionId, {
    status: isNotApplicable ? 'healthy' : 'unknown',
    progress: isNotApplicable ? 'ready' : isMissingEvidence ? 'partial' : 'ready',
    coverage: {
      reviewedFiles: 0,
      omittedFilesRelevant: 0,
      capLimited: false,
      confidence: 'low',
      coverageSummary: fallbackMessage,
    },
    applicability: {
      ...applicability,
    },
    summary: {
      whatWasReviewed: isNotApplicable
        ? `This repository profile indicates ${definition.label.toLowerCase()} is not applicable for this run.`
        : fallbackMessage,
      whatLooksStrong: isNotApplicable
        ? 'The applicability model matched this dimension to repository shape and excluded it from required launch review.'
        : 'No control was strong enough to call confirmed without directly relevant retained evidence.',
      whatRemainsUnclear: isNotApplicable
        ? 'No additional launch-signoff action is required for this dimension in the current repository profile.'
        : `This dimension requires expanded evidence coverage before launch sign-off for ${definition.label.toLowerCase()}.`,
      whatToCheckNext: isNotApplicable
        ? 'No immediate follow-up is required unless repository architecture changes.'
        : 'Review a representative sample of files in this dimension and rerun before treating it as launch-ready.',
    },
  })
}

export function renderConsolidatedReport({ repository, dashboard }) {
  const dimensions = toArray(dashboard?.dimensions)
  const summary = dashboard?.summary
  const repoProfile = dashboard?.repoProfile
  const overallStatus = summary?.overallStatus || 'unknown'
  const statusLabel = {
    healthy: 'Ready to launch',
    attention: 'Ready with caution',
    review_needed: 'Not ready for launch',
    unknown: 'Needs additional review',
  }[overallStatus] || 'Needs additional review'

  const summaryRisk =
    overallStatus === 'review_needed'
      ? 'Not ready for launch'
      : overallStatus === 'attention'
        ? 'Ready with caution'
      : overallStatus === 'healthy'
          ? 'Ready to launch'
          : 'Needs additional review'

  const header = `# SecLens Consolidated Report

- **Repository:** ${repository?.owner || 'unknown'}/${repository?.name || 'unknown'} (${repository?.url || 'unknown'})
- **Ref:** ${repository?.scannedRef || repository?.defaultBranch || 'unknown'}
- **Generated:** ${new Date().toISOString()}
- **Languages:** ${repository?.language || 'Unknown'}
- **Summary Risk:** ${summaryRisk} — ${statusLabel} (from the dimension results in this run).`

  const applicabilityTable = buildApplicabilityMarkdownTable(dimensions)

  const profileLines = repoProfile
    ? `### Repository profile (inferred)

- **Shapes detected:** ${(repoProfile.profiles || []).join(', ') || 'Unknown'}
- **Confidence:** ${repoProfile.confidence || 'unknown'}
- **Signals:** ${repoProfile.rationale || 'No profile rationale was generated for this run.'}

### Applicability by dimension

Each **weight** is how relevant that security lens is to this repository for this scan. It is **not** a quality score or pass/fail grade.

${applicabilityTable}`
    : `### Repository profile (inferred)

- **Shapes detected:** Unknown (no profile payload on this run)

### Applicability by dimension

${applicabilityTable}`

  const findingsAdmitted = summary?.totals?.findingsAdmitted ?? 0
  const observedControls = summary?.totals?.observedControls || 0
  const unverifiedControls = summary?.totals?.unverifiedControls || 0
  const postureQualifier =
    summary?.overallStatus === 'unknown' && findingsAdmitted === 0
      ? `\n\n> **Cautious posture:** At least one applicable dimension was incomplete, evidence-limited, or inconclusive, and no confirmed issues were admitted. That is **not** the same as a third-party “all clear” or a formal launch attestation.`
      : ''

  const readinessLines = Array.isArray(dashboard?.reportReadinessReasons) ? dashboard.reportReadinessReasons : []
  const exportNote =
    readinessLines.length > 0
      ? `\n\n**Export / readiness**\n\n${readinessLines.map((line) => `- ${line}`).join('\n')}`
      : ''

  const executiveSection = `## Executive Posture Summary

SecLens completed ${summary?.totals?.dimensionsReviewed || 0} of ${summary?.totals?.totalDimensions || dimensions.length} planned security dimensions for this repository.

**This run, in short**

- **Confirmed issues:** ${findingsAdmitted} — items treated as real problems backed by cited evidence in this review.
- **Observed protections:** ${observedControls} — defenses we could tie to specific reviewed files.
- **Pre-launch gaps:** ${unverifiedControls} — areas that still need work or stronger evidence before you treat the repo as launch-ready.
${postureQualifier}${exportNote}

${profileLines}

This report is assembled from those dimension results. Opening or exporting it does **not** re-fetch the whole repository.`

  const confirmedProtections = dimensions
    .flatMap((dimension) =>
      toArray(dimension.observedControls).map((control) => `- **${dimension.label}:** ${controlLine(control, 'Observed control recorded in reviewed evidence.')}`)
    )
    .slice(0, 12)
  const confirmedProtectionsSection = `## Confirmed Protections

Strengths we could support with retained citations from the reviewed scope.

${confirmedProtections.length ? confirmedProtections.join('\n') : '- Nothing rose to a separately highlighted, citation-backed strength in this run.'}`

  const priorityRisks = dimensions
    .flatMap((dimension) => {
      const findingLines = toArray(dimension.findings).map((finding) => {
        const evidence = finding?.evidence_citations?.[0] || dimension.evidence.topCitations?.[0] || 'Reviewed evidence'
        return `- **${dimension.label}:** ${controlLine(finding, 'Concrete follow-up required.')} Evidence: \`${evidence}\`.`
      })
      if (findingLines.length > 0) return findingLines
      return []
    })
    .slice(0, 12)
  const priorityRisksSection = `## Priority Risks Requiring Review

Highest-severity admitted findings—each should be read with its evidence path.

${priorityRisks.length ? priorityRisks.join('\n') : '- No confirmed issues were admitted as launch-blocking risks in this run.'}`

  const dimensionSummariesSection = `## Dimension Summaries

${dimensions
  .map((dimension) => {
    const counts = `${dimension.findings.length} findings · ${dimension.observedControls.length} observed controls · ${dimension.unverifiedControls.length} unverified controls · ${dimension.recommendations.length} recommendations`
    return `### ${dimension.label}

- **Status:** ${dimension.status}
- **Progress:** ${dimension.progress}
- **Coverage:** ${dimension.coverage.coverageSummary}
- **Volume:** ${counts}
- **What we reviewed:** ${dimension.summary.whatWasReviewed}
- **What looked strong:** ${dimension.summary.whatLooksStrong}
- **Risks or gaps:** ${dimension.summary.whatRemainsUnclear}
- **Suggested next step:** ${dimension.summary.whatToCheckNext}`
  })
  .join('\n\n')}`

  const prioritizedNextActionsSection = `## Prioritized Next Actions

${toArray(dashboard?.recommendationQueue)
  .slice(0, 12)
  .map(
    (item, index) =>
      `${index + 1}. **${item.dimensionLabel}** — ${item.text}

   Evidence: \`${item.evidenceTarget}\` · Confidence: **${item.confidence}**`
  )
  .join('\n\n') || '1. No follow-up actions were generated from the completed dimensions in this run.'}`

  const confidenceSection = `## Confidence & Coverage

Depth of review, aggregated across dimensions:

- **Reviewed files (counted once per path):** ${summary?.totals?.reviewedFiles || 0}
- **Dimensions at high confidence:** ${summary?.totals?.highConfidenceDimensions || 0}
- **Dimensions at medium confidence:** ${summary?.totals?.mediumConfidenceDimensions || 0}
- **Dimensions at low confidence:** ${summary?.totals?.lowConfidenceDimensions || 0}

Confidence reflects how much on-topic, citable evidence each dimension retained—not how “secure” the repository is overall.`

  const appendixLines = dimensions.flatMap((dimension) =>
    uniqueStrings(dimension.evidence.topCitations).map(
      (citation) => `- **${dimension.label}:** \`${citation}\``
    )
  )
  const appendixSection = `## Evidence Appendix

Paths and line ranges the dimension engines kept as citations (truncated per dimension in the UI).

${appendixLines.length ? appendixLines.join('\n') : '- No line-level citations were retained in the dimension results for this run.'}`

  return [
    header,
    executiveSection,
    confirmedProtectionsSection,
    priorityRisksSection,
    dimensionSummariesSection,
    prioritizedNextActionsSection,
    confidenceSection,
    appendixSection,
  ].join('\n\n')
}

export function buildRepositoryDisplay(repositoryUrl, fetchedRepository = null) {
  if (fetchedRepository) {
    return {
      url: fetchedRepository.url,
      owner: fetchedRepository.owner,
      name: fetchedRepository.repo,
      displayName: `${fetchedRepository.owner}/${fetchedRepository.repo}`,
      language: fetchedRepository.language,
      defaultBranch: fetchedRepository.defaultBranch,
      scannedRef: fetchedRepository.scannedRef,
      scannedSha: fetchedRepository.scannedSha,
    }
  }

  try {
    const parsed = new URL(repositoryUrl)
    const parts = parsed.pathname.split('/').filter(Boolean)
    const owner = parts[0] || 'unknown'
    const name = parts[1] || 'repository'
    return {
      url: repositoryUrl,
      owner,
      name,
      displayName: `${owner}/${name}`,
    }
  } catch {
    return {
      url: repositoryUrl,
      owner: 'unknown',
      name: 'repository',
      displayName: repositoryUrl,
    }
  }
}

export function dimensionIdForPassFamily(passFamily) {
  return getDimensionDefinitionByPassFamily(passFamily)?.id || null
}
