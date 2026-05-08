/**
 * MVP4 Stage 02 - deterministic tiered + related-context + CR-008 domain reservation (strategyVersion v2.8).
 * v2.6: DEFECT-003 - full critical shortlist (unbounded by maxFiles); maxFiles caps non-critical backfill only.
 * v2.7: DEFECT-003 shortlist pipeline - import-graph enrichment is applied upstream in securitySurfaceTargets; selection contract unchanged.
 * v2.8: DEFECT-005 - broader runtime entrypoint path signals (App Router routes, instrumentation, webhooks, jobs) for selection-domain mapping.
 */

import { normalizeRepoPath, looksBinaryExtension, TEXT_LIKE_EXT } from './repoInventory.js'
import { parseImportSpecifiers, resolveImportToRepoPath } from './jsImportResolve.js'

export const STRATEGY_VERSION = 'v2.8'

/** CR-008 Section2A - soft cap per security domain in the domain-reservation phase */
export const DOMAIN_RESERVE_MAX_PER_DOMAIN = 22
/** CR-008 Section2A - total files reserved for domain balancing before anchor / imported-by-anchor expansion */
export const DOMAIN_RESERVE_MAX_TOTAL = 220

const OPTIONAL_DOCUMENT_EXT_RE = /\.(pdf|docx?)$/i

/**
 * Map repo path to exactly one CR-008 security domain for domain-balanced selection, or null when none applies.
 * Order is specificity-first (narrow domains before broad auth).
 * @param {string} normPath
 * @returns {string | null}
 */
