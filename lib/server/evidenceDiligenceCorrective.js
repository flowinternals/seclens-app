import { getDimensionDefinitionByPassFamily } from '../shared/dimensions.js'

/** Paths that commonly carry oracle-style issues when present in-cluster but silent in outputs (DEFECT-004). */
const HIGH_SIGNAL_PATH_RE =
  /(localstorage|sessionstorage|inputpanel|ratelimit|rate[-_]?limit|scan[-_]?jobs|scanjobs|jobid|job[-_]?store|api[/\\](scan|analyze)|\/api\/(scan|analyze)\b|forwarded[-_]for|\bx-?forwarded-?for\b|xff|bearer|readme\.md|user-guide|seclens-user|invite|claims)/i

/**
 * @param {string[]} paths
 * @returns {string[]}
 */
export function highSignalEvidencePaths(paths) {
  const out = []
  for (const raw of paths || []) {
    const n = String(raw || '').replace(/\\/g, '/')
    if (HIGH_SIGNAL_PATH_RE.test(n)) out.push(raw)
  }
  return out
}

/** @param {object|null|undefined} dim */
export function dimensionHasNoClaimsForDiligence(dim) {
  if (!dim) return true
  const f = dim.findings?.length ?? 0
  const uv = dim.unverifiedControls?.length ?? 0
  const r = dim.recommendations?.length ?? 0
  const qw = dim.quickWins?.length ?? 0
  return f === 0 && uv === 0 && r === 0 && qw === 0
}

/**
 * @param {{ passes?: { id: string, family: string, evidencePaths: string[] }[] }} plan
 * @param {object[]} passRuns
 * @param {Map<string, object>} dimensionResults
 */
export function planDiligenceCorrectivePasses(plan, passRuns, dimensionResults) {
  const targets = []
  for (const pr of passRuns || []) {
    if (!pr.ok || !pr.passId) continue
    const pass = (plan?.passes || []).find((p) => p.id === pr.passId)
    if (!pass?.evidencePaths?.length) continue
    const high = highSignalEvidencePaths(pass.evidencePaths)
    if (!high.length) continue
    const dimId = getDimensionDefinitionByPassFamily(pass.family)?.id
    if (!dimId) continue
    const dim = dimensionResults.get(dimId)
    if (!dimensionHasNoClaimsForDiligence(dim)) continue
    targets.push({ passId: pass.id, family: pass.family, highSignalPaths: high })
  }
  return targets
}

/**
 * @param {string[]} highSignalPaths
 * @param {string} passFamily
 */
export function buildDiligenceCorrectiveSupplement(highSignalPaths, passFamily) {
  const list = highSignalPaths.map((p) => `\`${String(p).replace(/`/g, '')}\``).join(', ')
  return `\n\n—— Diligence corrective pass (DEFECT-004) — same cluster as above ——
These in-scope paths are high-signal for common launch-risk checks and produced no finding, unverified control, or recommendation in the prior pass: ${list}.
Re-read ONLY the supplied excerpts. If excerpts show any plausible weak pattern for this cluster (${passFamily}) — including: secret or token persistence in browser storage, rate controls that trust spoofable forwarded headers or are keyed only on IP, job or scan results retrievable with a bearer identifier only and no requester binding, or unbounded public analysis entrypoints — emit either:
- a **finding** only when the cited lines make the weakness explicit, with severity justified by evidence, OR
- at least one **unverified_control** naming the control that could not be proven, citing these paths, OR
- a **coverage_note** stating explicitly which security-relevant material was visible but inconclusive.
Do not invent behavior not visible in the excerpts. Prefer **unverified_control** over returning an empty claim list.\n`
}

/**
 * @param {object[]} claims
 */
export function dedupeClaimsByCandidateId(claims) {
  const map = new Map()
  for (const c of claims || []) {
    const id = c?.candidate_id
    if (!id) continue
    map.set(String(id), c)
  }
  return [...map.values()]
}
