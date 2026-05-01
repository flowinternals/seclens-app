/**
 * GitHub API client — MVP4 Stage 02 metadata, tree, deterministic selection, evidence bundle.
 */

import { sanitizeGitHubUrl, isValidGitHubUrl } from './sanitize.js'
import { getIngestionCaps, allowPartialCriticalShortlistCoverage } from './ingestionCaps.js'
import {
  classifyRepoPath,
  selectPathsByTiers,
  selectionMetaRowIsExpansionAnchor,
  sortPathsDeterministic,
} from './fileSelection.js'
import { countEligibleByTier, normalizeRepoPath } from './repoInventory.js'
import { buildEvidenceBundle } from './evidenceBundle.js'
import { resolveScanRef } from './githubRefResolution.js'
import { inferRepoProfileFromPaths } from '../shared/repoProfile.js'
import { decodeRepositoryArtifact } from './artifactText.js'
import {
  buildSecuritySurfacePlan,
  enrichSecuritySurfacePlanWithImportGraph,
  enrichSecuritySurfacePlanWithKeywordSignalsFromTexts,
  evaluateDimensionCoreEvidence,
  pickBoundedKeywordScanCandidates,
} from './securitySurfaceTargets.js'

function stripJsonComments(text) {
  return String(text || '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

function detectAliasRootsFromConfigTexts(configTexts) {
  const roots = new Set()
  for (const raw of configTexts) {
    if (!raw || !raw.trim()) continue
    let parsed
    try {
      parsed = JSON.parse(stripJsonComments(raw))
    } catch {
      continue
    }
    const compilerOptions = parsed?.compilerOptions || {}
    const paths = compilerOptions?.paths || {}
    const candidates = paths['@/*']
    if (!Array.isArray(candidates)) continue
    for (const c of candidates) {
      const v = String(c || '').trim()
      if (v === './*' || v === '*') roots.add('')
      if (v === 'src/*' || v === './src/*') roots.add('src')
    }
  }
  return [...roots]
}

export async function fetchRepositoryContent(repoUrl, options = {}) {
  try {
    if (!repoUrl || typeof repoUrl !== 'string') {
      throw new Error('Repository URL is required')
    }

    if (!isValidGitHubUrl(repoUrl)) {
      const sanitized = sanitizeGitHubUrl(repoUrl)
      if (!sanitized) {
        throw new Error('Invalid GitHub repository URL format')
      }
      repoUrl = sanitized
    }

    const match = repoUrl.match(/github\.com\/([\w.-]+)\/([\w.-]+)/)
    if (!match) {
      throw new Error('Invalid GitHub repository URL')
    }

    const [, owner, repo] = match
    const explicitRefMatch = repoUrl.match(/\/tree\/(.+)$/)
    let explicitRef = null
    if (explicitRefMatch && typeof explicitRefMatch[1] === 'string' && explicitRefMatch[1].trim()) {
      try {
        explicitRef = decodeURIComponent(explicitRefMatch[1].trim())
      } catch {
        explicitRef = explicitRefMatch[1].trim()
      }
    }

    const githubToken =
      options && options.githubToken && typeof options.githubToken === 'string' && options.githubToken.trim()
        ? options.githubToken.trim()
        : process.env.GITHUB_TOKEN || process.env.GITHUB_API_TOKEN

    if (process.env.NODE_ENV === 'development') {
      console.log('Using GitHub token:', githubToken ? 'yes' : 'no')
    }

    const chooseScheme = (token) => {
      if (!token) return null
      if (token.startsWith('github_pat_')) return 'Bearer'
      if (token.startsWith('ghp_')) return 'token'
      return 'token'
    }

    const baseHeaders = {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'SecLens-Security-Analyzer',
    }

    const schemesToTry = githubToken ? [chooseScheme(githubToken), 'Bearer', 'token'].filter(Boolean) : []

    async function fetchWithAuth(url, init = {}) {
      let response = await fetch(url, { headers: baseHeaders, ...init })
      if (response.ok || !githubToken) return response

      for (const scheme of schemesToTry) {
        const headers = { ...baseHeaders, Authorization: `${scheme} ${githubToken}` }
        const retry = await fetch(url, { headers, ...init })
        if (retry.ok) return retry
        response = retry
      }
      return response
    }

    const caps = getIngestionCaps()

    const repoResponse = await fetchWithAuth(`https://api.github.com/repos/${owner}/${repo}`)

    if (!repoResponse.ok) {
      if (process.env.NODE_ENV === 'development') {
        try {
          const errText = await repoResponse.text()
          console.error('GitHub repo metadata error:', repoResponse.status, errText?.slice(0, 300))
        } catch {
          // Best-effort diagnostic read only.
        }
      }
      if (repoResponse.status === 404) {
        const authed = !!githubToken
        throw new Error(
          authed
            ? 'Repository is private or access is denied with the provided token'
            : 'Repository not found or is private'
        )
      }
      if (repoResponse.status === 401) {
        throw new Error('GitHub token is invalid or expired (401)')
      }
      if (repoResponse.status === 403) {
        const rateLimitRemaining = repoResponse.headers.get('x-ratelimit-remaining')
        const rateLimitReset = repoResponse.headers.get('x-ratelimit-reset')

        if (rateLimitRemaining === '0') {
          const resetTime = rateLimitReset ? new Date(parseInt(rateLimitReset) * 1000).toISOString() : 'unknown'
          throw new Error(
            `GitHub API rate limit exceeded. Please try again later (reset at ${resetTime}). Consider setting GITHUB_TOKEN environment variable for higher limits.`
          )
        }
        throw new Error(
          'GitHub API access forbidden (403). The repository may be private or token lacks repo access.'
        )
      }
      throw new Error(`GitHub API error: ${repoResponse.status}`)
    }

    const ghRepo = await repoResponse.json()
    const apiDefaultBranch =
      typeof ghRepo.default_branch === 'string' && ghRepo.default_branch.trim()
        ? ghRepo.default_branch.trim()
        : null

    const selectedRef = explicitRef || apiDefaultBranch
    const refResult = await resolveScanRef(fetchWithAuth, owner, repo, selectedRef, {
      metadataResolved: !!selectedRef,
    })

    const treeResp = await fetchWithAuth(
      `https://api.github.com/repos/${owner}/${repo}/git/trees/${refResult.sha}?recursive=1`
    )

    if (!treeResp.ok) {
      if (treeResp.status === 403) {
        throw new Error(
          'GitHub API access forbidden. Rate limit may be exceeded, or repository is private without sufficient token scope.'
        )
      }
      throw new Error(`GitHub tree fetch failed (${treeResp.status})`)
    }

    const treePayload = await treeResp.json()
    const apiTruncated = !!treePayload.truncated

    /** @type {{ path: string, type: string }[]} */
    const rawTree = Array.isArray(treePayload.tree) ? treePayload.tree : []

    let blobPaths = rawTree.filter((t) => t.type === 'blob' && typeof t.path === 'string').map((t) => t.path)

    blobPaths = sortPathsDeterministic(blobPaths)

    let treeSizeCapHit = false
    if (blobPaths.length > caps.maxTreeEntries) {
      blobPaths = blobPaths.slice(0, caps.maxTreeEntries)
      treeSizeCapHit = true
    }

    const repoProfile = inferRepoProfileFromPaths(blobPaths, ghRepo.language || '')
    const surfacePlanOpts = { maxFiles: caps.maxFiles }
    if (Number.isFinite(options.criticalShortlistMax)) {
      surfacePlanOpts.criticalShortlistMax = Math.floor(/** @type {number} */ (options.criticalShortlistMax))
    }
    let securitySurfacePlan = buildSecuritySurfacePlan(blobPaths, repoProfile, surfacePlanOpts)

    function classifyInv(p) {
      const c = classifyRepoPath(p, { repoProfile })
      return { tier: c.tier, omit: !!c.omit }
    }

    const inventoryCounts = countEligibleByTier(blobPaths, classifyInv)

    const initialPlan = selectPathsByTiers(blobPaths, caps.maxFiles, { repoProfile, securitySurfacePlan })
    const anchorPaths = initialPlan.selectionMeta.filter(selectionMetaRowIsExpansionAnchor).map((s) => s.path)
    const workflowPaths = initialPlan.selectionMeta
      .filter(
        (s) =>
          /\.github\/workflows\/.+\.ya?ml$/i.test(s.path) &&
          (s.reason === 'tier1_priority' || s.reason === 'critical_shortlist')
      )
      .map((s) => s.path)
    const configPaths = blobPaths.filter((p) => /(^|\/)(tsconfig(\.[^/]+)?|jsconfig)\.json$/i.test(p))
    const seedTextPaths = [...new Set([...anchorPaths, ...workflowPaths, ...configPaths])]
    const pathTextByPath = {}

    const shortlistSourceRe = /\.(js|mjs|cjs|ts|tsx|jsx)$/i
    async function fetchPathTextIntoMap(path) {
      if (pathTextByPath[path]) return
      try {
        const encoded = encodeGithubContentsPath(path)
        const fileUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${encoded}?ref=${encodeURIComponent(refResult.sha)}`
        const fileResponse = await fetchWithAuth(fileUrl)
        if (!fileResponse.ok) return
        const fileData = await fileResponse.json()
        if (!fileData?.content || fileData.encoding !== 'base64') return
        const buf = Buffer.from(fileData.content.replace(/\n/g, ''), 'base64')
        const text = buf.toString('utf8')
        if (buf.includes(0) || text.includes('\uFFFD')) return
        pathTextByPath[path] = text
      } catch {
        // Best effort only.
      }
    }

    for (const path of securitySurfacePlan.criticalShortlist) {
      if (shortlistSourceRe.test(path)) await fetchPathTextIntoMap(path)
    }

    for (const path of seedTextPaths) {
      await fetchPathTextIntoMap(path)
    }

    const aliasAtRoots = detectAliasRootsFromConfigTexts(
      configPaths.map((p) => pathTextByPath[p]).filter(Boolean)
    )

    for (const path of pickBoundedKeywordScanCandidates(blobPaths, repoProfile, securitySurfacePlan, { max: 360 })) {
      if (shortlistSourceRe.test(path)) await fetchPathTextIntoMap(path)
    }
    securitySurfacePlan = enrichSecuritySurfacePlanWithKeywordSignalsFromTexts(
      blobPaths,
      repoProfile,
      securitySurfacePlan,
      pathTextByPath
    )

    let forwardAcc = 0
    let reverseAcc = 0
    let enrichRounds = 0
    for (let r = 0; r < 8; r++) {
      const before = securitySurfacePlan.criticalShortlist.join('\0')
      securitySurfacePlan = enrichSecuritySurfacePlanWithImportGraph(
        blobPaths,
        repoProfile,
        securitySurfacePlan,
        pathTextByPath,
        aliasAtRoots
      )
      forwardAcc += securitySurfacePlan.shortlistPipeline?.forwardImportExpansions ?? 0
      reverseAcc += securitySurfacePlan.shortlistPipeline?.reverseCallerExpansions ?? 0
      for (const path of securitySurfacePlan.criticalShortlist) {
        if (shortlistSourceRe.test(path)) await fetchPathTextIntoMap(path)
      }
      enrichRounds = r + 1
      if (securitySurfacePlan.criticalShortlist.join('\0') === before) break
    }
    securitySurfacePlan = {
      ...securitySurfacePlan,
      shortlistPipeline: {
        ...securitySurfacePlan.shortlistPipeline,
        forwardImportExpansions: forwardAcc,
        reverseCallerExpansions: reverseAcc,
        rounds: enrichRounds,
      },
    }

    const selectionPlan = selectPathsByTiers(blobPaths, caps.maxFiles, {
      pathTextByPath,
      aliasAtRoots,
      repoProfile,
      securitySurfacePlan,
    })
    const tierOmissions = selectionPlan.omitted.map((o) => ({ ...o }))
    const tierFileCapReached = tierOmissions.some((o) => o.reason === 'cap')

    if (selectionPlan.protectedCoverageGap && !allowPartialCriticalShortlistCoverage()) {
      throw new Error(
        'SecLens critical shortlist coverage gap: an in-tree profile security target was not selected, or the critical shortlist was truncated (SECLENS_CRITICAL_SHORTLIST_MAX). Fix profiling/selection or raise SECLENS_CRITICAL_SHORTLIST_MAX. To continue with partial coverage anyway, set SECLENS_ALLOW_PROTECTED_COVERAGE_GAP=true.'
      )
    }

    /** @type {Array<{ path: string, reason: string }>} */
    const fetchOmissions = []

    /** @type {Array<{ path: string, content: string }>} */
    const orderedFiles = []

    for (const sel of selectionPlan.selectionMeta) {
      const path = sel.path
      try {
        const encoded = encodeGithubContentsPath(path)
        const fileUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${encoded}?ref=${encodeURIComponent(refResult.sha)}`
        const fileResponse = await fetchWithAuth(fileUrl)

        if (!fileResponse.ok) {
          if (fileResponse.status === 403) {
            console.warn(`GitHub rate limit or forbidden while fetching ${path}`)
            break
          }
          fetchOmissions.push({ path, reason: 'unsupported' })
          continue
        }

        const fileData = await fileResponse.json()
        if (!fileData.content || fileData.encoding !== 'base64') {
          fetchOmissions.push({ path, reason: 'binary' })
          continue
        }

        const decoded = await decodeRepositoryArtifact(path, fileData.content)
        if (!decoded.ok) {
          fetchOmissions.push({ path, reason: decoded.reason || 'binary' })
          continue
        }
        orderedFiles.push({ path, content: decoded.content })
      } catch (err) {
        if (process.env.NODE_ENV === 'development') {
          console.error(`Error fetching file ${path}:`, err instanceof Error ? err.message : err)
        }
        fetchOmissions.push({ path, reason: 'unsupported' })
      }
    }

    const fetchedPaths = new Set(orderedFiles.map((f) => f.path))
    const recordedFail = new Set(fetchOmissions.map((o) => o.path))
    for (const sel of selectionPlan.selectionMeta) {
      if (!fetchedPaths.has(sel.path) && !recordedFail.has(sel.path)) {
        fetchOmissions.push({ path: sel.path, reason: 'unsupported' })
      }
    }

    const inventory = {
      totalFilesSeen: inventoryCounts.totalFilesSeen,
      filesEligibleByTier: inventoryCounts.filesEligibleByTier,
    }

    const dimensionCoreEvidence = evaluateDimensionCoreEvidence(
      securitySurfacePlan,
      new Set(selectionPlan.selected),
      repoProfile
    )

    const selectionForBundle = {
      selected: selectionPlan.selectionMeta.map((s) => ({
        path: s.path,
        tier: s.tier,
        reason: s.reason,
        ...(s.linkedAnchorPath ? { linkedAnchorPath: s.linkedAnchorPath } : {}),
        ...(s.reservedDomain ? { reservedDomain: s.reservedDomain } : {}),
      })),
      omitted: [...tierOmissions, ...fetchOmissions].map((o) => ({
        path: o.path,
        reason: o.reason,
      })),
      selectedReasonCounts: selectionPlan.selectedReasonCounts,
      anchorCount: selectionPlan.anchorCount,
      relatedContextCount: selectionPlan.relatedContextCount,
      backfillCount: selectionPlan.backfillCount,
      domainReservationCount: selectionPlan.domainReservationCount ?? 0,
      domainReservationByDomain: selectionPlan.domainReservationByDomain ?? {},
      dimensionCoreEvidence,
      ...(selectionPlan.protectedSecurityTargets
        ? {
            protectedSecurityTargets: selectionPlan.protectedSecurityTargets,
            protectedCoverageGap: !!selectionPlan.protectedCoverageGap,
          }
        : {}),
    }

    const { bundle, apiIngestion } = buildEvidenceBundle(
      {
        owner,
        name: ghRepo.name || repo,
        defaultBranch: apiDefaultBranch ?? refResult.scannedRef,
        scannedRef: refResult.scannedRef,
        scannedSha: refResult.sha,
        url: repoUrl,
      },
      {
        totalFilesSeen: inventory.totalFilesSeen,
        filesEligibleByTier: inventory.filesEligibleByTier,
      },
      selectionForBundle,
      orderedFiles,
      caps,
      {
        treeTruncated: apiTruncated || treeSizeCapHit,
        refResolutionDegraded: refResult.degraded,
        tierFileCapReached,
      }
    )

    if (treeSizeCapHit) {
      bundle.coverage.maxTreeSizeCapHit = true
      bundle.coverage.notes.push(`Repository tree entries capped at ${caps.maxTreeEntries} for processing.`)
      if (!apiIngestion.capHits.includes('MAX_REPO_TREE_ENTRIES')) {
        apiIngestion.capHits.push('MAX_REPO_TREE_ENTRIES')
      }
      apiIngestion.coverageSummary = `Partial coverage: tree processing limited (${apiIngestion.capHits.join(', ')}).`
    }

    if (bundle.evidence.length === 0) {
      throw new Error(
        'No analyzable evidence could be collected from the repository. It may be empty, contain no supported text files, or GitHub API access failed for selected paths.'
      )
    }

    const legacyFiles = bundle.evidence.map((ev) => ({
      path: ev.path,
      content: ev.snippets.map((s) => s.text).join('\n'),
    }))

    return {
      owner,
      repo,
      name: ghRepo.name || repo,
      description: ghRepo.description,
      language: ghRepo.language,
      url: repoUrl,
      files: legacyFiles,
      defaultBranch: apiDefaultBranch ?? refResult.scannedRef,
      scannedRef: refResult.scannedRef,
      scannedSha: refResult.sha,
      refResolutionDegraded: refResult.degraded,
      evidenceBundle: bundle,
      ingestion: apiIngestion,
      repoProfile,
      securitySurfacePlan,
    }
  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      console.error('GitHub API error:', error.message)
    } else {
      console.error('GitHub API error: Request failed')
    }
    throw error
  }
}

function encodeGithubContentsPath(path) {
  const norm = normalizeRepoPath(path)
  return norm.split('/').filter(Boolean).map(encodeURIComponent).join('/')
}
