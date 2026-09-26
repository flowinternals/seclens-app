import { existsSync, readFileSync } from 'fs'
import { parseGithubRepoUrl } from './baseline.js'

const DEFAULT_PUBLIC_TARGET = 'https://github.com/github/brakeman'
const DEFAULT_GITHUB_SECRETS =
  'D:/Assets/flowinternals-seclens-app-Assets/security/secrets/github.txt'
const DEFAULT_ITC2_SECRETS =
  'D:/Assets/flowinternals-seclens-app-Assets/security/secrets/itc2-pat.txt'
const DEFAULT_PUBLIC_REPOS =
  'D:/Assets/flowinternals-seclens-app-Assets/testing/public-github-repos.md'
const DEFAULT_E2E_CREDS =
  'D:/Assets/flowinternals-seclens-app-Assets/security/secrets/e2e-firebase.txt'

function firstMatch(text, regex) {
  const m = String(text || '').match(regex)
  return m?.[1] || m?.[0] || null
}

function extractUrl(text) {
  const urlMatch = String(text || '').match(/https:\/\/github\.com\/[^\s)\]>]+/i)
  return urlMatch?.[0]?.replace(/[.,;]+$/, '') || null
}

function extractToken(text) {
  const tokenMatch = String(text || '').match(/\b(ghp_[A-Za-z0-9]+|github_pat_[A-Za-z0-9_]+)\b/)
  return tokenMatch?.[1] || null
}

/**
 * Parse a secrets file into repo-bound tokens, unbound tokens, and public URLs.
 * Supports:
 *   - url + token on the same line
 *   - token line followed by url line (or reverse) within the file
 *   - bare public URLs
 */
export function parseGithubSecretsFile(secretsPath = DEFAULT_GITHUB_SECRETS) {
  if (!existsSync(secretsPath)) {
    return { repoTokens: [], unboundTokens: [], publicUrls: [] }
  }
  const lines = readFileSync(secretsPath, 'utf8').split(/\r?\n/)
  const repoTokens = []
  const unboundTokens = []
  const publicUrls = []
  const pendingTokens = []
  const pendingUrls = []

  function pushBound(url, token, rawLine) {
    const parsed = parseGithubRepoUrl(url)
    if (!parsed || !token) return
    repoTokens.push({
      owner: parsed.owner,
      repo: parsed.repo,
      repoUrl: parsed.url,
      token,
      rawLine: rawLine || `${url} ${token.slice(0, 8)}…`,
    })
  }

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const url = extractUrl(trimmed)
    const token = extractToken(trimmed)

    if (url && token) {
      pushBound(url, token, trimmed)
      continue
    }
    if (token && !url) {
      if (pendingUrls.length) {
        pushBound(pendingUrls.shift(), token, trimmed)
      } else {
        pendingTokens.push(token)
        unboundTokens.push(token)
      }
      continue
    }
    if (url && !token) {
      if (pendingTokens.length) {
        const t = pendingTokens.shift()
        // Keep unbound list but also bind when a following URL appears.
        pushBound(url, t, trimmed)
      } else {
        pendingUrls.push(url)
      }
      if (!/ITC2-AUS\/SPO_Management/i.test(url)) {
        publicUrls.push(url.split(/\s+-\s+/)[0])
      }
    }
  }

  return { repoTokens, unboundTokens, publicUrls }
}

/**
 * Merge github.txt + itc2-pat.txt (and any extra paths).
 */
export function loadAllGithubSecretStores(extraPaths = []) {
  const paths = [DEFAULT_GITHUB_SECRETS, DEFAULT_ITC2_SECRETS, ...extraPaths]
  const repoTokens = []
  const unboundTokens = []
  const publicUrls = []
  for (const path of paths) {
    const parsed = parseGithubSecretsFile(path)
    repoTokens.push(...parsed.repoTokens)
    unboundTokens.push(...parsed.unboundTokens)
    publicUrls.push(...parsed.publicUrls)
  }
  return { repoTokens, unboundTokens, publicUrls }
}

/**
 * Resolve a GitHub token for a target repo.
 * Prefer repo-bound PAT from secrets files, then explicit e2e env, then unbound tokens.
 */
export function loadGithubTokenForTarget(target, secretsPath = null) {
  const stores = secretsPath
    ? parseGithubSecretsFile(secretsPath)
    : loadAllGithubSecretStores()
  const { repoTokens, unboundTokens } = stores
  if (target?.owner && target?.repo) {
    const bound = repoTokens.find(
      (entry) =>
        entry.owner.toLowerCase() === String(target.owner).toLowerCase() &&
        entry.repo.toLowerCase() === String(target.repo).toLowerCase()
    )
    if (bound?.token) return bound.token
  }

  if (process.env.SECLENS_E2E_GITHUB_TOKEN) return process.env.SECLENS_E2E_GITHUB_TOKEN.trim()
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN.trim()
  if (process.env.GITHUB_API_TOKEN) return process.env.GITHUB_API_TOKEN.trim()
  return unboundTokens[0] || null
}

