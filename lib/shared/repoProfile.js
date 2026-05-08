const PROFILE_TYPES = Object.freeze([
  'frontend SPA',
  'backend API',
  'monolith',
  'mobile app',
  'CLI/tooling',
  'library/package',
  'infrastructure-as-code repo',
  'CI-only repo',
  'data pipeline',
  'mixed/multi-surface repo',
])

function uniq(values) {
  return [...new Set((values || []).filter(Boolean))]
}

function hasAny(paths, matcher) {
  return paths.some((path) => matcher.test(path))
}

function joinOxfordList(items) {
  const list = (items || []).filter(Boolean)
  if (list.length === 0) return ''
  if (list.length === 1) return list[0]
  if (list.length === 2) return `${list[0]} and ${list[1]}`
  return `${list.slice(0, -1).join(', ')}, and ${list[list.length - 1]}`
}

/**
 * Human-readable explanation of path-only architecture inference for the dashboard.
 * "Matched" elsewhere meant: at least one scanned path looked like this kind of layout (heuristic regex on paths, not file contents).
 */
export function buildArchitectureRationale(scannedPathCount, flags) {
  const {
    hasFrontend,
    hasApi,
    hasMobile,
    hasCli,
    hasLibrary,
    hasIac,
    hasCi,
    hasData,
  } = flags

  const markers = []
  if (hasFrontend) markers.push('a front-end or SPA-style layout')
  if (hasApi) markers.push('server or API routes')
  if (hasMobile) markers.push('a mobile-oriented tree')
  if (hasCli) markers.push('CLI or scripting entrypoints')
  if (hasLibrary) markers.push('a library or packaged workspace')
  if (hasIac) markers.push('infrastructure-as-code')
  if (hasCi) markers.push('CI or workflow automation')
  if (hasData) markers.push('data pipeline or orchestration folders')

  const intro =
    'Architecture here is inferred only from folder and file paths in the scan-source code is not read for this label.'

  const pathSentence =
    typeof scannedPathCount === 'number' && scannedPathCount > 0
      ? `This snapshot includes ${scannedPathCount} paths from the repository tree.`
      : 'Path listings were not available for this structural summary.'

  let conclusion
  if (markers.length === 0) {
    conclusion =
      'No specialized folder shapes stood out strongly; classification falls back to a generic library-or-package style layout.'
  } else {
    conclusion = `At least one path in the tree fits common patterns for ${joinOxfordList(markers)}.`
  }

  return `${intro} ${pathSentence} ${conclusion}`
}

function scoreFromSignalCount(signalCount) {
  if (signalCount >= 4) return 'high'
  if (signalCount >= 2) return 'medium'
  return 'low'
}

function scoreStackIdentification(stackLabels = []) {
  const n = stackLabels.length
  if (n >= 3) return 'high'
  if (n >= 1) return 'medium'
  return 'low'
}

const CONFIDENCE_ORDER = { low: 0, medium: 1, high: 2 }

function minimumConfidence(...levels) {
  let minOrder = 2
  for (const level of levels) {
    const o = CONFIDENCE_ORDER[level] ?? 0
    if (o < minOrder) minOrder = o
  }
  return minOrder === 2 ? 'high' : minOrder === 1 ? 'medium' : 'low'
}

/**
 * Infers toolchain labels from repository-relative paths only (no file contents).
 * Used for dashboard "Detected stack" and stack-confidence scoring.
 */
