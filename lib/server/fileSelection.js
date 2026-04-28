/**
 * MVP4 Stage 02 — deterministic tiered file selection (strategyVersion v1).
 */

import { normalizeRepoPath, looksBinaryExtension, TEXT_LIKE_EXT } from './repoInventory.js'

export const STRATEGY_VERSION = 'v1'

const IGNORED_PREFIXES = [
  'node_modules/',
  'vendor/',
  'dist/',
  'build/',
  '.next/',
  'out/',
  'coverage/',
  '__pycache__/',
  '.git/',
  'target/',
  '.cache/',
  '.pnpm-store/',
  '.yarn/cache/',
  'Pods/',
  'DerivedData/',
]

function isIgnoredPath(norm) {
  const lower = norm.toLowerCase()
  for (const prefix of IGNORED_PREFIXES) {
    if (lower.startsWith(prefix)) return true
  }
  return false
}

/** @returns {{ tier: 1|2|3|null, omit?: boolean, omitReason?: string }} */
export function classifyRepoPath(norm) {
  const path = normalizeRepoPath(norm)
  if (!path || path.endsWith('/')) {
    return { tier: null, omit: true, omitReason: 'ignored' }
  }

  if (isIgnoredPath(path)) {
    return { tier: null, omit: true, omitReason: 'ignored' }
  }

  if (looksBinaryExtension(path)) {
    return { tier: null, omit: true, omitReason: 'binary' }
  }

  const base = path.split('/').pop() || ''
  const lowerBase = base.toLowerCase()

  // Tier 1 — manifests, lockfiles, CI, containers, env samples, policies
  const tier1Basenames = new Set([
    'package.json',
    'package-lock.json',
    'npm-shrinkwrap.json',
    'yarn.lock',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'bun.lock',
    'requirements.txt',
    'constraints.txt',
    'pipfile',
    'pipfile.lock',
    'poetry.lock',
    'pyproject.toml',
    'go.mod',
    'go.sum',
    'cargo.toml',
    'cargo.lock',
    'composer.json',
    'composer.lock',
    'gemfile',
    'gemfile.lock',
    'mix.exs',
    'mix.lock',
    'makefile',
    'dockerfile',
    '.env.example',
    '.env.sample',
    '.env.template',
    '.env.local.example',
    'security.md',
    'renovate.json',
    'firebase.json',
    'vercel.json',
    'netlify.toml',
    'terraform.tf',
    'nginx.conf',
  ])

  if (tier1Basenames.has(lowerBase)) {
    return { tier: 1 }
  }
  if (/^dockerfile/i.test(base) || /^dockerfile\./i.test(base)) {
    return { tier: 1 }
  }
  if (/^docker-compose\.ya?ml$/i.test(base)) {
    return { tier: 1 }
  }
  if (/\.github\/workflows\/.+\.(ya?ml)$/i.test(path)) {
    return { tier: 1 }
  }
  if (/\.gitlab-ci\.ya?ml$/i.test(base)) {
    return { tier: 1 }
  }
  if (path.includes('.circleci/')) {
    return { tier: 1 }
  }
  if (/\.dependabot\.ya?ml$/i.test(base)) {
    return { tier: 1 }
  }
  if (/^\.releaserc/i.test(base) || base === '.releaserc.json') {
    return { tier: 1 }
  }
  if (/^(next|nuxt|astro|vite|vitest|playwright|babel|postcss|tailwind)\.config\.(js|ts|mjs|cjs)$/i.test(base)) {
    return { tier: 1 }
  }
  if (/^tsconfig(\.[^/]+)?\.json$/i.test(base)) {
    return { tier: 1 }
  }
  if (/^jest\.config\.(js|ts|mjs|cjs)$/i.test(base) || base === 'playwright.config.ts') {
    return { tier: 1 }
  }
  if (/^eslint\.config\.(js|mjs|cjs|ts)$/i.test(base) || /^\.eslintrc/i.test(base)) {
    return { tier: 1 }
  }

  // Tier 2 — security-critical surfaces
  if (
    /(^|\/)server\.(js|ts|mjs|cjs)$/i.test(path) ||
    /(^|\/)main\.go$/i.test(path) ||
    /(^|\/)cmd\/[^/]+\/main\.go$/i.test(path)
  ) {
    return { tier: 2 }
  }
  if (/\/(routes|router|handlers|controllers|api)\//i.test(path)) {
    return { tier: 2 }
  }
  if (/\/(middleware|auth|authorization|authentication)(\/|\.)/i.test(path)) {
    return { tier: 2 }
  }
  if (/prisma\/schema\.prisma$/i.test(path) || /(^|\/)schema\.sql$/i.test(path)) {
    return { tier: 2 }
  }
  if (/\/(db|database|models|repositories)\/[^/]+\.(js|ts|mjs|cjs|go|py)$/i.test(path)) {
    return { tier: 2 }
  }
  if (/\/(upload|download|storage|files)\b/i.test(path) && /\.(js|ts|jsx|tsx|py|go)$/i.test(path)) {
    return { tier: 2 }
  }
  if (/^(src\/|app\/|pages\/api\/)/i.test(path) && /route\.(js|ts)$/i.test(base)) {
    return { tier: 2 }
  }

  // Tier 3 — representative code and docs
  if (
    /\.(js|jsx|mjs|cjs|ts|tsx|vue|svelte|astro|py|go|java|rb|php|cs|swift|kt|rs)$/i.test(path) ||
    TEXT_LIKE_EXT.test(path) ||
    /\.(sql|graphql|dart|lua|hs|scala)$/i.test(path)
  ) {
    return { tier: 3 }
  }

  return { tier: null, omit: true, omitReason: 'unsupported' }
}

function pathSortKey(path) {
  return path.replace(/\\/g, '/').toLowerCase()
}

/**
 * Waterfall: all tier 1 (sorted), then tier 2, then tier 3 until maxFiles.
 * @param {string[]} blobPaths
 * @param {number} maxFiles
 */
export function selectPathsByTiers(blobPaths, maxFiles) {
  const caps = Math.max(1, maxFiles)
  const omitted = []
  const byTier = [[], [], []]

  for (const raw of blobPaths) {
    const path = normalizeRepoPath(raw)
    const c = classifyRepoPath(path)
    if (c.omit) {
      omitted.push({
        path,
        reason: /** @type {'binary'|'ignored'|'unsupported'} */ (c.omitReason || 'unsupported'),
      })
      continue
    }
    const t = c.tier
    if (t === 1) byTier[0].push(path)
    else if (t === 2) byTier[1].push(path)
    else byTier[2].push(path)
  }

  for (const arr of byTier) {
    arr.sort((a, b) => pathSortKey(a).localeCompare(pathSortKey(b)))
  }

  const selected = []
  const selMeta = []

  for (let ti = 0; ti < 3; ti++) {
    for (const path of byTier[ti]) {
      if (selected.length >= caps) {
        omitted.push({ path, reason: 'cap' })
        continue
      }
      const tierNum = /** @type {1|2|3} */ (ti + 1)
      selected.push(path)
      selMeta.push({
        path,
        tier: `tier${tierNum}`,
        reason: tierNum === 1 ? 'tier1_priority' : tierNum === 2 ? 'tier2_security_surface' : 'tier3_context',
      })
    }
  }

  return {
    strategyVersion: STRATEGY_VERSION,
    selected,
    selectionMeta: selMeta,
    omitted,
  }
}

export function sortPathsDeterministic(paths) {
  return [...paths].sort((a, b) => pathSortKey(a).localeCompare(pathSortKey(b)))
}
