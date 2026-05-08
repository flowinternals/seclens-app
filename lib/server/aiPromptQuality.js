/**
 * Addendum Change 005 - AI IDE prompt shape and quality gate (repo-specific, dimension-specific prompts).
 */

import { DIMENSION_IDS } from '../shared/dimensions.js'

function isNonEmptyString(value, min = 12) {
  return typeof value === 'string' && value.trim().length >= min
}

function safeArray(value) {
  return Array.isArray(value) ? value : []
}

/** Paths should look like repository-relative paths, not bare words. */
export function looksLikeRepoPath(p) {
  const s = String(p || '').trim()
  if (s.length < 2) return false
  if (s.includes('/') || s.startsWith('.') || /^[a-zA-Z]:\\/.test(s)) return true
  return /\.[a-zA-Z0-9]{1,8}$/.test(s)
}

function buildRepoContext(repoProfile) {
  const profiles = safeArray(repoProfile?.profiles)
    .map((p) => String(p || '').trim())
    .filter(Boolean)
  const stack = safeArray(repoProfile?.technologyStack)
    .map((p) => String(p || '').trim())
    .filter(Boolean)
  const arch = safeArray(repoProfile?.architectureSignals)
    .map((p) => String(p || '').trim())
    .filter(Boolean)
  const primary = String(repoProfile?.primaryProfile || '').trim()
  const parts = [
    primary ? `Primary profile: ${primary}` : null,
    profiles.length ? `Profiles: ${profiles.join(', ')}` : null,
    stack.length ? `Stack signals: ${stack.join(', ')}` : null,
    arch.length ? `Architecture: ${arch.join(', ')}` : null,
  ].filter(Boolean)
  return parts.join('. ') || 'Repository stack and layout detected from selected evidence paths.'
}

/**
 * Build one IDE prompt object matching addendum required JSON shape.
 */
export function buildAiIdePromptFromRecommendation({
  recommendation,
  dimensionId,
  dimensionLabel,
  reviewedPaths,
  repoProfile,
}) {
  const text = String(recommendation?.text || recommendation?.claim || '').trim()
  const title = String(recommendation?.title || 'Review security posture').trim()
  const evidenceTarget = String(recommendation?.evidenceTarget || '').trim()
  const primaryPath = evidenceTarget ? evidenceTarget.split(':')[0].trim() : ''
  const paths = safeArray(reviewedPaths)
    .map((p) => String(p || '').trim())
    .filter(Boolean)
  const targetFiles = []
  if (primaryPath && looksLikeRepoPath(primaryPath)) targetFiles.push(primaryPath)
  for (const p of paths) {
    if (targetFiles.length >= 8) break
    if (!targetFiles.includes(p) && looksLikeRepoPath(p)) targetFiles.push(p)
  }
  if (!targetFiles.length) return null

  const repoContext = buildRepoContext(repoProfile)
  const reviewFocus =
    text.length >= 24
      ? text.slice(0, 600)
      : `${dimensionLabel}: validate trust boundaries and authorization for changes touching ${targetFiles
          .slice(0, 3)
          .join(', ')}.`

  const controlExpectation = text.length >= 20
    ? `Expected secure behaviour: controls align with the recommendation ("${title}") before mutating state or crossing trust boundaries.`
    : `Expected secure behaviour: identity-bound authorization and safe defaults for routes touching ${targetFiles[0]}.`

  const inspectionInstructions = [
    `Trace request entry -> auth/session resolution -> authorization -> persistence for paths: ${targetFiles.slice(0, 4).join(', ')}.`,
    `Confirm no client-supplied identifiers can bypass ownership or role checks.`,
    `Verify failure modes deny by default (no silent bypass).`,
  ].join(' ')

  const remediationInstructions =
    'Do not assume a vulnerability exists. If controls are missing, unclear, or bypassable, propose the smallest safe change consistent with existing helpers and patterns in these files.'

  const testInstructions =
    'Add or extend automated tests that prove authorized vs unauthorized behaviour: positive path, negative/bypass path, and one edge case tied to the cited routes or helpers.'

  const expectedOutcome =
    'Return inspected files, whether remediation is required, minimal patch sketch, and concrete tests that would detect regression.'

  const promptBody = [
    `Task:`,
    `Perform a targeted security review for dimension "${dimensionId}" (${dimensionLabel}).`,
    ``,
    `Target files:`,
    ...targetFiles.map((f) => `- ${f}`),
    ``,
    `Repository context:`,
    repoContext,
    ``,
    `Review focus:`,
    reviewFocus,
    ``,
    `Inspect:`,
    inspectionInstructions,
    ``,
    `Secure behaviour expected:`,
    controlExpectation,
    ``,
    `Remediation guidance:`,
    remediationInstructions,
    ``,
    `Testing guidance:`,
    testInstructions,
    ``,
    `Expected output:`,
    expectedOutcome,
  ].join('\n')

  return {
    title,
    dimensionId,
    targetFiles,
    repoContext,
    reviewFocus,
    controlExpectation,
    inspectionInstructions,
    remediationInstructions,
    testInstructions,
    expectedOutcome,
    prompt: promptBody,
  }
}