export function inferTechnologyStackFromPaths(paths = [], language = '') {
  const normalized = (paths || []).map((p) => String(p || '').toLowerCase())
  const stack = []

  const tryPush = (label) => {
    if (!stack.includes(label)) stack.push(label)
  }

  for (const path of normalized) {
    if (/(^|\/)package\.json$/.test(path)) tryPush('Node.js / npm manifest')
    if (/pnpm-lock\.yaml$/.test(path)) tryPush('pnpm')
    if (/yarn\.lock$/.test(path)) tryPush('Yarn')
    if (/package-lock\.json$/.test(path)) tryPush('npm lockfile')
    if (/vite\.config\.(js|ts|mjs|cjs)$/.test(path)) tryPush('Vite')
    if (/vitest\.config\.(js|ts|mjs|cjs)$/.test(path)) tryPush('Vitest')
    if (/next\.config\.(js|ts|mjs)$/.test(path)) tryPush('Next.js')
    if (/nuxt\.config\.(js|ts)$/.test(path)) tryPush('Nuxt')
    if (/angular\.json$/.test(path)) tryPush('Angular')
    if (/svelte\.config\.(js|ts)$/.test(path)) tryPush('Svelte')
    if (/astro\.config\.(js|ts|mjs)$/.test(path)) tryPush('Astro')
    if (/remix\.config\.(js|ts)$/.test(path)) tryPush('Remix')
    if (/gatsby-config\.(js|ts)$/.test(path)) tryPush('Gatsby')
    if (/tailwind\.config\.(js|ts)$/.test(path)) tryPush('Tailwind CSS')
    if (/(^|\/)server\.(js|mjs|cjs|ts)$/.test(path)) tryPush('Node server entrypoint')
    if (/(^|\/)tsconfig\.json$/.test(path)) tryPush('TypeScript')
    if (/eslint\.config\.(js|ts|mjs)|\.eslintrc\.(js|json|cjs|yaml|yml)$/.test(path)) tryPush('ESLint')
    if (/(^|\/)dockerfile$|(^|\/)docker-compose\.ya?ml$/.test(path)) tryPush('Docker')
    if (/prisma\/schema\.prisma$/.test(path)) tryPush('Prisma')
    if (/^cargo\.toml$|(^|\/)cargo\.toml$/.test(path)) tryPush('Rust / Cargo')
    if (/^go\.mod$|(^|\/)go\.mod$/.test(path)) tryPush('Go modules')
    if (/^pyproject\.toml$|(^|\/)pyproject\.toml$/.test(path)) tryPush('Python (pyproject)')
    if (/requirements.*\.txt$/.test(path)) tryPush('Python (requirements)')
    if (/^gemfile$|(^|\/)gemfile$/.test(path)) tryPush('Ruby / Bundler')
    if (/^pom\.xml$|(^|\/)pom\.xml$/.test(path)) tryPush('Java / Maven')
    if (/build\.gradle(\.kts)?$|settings\.gradle(\.kts)?$/.test(path)) tryPush('Gradle')
    if (/\.csproj$/.test(path)) tryPush('.NET')
  }

  const lang = String(language || '').trim()
  if (lang && !stack.some((s) => s.toLowerCase().includes(lang.toLowerCase()))) {
    tryPush(`${lang} (platform language metadata)`)
  }

  return stack
}

const PRIMARY_SUMMARY_PHRASE = {
  'frontend SPA': 'a browser-oriented single-page or rich client application',
  'backend API': 'a backend or HTTP API-oriented codebase',
  monolith: 'a combined frontend-and-backend monolith',
  'mobile app': 'a mobile-oriented codebase',
  'CLI/tooling': 'a CLI, scripts, or developer tooling project',
  'library/package': 'a library or distributable package',
  'infrastructure-as-code repo': 'an infrastructure-as-code oriented repository',
  'CI-only repo': 'a repository whose strongest signals are CI or automation config',
  'data pipeline': 'a data pipeline or ETL style codebase',
  'mixed/multi-surface repo': 'a multi-surface codebase spanning several application types',
}

export function buildProfileSummary(repoProfile) {
  const primary = repoProfile?.primaryProfile || 'library/package'
  const phrase = PRIMARY_SUMMARY_PHRASE[primary] || `a repository classified as ${primary}`
  const profiles = Array.isArray(repoProfile?.profiles) ? repoProfile.profiles : []
  const extra = profiles.filter((p) => p !== primary)
  let first = `SecLens infers this target is primarily ${phrase}`
  if (extra.length) {
    first += `; other detected shapes include ${extra.slice(0, 5).join(', ')}`
    if (extra.length > 5) first += ', ...'
  }
  first += '.'
  const stack = Array.isArray(repoProfile?.technologyStack) ? repoProfile.technologyStack : []
  const second =
    stack.length > 0
      ? ` From configuration and lockfile paths alone (manifest contents are not parsed here), toolchain hints include ${stack.join(', ')}.`
      : ' No toolchain labels were inferred from typical manifest or config filenames in the scanned paths.'
  return `${first}${second}`
}

