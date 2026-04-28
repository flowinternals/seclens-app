/**
 * MVP4 Stage 02 — normalized evidence bundle + coverage summary for prompts/API.
 */

import { splitLines, excerptWithinByteBudget, formatCitationRange } from './lineNumbering.js'
import { STRATEGY_VERSION } from './fileSelection.js'
import { getIngestionCaps } from './ingestionCaps.js'

/**
 * Build evidence entries from fetched UTF-8 content, enforcing per-file and total byte caps.
 *
 * @param {{
 *   owner: string,
 *   name: string,
 *   defaultBranch: string,
 *   scannedRef: string,
 *   scannedSha?: string,
 *   url?: string,
 * }} repository
 * @param {{
 *   totalFilesSeen: number,
 *   filesEligibleByTier: { tier1: number, tier2: number, tier3: number },
 * }} inventory
 * @param {{
 *   selected: Array<{ path: string, tier: string, reason: string }>,
 *   omitted: Array<{ path: string, reason: string }>,
 * }} selection
 * @param {Array<{ path: string, content: string }>} orderedFiles successful fetches in deterministic order
 * @param {{ maxFiles: number, maxBytesPerFile: number, maxTotalBytes: number, maxTreeEntries: number }} caps
 * @param {{
 *   treeTruncated?: boolean,
 *   refResolutionDegraded?: boolean,
 *   tierFileCapReached?: boolean,
 * }} flags
 */
export function buildEvidenceBundle(repository, inventory, selection, orderedFiles, caps, flags = {}) {
  const notes = []
  const coverage = {
    maxFilesCapHit: !!flags.tierFileCapReached,
    maxBytesPerFileCapHit: false,
    maxTotalBytesCapHit: false,
    maxTreeSizeCapHit: !!flags.treeTruncated,
    notes: /** @type {string[]} */ ([]),
  }

  if (flags.refResolutionDegraded) {
    notes.push('Ref resolution degraded: fell back from API default_branch metadata.')
    coverage.notes.push('Ref resolution degraded (fallback branch heuristic).')
  }
  if (flags.treeTruncated) {
    notes.push('GitHub tree response was truncated by GitHub API.')
    coverage.notes.push('Repository tree truncated at GitHub API limit.')
  }

  /** @type {Array<{ path: string, language?: string, snippets: Array<{ startLine: number, endLine: number, text: string }> }>} */
  const evidence = []

  let totalBytes = 0
  /** @type {Array<{ path: string, reason: string }>} */
  const omittedAfterFetch = []

  for (const { path, content } of orderedFiles) {
    const lines = splitLines(typeof content === 'string' ? content : '')
    let remaining = caps.maxTotalBytes - totalBytes
    if (remaining <= 0) {
      omittedAfterFetch.push({ path, reason: 'cap' })
      coverage.maxTotalBytesCapHit = true
      continue
    }

    const perCap = Math.min(caps.maxBytesPerFile, remaining)
    let excerpt = excerptWithinByteBudget(lines, perCap)
    if (excerpt.lineRangeUnavailable) {
      notes.push(`Line range unavailable for ${path}`)
      evidence.push({
        path,
        snippets: [
          {
            startLine: 0,
            endLine: 0,
            text: '',
          },
        ],
      })
      continue
    }

    if (excerpt.truncated) {
      coverage.maxBytesPerFileCapHit = true
    }

    let byteSize = Buffer.byteLength(excerpt.text, 'utf8')
    if (totalBytes + byteSize > caps.maxTotalBytes) {
      const tighter = excerptWithinByteBudget(lines, Math.max(0, caps.maxTotalBytes - totalBytes))
      excerpt = tighter
      byteSize = Buffer.byteLength(excerpt.text, 'utf8')
      coverage.maxTotalBytesCapHit = true
      coverage.maxBytesPerFileCapHit = true
    }

    if (byteSize === 0 && lines.length > 0) {
      omittedAfterFetch.push({ path, reason: 'cap' })
      coverage.maxTotalBytesCapHit = true
      continue
    }

    totalBytes += byteSize

    evidence.push({
      path,
      snippets: [
        {
          startLine: excerpt.startLine,
          endLine: excerpt.endLine,
          text: excerpt.text,
        },
      ],
    })

    if (coverage.maxTotalBytesCapHit && totalBytes >= caps.maxTotalBytes) {
      // remaining files handled below
    }
  }

  const combinedOmitted = [...selection.omitted, ...omittedAfterFetch]

  const omittedCount = combinedOmitted.length

  const capHits = []
  if (coverage.maxFilesCapHit) capHits.push('MAX_FILES_FETCHED')
  if (coverage.maxBytesPerFileCapHit) capHits.push('MAX_BYTES_PER_FILE')
  if (coverage.maxTotalBytesCapHit) capHits.push('MAX_TOTAL_BYTES_TO_MODEL')
  if (coverage.maxTreeSizeCapHit) capHits.push('MAX_REPO_TREE_ENTRIES')

  let coverageSummary = 'Full planned coverage within caps.'
  if (capHits.length > 0) {
    coverageSummary = `Partial coverage: limits reached (${capHits.join(', ')}). Review Confidence & Coverage.`
  }

  coverage.notes.push(...notes)

  const bundle = {
    repository: {
      owner: repository.owner,
      name: repository.name,
      defaultBranch: repository.defaultBranch,
      scannedRef: repository.scannedRef,
      scannedSha: repository.scannedSha,
    },
    inventory: {
      totalFilesSeen: inventory.totalFilesSeen,
      filesEligibleByTier: inventory.filesEligibleByTier,
      filesSelected: selection.selected.length,
      filesOmitted: omittedCount,
    },
    selection: {
      strategyVersion: STRATEGY_VERSION,
      selected: selection.selected,
      omitted: combinedOmitted,
    },
    evidence,
    coverage,
  }

  const citationSample = evidence
    .filter((e) => e.snippets[0]?.startLine > 0)
    .slice(0, 8)
    .map((e) =>
      formatCitationRange(e.path, e.snippets[0].startLine, e.snippets[0].endLine)
    )

  const apiIngestion = {
    strategyVersion: STRATEGY_VERSION,
    selectedFileCount: evidence.length,
    omittedFileCount: omittedCount,
    capHits,
    coverageSummary,
    citationHints: citationSample,
  }

  return { bundle, apiIngestion }
}

