/**
 * User-facing register checks for advisory text (DEFECT-OUTPUT-001).
 * Phrase-only bans (plan Q1/Q5). Hybrid gate severity is field-aware (plan Q4).
 */

/** Approved customer-facing fallbacks (plan Q3 / CR-012 AQ12 — no pathless optimistic fluff). */
export const HUMAN_COVERAGE_NOTE_FALLBACK =
  'Coverage for this area was limited; see the concrete omitted or unmatched paths and reason codes in the coverage allocation section when present.'

export const HUMAN_NO_CONFIRMED_FINDING =
  'No confirmed security issue was identified in the reviewed files. This is not a guarantee for files outside the scan scope.'

export const HUMAN_DOWNSCOPE_WEAKNESS =
  'This review identified a possible weakness, but the reviewed files were not sufficient to report it as a confirmed finding.'

export const HUMAN_EVIDENCE_STANDARD_NOT_MET =
  'The available evidence did not meet the standard for a confirmed finding.'

/**
 * Pipeline / AI-register phrases banned in customer-facing prose.
 * Telemetry and post-mortem internals may still use these terms.
 */
export const INTERNAL_REGISTER_RULES = Object.freeze([
  { re: /\bevidence bundle\b/i, code: 'INTERNAL_EVIDENCE_BUNDLE' },
  { re: /\bcoverage bundle\b/i, code: 'INTERNAL_COVERAGE_BUNDLE' },
  { re: /\bpass family\b/i, code: 'INTERNAL_PASS_FAMILY' },
  { re: /\banalysis pass\b/i, code: 'INTERNAL_ANALYSIS_PASS' },
  { re: /\bpass (id|focus)\b/i, code: 'INTERNAL_PASS_META' },
  { re: /\bin this pass\b/i, code: 'INTERNAL_PASS_META' },
  { re: /\b(candidate admission|admission requirements|finding candidate|admitted finding)\b/i, code: 'INTERNAL_CLAIM_PIPELINE' },
  { re: /\bkey finding admission\b/i, code: 'INTERNAL_CLAIM_PIPELINE' },
  { re: /\b(token budget|context window|prompt packing|prompt budget)\b/i, code: 'INTERNAL_MODEL_PIPELINE' },
  { re: /\b(artifact class|model output|model prompt)\b/i, code: 'INTERNAL_MODEL_REGISTER' },
  { re: /\bgrounded in (scanned )?evidence\b/i, code: 'INTERNAL_MODEL_REGISTER' },
  { re: /\bscanned evidence\b/i, code: 'INTERNAL_SCANNED_EVIDENCE' },
  { re: /\bretained citations\b/i, code: 'INTERNAL_RETAINED_CITATIONS' },
  { re: /\bevidence (pack|chunk)\b/i, code: 'INTERNAL_EVIDENCE_META' },
  { re: /\bstructured claim\b/i, code: 'INTERNAL_STRUCTURED_CLAIM' },
  { re: /\bclaim (schema|kind)\b/i, code: 'INTERNAL_CLAIM_META' },
  { re: /\bdimension id\b/i, code: 'INTERNAL_DIMENSION_ID' },
  { re: /\breason code\b/i, code: 'INTERNAL_REASON_CODE_PHRASE' },
  {
    re: /\b(ai_prompt_quality_failed|ai_prompt_quality_warning|no_relevant_evidence|file_omitted_by_cap|structure[d]?_parse_partial)\b/i,
    code: 'INTERNAL_REASON_CODE',
  },
  { re: /\bdownscoped\b/i, code: 'INTERNAL_DOWNSCOPED_LABEL' },
  { re: /\b(prompt or bundle limits|bundle limits)\b/i, code: 'INTERNAL_BUNDLE_LIMITS' },
])

