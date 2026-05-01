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

function scoreFromSignalCount(signalCount) {
  if (signalCount >= 4) return 'high'
  if (signalCount >= 2) return 'medium'
  return 'low'
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

  if (hasFrontend) signalReasons.push('frontend framework/build surfaces detected')
  if (hasApi) signalReasons.push('API/server route surfaces detected')
  if (hasMobile) signalReasons.push('mobile platform surfaces detected')
  if (hasCli) signalReasons.push('CLI entrypoint/tooling surfaces detected')
  if (hasLibrary) signalReasons.push('library/package distribution surfaces detected')
  if (hasIac) signalReasons.push('infrastructure-as-code surfaces detected')
  if (hasCi) signalReasons.push('CI/workflow automation surfaces detected')
  if (hasData) signalReasons.push('data pipeline/orchestration surfaces detected')

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
  const rationale = `Repo profile inferred from ${normalized.length} repository path signal(s): ${signalReasons.join('; ') || 'generic repository structure signals'}.`
  return {
    profiles: dedupedProfiles,
    primaryProfile: dedupedProfiles[0] || 'library/package',
    confidence: scoreFromSignalCount(signalReasons.length),
    rationale,
    evidenceSignals: signalReasons.slice(0, 6),
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
      ? `Not required on this run: the repository looks like ${profileSummary}, which does not call for this security lens in SecLens’s profile model.`
      : 'Weighted from repo profile fit and in-scope evidence.',
    required: !notApplicable,
  }
}