function profileWeightsForDimension(dimensionId) {
  return {
    auth_session_authorization: {
      'frontend SPA': 0.75,
      'backend API': 1,
      monolith: 1,
      'mobile app': 0.7,
      'CLI/tooling': 0.35,
      'library/package': 0.25,
      'infrastructure-as-code repo': 0.2,
      'CI-only repo': 0.05,
      'data pipeline': 0.4,
      'mixed/multi-surface repo': 1,
    },
    invite_token_claims: {
      'frontend SPA': 0.65,
      'backend API': 0.9,
      monolith: 0.9,
      'mobile app': 0.6,
      'CLI/tooling': 0.25,
      'library/package': 0.2,
      'infrastructure-as-code repo': 0.1,
      'CI-only repo': 0.05,
      'data pipeline': 0.2,
      'mixed/multi-surface repo': 0.9,
    },
    validation_input_trust_boundaries: {
      'frontend SPA': 0.8,
      'backend API': 1,
      monolith: 1,
      'mobile app': 0.8,
      'CLI/tooling': 0.65,
      'library/package': 0.7,
      'infrastructure-as-code repo': 0.35,
      'CI-only repo': 0.2,
      'data pipeline': 0.6,
      'mixed/multi-surface repo': 1,
    },
    rate_limiting_abuse_controls: {
      'frontend SPA': 0.45,
      'backend API': 0.95,
      monolith: 0.9,
      'mobile app': 0.35,
      'CLI/tooling': 0.15,
      'library/package': 0.1,
      'infrastructure-as-code repo': 0.1,
      'CI-only repo': 0.05,
      'data pipeline': 0.3,
      'mixed/multi-surface repo': 0.8,
    },
    cicd_secrets_deployment: {
      'frontend SPA': 0.7,
      'backend API': 0.8,
      monolith: 0.85,
      'mobile app': 0.8,
      'CLI/tooling': 0.75,
      'library/package': 0.75,
      'infrastructure-as-code repo': 1,
      'CI-only repo': 1,
      'data pipeline': 0.85,
      'mixed/multi-surface repo': 0.9,
    },
    config_policy_rules: {
      'frontend SPA': 0.65,
      'backend API': 0.8,
      monolith: 0.8,
      'mobile app': 0.75,
      'CLI/tooling': 0.55,
      'library/package': 0.55,
      'infrastructure-as-code repo': 1,
      'CI-only repo': 0.85,
      'data pipeline': 0.85,
      'mixed/multi-surface repo': 0.9,
    },
    data_access_persistence: {
      'frontend SPA': 0.35,
      'backend API': 0.8,
      monolith: 0.85,
      'mobile app': 0.4,
      'CLI/tooling': 0.25,
      'library/package': 0.2,
      'infrastructure-as-code repo': 0.1,
      'CI-only repo': 0.05,
      'data pipeline': 1,
      'mixed/multi-surface repo': 0.75,
    },
    client_auth_bridge_frontend_guarding: {
      'frontend SPA': 1,
      'backend API': 0.4,
      monolith: 0.85,
      'mobile app': 0.8,
      'CLI/tooling': 0.05,
      'library/package': 0.15,
      'infrastructure-as-code repo': 0.05,
      'CI-only repo': 0.05,
      'data pipeline': 0.1,
      'mixed/multi-surface repo': 0.9,
    },
  }[dimensionId] || {}
}

