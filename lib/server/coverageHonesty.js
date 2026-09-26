/**
 * CR-012 / DEFECT-COVERAGE-001 — coverage honesty, residual policy, hone-in denylist, quotas.
 */

export const PARTIAL_REASON_CODES = Object.freeze({
  STRUCTURED_PARSE_PARTIAL: 'STRUCTURED_PARSE_PARTIAL',
  PROMPT_BUDGET_TRIM: 'PROMPT_BUDGET_TRIM',
  FILE_OMITTED_BY_CAP: 'FILE_OMITTED_BY_CAP',
  NO_PASS_EVIDENCE: 'NO_PASS_EVIDENCE',
  OMITTED_BY_DIMENSION_QUOTA: 'OMITTED_BY_DIMENSION_QUOTA',
  UNMAPPED_SUPPORTING_CONTEXT: 'UNMAPPED_SUPPORTING_CONTEXT',
  SELECTED_SURFACE_UNMATCHED: 'SELECTED_SURFACE_UNMATCHED',
})

export const RESIDUAL_PASS_FAMILY = 'supporting_context_residual'

export const HOTSPOT_SCOPED_CLAIM =
  'Hotspot-scoped security review of selected security surfaces. This is not a full-repository vulnerability attestation.'

/**
 * Presentational / low-value trees — denylisted unless a direct security signal restores them (Q7).
 * @param {string} path
 */