/** Substrings matching "invalid prompt" examples from addendum (case-insensitive scan on prompt body). */
const INVALID_PROMPT_FRAGMENTS = [
  'review the reviewed files and follow the recommendation',
  'check these files for vulnerabilities and fix anything you find',
  'improve the security of the authentication logic',
  'review this code for best practices',
  'make sure validation is good',
  'look for security issues in the selected files',
  'review this risk pattern and propose fixes if present',
  'add tests for this area',
]

function bodyFailsGenericHeuristic(promptBody) {
  const lower = String(promptBody || '').toLowerCase()
  const stripped = lower.replace(/\s+/g, ' ').trim()
  if (stripped.length < 220) return true
  const taskIdx = stripped.indexOf('task:')
  const targetIdx = stripped.indexOf('target files')
  const inspectIdx = stripped.indexOf('inspect:')
  if (taskIdx === -1 || targetIdx === -1 || inspectIdx === -1) return true
  if (!/[./\\]/.test(stripped)) return true
  for (const frag of INVALID_PROMPT_FRAGMENTS) {
    if (stripped.includes(frag)) return true
  }
  return false
}

export function validateAiIdePrompt(prompt, dimensionId) {
  const issues = []
  if (!prompt || typeof prompt !== 'object') {
    return { ok: false, issues: ['prompt object missing'] }
  }
  if (!isNonEmptyString(prompt.title, 4)) issues.push('title')
  if (String(prompt.dimensionId || '') !== String(dimensionId || '')) issues.push('dimensionId')
  if (!DIMENSION_IDS.has(String(prompt.dimensionId || ''))) issues.push('dimensionId_unknown')

  const files = safeArray(prompt.targetFiles).map((p) => String(p || '').trim()).filter(Boolean)
  if (!files.length) issues.push('targetFiles_empty')
  else {
    const bad = files.some((p) => !looksLikeRepoPath(p))
    if (bad) issues.push('targetFiles_not_paths')
  }

  if (!isNonEmptyString(prompt.repoContext, 20)) issues.push('repoContext')
  if (!isNonEmptyString(prompt.reviewFocus, 20)) issues.push('reviewFocus')

  const rf = String(prompt.reviewFocus || '').toLowerCase()
  if (/^\s*security review\s*$/i.test(rf) || /generic security review/i.test(rf)) issues.push('reviewFocus_generic')

  if (!isNonEmptyString(prompt.controlExpectation, 24)) issues.push('controlExpectation')
  if (!isNonEmptyString(prompt.inspectionInstructions, 40)) issues.push('inspectionInstructions')
  if (!isNonEmptyString(prompt.remediationInstructions, 24)) issues.push('remediationInstructions')
  if (!isNonEmptyString(prompt.testInstructions, 24)) issues.push('testInstructions')
  if (!isNonEmptyString(prompt.expectedOutcome, 24)) issues.push('expectedOutcome')
  if (!isNonEmptyString(prompt.prompt, 200)) issues.push('prompt_body_short')

  const pb = String(prompt.prompt || '')
  if (bodyFailsGenericHeuristic(pb)) issues.push('prompt_body_generic_or_template')

  const combined = `${pb} ${prompt.inspectionInstructions || ''}`.toLowerCase()
  if (!combined.includes(String(dimensionId || '').toLowerCase())) issues.push('prompt_missing_dimension')

  return { ok: issues.length === 0, issues }
}

/**
 * @param {object[]} builtPrompts - outputs from buildAiIdePromptFromRecommendation
 * @returns {{ promptsForUser: object[], allInvalid: boolean, hasInvalid: boolean, validCount: number, invalidCount: number }}
 */
export function splitPromptsByValidity(builtPrompts, dimensionId) {
  const promptsForUser = []
  let invalidCount = 0
  for (const p of builtPrompts) {
    const v = validateAiIdePrompt(p, dimensionId)
    if (v.ok) promptsForUser.push(p)
    else invalidCount += 1
  }
  const validCount = promptsForUser.length
  const total = builtPrompts.length
  return {
    promptsForUser,
    allInvalid: total > 0 && validCount === 0,
    hasInvalid: invalidCount > 0,
    validCount,
    invalidCount,
    total,
  }
}