/** Paths / field classes that warn + fallback instead of hard-fail (plan Q4 hybrid D). */
function fieldSeverity(path) {
  const p = String(path || '')
  if (/\.coverage\.coverageNotes\[/.test(p) || /\.coverageSummary\b/.test(p)) return 'warn'
  return 'error'
}

export function lintHumanReadableText(value, path = '') {
  const text = String(value || '')
  if (!text.trim()) return []
  return INTERNAL_REGISTER_RULES.filter(({ re }) => re.test(text)).map(({ code }) => ({
    code,
    path,
    severity: fieldSeverity(path),
  }))
}

function pushText(issues, value, path) {
  issues.push(...lintHumanReadableText(value, path))
}

/**
 * Lint customer-facing advisory contract fields (plan Q2: include IDE prompts + suggested tests).
 * Does not scan telemetry-only keys (coverage_basis, candidate ids, reasonCode enum fields).
 */
export function lintHumanReadableAdvisory(contract) {
  const issues = []
  const dims = Array.isArray(contract?.dimensions) ? contract.dimensions : []
  for (const [index, dimension] of dims.entries()) {
    const base = `dimensions[${index}]`
    pushText(issues, dimension?.label, `${base}.label`)

    for (const [recIndex, recommendation] of (Array.isArray(dimension?.recommendations)
      ? dimension.recommendations
      : []
    ).entries()) {
      const rp = `${base}.recommendations[${recIndex}]`
      pushText(issues, recommendation?.title, `${rp}.title`)
      pushText(issues, recommendation?.recommendation, `${rp}.recommendation`)
      pushText(issues, recommendation?.text, `${rp}.text`)
      pushText(issues, recommendation?.claim, `${rp}.claim`)
    }

    for (const [noteIndex, note] of (Array.isArray(dimension?.coverage?.coverageNotes)
      ? dimension.coverage.coverageNotes
      : []
    ).entries()) {
      pushText(issues, note, `${base}.coverage.coverageNotes[${noteIndex}]`)
    }
    pushText(issues, dimension?.coverage?.coverageSummary, `${base}.coverage.coverageSummary`)

    const summary = dimension?.summary && typeof dimension.summary === 'object' ? dimension.summary : null
    if (summary) {
      pushText(issues, summary.whatWasReviewed, `${base}.summary.whatWasReviewed`)
      pushText(issues, summary.whatLooksStrong, `${base}.summary.whatLooksStrong`)
      pushText(issues, summary.whatRemainsUnclear, `${base}.summary.whatRemainsUnclear`)
      pushText(issues, summary.whatToCheckNext, `${base}.summary.whatToCheckNext`)
    }

    for (const [findingIndex, finding] of (Array.isArray(dimension?.findings) ? dimension.findings : []).entries()) {
      const fp = `${base}.findings[${findingIndex}]`
      pushText(issues, finding?.title, `${fp}.title`)
      pushText(issues, finding?.claim, `${fp}.claim`)
      pushText(issues, finding?.text, `${fp}.text`)
      pushText(issues, finding?.impact, `${fp}.impact`)
    }

    for (const [obsIndex, observation] of (Array.isArray(dimension?.observations)
      ? dimension.observations
      : []
    ).entries()) {
      const op = `${base}.observations[${obsIndex}]`
      pushText(issues, observation?.title, `${op}.title`)
      pushText(issues, observation?.claim, `${op}.claim`)
      pushText(issues, observation?.text, `${op}.text`)
    }

    for (const [testIndex, test] of (Array.isArray(dimension?.suggestedTests)
      ? dimension.suggestedTests
      : []
    ).entries()) {
      const tp = `${base}.suggestedTests[${testIndex}]`
      pushText(issues, test?.title, `${tp}.title`)
      pushText(issues, test?.testGoal, `${tp}.testGoal`)
      pushText(issues, test?.instructions, `${tp}.instructions`)
    }

    for (const [promptIndex, prompt] of (Array.isArray(dimension?.aiPrompts) ? dimension.aiPrompts : []).entries()) {
      const pp = `${base}.aiPrompts[${promptIndex}]`
      // Structured metadata (dimensionId) is not scanned; displayed prose is.
      pushText(issues, prompt?.title, `${pp}.title`)
      pushText(issues, prompt?.reviewFocus, `${pp}.reviewFocus`)
      pushText(issues, prompt?.controlExpectation, `${pp}.controlExpectation`)
      pushText(issues, prompt?.inspectionInstructions, `${pp}.inspectionInstructions`)
      pushText(issues, prompt?.remediationInstructions, `${pp}.remediationInstructions`)
      pushText(issues, prompt?.testInstructions, `${pp}.testInstructions`)
      pushText(issues, prompt?.expectedOutcome, `${pp}.expectedOutcome`)
      pushText(issues, prompt?.repoContext, `${pp}.repoContext`)
      pushText(issues, prompt?.prompt, `${pp}.prompt`)
    }
  }

  const queue = Array.isArray(contract?.summary?.recommendationQueue)
    ? contract.summary.recommendationQueue
    : Array.isArray(contract?.recommendationQueue)
      ? contract.recommendationQueue
      : []
  for (const [qi, item] of queue.entries()) {
    pushText(issues, item?.text, `recommendationQueue[${qi}].text`)
    pushText(issues, item?.title, `recommendationQueue[${qi}].title`)
  }

  if (typeof contract?.report === 'string') {
    pushText(issues, contract.report, 'report')
  }

  return issues
}

/**
 * Rewrite dirty coverage notes to the approved fallback (plan Q4 — exports stay clean).
 * @returns {{ contract: object, replacements: { path: string, code: string }[] }}
 */
export function applyHumanReadableCoverageFallbacks(contract) {
  const replacements = []
  if (!contract || typeof contract !== 'object') return { contract, replacements }
  const dims = Array.isArray(contract.dimensions) ? contract.dimensions : []
  for (const [index, dimension] of dims.entries()) {
    if (!dimension?.coverage || typeof dimension.coverage !== 'object') continue
    const notes = Array.isArray(dimension.coverage.coverageNotes) ? dimension.coverage.coverageNotes : null
    if (notes) {
      dimension.coverage.coverageNotes = notes.map((note, noteIndex) => {
        const hits = lintHumanReadableText(note, `dimensions[${index}].coverage.coverageNotes[${noteIndex}]`)
        if (hits.length === 0) return note
        for (const hit of hits) replacements.push({ path: hit.path, code: hit.code })
        return HUMAN_COVERAGE_NOTE_FALLBACK
      })
    }
    if (typeof dimension.coverage.coverageSummary === 'string') {
      const path = `dimensions[${index}].coverage.coverageSummary`
      const hits = lintHumanReadableText(dimension.coverage.coverageSummary, path)
      if (hits.length > 0) {
        for (const hit of hits) replacements.push({ path: hit.path, code: hit.code })
        dimension.coverage.coverageSummary = HUMAN_COVERAGE_NOTE_FALLBACK
      }
    }
  }
  return { contract, replacements }
}

/**
 * Split lint issues into hard-fail vs warn (after coverage fallbacks applied).
 */
export function partitionHumanRegisterIssues(issues) {
  const list = Array.isArray(issues) ? issues : []
  return {
    errors: list.filter((i) => i.severity === 'error'),
    warnings: list.filter((i) => i.severity === 'warn'),
  }
}