export function isPresentationalDenylistPath(path) {
  const p = String(path || '')
    .replace(/\\/g, '/')
    .toLowerCase()
  if (!p) return false
  if (/(^|\/)(tokens|design-tokens|theme-tokens)\//.test(p)) return true
  if (/\.(stories|story)\.(tsx?|jsx?|mdx)$/.test(p)) return true
  if (/(^|\/)(__snapshots__|storybook)\//.test(p)) return true
  if (/\.(css|scss|sass|less|styl)$/.test(p) && !/(security|csp|headers)/.test(p)) return true
  if (/\.(svg|png|jpe?g|gif|webp|ico|woff2?|ttf|eot)$/.test(p)) return true
  if (/(^|\/)(generated|__generated__|dist|build|coverage)\//.test(p)) return true
  if (/^docs\//.test(p) && /\.(md|mdx)$/.test(p)) return true
  if (/^readme\.md$/i.test(p)) return true
  return false
}

/**
 * Path has a direct security signal that can restore a denylisted file (Q7).
 * @param {string} path
 */
export function hasDirectSecurityRestoreSignal(path) {
  const p = String(path || '')
    .replace(/\\/g, '/')
    .toLowerCase()
  return (
    /auth|session|permission|role|middleware|guard|authorize|rbac|invite|claim|csrf|xss|idor|ratelimit|rate[-_]?limit|throttle|secret|firestore\.rules|storage\.rules|prisma|webhook/.test(
      p
    ) && !/(^|\/)(tokens|design-tokens)\//.test(p)
  )
}

/**
 * @param {string} path
 * @returns {boolean} true when path should be excluded from security-surface inclusion
 */
export function shouldDenylistFromSecuritySurface(path) {
  return isPresentationalDenylistPath(path) && !hasDirectSecurityRestoreSignal(path)
}

/**
 * Primary partial reason with Q1 precedence: parse → prompt trim → cap → no evidence → unmatched surface.
 * @param {{
 *   parseError?: boolean,
 *   promptTrimmedCount?: number,
 *   maxFilesCapHit?: boolean,
 *   maxBytesPerFileCapHit?: boolean,
 *   maxTotalBytesCapHit?: boolean,
 *   maxTreeSizeCapHit?: boolean,
 *   reviewedFileCount?: number,
 *   unmatchedSurfacedCount?: number,
 *   omittedByQuotaCount?: number,
 * }} signals
 */
export function resolvePrimaryPartialReason(signals = {}) {
  if (signals.parseError) return PARTIAL_REASON_CODES.STRUCTURED_PARSE_PARTIAL
  if (Number(signals.promptTrimmedCount || 0) > 0) return PARTIAL_REASON_CODES.PROMPT_BUDGET_TRIM
  if (
    signals.maxFilesCapHit ||
    signals.maxBytesPerFileCapHit ||
    signals.maxTotalBytesCapHit ||
    signals.maxTreeSizeCapHit
  ) {
    return PARTIAL_REASON_CODES.FILE_OMITTED_BY_CAP
  }
  if (Number(signals.omittedByQuotaCount || 0) > 0) {
    return PARTIAL_REASON_CODES.OMITTED_BY_DIMENSION_QUOTA
  }
  if (Number(signals.reviewedFileCount || 0) <= 0) return PARTIAL_REASON_CODES.NO_PASS_EVIDENCE
  if (Number(signals.unmatchedSurfacedCount || 0) > 0) {
    return PARTIAL_REASON_CODES.SELECTED_SURFACE_UNMATCHED
  }
  return null
}

/**
 * @param {object} [bundleCoverage]
 * @param {object} [ingestion]
 * @param {{ promptTrimmedCount?: number }} [passSignals]
 */
export function buildPassScopedCoverage(bundleCoverage = {}, ingestion = null, passSignals = {}) {
  const capHits = Array.isArray(ingestion?.capHits) ? ingestion.capHits : []
  const fromBundle = bundleCoverage && typeof bundleCoverage === 'object' ? bundleCoverage : {}
  const maxFilesCapHit = Boolean(fromBundle.maxFilesCapHit) || capHits.includes('MAX_FILES_FETCHED')
  const maxBytesPerFileCapHit =
    Boolean(fromBundle.maxBytesPerFileCapHit) || capHits.includes('MAX_BYTES_PER_FILE')
  const maxTotalBytesCapHit =
    Boolean(fromBundle.maxTotalBytesCapHit) || capHits.includes('MAX_TOTAL_BYTES_TO_MODEL')
  const maxTreeSizeCapHit =
    Boolean(fromBundle.maxTreeSizeCapHit) || capHits.includes('MAX_REPO_TREE_ENTRIES')
  const notes = []
  if (maxFilesCapHit) notes.push('MAX_FILES_FETCHED')
  if (maxBytesPerFileCapHit) notes.push('MAX_BYTES_PER_FILE')
  if (maxTotalBytesCapHit) notes.push('MAX_TOTAL_BYTES_TO_MODEL')
  if (maxTreeSizeCapHit) notes.push('MAX_REPO_TREE_ENTRIES')
  if (Number(passSignals.promptTrimmedCount || 0) > 0) notes.push('PROMPT_BUDGET_TRIM')
  return {
    maxFilesCapHit,
    maxBytesPerFileCapHit,
    maxTotalBytesCapHit,
    maxTreeSizeCapHit,
    notes,
  }
}

/**
 * Deterministic per-dimension path/byte ceilings (Q8).
 * @param {{ globalMaxFiles: number, globalMaxTotalBytes: number, applicableDimensionCount: number }} args
 */
export function computeDimensionQuotas({
  globalMaxFiles,
  globalMaxTotalBytes,
  applicableDimensionCount,
}) {
  const dims = Math.max(1, Number(applicableDimensionCount) || 1)
  const gFiles = Math.max(1, Number(globalMaxFiles) || 48)
  const gBytes = Math.max(256 * 1024, Number(globalMaxTotalBytes) || 2 * 1024 * 1024)
  const pathCeiling = Math.min(48, Math.max(4, Math.ceil(gFiles / dims) * 2))
  const byteCeiling = Math.min(2 * 1024 * 1024, Math.max(256 * 1024, Math.ceil(gBytes / dims) * 2))
  return {
    minPaths: 4,
    maxPaths: pathCeiling,
    maxBytes: byteCeiling,
  }
}

/**
 * Rank evidence for quota keep (Q9): protected anchors → security signals → tier → path.
 * @param {{ path: string, bytes?: number, tier?: number, protected?: boolean, securitySignal?: boolean }} a
 * @param {{ path: string, bytes?: number, tier?: number, protected?: boolean, securitySignal?: boolean }} b
 */
export function compareEvidenceRank(a, b) {
  const pa = a.protected ? 0 : 1
  const pb = b.protected ? 0 : 1
  if (pa !== pb) return pa - pb
  const sa = a.securitySignal ? 0 : 1
  const sb = b.securitySignal ? 0 : 1
  if (sa !== sb) return sa - sb
  const ta = Number.isFinite(a.tier) ? a.tier : 99
  const tb = Number.isFinite(b.tier) ? b.tier : 99
  if (ta !== tb) return ta - tb
  return String(a.path || '')
    .replace(/\\/g, '/')
    .toLowerCase()
    .localeCompare(
      String(b.path || '')
        .replace(/\\/g, '/')
        .toLowerCase()
    )
}

/**
 * Apply path/byte quotas; returns kept evidence + omitted paths with reason.
 * @param {Array<{ path: string, text?: string, content?: string, snippets?: unknown[] }>} evidence
 * @param {{ maxPaths: number, maxBytes: number, minPaths?: number }} quota
 * @param {(path: string) => { protected?: boolean, securitySignal?: boolean, tier?: number }} rankMetaForPath
 */
export function applyDimensionQuota(evidence, quota, rankMetaForPath = () => ({})) {
  const items = Array.isArray(evidence) ? [...evidence] : []
  const ranked = items
    .map((ev) => {
      const meta = rankMetaForPath(ev.path) || {}
      const bytes =
        Number(ev.byteLength) ||
        String(ev.text || ev.content || '').length ||
        (Array.isArray(ev.snippets)
          ? ev.snippets.reduce((n, s) => n + String(s?.text || '').length, 0)
          : 0)
      return { ev, bytes, ...meta, path: ev.path }
    })
    .sort(compareEvidenceRank)

  const kept = []
  const omitted = []
  let usedBytes = 0
  const maxPaths = Math.max(Number(quota?.maxPaths) || 4, Number(quota?.minPaths) || 4)
  const maxBytes = Number(quota?.maxBytes) || 2 * 1024 * 1024

  for (const row of ranked) {
    const wouldExceedPaths = kept.length >= maxPaths
    const wouldExceedBytes = kept.length > 0 && usedBytes + row.bytes > maxBytes
    if (wouldExceedPaths || wouldExceedBytes) {
      omitted.push({
        path: row.path,
        reasonCode: PARTIAL_REASON_CODES.OMITTED_BY_DIMENSION_QUOTA,
      })
      continue
    }
    kept.push(row.ev)
    usedBytes += row.bytes
  }

  return { kept, omitted, usedBytes }
}

/** AQ6 — residual is model-skipped; never say "reviewed". */
export const RESIDUAL_ROUTING_NOTE =
  'routed as supporting context; not model-examined and not counted as dimension coverage'

/**
 * Bounded user-facing coverage note for unmatched / residual paths (Q2 / AQ6).
 * Only emit when backed by concrete counts (AQ12).
 */
export function buildCoverageHonestyCallout({
  unmatchedSurfacedPaths = [],
  residualPaths = [],
  omittedByQuotaCount = 0,
  omittedByQuotaPaths = [],
} = {}) {
  const unmatched = unmatchedSurfacedPaths.length
  const residual = residualPaths.length
  if (unmatched === 0 && residual === 0 && omittedByQuotaCount <= 0) return null
  const parts = []
  if (unmatched > 0) {
    const sample = unmatchedSurfacedPaths.slice(0, 3).join(', ')
    parts.push(
      `${unmatched} selected security-surface path${unmatched === 1 ? '' : 's'} were not present in analysis evidence` +
        (sample ? ` (e.g. ${sample})` : '')
    )
  }
  if (residual > 0) {
    parts.push(
      `${residual} selected path${residual === 1 ? '' : 's'} ${RESIDUAL_ROUTING_NOTE}`
    )
  }
  if (omittedByQuotaCount > 0) {
    const sample = (omittedByQuotaPaths.length ? omittedByQuotaPaths : []).slice(0, 3).join(', ')
    parts.push(
      `${omittedByQuotaCount} path${omittedByQuotaCount === 1 ? '' : 's'} omitted by per-dimension quota` +
        (sample ? ` (e.g. ${sample})` : '')
    )
  }
  return `${HOTSPOT_SCOPED_CLAIM} ${parts.join('; ')}.`
}

const CAP_CODE_TO_FIELD = Object.freeze({
  MAX_FILES_FETCHED: 'maxFiles',
  MAX_BYTES_PER_FILE: 'maxBytesPerFile',
  MAX_TOTAL_BYTES_TO_MODEL: 'maxTotalBytes',
  MAX_REPO_TREE_ENTRIES: 'maxTreeEntries',
})

/**
 * Resolve cap source label (AQ8).
 * @param {string} code
 * @param {object} caps
 * @param {{ envBound?: boolean, planBound?: boolean }} [hints]
 */
export function resolveCapSource(code, caps = {}, hints = {}) {
  if (hints.planBound) return 'plan'
  if (hints.envBound) return 'environment'
  const field = CAP_CODE_TO_FIELD[code]
  if (!field) return 'global'
  const envKey = {
    maxFiles: 'SECLENS_MAX_FILES_FETCHED',
    maxBytesPerFile: 'SECLENS_MAX_BYTES_PER_FILE',
    maxTotalBytes: 'SECLENS_MAX_TOTAL_BYTES_TO_MODEL',
    maxTreeEntries: 'SECLENS_MAX_REPO_TREE_ENTRIES',
  }[field]
  if (envKey && process.env[envKey]) return 'environment'
  return 'global'
}

/**
 * Build AQ8 cap provenance records.
 * @param {{
 *   caps?: { maxFiles?: number, maxBytesPerFile?: number, maxTotalBytes?: number, maxTreeEntries?: number },
 *   coverage?: object,
 *   capHits?: string[],
 *   affectedPathsByCode?: Record<string, string[]>,
 *   affectedDimensionIdsByCode?: Record<string, string[]>,
 *   impactByCode?: Record<string, string>,
 *   sourceHintsByCode?: Record<string, { envBound?: boolean, planBound?: boolean }>,
 *   observedAtIso?: string,
 * }} args
 */
export function buildCapProvenanceRecords({
  caps = {},
  coverage = {},
  capHits = [],
  affectedPathsByCode = {},
  affectedDimensionIdsByCode = {},
  impactByCode = {},
  sourceHintsByCode = {},
  observedAtIso = null,
} = {}) {
  const hitSet = new Set(
    [
      ...(Array.isArray(capHits) ? capHits : []),
      coverage?.maxFilesCapHit ? 'MAX_FILES_FETCHED' : null,
      coverage?.maxBytesPerFileCapHit ? 'MAX_BYTES_PER_FILE' : null,
      coverage?.maxTotalBytesCapHit ? 'MAX_TOTAL_BYTES_TO_MODEL' : null,
      coverage?.maxTreeSizeCapHit ? 'MAX_REPO_TREE_ENTRIES' : null,
    ].filter(Boolean)
  )
  const observed = observedAtIso || new Date().toISOString()
  const records = []
  for (const code of hitSet) {
    const field = CAP_CODE_TO_FIELD[code]
    const resolvedLimitBytes =
      field === 'maxBytesPerFile' || field === 'maxTotalBytes'
        ? Number(caps[field]) || null
        : field === 'maxFiles' || field === 'maxTreeEntries'
          ? Number(caps[field]) || null
          : null
    records.push({
      code,
      resolvedLimitBytes,
      source: resolveCapSource(code, caps, sourceHintsByCode[code] || {}),
      affectedPaths: [...new Set(affectedPathsByCode[code] || [])].sort((a, b) => a.localeCompare(b)),
      affectedDimensionIds: [...new Set(affectedDimensionIdsByCode[code] || [])].sort((a, b) =>
        a.localeCompare(b)
      ),
      impact: impactByCode[code] || (code === 'MAX_BYTES_PER_FILE' ? 'excerpt_truncated' : 'path_omitted'),
      observedAtIso: observed,
    })
  }
  records.sort((a, b) => String(a.code).localeCompare(String(b.code)))
  return records
}

/**
 * Bounded customer note from cap records (AQ8 / AQ12).
 */
export function buildCapProvenanceCustomerNote(capRecords = []) {
  const list = Array.isArray(capRecords) ? capRecords : []
  if (list.length === 0) return null
  const parts = list.map((rec) => {
    const limit =
      rec.resolvedLimitBytes != null
        ? rec.code.includes('BYTES')
          ? `${rec.resolvedLimitBytes} bytes`
          : String(rec.resolvedLimitBytes)
        : 'unresolved'
    const paths = (rec.affectedPaths || []).slice(0, 3)
    const pathBit = paths.length ? `; affected e.g. ${paths.join(', ')}` : ''
    return `${rec.code}=${limit} (source=${rec.source}, impact=${rec.impact}${pathBit})`
  })
  return `Effective coverage caps applied: ${parts.join('; ')}.`
}

/**
 * Empty AQ9 allocation ledger row.
 */
export function createAllocationLedgerEntry(dimensionId, overrides = {}) {
  return {
    dimensionId,
    surfacedPaths: [],
    assignedPaths: [],
    modelExaminedPaths: [],
    omittedByQuota: [],
    unmatchedSurfaced: [],
    zeroReviewReasonCode: null,
    quota: { minPaths: 0, maxPaths: 0, maxBytes: 0 },
    allocationSource: 'surface_plan',
    multiAssignedPathCount: 0,
    ...overrides,
  }
}

/**
 * Bounded customer export section from allocation ledger (AQ9 / AQ12).
 */
export function buildAllocationLedgerExportSection(allocationLedger = []) {
  const rows = Array.isArray(allocationLedger) ? allocationLedger : []
  if (rows.length === 0) return null
  const lines = ['## Coverage allocation (hotspot-scoped)', '']
  for (const row of rows) {
    const examined = (row.modelExaminedPaths || []).length
    const omitted = (row.omittedByQuota || []).length
    const unmatched = (row.unmatchedSurfaced || []).length
    if (examined === 0 && omitted === 0 && unmatched === 0 && !row.zeroReviewReasonCode) continue
    const bits = [`model-examined=${examined}`]
    if (row.zeroReviewReasonCode) bits.push(`zero-review=${row.zeroReviewReasonCode}`)
    if (omitted > 0) {
      const sample = row.omittedByQuota.slice(0, 3).map((o) => (typeof o === 'string' ? o : o.path)).filter(Boolean)
      bits.push(`omitted-by-quota=${omitted}${sample.length ? ` (${sample.join(', ')})` : ''}`)
    }
    if (unmatched > 0) {
      const sample = row.unmatchedSurfaced.slice(0, 3)
      bits.push(`unmatched-surfaced=${unmatched}${sample.length ? ` (${sample.join(', ')})` : ''}`)
    }
    lines.push(`- **${row.dimensionId}:** ${bits.join('; ')}`)
  }
  if (lines.length <= 2) return null
  lines.push('')
  return lines.join('\n')
}
