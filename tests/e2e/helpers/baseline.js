/**
 * Dynamic GitHub repo target helpers for e2e oracle runs.
 */

export function parseGithubRepoUrl(input) {
  const raw = String(input || '').trim()
  if (!raw) return null
  const normalized = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  let parsed
  try {
    parsed = new URL(normalized)
  } catch {
    return null
  }
  if (parsed.hostname !== 'github.com') return null
  const segments = parsed.pathname.split('/').filter(Boolean)
  if (segments.length < 2) return null
  const owner = segments[0]
  const repo = segments[1].replace(/\.git$/i, '')
  let ref = null
  if (segments[2] === 'tree' && segments.length >= 4) {
    ref = decodeURIComponent(segments.slice(3).join('/'))
  }
  return { owner, repo, ref, url: `https://github.com/${owner}/${repo}` }
}

function githubHeaders(token) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'seclens-e2e-baseline',
  }
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

/** Resolve repository default branch (e.g. main vs master). */
export async function resolveGithubDefaultBranch({
  owner,
  repo,
  token,
  fetchImpl = fetch,
}) {
  const url = `https://api.github.com/repos/${owner}/${repo}`
  const res = await fetchImpl(url, { headers: githubHeaders(token) })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`GitHub repo lookup failed (${res.status}): ${body.slice(0, 200)}`)
  }
  const data = await res.json()
  const branch = data?.default_branch
  if (!branch || typeof branch !== 'string') {
    throw new Error('GitHub repo lookup returned no default_branch')
  }
  return branch
}

/**
 * Resolve tip SHA for owner/repo/ref. Token optional (public repos).
 * If ref is null/empty/'HEAD', uses the repo default branch.
 */
export async function resolveGithubRefSha({
  owner,
  repo,
  ref,
  token,
  fetchImpl = fetch,
}) {
  let resolvedRef = ref
  if (!resolvedRef || resolvedRef === 'HEAD') {
    resolvedRef = await resolveGithubDefaultBranch({ owner, repo, token, fetchImpl })
  }

  const url = `https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(resolvedRef)}`
  const res = await fetchImpl(url, { headers: githubHeaders(token) })
  if (!res.ok) {
    // Common miss: caller assumed `main` but repo uses `master` (or vice versa).
    if (res.status === 404 || res.status === 422) {
      const fallback = await resolveGithubDefaultBranch({ owner, repo, token, fetchImpl })
      if (fallback !== resolvedRef) {
        return resolveGithubRefSha({
          owner,
          repo,
          ref: fallback,
          token,
          fetchImpl,
        })
      }
    }
    const body = await res.text()
    throw new Error(`GitHub ref resolve failed (${res.status}): ${body.slice(0, 200)}`)
  }
  const data = await res.json()
  const sha = data?.sha || data?.commit?.sha
  if (!sha || typeof sha !== 'string') {
    throw new Error('GitHub ref resolve returned no sha')
  }
  return { sha, ref: resolvedRef }
}

/**
 * @returns {{ baselineComparison: 'equivalent'|'baseline_changed'|'unverified', resolvedSha: string, baselineSha: string, proceed: boolean, reason?: string }}
 */
export function evaluateBaselineGuard({
  resolvedSha,
  baselineSha,
  mode = 'strict',
}) {
  const tip = String(resolvedSha || '').toLowerCase()
  const base = String(baselineSha || '').toLowerCase()
  if (!tip) {
    return {
      baselineComparison: 'unverified',
      resolvedSha: tip,
      baselineSha: base,
      proceed: false,
      reason: 'Missing resolved SHA',
    }
  }
  if (!base) {
    return {
      baselineComparison: 'unverified',
      resolvedSha: tip,
      baselineSha: '',
      proceed: true,
      reason: 'No baseline SHA configured for this target',
    }
  }
  if (tip === base) {
    return {
      baselineComparison: 'equivalent',
      resolvedSha: tip,
      baselineSha: base,
      proceed: true,
    }
  }
  if (mode === 'allow-drift') {
    return {
      baselineComparison: 'baseline_changed',
      resolvedSha: tip,
      baselineSha: base,
      proceed: true,
      reason: 'Tip SHA differs from AC baseline; continuing under allow-drift',
    }
  }
  return {
    baselineComparison: 'baseline_changed',
    resolvedSha: tip,
    baselineSha: base,
    proceed: false,
    reason: `strict baseline mismatch: tip ${tip} !== baseline ${base}`,
  }
}

export function buildScanUrl({ owner, repo, sha, ref = 'main', mode = 'strict' }) {
  const ownerRepo = `${owner}/${repo}`
  if (mode === 'strict' && sha) {
    return `https://github.com/${ownerRepo}/tree/${sha}`
  }
  if (ref) return `https://github.com/${ownerRepo}/tree/${ref}`
  return `https://github.com/${ownerRepo}`
}

/** @deprecated use buildScanUrl */
export function buildSpoScanUrl(opts) {
  return buildScanUrl({
    owner: 'ITC2-AUS',
    repo: 'SPO_Management',
    ref: opts?.ref || 'staging',
    sha: opts?.sha,
    mode: opts?.mode || 'strict',
  })
}
