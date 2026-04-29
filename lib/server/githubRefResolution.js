/**
 * GitHub default-branch / HEAD resolution (MVP4 Stage 02, DEFECT-001).
 *
 * When repository metadata succeeded and default_branch is known, only that branch is scanned —
 * never silent fallback to main/master. Heuristic fallback runs only without reliable metadata.
 */

function extractShaFromRef(refJson) {
  if (!refJson || typeof refJson !== 'object') return null
  const obj = refJson.object
  if (!obj || typeof obj !== 'object') return null
  if (obj.type === 'commit' && typeof obj.sha === 'string') return obj.sha
  return typeof obj.sha === 'string' ? obj.sha : null
}

function extractShaFromCommit(commitJson) {
  if (!commitJson || typeof commitJson !== 'object') return null
  return typeof commitJson.sha === 'string' ? commitJson.sha : null
}

function buildRefPathVariants(ref) {
  const trimmed = typeof ref === 'string' ? ref.trim() : ''
  if (!trimmed) return []

  const encodedWhole = encodeURIComponent(trimmed)
  const encodedSegments = trimmed.split('/').map(encodeURIComponent).join('/')
  return Array.from(new Set([encodedWhole, encodedSegments]))
}

export class BranchRefResolutionError extends Error {
  /**
   * @param {string} ref
   * @param {Array<{ endpoint: string, status: number | null }>} attempts
   */
  constructor(ref, attempts) {
    super(
      `Could not resolve HEAD for the selected branch/ref '${ref}'. Ref, branches, and commits endpoints failed; no fallback to other branch names was attempted.`
    )
    this.name = 'BranchRefResolutionError'
    this.code = 'BRANCH_REF_RESOLUTION_FAILED'
    this.ref = ref
    this.attempts = attempts
  }
}

/**
 * @param {(url: string, init?: RequestInit) => Promise<Response>} fetchWithAuth
 * @param {string} owner
 * @param {string} repo
 * @param {string | null} defaultBranchFromApi branch name from GET /repos (may be null if unknown)
 * @param {{ metadataResolved?: boolean }} options metadataResolved false => allow main/master heuristic only
 * @returns {Promise<{ sha: string, scannedRef: string, degraded: boolean }>}
 */
export async function resolveScanRef(fetchWithAuth, owner, repo, defaultBranchFromApi, options = {}) {
  const metadataResolved = options.metadataResolved !== false

  if (metadataResolved && defaultBranchFromApi && defaultBranchFromApi.trim()) {
    const branch = defaultBranchFromApi.trim()
    const baseUrl = `https://api.github.com/repos/${owner}/${repo}`
    const variants = buildRefPathVariants(branch)
    const attempts = []

    for (const variant of variants) {
      const refUrl = `${baseUrl}/git/ref/heads/${variant}`
      const refResp = await fetchWithAuth(refUrl)
      attempts.push({ endpoint: 'git/ref', status: typeof refResp.status === 'number' ? refResp.status : null })

      if (refResp.ok) {
        const data = await refResp.json()
        const sha = extractShaFromRef(data)
        if (sha) {
          return { sha, scannedRef: branch, degraded: false }
        }
      }
    }

    for (const variant of variants) {
      const branchResp = await fetchWithAuth(`${baseUrl}/branches/${variant}`)
      attempts.push({ endpoint: 'branches', status: typeof branchResp.status === 'number' ? branchResp.status : null })

      if (branchResp.ok) {
        const b = await branchResp.json()
        const sha = b.commit && typeof b.commit.sha === 'string' ? b.commit.sha : null
        if (sha) {
          return {
            sha,
            scannedRef: branch,
            degraded: true,
          }
        }
      }
    }

    for (const variant of variants) {
      const commitResp = await fetchWithAuth(`${baseUrl}/commits/${variant}`)
      attempts.push({ endpoint: 'commits', status: typeof commitResp.status === 'number' ? commitResp.status : null })

      if (commitResp.ok) {
        const commit = await commitResp.json()
        const sha = extractShaFromCommit(commit)
        if (sha) {
          return {
            sha,
            scannedRef: branch,
            degraded: true,
          }
        }
      }
    }

    throw new BranchRefResolutionError(branch, attempts)
  }

  /** Explicit degraded mode: no trusted default_branch from metadata. */
  let degraded = true
  const heuristics = ['main', 'master']
  for (const branch of heuristics) {
    const refUrl = `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`
    const refResp = await fetchWithAuth(refUrl)
    if (refResp.ok) {
      const data = await refResp.json()
      const sha = extractShaFromRef(data)
      if (sha) {
        return { sha, scannedRef: branch, degraded }
      }
    }
  }

  for (const branch of heuristics) {
    const branchResp = await fetchWithAuth(
      `https://api.github.com/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`
    )
    if (branchResp.ok) {
      const b = await branchResp.json()
      const sha = b.commit && typeof b.commit.sha === 'string' ? b.commit.sha : null
      if (sha) {
        return { sha, scannedRef: branch, degraded }
      }
    }
  }

  throw new Error(
    'Could not resolve repository branch head SHA (no default_branch metadata and main/master resolution failed).'
  )
}