/**
 * Canonical citation strings for Stage 02 report alignment (DEFECT-002).
 * @param {object} bundle evidence bundle from buildEvidenceBundle / GitHub path
 */
export function collectCitationManifest(bundle) {
  /** @type {{ cite: string, path: string }[]} */
  const canonical = []
  /** @type {string[]} */
  const unavailablePaths = []

  for (const ev of bundle.evidence || []) {
    const sn = ev.snippets && ev.snippets[0]
    if (!sn) continue
    if (sn.startLine > 0 && sn.endLine >= sn.startLine && String(sn.text || '').length > 0) {
      canonical.push({
        cite: formatCitationRange(ev.path, sn.startLine, sn.endLine),
        path: ev.path,
      })
    } else {
      unavailablePaths.push(ev.path)
    }
  }

  return {
    canonicalCitations: canonical.map((c) => c.cite),
    canonical,
    unavailablePaths,
  }
}

/**
 * Prompt block: enforce consumption of line-addressable evidence (DEFECT-002).
 */
export function renderCitationManifestForPrompt(bundle) {
  const { canonical, unavailablePaths } = collectCitationManifest(bundle)
  const lines = []

  lines.push('## Mandatory line citations (Stage 02)')
  lines.push('')
  if (canonical.length === 0) {
    lines.push(
      'No line-range citations were produced for this run (excerpts missing or unavailable). Use `path:line unknown` or honest scope descriptions — do not invent numeric line numbers.'
    )
    if (unavailablePaths.length > 0) {
      lines.push('')
      lines.push('**Paths with unavailable line ranges:**')
      for (const p of unavailablePaths) {
        lines.push(`- \`${p}\``)
      }
    }
    lines.push('')
    return lines.join('\n')
  }

  lines.push(
    'Copy the following **exact** `path:start-end` strings into **Key Findings** (**Evidence:** and related fields), into **Appendix A – Evidence Index** for the same files, and anywhere else you reference those excerpts. **Do not** write `path:line unknown` for these paths.'
  )
  lines.push('')
  for (const { cite } of canonical) {
    lines.push(`- \`${cite}\``)
  }

  if (unavailablePaths.length > 0) {
    lines.push('')
    lines.push(
      '**Line range unavailable (use `path:line unknown` or describe scope only for these paths):**'
    )
    for (const p of unavailablePaths) {
      lines.push(`- \`${p}\``)
    }
  }

  lines.push('')
  lines.push(
    `**Consistency:** Appendix A rows for files above must use the same backtick citations as finding-level **Evidence:** (no Appendix showing \`path:1-50\` while the finding says \`path:line unknown\`).`
  )

  return lines.join('\n')
}