export function inferRepoProfileFromPaths(paths = [], language = '') {
  const normalized = (paths || []).map((path) => String(path || '').toLowerCase())
  const signalReasons = []

  const hasFrontend = hasAny(normalized, /(^|\/)(src|components|pages|app)\//) || hasAny(normalized, /next\.config|vite\.config|webpack\.config|index\.html/)
  const hasApi = hasAny(normalized, /(^|\/)(api|server|functions)\//) || hasAny(normalized, /route\.(js|ts)|express|fastify|nestjs/)
  const hasMobile = hasAny(normalized, /(^|\/)(android|ios)\//) || hasAny(normalized, /react-native|expo|flutter|xcodeproj|gradle/)
  const hasCli = hasAny(normalized, /(^|\/)(bin|cli|scripts)\//) || hasAny(normalized, /commander|yargs|argparse/)
  const hasLibrary = hasAny(normalized, /(^|\/)(lib|packages)\//) || hasAny(normalized, /tsup\.config|rollup\.config|exports/)
  const hasIac = hasAny(normalized, /terraform|\.tf$|cloudformation|pulumi|kustomization|helm/)
  const hasCi = hasAny(normalized, /\.github\/workflows|azure-pipelines|bitbucket-pipelines|circleci|jenkinsfile/)
  const hasData = hasAny(normalized, /(^|\/)(dbt|airflow|dags|pipelines?|etl|spark|notebooks?)\//) || hasAny(normalized, /requirements.*data|mlflow|prefect/)

  if (hasFrontend) signalReasons.push('front-end / SPA path shape')
  if (hasApi) signalReasons.push('API or server path shape')
  if (hasMobile) signalReasons.push('mobile path shape')
  if (hasCli) signalReasons.push('CLI or scripts path shape')
  if (hasLibrary) signalReasons.push('library or package workspace shape')
  if (hasIac) signalReasons.push('infrastructure-as-code path shape')
  if (hasCi) signalReasons.push('CI / workflow path shape')
  if (hasData) signalReasons.push('data pipeline path shape')

  const profiles = []
  if (hasFrontend) profiles.push('frontend SPA')
  if (hasApi) profiles.push('backend API')
  if (hasMobile) profiles.push('mobile app')
  if (hasCli) profiles.push('CLI/tooling')
  if (hasLibrary) profiles.push('library/package')
  if (hasIac) profiles.push('infrastructure-as-code repo')
  if (hasData) profiles.push('data pipeline')

  const nonInfraProfiles = profiles.filter((profile) => profile !== 'infrastructure-as-code repo')
  if (hasCi && nonInfraProfiles.length === 0 && !hasIac) profiles.push('CI-only repo')
  if (hasFrontend && hasApi) profiles.push('monolith')
  if (nonInfraProfiles.length >= 2) profiles.push('mixed/multi-surface repo')
  if (profiles.length === 0) profiles.push('library/package')

  const dedupedProfiles = uniq(profiles).filter((profile) => PROFILE_TYPES.includes(profile))
  const rationale = buildArchitectureRationale(normalized.length, {
    hasFrontend,
    hasApi,
    hasMobile,
    hasCli,
    hasLibrary,
    hasIac,
    hasCi,
    hasData,
  })

  const technologyStack = inferTechnologyStackFromPaths(normalized, language)
  const architectureConfidence = scoreFromSignalCount(signalReasons.length)
  const stackConfidence = scoreStackIdentification(technologyStack)
  const confidence = minimumConfidence(architectureConfidence, stackConfidence)

  const draft = {
    profiles: dedupedProfiles,
    primaryProfile: dedupedProfiles[0] || 'library/package',
    confidence,
    architectureConfidence,
    stackConfidence,
    technologyStack,
    architectureSignals: signalReasons,
    rationale,
    evidenceSignals: signalReasons.slice(0, 6),
  }
  return {
    ...draft,
    applicationPurpose: '',
    profileSummary: '',
  }
}

export function buildDimensionApplicability({ dimensionId, repoProfile, reviewedFileCount = 0, runtimeProgress = 'completed' }) {
  if (runtimeProgress === 'failed') {
    return {
      status: 'retry_needed',
      weight: 1,
      rationale: 'Dimension run failed and must be retried before launch sign-off.',
      required: true,
    }
  }

  const profiles = Array.isArray(repoProfile?.profiles) ? repoProfile.profiles : []
  const weights = profileWeightsForDimension(dimensionId)
  const profileWeights = profiles.map((profile) => weights[profile]).filter((value) => Number.isFinite(value))
  const rawWeight = profileWeights.length ? Math.max(...profileWeights) : 0.5
  const weight = Number(Math.max(0.05, Math.min(1, rawWeight)).toFixed(2))
  const notApplicable = weight <= 0.15 && reviewedFileCount === 0
  const profileSummary = profiles.length ? profiles.join(', ') : 'unknown repository profile'

  return {
    status: notApplicable ? 'not_applicable' : 'applicable',
    weight,
    rationale: notApplicable
      ? `Not required on this run: the repository looks like ${profileSummary}, which does not call for this security lens in SecLens's profile model.`
      : 'Weighted from repo profile fit and in-scope evidence.',
    required: !notApplicable,
  }
}