/** @deprecated prefer loadGithubTokenForTarget */
export function loadGithubTokenFromSecrets(secretsPath = DEFAULT_GITHUB_SECRETS) {
  return loadGithubTokenForTarget(null, secretsPath)
}

export function loadFirebaseE2eCreds(credsPath = DEFAULT_E2E_CREDS) {
  if (process.env.SECLENS_E2E_FIREBASE_EMAIL && process.env.SECLENS_E2E_FIREBASE_PASSWORD) {
    return {
      email: process.env.SECLENS_E2E_FIREBASE_EMAIL.trim(),
      password: process.env.SECLENS_E2E_FIREBASE_PASSWORD,
      source: 'env',
    }
  }
  if (!existsSync(credsPath)) return null
  const raw = readFileSync(credsPath, 'utf8')
  const email = firstMatch(raw, /SECLENS_E2E_FIREBASE_EMAIL\s*=\s*(\S+)/)
  const password = firstMatch(raw, /SECLENS_E2E_FIREBASE_PASSWORD\s*=\s*(\S+)/)
  if (!email || !password) return null
  return { email, password, source: credsPath }
}

function looksPrivateTarget(owner, repo, repoTokens) {
  const key = `${owner}/${repo}`.toLowerCase()
  if (/itc2-aus\/spo_management/i.test(key)) return true
  if (/flowinternals\/spekify-app/i.test(key)) return true
  return repoTokens.some(
    (entry) =>
      entry.owner.toLowerCase() === String(owner).toLowerCase() &&
      entry.repo.toLowerCase() === String(repo).toLowerCase()
  )
}

/**
 * Resolve e2e target repo.
 * Priority:
 *   SECLENS_E2E_REPO_URL
 *   → first repo-bound URL in github.txt (e.g. spekify)
 *   → first public URL in github.txt
 *   → public-github-repos.md
 *   → brakeman default
 */
export function resolveE2eTarget(opts = {}) {
  const explicit = process.env.SECLENS_E2E_REPO_URL || opts.repoUrl || ''
  const publicReposPath = opts.publicReposPath || DEFAULT_PUBLIC_REPOS
  const { repoTokens, publicUrls } = opts.githubSecretsPath
    ? parseGithubSecretsFile(opts.githubSecretsPath)
    : loadAllGithubSecretStores()

  let chosen = explicit.trim()
  if (!chosen && repoTokens.length) {
    // Prefer non-SPO bound repos as interim default unless explicitly requested.
    const preferred =
      repoTokens.find((e) => !/ITC2-AUS\/SPO_Management/i.test(`${e.owner}/${e.repo}`)) ||
      repoTokens[0]
    chosen = preferred.repoUrl
  }
  if (!chosen && publicUrls.length) {
    chosen = publicUrls[0]
  }
  if (!chosen && existsSync(publicReposPath)) {
    const lines = readFileSync(publicReposPath, 'utf8').split(/\r?\n/)
    for (const line of lines) {
      const cleaned = line.split(/\s+-\s+/)[0].trim()
      if (/^https:\/\/github\.com\//i.test(cleaned) && !/ITC2-AUS\/SPO_Management/i.test(cleaned)) {
        chosen = cleaned
        break
      }
    }
  }
  if (!chosen) chosen = DEFAULT_PUBLIC_TARGET

  const parsed = parseGithubRepoUrl(chosen)
  if (!parsed) throw new Error(`Invalid SECLENS_E2E_REPO_URL: ${chosen}`)

  // If URL includes /tree/<ref>, keep it; for SPO default to staging when unbound.
  let ref =
    process.env.SECLENS_E2E_REPO_REF ||
    parsed.ref ||
    opts.ref ||
    null
  if (!ref && /ITC2-AUS\/SPO_Management/i.test(`${parsed.owner}/${parsed.repo}`)) {
    ref = 'staging'
  }

  const privateFlag = String(process.env.SECLENS_E2E_REPO_PRIVATE || '').toLowerCase()
  const isPrivate =
    privateFlag === '1' ||
    privateFlag === 'true' ||
    (privateFlag !== '0' &&
      privateFlag !== 'false' &&
      looksPrivateTarget(parsed.owner, parsed.repo, repoTokens))

  return {
    owner: parsed.owner,
    repo: parsed.repo,
    ref,
    isPrivate,
    repoUrl: parsed.url,
    displayUrl: `${parsed.url}/tree/${ref || 'HEAD'}`,
    baselineSha: process.env.SECLENS_E2E_BASELINE_SHA || opts.baselineSha || null,
  }
}
