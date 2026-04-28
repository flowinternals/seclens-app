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

    const refUrl = `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`
    const refResp = await fetchWithAuth(refUrl)

    if (refResp.ok) {
      const data = await refResp.json()
      const sha = extractShaFromRef(data)
      if (sha) {
        return { sha, scannedRef: branch, degraded: false }
      }
    }

    const branchResp = await fetchWithAuth(
      `https://api.github.com/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`
    )
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

    throw new Error(
      `Could not resolve HEAD for the repository default branch '${branch}'. Ref and branches endpoints failed; no fallback to other branch names was attempted.`
    )
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