export function classifySelectionDomain(normPath) {
  const path = normalizeRepoPath(normPath).toLowerCase()
  if (!path) return null

  if (/\.github\/workflows\/|\.circleci\/|azure-pipelines|\.gitlab-ci\.ya?ml|(^|\/)jenkinsfile|(^|\/)\.drone\.ya?ml/i.test(path)) {
    return 'cicd'
  }

  if (
    /^readme\.md$/i.test(path) ||
    /^docs\/.+\.(md|mdx)$/i.test(path) ||
    /(^|\/)firestore\.rules$|(^|\/)storage\.rules$|(^|\/)firebase\.json$|\.gitleaks|pre-commit|dependabot|renovate\./i.test(
      path
    ) ||
    /\.(rules|policy)$/i.test(path.split('/').pop() || '')
  ) {
    return 'config_policy'
  }

  if (
    /^src\/contexts\/authcontext\.(tsx|ts|jsx|js)$/i.test(path) ||
    /^src\/components\/auth\/(authcallback|sessionprotectedroute)\.(tsx|ts|jsx|js)$/i.test(path)
  ) {
    return 'client_auth_bridge'
  }

  // Vercel/Netlify-style HTTP handlers + lib/server orchestration (DEFECT-003: scan jobs, analyze, rate limits)
  if (/^api\/[^/]+\.(js|ts|mjs|cjs)$/i.test(path)) return 'rate_limit'
  if (/^lib\/server\/[^/]+\.(js|ts|mjs|cjs)$/i.test(path)) return 'rate_limit'

  // Next.js App Router / Route Handlers / server actions (DEFECT-005 runtime boundaries)
  if (/(^|\/)app\/api\/auth\/.+/i.test(path) && /route\.(js|ts|mjs|cjs)$/i.test(path)) return 'auth_session'
  if (/(^|\/)app\/api\/.+\/route\.(js|ts|mjs|cjs)$/i.test(path)) return 'validation'
  if (/(^|\/)app\/.+\/actions\.(ts|tsx|js|jsx)$/i.test(path)) return 'validation'
  if (/(^|\/)(src\/)?instrumentation\.(ts|js|mjs|cjs)$/i.test(path)) return 'middleware_headers'

  if (/(^|\/)user_?management\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(path)) {
    return 'auth_session'
  }

  if (/(^|\/)invite_?management\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(path)) {
    return 'invite_token_claims'
  }

  if (
    /invite|invitation|customclaims|(^|[\\/])claims([\\/._]|$)|(^|\/)tokens\/|refreshtoken|idtoken/i.test(path) &&
    !/(?:^|\/)node_modules\//i.test(path)
  ) {
    return 'invite_token_claims'
  }

  if (/rate[-_]?limit|ratelimit|throttle|(^|\/)abuse\//i.test(path)) return 'rate_limit'

  // Webhook and scheduled job entrypoints (DEFECT-005)
  if (/(^|\/)webhooks?\/|(^|\/)stripe\/webhook|(^|\/)billing\/webhook/i.test(path)) return 'validation'
  if (/(^|\/)cron\/|(^|\/)scheduled\/|(^|\/)inngest\/|(^|\/)jobs\/[^/]+\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(path)) {
    return 'data_store'
  }

  if (/middleware|helmet|\bcsp\b|hsts|security[-_]headers|(^|\/)headers\.(ts|js)/i.test(path)) return 'middleware_headers'

  if (/validat|(^|\/)schemas?\/|(^|\/)schema\/|\bzod\b|sanitize|sanitise/i.test(path)) return 'validation'

  if (
    /prisma\/schema\.prisma|(^|\/)migrations\/|(^|\/)repositories\/|(^|\/)database\/|(^|\/)models\/|mongoose|sequelize|typeorm|(^|\/)supabase\/|(^|\/)firestore\.(ts|tsx|js)/i.test(
      path
    )
  ) {
    return 'data_store'
  }

  if (
    /(^|\/)(auth|authorization|authentication|session)(\/|\.|_)/i.test(path) ||
    /(^|\/)permissions\//i.test(path) ||
    /(^|\/)roles?\//i.test(path) ||
    /(^|\/)access[_-]?control/i.test(path)
  ) {
    return 'auth_session'
  }

  return null
}

/** Fixed round-robin order for CR-008 domain reservation (breadth-first across domains). */
export const DOMAIN_RESERVE_ORDER = [
  'auth_session',
  'invite_token_claims',
  'validation',
  'rate_limit',
  'middleware_headers',
  'cicd',
  'config_policy',
  'data_store',
  'client_auth_bridge',
]

function isTestLikePathForAnchor(p) {
  return /(\.test\.|\.spec\.|\/__tests__\/|\/tests?\/)/i.test(p)
}

/**
 * Callable auth / RBAC / account-admin modules that are frequently Tier-3 in basename-only classifiers
 * but are oracle-critical for auth/session dimensions (DEFECT-002 / CR-2.1-002 retrieval wiring).
 * Cross-repo heuristics - not repository-specific.
 */
const CALLABLE_AUTH_ADMIN_BASENAME_RE =
  /^(?:user_?management|invite_?management|permission_?manager|role_?manager|account_?management|access_?control|rbac(?:helpers?)?)(?:\.(?:ts|tsx|js|jsx|mjs|cjs))$/i

export function isCallableAuthAdminModulePath(p) {
  const path = normalizeRepoPath(p)
  if (!path || isTestLikePathForAnchor(path)) return false
  const base = path.split('/').pop() || ''
  if (!CALLABLE_AUTH_ADMIN_BASENAME_RE.test(base)) return false
  const lower = path.toLowerCase()
  if (/^functions\/src\//.test(lower)) return true
  if (/^server\//.test(lower)) return true
  if (/^api\/src\//.test(lower)) return true
  if (/^services\//.test(lower)) return true
  if (/^lib\//.test(lower)) return true
  if (/^src\/(services|handlers|controllers|api)\//.test(lower)) return true
  return false
}

/** Route/handler files that act as primary anchors for import expansion. */
export function isRouteAnchorPath(p) {
  const path = normalizeRepoPath(p)
  if (!path || isTestLikePathForAnchor(path)) return false
  return (
    /^app\/api\/.+\/route\.(js|ts)$/i.test(path) ||
    /^pages\/api\/.+\.(js|ts|mjs|cjs)$/i.test(path) ||
    /^api\/[^/]+\.(js|ts|mjs|cjs)$/i.test(path) ||
    /^src\/(routes|api)\/.+(route|handler|controller|index)\.(js|ts|mjs|cjs)$/i.test(path) ||
    /^server\/routes\/.+\.(js|ts|mjs|cjs)$/i.test(path) ||
    /^(controllers|handlers)\/.+\.(js|ts|mjs|cjs)$/i.test(path)
  )
}

/**
 * Tier-2-style security surfaces eligible to drive related/import expansion (includes middleware, auth dirs, CF entrypoints).
 */
export function isSecurityAnchorPath(p) {
  const path = normalizeRepoPath(p)
  if (!path || isTestLikePathForAnchor(path)) return false
  return (
    isRouteAnchorPath(path) ||
    isCallableAuthAdminModulePath(path) ||
    /(^|\/)(middleware(\.(js|ts|mjs|cjs))?|middleware\/.+|lib\/middleware\/.+)$/i.test(path) ||
    /(^|\/)(auth|authorization|authentication)(\/|\.|_).+/i.test(path) ||
    /(^|\/)(server\.(js|ts|mjs|cjs)|main\.go|cmd\/[^/]+\/main\.go)$/i.test(path) ||
    /^functions\/src\/(index|main|app|server)\.(ts|js|mjs|cjs)$/i.test(path) ||
    /^functions\/src\/(create|update|delete|invite|auth|claim|token|rate(limit)?|validate)[\w-]*\.(ts|js|mjs|cjs)$/i.test(
      path
    ) ||
    /^functions\/src\/utils\/(inviteToken|rateLimit|auth|claims?|validate[\w-]*)\.(ts|js|mjs|cjs)$/i.test(path)
  )
}

/**
 * Selection rows whose paths participate in imported-by-anchor + nearby related expansion (CR-008: domain-reserved security anchors included).
 * @param {{ path: string, reason: string }} row
 */
export function selectionMetaRowIsExpansionAnchor(row) {
  const r = row?.reason
  if (r === 'tier2_anchor_route' || r === 'tier2_security_surface') return true
  if (r === 'critical_shortlist' && isSecurityAnchorPath(row.path)) return true
  if (String(r || '').startsWith('domain_reserve_') && isSecurityAnchorPath(row.path)) return true
  return false
}

/** CR-008 provenance: domain bucket chosen in reservation phase (stable after reason upgrades to related_*). */
export function selectionRowReservedDomain(row) {
  if (row?.reservedDomain && DOMAIN_RESERVE_ORDER.includes(row.reservedDomain)) return row.reservedDomain
  const reason = String(row?.reason || '')
  if (reason.startsWith('domain_reserve_')) return reason.slice('domain_reserve_'.length)
  return null
}

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
export function classifyRepoPath(norm, opts = {}) {
  const path = normalizeRepoPath(norm)
  if (!path || path.endsWith('/')) {
    return { tier: null, omit: true, omitReason: 'ignored' }
  }

  if (isIgnoredPath(path)) {
    return { tier: null, omit: true, omitReason: 'ignored' }
  }

  if (looksBinaryExtension(path)) {
    if (OPTIONAL_DOCUMENT_EXT_RE.test(path)) {
      return { tier: 3 }
    }
    return { tier: null, omit: true, omitReason: 'binary' }
  }

  const base = path.split('/').pop() || ''
  const lowerBase = base.toLowerCase()

  // Tier 1 - manifests, lockfiles, CI, containers, env samples, policies
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
    '.gitleaks.toml',
    '.pre-commit-config.yaml',
    '.pre-commit-config.yml',
    '.dependabot.yml',
    '.dependabot.yaml',
    'renovate.json',
    'firebase.json',
    'firestore.rules',
    'storage.rules',
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
  if (/\.(rules)$/i.test(base)) {
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

  // Tier 2 - security-critical surfaces
  if (
    /(^|\/)server\.(js|ts|mjs|cjs)$/i.test(path) ||
    /(^|\/)main\.go$/i.test(path) ||
    /(^|\/)cmd\/[^/]+\/main\.go$/i.test(path)
  ) {
    return { tier: 2 }
  }
  if (/^api\/[^/]+\.(js|ts|mjs|cjs)$/i.test(path)) {
    return { tier: 2 }
  }
  if (/\/(routes|router|handlers|controllers|api)\//i.test(path)) {
    return { tier: 2 }
  }
  if (
    /^functions\/src\/(index|main|app|server)\.(ts|js|mjs|cjs)$/i.test(path) ||
    /^functions\/src\/(create|update|delete|invite|auth|claim|token|rate(limit)?|validate)[\w-]*\.(ts|js|mjs|cjs)$/i.test(
      path
    ) ||
    /^functions\/src\/utils\/(inviteToken|rateLimit|auth|claims?|validate[\w-]*)\.(ts|js|mjs|cjs)$/i.test(path)
  ) {
    return { tier: 2 }
  }
  if (/^src\/contexts\/AuthContext\.(ts|tsx|js|jsx)$/i.test(path)) {
    return { tier: 2 }
  }
  if (isCallableAuthAdminModulePath(path)) {
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

  // Tier 3 - representative code and docs
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
export function selectPathsByTiers(blobPaths, maxFiles, opts = {}) {
  const caps = Math.max(1, maxFiles)
  const omitted = []
  const byTier = [[], [], []]
  const classifyOpts = { repoProfile: opts.repoProfile || null }

  for (const raw of blobPaths) {
    const path = normalizeRepoPath(raw)
    const c = classifyRepoPath(path, classifyOpts)
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

  const selected = /** @type {string[]} */ ([])
  const selMeta = /** @type {Array<{ path: string, tier: string, reason: string }>} */ ([])
  const selectedSet = new Set()
  const capSet = new Set()

  const allEligible = [...byTier[0], ...byTier[1], ...byTier[2]]
  const eligibleSet = new Set(allEligible)
  const dirMap = new Map()
  for (const p of allEligible) {
    const idx = p.lastIndexOf('/')
    const dir = idx === -1 ? '' : p.slice(0, idx)
    if (!dirMap.has(dir)) dirMap.set(dir, [])
    dirMap.get(dir).push(p)
  }
  for (const arr of dirMap.values()) arr.sort((a, b) => pathSortKey(a).localeCompare(pathSortKey(b)))

  const plan = opts.securitySurfacePlan
  const rawCriticalList =
    plan && Array.isArray(plan.criticalShortlist)
      ? plan.criticalShortlist
      : plan && Array.isArray(plan.protectedTargetPaths)
        ? plan.protectedTargetPaths
        : null
  const criticalOrdered = []
  const criticalListSeen = new Set()
  if (rawCriticalList) {
    for (const raw of rawCriticalList) {
      const p = normalizeRepoPath(raw)
      if (!p || criticalListSeen.has(p)) continue
      criticalListSeen.add(p)
      criticalOrdered.push(p)
    }
  }
  const hasSurfacePlan = criticalOrdered.length > 0
  const criticalSet = new Set(criticalOrdered.filter((p) => eligibleSet.has(p)))

  for (const path of criticalOrdered) {
    if (!eligibleSet.has(path)) continue
    if (selectedSet.has(path)) continue
    selected.push(path)
    selectedSet.add(path)
    const tierNum = classifyRepoPath(path, classifyOpts).tier || 3
    selMeta.push({ path, tier: `tier${tierNum}`, reason: 'critical_shortlist' })
  }

  const nonCriticalSelectedCount = () => selMeta.filter((m) => m.reason !== 'critical_shortlist').length

  const basename = (p) => {
    const idx = p.lastIndexOf('/')
    return idx === -1 ? p : p.slice(idx + 1)
  }
  const dirname = (p) => {
    const idx = p.lastIndexOf('/')
    return idx === -1 ? '' : p.slice(0, idx)
  }
  const isRouteAnchor = isRouteAnchorPath
  const isSecurityAnchor = isSecurityAnchorPath
  const relatedReason = (p) => {
    const lower = p.toLowerCase()
    const base = basename(lower)
    if (
      base.endsWith('.test.ts') ||
      base.endsWith('.test.js') ||
      base.endsWith('.spec.ts') ||
      base.endsWith('.spec.js') ||
      /(^|\/)__tests__\//.test(lower)
    ) {
      return 'related_same_directory_test'
    }
    if (/(^|\/)(middleware(\.|\/)|lib\/middleware\/)/.test(lower)) return 'related_middleware'
    if (/(^|\/)(auth|firebase-admin|session|permissions|roles)\b/.test(lower)) return 'related_auth_helper'
    if (/(^|\/)(validate|validation|schemas|schema|zod)\b/.test(lower)) return 'related_validation_helper'
    if (/(^|\/)(errorhandler|error|errors|response|withroute)\b/.test(lower)) return 'related_error_helper'
    if (/(^|\/)(ratelimit|rate-limit|throttle|abuse)\b/.test(lower)) return 'related_rate_limit_helper'
    if (/^src\/contexts\/authcontext\.(ts|tsx|js|jsx)$/.test(lower)) return 'related_client_auth_bridge'
    if (/^src\/components\/auth\/(authcallback|sessionprotectedroute)\.(ts|tsx|js|jsx)$/.test(lower)) {
      return 'related_client_auth_bridge'
    }
    if (/^scripts\/.+\.(js|ts|sh|ps1|mjs|cjs)$/i.test(p)) return 'related_workflow_script'
    if (
      /(^|\/)(\.gitleaks\.toml|\.pre-commit-config\.ya?ml|security\.md|dependabot\.ya?ml|renovate(\.json|\.json5|\.js|\.ya?ml)?)$/i.test(
        p
      )
    ) {
      return 'related_config_policy'
    }
    return null
  }
  const readTextForPath = (p) => {
    const map = opts.pathTextByPath
    if (!map) return ''
    if (map instanceof Map) return String(map.get(p) || '')
    return String(map[p] || '')
  }
  const parseWorkflowScriptRefs = (text) => {
    const out = []
    if (!text) return out
    const re = /scripts\/[^\s"'`|&;]+?\.(js|ts|mjs|cjs|sh|ps1)/gim
    let m
    while ((m = re.exec(text))) {
      const normalized = String(m[0] || '').replace(/\\/g, '/').replace(/^\.\//, '')
      out.push(normalized)
    }
    return out
  }
  const aliasRoots = Array.isArray(opts.aliasAtRoots) ? opts.aliasAtRoots : []
  const add = (path, tier, reason, linkedAnchorPath = null, explicitReservedDomain = null) => {
    if (selectedSet.has(path)) return true
    if (!criticalSet.has(path) && nonCriticalSelectedCount() >= caps) {
      if (!capSet.has(path)) {
        capSet.add(path)
        omitted.push({ path, reason: 'cap' })
      }
      return false
    }
    selected.push(path)
    selectedSet.add(path)
    const rd =
      explicitReservedDomain ||
      (String(reason).startsWith('domain_reserve_') ? reason.slice('domain_reserve_'.length) : null)
    const meta = {
      path,
      tier,
      reason,
      ...(linkedAnchorPath ? { linkedAnchorPath } : {}),
      ...(rd && DOMAIN_RESERVE_ORDER.includes(rd) ? { reservedDomain: rd } : {}),
    }
    selMeta.push(meta)
    return true
  }
  const maybeUpgradeSelectedReason = (path, reason, linkedAnchorPath = null) => {
    const idx = selMeta.findIndex((m) => m.path === path)
    if (idx === -1) return
    const cur = selMeta[idx].reason
    const upgradeable =
      cur === 'tier2_security_surface' ||
      cur.startsWith('domain_reserve_') ||
      cur.startsWith('backfill_') ||
      (cur === 'related_imported_by_anchor' && reason === 'related_client_auth_bridge')
    if (!upgradeable) return
    if (!String(reason || '').startsWith('related_')) return
    selMeta[idx] = {
      ...selMeta[idx],
      reason,
      ...(linkedAnchorPath && !selMeta[idx].linkedAnchorPath ? { linkedAnchorPath } : {}),
    }
  }

  for (const path of byTier[0]) {
    add(path, 'tier1', 'tier1_priority')
  }

  // CR-008 Section2A - domain-balanced reservation before tier-2 anchors and imported-by-anchor expansion
  const buckets = new Map()
  for (const d of DOMAIN_RESERVE_ORDER) buckets.set(d, [])
  for (const p of allEligible) {
    if (selectedSet.has(p)) continue
    const d = classifySelectionDomain(p)
    if (!d || !buckets.has(d)) continue
    buckets.get(d).push(p)
  }
  for (const d of DOMAIN_RESERVE_ORDER) {
    buckets.get(d).sort((a, b) => {
      const ta = classifyRepoPath(a, classifyOpts).tier || 3
      const tb = classifyRepoPath(b, classifyOpts).tier || 3
      if (ta !== tb) return ta - tb
      return pathSortKey(a).localeCompare(pathSortKey(b))
    })
  }
  const perDomainReserved = Object.fromEntries(DOMAIN_RESERVE_ORDER.map((d) => [d, 0]))
  let domainPhaseSlots = Math.min(DOMAIN_RESERVE_MAX_TOTAL, Math.max(0, caps - nonCriticalSelectedCount()))
  let domainRoundProgress = true
  while (domainPhaseSlots > 0 && nonCriticalSelectedCount() < caps && domainRoundProgress) {
    domainRoundProgress = false
    for (const d of DOMAIN_RESERVE_ORDER) {
      if (domainPhaseSlots <= 0 || nonCriticalSelectedCount() >= caps) break
      if (perDomainReserved[d] >= DOMAIN_RESERVE_MAX_PER_DOMAIN) continue
      const list = buckets.get(d)
      const next = list.find((path) => !selectedSet.has(path))
      if (!next) continue
      const tierNum = classifyRepoPath(next, classifyOpts).tier || 3
      const ok = add(next, `tier${tierNum}`, `domain_reserve_${d}`, null, d)
      if (ok) {
        perDomainReserved[d]++
        domainPhaseSlots--
        domainRoundProgress = true
      }
    }
  }

  const tier2Anchors = byTier[1].filter((p) => isSecurityAnchor(p))
  const anchorBudget = Math.max(1, Math.floor(Math.max(0, caps - nonCriticalSelectedCount()) * 0.6))
  let anchorsAdded = 0
  for (const path of tier2Anchors) {
    if (anchorsAdded >= anchorBudget || nonCriticalSelectedCount() >= caps) break
    const ok = add(path, 'tier2', isRouteAnchor(path) ? 'tier2_anchor_route' : 'tier2_security_surface')
    if (ok) anchorsAdded++
  }

  const anchorMeta = selMeta.filter(selectionMetaRowIsExpansionAnchor)
  const relatedBudget = Math.max(1, Math.floor(Math.max(0, caps - nonCriticalSelectedCount()) * 0.7))
  let relatedAdded = 0
  const candidates = []
  const candidateSeen = new Set()
  const pushCandidate = (path, reason, linkedAnchorPath = null) => {
    if (selectedSet.has(path)) {
      maybeUpgradeSelectedReason(path, reason, linkedAnchorPath)
      return
    }
    const key = `${path}::${reason}`
    if (candidateSeen.has(key)) {
      const idx = candidates.findIndex((c) => `${c.path}::${c.reason}` === key)
      if (idx >= 0 && linkedAnchorPath && !candidates[idx].linkedAnchorPath) {
        candidates[idx] = { ...candidates[idx], linkedAnchorPath }
      }
      return
    }
    candidateSeen.add(key)
    candidates.push({ path, reason, ...(linkedAnchorPath ? { linkedAnchorPath } : {}) })
  }

  for (const anchor of anchorMeta) {
    const dir = dirname(anchor.path)
    const near = dirMap.get(dir) || []
    for (const p of near) {
      const reason = relatedReason(p)
      if (reason === 'related_same_directory_test' || reason === 'related_validation_helper' || reason === 'related_error_helper') {
        pushCandidate(p, reason, anchor.path)
      }
    }
    const parts = dir ? dir.split('/') : []
    for (let i = parts.length; i >= 0; i--) {
      const parent = parts.slice(0, i).join('/')
      const local = dirMap.get(parent) || []
      for (const p of local) {
        if (relatedReason(p) === 'related_middleware') pushCandidate(p, 'related_middleware', anchor.path)
      }
    }

    const text = readTextForPath(anchor.path)
    const specs = parseImportSpecifiers(text)
    for (const spec of specs) {
      const resolved = resolveImportToRepoPath(anchor.path, spec, eligibleSet, aliasRoots)
      if (!resolved) continue
      if (resolved === anchor.path) continue
      pushCandidate(resolved, 'related_imported_by_anchor', anchor.path)
    }
  }

  const authInviteAnchorPresent = anchorMeta.some((a) =>
    /(^functions\/src\/|\/)(createuserandinvite|invitemanagement|validateinvite|updateuserclaims|usermanagement|index)\.(ts|js|mjs|cjs)$/i.test(
      a.path
    )
  )
  if (authInviteAnchorPresent) {
    const bridgeCandidates = [
      'src/contexts/AuthContext.tsx',
      'src/contexts/AuthContext.ts',
      'src/components/Auth/AuthCallback.tsx',
      'src/components/Auth/AuthCallback.ts',
      'src/components/Auth/SessionProtectedRoute.tsx',
      'src/components/Auth/SessionProtectedRoute.ts',
    ]
    for (const p of bridgeCandidates) {
      if (eligibleSet.has(p)) pushCandidate(p, 'related_client_auth_bridge')
    }
  }

  if (anchorMeta.length > 0) {
    const sharedSecurityPrefixes = [
      'lib/middleware/',
      'lib/auth/',
      'lib/validation/',
      'lib/errors/',
      'lib/rateLimit/',
      'src/lib/middleware/',
      'src/lib/auth/',
      'src/lib/validation/',
      'src/lib/errors/',
      'src/lib/rateLimit/',
    ]
    for (const p of allEligible) {
      if (sharedSecurityPrefixes.some((prefix) => p.startsWith(prefix))) {
        pushCandidate(p, 'related_shared_security_dir')
      }
    }
  }

  const workflowAnchors = selMeta
    .filter(
      (m) =>
        /\.github\/workflows\/.+\.ya?ml$/i.test(m.path) &&
        (m.reason === 'tier1_priority' || m.reason === 'critical_shortlist')
    )
    .map((m) => m.path)
  for (const p of allEligible) {
    const reason = relatedReason(p)
    if (!reason) continue
    if (reason === 'related_config_policy') {
      pushCandidate(p, reason)
    }
  }
  for (const wf of workflowAnchors) {
    const wfText = readTextForPath(wf)
    const refs = parseWorkflowScriptRefs(wfText)
    for (const ref of refs) {
      if (eligibleSet.has(ref)) {
        pushCandidate(ref, 'related_workflow_script', wf)
      }
    }
  }

  const reasonPriority = {
    related_client_auth_bridge: 1,
    related_imported_by_anchor: 2,
    related_shared_security_dir: 2,
    related_middleware: 3,
    related_auth_helper: 4,
    related_validation_helper: 5,
    related_error_helper: 6,
    related_rate_limit_helper: 7,
    related_same_directory_test: 9,
    related_config_policy: 10,
    related_workflow_script: 11,
  }
  candidates.sort((a, b) => {
    const pa = reasonPriority[a.reason] || 99
    const pb = reasonPriority[b.reason] || 99
    if (pa !== pb) return pa - pb
    const cmp = pathSortKey(a.path).localeCompare(pathSortKey(b.path))
    if (cmp !== 0) return cmp
    return a.reason.localeCompare(b.reason)
  })

  for (const c of candidates) {
    if (nonCriticalSelectedCount() >= caps || relatedAdded >= relatedBudget) break
    const t = classifyRepoPath(c.path, classifyOpts).tier || 3
    const ok = add(c.path, `tier${t}`, c.reason, c.linkedAnchorPath || null)
    if (ok) relatedAdded++
  }

  for (const path of byTier[1]) {
    if (nonCriticalSelectedCount() >= caps) break
    add(path, 'tier2', 'backfill_tier2')
  }
  for (const path of byTier[2]) {
    if (nonCriticalSelectedCount() >= caps) break
    add(path, 'tier3', 'backfill_tier3')
  }

  if (nonCriticalSelectedCount() >= caps) {
    for (const path of allEligible) {
      if (!selectedSet.has(path) && !capSet.has(path)) {
        capSet.add(path)
        omitted.push({ path, reason: 'cap' })
      }
    }
  }

  const selectedReasonCounts = {}
  for (const row of selMeta) {
    selectedReasonCounts[row.reason] = (selectedReasonCounts[row.reason] || 0) + 1
  }

  const domainReservationByDomain = Object.fromEntries(
    DOMAIN_RESERVE_ORDER.map((d) => [d, selMeta.filter((m) => selectionRowReservedDomain(m) === d).length])
  )
  const domainReservationCount = selMeta.filter((m) => selectionRowReservedDomain(m)).length

  let protectedSecurityTargets = null
  let protectedCoverageGap = false
  if (hasSurfacePlan) {
    const protectedInEligible = criticalOrdered.filter((p) => eligibleSet.has(p))
    const included = protectedInEligible.filter((p) => selectedSet.has(p)).length
    const oracleEligible = protectedInEligible.filter((p) => isCallableAuthAdminModulePath(p))
    const oracleIncluded = oracleEligible.filter((p) => selectedSet.has(p)).length
    const truncated = !!opts.securitySurfacePlan.criticalShortlistTruncated
    protectedSecurityTargets = {
      requested: criticalOrdered.length,
      eligible: protectedInEligible.length,
      absentFromTree: criticalOrdered.length - protectedInEligible.length,
      included,
      capDropped: protectedInEligible.length - included,
      /** Oracle-callable auth/admin modules (subset of critical); retained for debugging */
      oracleEligible: oracleEligible.length,
      oracleIncluded,
      criticalShortlistTruncated: truncated,
      surfaceDiscoveredCounts: opts.securitySurfacePlan.surfaceDiscoveredCounts || {},
      ...(opts.securitySurfacePlan.shortlistPipeline
        ? { shortlistPipeline: opts.securitySurfacePlan.shortlistPipeline }
        : {}),
    }
    // Fail-closed when any in-tree critical shortlist member is missing from selection, or list was truncated by SECLENS_CRITICAL_SHORTLIST_MAX
    protectedCoverageGap = truncated || included < protectedInEligible.length
  }

  return {
    strategyVersion: STRATEGY_VERSION,
    selected,
    selectionMeta: selMeta,
    omitted,
    selectedReasonCounts,
    anchorCount: selMeta.filter(selectionMetaRowIsExpansionAnchor).length,
    relatedContextCount: selMeta.filter((m) => m.reason.startsWith('related_')).length,
    backfillCount: selMeta.filter((m) => m.reason.startsWith('backfill_')).length,
    domainReservationCount,
    domainReservationByDomain,
    ...(protectedSecurityTargets
      ? { protectedSecurityTargets, protectedCoverageGap }
      : {}),
  }
}

export function sortPathsDeterministic(paths) {
  return [...paths].sort((a, b) => pathSortKey(a).localeCompare(pathSortKey(b)))
}