/** Representative paths from evidence for non-finding section basis (DEFECT-002). */
export function renderScannedPathsHint(bundle) {
  const paths = [...new Set((bundle.evidence || []).map((e) => e.path).filter(Boolean))]
  if (paths.length === 0) return ''

  const lines = []
  lines.push('## Scanned paths hint (for non-finding sections)')
  lines.push('')
  lines.push(
    'When stating controls are absent or not evidenced, reference concrete paths from this scan where relevant (examples below — not exhaustive):'
  )
  lines.push('')
  const max = 48
  for (const p of paths.slice(0, max)) {
    lines.push(`- \`${p}\``)
  }
  if (paths.length > max) {
    lines.push(`- _(and ${paths.length - max} more paths in the evidence index above)_`)
  }
  lines.push('')
  return lines.join('\n')
}

export function renderEvidenceForPrompt(bundle) {
  const lines = []
  lines.push('## Evidence index (line-addressable excerpts)')
  lines.push(
    `- Default branch: ${bundle.repository.defaultBranch}; scanned ref: ${bundle.repository.scannedRef}` +
      (bundle.repository.scannedSha ? ` @ ${bundle.repository.scannedSha.slice(0, 7)}` : '')
  )
  lines.push(
    `- Strategy: ${bundle.selection.strategyVersion}; files in evidence: ${bundle.inventory.filesSelected}; omitted (tracked): ${bundle.inventory.filesOmitted}`
  )
  lines.push(`- Coverage: ${bundle.coverage.notes.filter(Boolean).join(' | ') || 'within limits'}`)

  for (const ev of bundle.evidence) {
    const sn = ev.snippets[0]
    if (!sn || sn.startLine <= 0) {
      lines.push(`\n### ${ev.path}\n(line range unavailable for excerpt)\n`)
      continue
    }
    const cite = formatCitationRange(ev.path, sn.startLine, sn.endLine)
    lines.push(`\n### ${cite}\n\`\`\`\n${sn.text}\n\`\`\`\n`)
  }

  return lines.join('\n')
}

/**
 * Builds the same normalized bundle shape from legacy `{ files: { path, content }[] }` repo data (tests/fixtures).
 * @param {{ owner?: string, repo?: string, name?: string, url?: string, files?: Array<{ path: string, content: string }> }} repoData
 * @param {{ maxFiles: number, maxBytesPerFile: number, maxTotalBytes: number, maxTreeEntries: number }} [caps]
 */
export function stubEvidenceBundleFromLegacyRepoData(repoData, caps = getIngestionCaps()) {
  const orderedFiles = (repoData.files || []).map((f) => ({
    path: f.path,
    content: typeof f.content === 'string' ? f.content : String(f.content ?? ''),
  }))
  const owner = repoData.owner || 'unknown'
  const name = repoData.repo || repoData.name || 'repository'
  const selection = {
    selected: orderedFiles.map((f) => ({
      path: f.path,
      tier: 'tier3',
      reason: 'legacy_fixture',
    })),
    omitted: [],
  }
  const inventory = {
    totalFilesSeen: orderedFiles.length,
    filesEligibleByTier: {
      tier1: 0,
      tier2: 0,
      tier3: orderedFiles.length,
    },
  }

  const { bundle } = buildEvidenceBundle(
    {
      owner,
      name,
      defaultBranch: 'fixture',
      scannedRef: 'fixture',
      scannedSha: undefined,
      url: repoData.url,
    },
    inventory,
    selection,
    orderedFiles,
    caps,
    { tierFileCapReached: false }
  )

  return bundle
}
