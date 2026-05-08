/**
 * Repository documentation profiling - README, design/architecture markdown, package.json.
 * Used to populate application purpose (human-facing) and augment detected stack with real deps/text.
 */

function stripJsonComments(text) {
  return String(text || '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

function clipText(s, max) {
  const t = String(s || '').trim()
  if (t.length <= max) return t
  return `${t.slice(0, Math.max(0, max - 1)).trim()}...`
}

/** Known npm dependency keys -> concise stack label (exact match). */
const NPM_DEP_LABEL = {
  react: 'React',
  'react-dom': 'React',
  'react-router-dom': 'React Router',
  vue: 'Vue',
  nuxt: 'Nuxt',
  next: 'Next.js',
  '@remix-run/react': 'Remix',
  '@remix-run/node': 'Remix',
  '@angular/core': 'Angular',
  '@sveltejs/kit': 'SvelteKit',
  svelte: 'Svelte',
  astro: 'Astro',
  vite: 'Vite',
  vitest: 'Vitest',
  webpack: 'Webpack',
  tailwindcss: 'Tailwind CSS',
  express: 'Express',
  fastify: 'Fastify',
  '@nestjs/core': 'NestJS',
  prisma: 'Prisma',
  firebase: 'Firebase',
  'firebase-admin': 'Firebase Admin',
  stripe: 'Stripe',
  openai: 'OpenAI SDK',
  cors: null,
  dotenv: null,
}

/**
 * Priority order of documentation paths present in the repository tree.
 * @param {string[]} blobPaths repository-relative paths
 * @param {{ maxFiles?: number }} [opts]
 * @returns {string[]}
 */
export function pickDocumentationPaths(blobPaths = [], opts = {}) {
  const maxFiles = Number.isFinite(opts.maxFiles) ? Math.min(16, Math.max(1, opts.maxFiles)) : 12
  const normalized = (blobPaths || []).map((p) => String(p || '').replace(/\\/g, '/'))
  const lowerToOriginal = new Map()
  for (const p of normalized) {
    lowerToOriginal.set(p.toLowerCase(), p)
  }
  function take(...candidates) {
    for (const c of candidates) {
      const hit = lowerToOriginal.get(String(c).toLowerCase())
      if (hit) return hit
    }
    return null
  }
  const ordered = []
  const push = (p) => {
    if (p && !ordered.includes(p)) ordered.push(p)
  }

  push(take('README.md', 'readme.md', 'Readme.md'))
  push(take('docs/README.md', 'doc/README.md', 'documentation/README.md'))
  push(take('ARCHITECTURE.md', 'docs/ARCHITECTURE.md', 'docs/architecture.md', 'docs/Architecture.md'))
  push(take('DESIGN.md', 'docs/DESIGN.md', 'design/README.md'))
  const designFolder = normalized
    .filter((p) => /^docs\/design\//i.test(p) && /\.md$/i.test(p))
    .sort()
  for (const p of designFolder.slice(0, 4)) push(p)

  const looseDesign = normalized
    .filter((p) => /(^|\/)design\//i.test(p) && /\.md$/i.test(p) && !ordered.includes(p))
    .sort()
  for (const p of looseDesign.slice(0, 2)) push(p)

  push(take('package.json'))

  return ordered.slice(0, maxFiles)
}

function skipFrontmatterAndMainTitle(lines) {
  let i = 0
  if (lines[0]?.trim() === '---') {
    i = 1
    while (i < lines.length && lines[i]?.trim() !== '---') i++
    if (i < lines.length) i++
  }
  while (i < lines.length && !lines[i]?.trim()) i++

  if (i < lines.length && /^#\s+/.test(lines[i])) {
    i++
    while (i < lines.length && !lines[i]?.trim()) i++
  }
  return i
}

function normalizeMarkdownProse(s) {
  let out = String(s || '')
  out = out.replace(/\[(.*?)\]\([^)]*\)/g, '$1').replace(/`([^`]+)`/g, '$1')
  out = out.replace(/\s+/g, ' ').trim()
  return out
}

/**
 * Opening prose after the main title: several blank-line-separated paragraphs, until the first `##` section.
 * @param {string} raw
 * @param {{ maxParagraphs?: number, maxChars?: number }} [opts]
 */
export function extractOpeningProseFromMarkdown(raw, opts = {}) {
  const maxParagraphs = Math.min(12, Math.max(1, opts.maxParagraphs ?? 4))
  const maxChars = Math.min(8000, Math.max(200, opts.maxChars ?? 2000))
  let text = String(raw || '')
  if (text.length > 120000) text = text.slice(0, 120000)
  const lines = text.split(/\r?\n/)
  let i = skipFrontmatterAndMainTitle(lines)
  const paragraphs = []
  let stopOpening = false

  while (paragraphs.length < maxParagraphs && i < lines.length && !stopOpening) {
    const para = []
    while (i < lines.length) {
      const line = lines[i]
      const trimmed = line.trim()
      if (/^##\s/.test(trimmed)) {
        stopOpening = true
        break
      }
      if (/^#{1,6}\s/.test(trimmed) && para.length) break
      if (trimmed === '') {
        if (para.length) break
        i++
        continue
      }
      para.push(trimmed)
      i++
    }
    if (para.length) paragraphs.push(para.join(' '))
    const joined = paragraphs.join(' ')
    if (joined.length >= maxChars) break
    if (stopOpening) break
    while (i < lines.length && !lines[i]?.trim()) i++
  }

  let out = paragraphs.join(' ')
  out = normalizeMarkdownProse(out)
  return clipText(out, maxChars)
}

export function extractLeadParagraphFromMarkdown(raw) {
  return extractOpeningProseFromMarkdown(raw, { maxParagraphs: 1, maxChars: 720 })
}

function joinPurposeChunks(chunks) {
  const parts = chunks.map((c) => String(c || '').trim()).filter(Boolean)
  if (parts.length === 0) return ''
  if (parts.length === 1) return parts[0]
  return parts.join('\n\n')
}

export function extractTechnologyFromPackageJson(raw) {
  const text = stripJsonComments(String(raw || ''))
  if (!text.trim()) return []
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return []
  }
  const deps = {
    ...(parsed.dependencies || {}),
    ...(parsed.devDependencies || {}),
    ...(parsed.peerDependencies || {}),
  }
  const labels = []
  const seen = new Set()
  for (const key of Object.keys(deps)) {
    let label = NPM_DEP_LABEL[key]
    if (!label) {
      const leaf = key.includes('/') ? key.slice(key.lastIndexOf('/') + 1) : key
      label = NPM_DEP_LABEL[leaf]
    }
    if (!label) continue
    const k = label.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    labels.push(label)
  }
  return labels
}

const MD_TECH_PATTERN =
  /\b(React|Vue\.js|Vue|Angular|Svelte|Next\.js|Nuxt|Remix|Astro|Vite|Webpack|Rollup|TypeScript|JavaScript|Node\.js|Express|Fastify|NestJS|Docker|Kubernetes|Terraform|PostgreSQL|MongoDB|Redis|GraphQL|tRPC|Prisma|Firebase|Stripe|Jest|Vitest|Cypress|Playwright|Tailwind CSS)\b/gi

const KEYWORD_CANON = {
  react: 'React',
  'vue.js': 'Vue',
  vue: 'Vue',
  angular: 'Angular',
  svelte: 'Svelte',
  'next.js': 'Next.js',
  nuxt: 'Nuxt',
  remix: 'Remix',
  astro: 'Astro',
  vite: 'Vite',
  webpack: 'Webpack',
  rollup: 'Rollup',
  typescript: 'TypeScript',
  javascript: 'JavaScript',
  'node.js': 'Node.js',
  express: 'Express',
  fastify: 'Fastify',
  nestjs: 'NestJS',
  docker: 'Docker',
  kubernetes: 'Kubernetes',
  terraform: 'Terraform',
  postgresql: 'PostgreSQL',
  mongodb: 'MongoDB',
  redis: 'Redis',
  graphql: 'GraphQL',
  trpc: 'tRPC',
  prisma: 'Prisma',
  firebase: 'Firebase',
  stripe: 'Stripe',
  jest: 'Jest',
  vitest: 'Vitest',
  cypress: 'Cypress',
  playwright: 'Playwright',
  'tailwind css': 'Tailwind CSS',
}

export function extractTechnologyKeywordsFromMarkdown(raw) {
  const text = String(raw || '').slice(0, 80000)
  const found = new Set()
  const matches = text.match(MD_TECH_PATTERN) || []
  for (const m of matches) {
    const k = m.toLowerCase()
    found.add(KEYWORD_CANON[k] || m)
  }
  return [...found]
}

function uniqMergePreferred(primary, ...rest) {
  const seen = new Set()
  const out = []
  for (const list of [primary, ...rest]) {
    for (const item of list || []) {
      const k = String(item || '')
        .toLowerCase()
        .trim()
      if (!k || seen.has(k)) continue
      seen.add(k)
      out.push(item)
    }
  }
  return out
}

function scoreStackIdentification(stackLabels = []) {
  const n = stackLabels.length
  if (n >= 4) return 'high'
  if (n >= 2) return 'medium'
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
 * Derive what the project is for - prose only. Prefers README/architecture/design markdown,
 * then package.json description, then GitHub API description.
 */
export function deriveApplicationPurpose(pathTextByPath, orderedDocPaths, ghDescription, packageJsonText) {
  const chunks = []

  for (const p of orderedDocPaths) {
    if (!/\.(md|mdx)$/i.test(p)) continue
    const text = pathTextByPath[p]
    if (!text?.trim()) continue
    const para = extractOpeningProseFromMarkdown(text, { maxParagraphs: 4, maxChars: 1400 })
    if (para.length < 36) continue
    chunks.push(para)
    if (chunks.length >= 2) break
  }

  let text = joinPurposeChunks(chunks)
  if (text.length > 2600) text = clipText(text, 2600)

  if (!text?.trim() && packageJsonText) {
    try {
      const parsed = JSON.parse(stripJsonComments(packageJsonText))
      const d = parsed?.description
      if (typeof d === 'string' && d.trim().length > 16) {
        text = clipText(d.trim(), 900)
      }
    } catch {
      // ignore
    }
  }

  if (!text?.trim() && ghDescription?.trim()) {
    return { text: clipText(ghDescription.trim(), 900), sources: [] }
  }

  return { text: (text || '').trim(), sources: [] }
}

/**
 * Merge path-based stack with package.json and markdown mentions; re-score confidences.
 * @param {object} baseProfile from inferRepoProfileFromPaths
 * @param {Record<string, string>} pathTextByPath
 * @param {string[]} orderedDocPaths from pickDocumentationPaths
 * @param {string} ghDescription
 */
export function enrichRepoProfileWithDocumentation(baseProfile, pathTextByPath, orderedDocPaths, ghDescription = '') {
  const pkgPath = orderedDocPaths.find((p) => /(^|\/)package\.json$/i.test(p))
  const pkgText = pkgPath ? pathTextByPath[pkgPath] : ''

  const fromPkg = extractTechnologyFromPackageJson(pkgText)
  const fromMd = []
  for (const p of orderedDocPaths) {
    if (!/\.(md|mdx)$/i.test(p)) continue
    const t = pathTextByPath[p]
    if (!t) continue
    fromMd.push(...extractTechnologyKeywordsFromMarkdown(t))
  }

  const pathStack = Array.isArray(baseProfile.technologyStack) ? baseProfile.technologyStack : []
  const mergedStack = uniqMergePreferred(fromPkg, fromMd, pathStack)

  const purpose = deriveApplicationPurpose(pathTextByPath, orderedDocPaths, ghDescription, pkgText)

  const stackConfidence = scoreStackIdentification(mergedStack)
  const architectureConfidence = baseProfile.architectureConfidence || baseProfile.confidence || 'low'
  const confidence = minimumConfidence(architectureConfidence, stackConfidence)

  return {
    ...baseProfile,
    applicationPurpose: purpose.text,
    applicationPurposeSources: purpose.sources,
    documentationPathsRead: orderedDocPaths.filter((p) => pathTextByPath[p]?.trim()),
    technologyStackFromPackageJson: fromPkg,
    technologyStackFromDocumentation: uniqMergePreferred(fromMd, []),
    technologyStackFromPaths: pathStack,
    technologyStack: mergedStack,
    stackConfidence,
    confidence,
    profileSummary: purpose.text || baseProfile.profileSummary || '',
  }
}

/**
 * Second-pass enrich when only sparse artifact files are available (e.g. analyze replay).
 */
export function enrichRepoProfileFromDocumentationArtifacts(repoProfile, files, ghDescription = '') {
  const pathTextByPath = {}
  const candidates = []
  for (const f of files || []) {
    if (!f?.path || typeof f.content !== 'string') continue
    const norm = String(f.path).replace(/\\/g, '/')
    const low = norm.toLowerCase()
    const base = norm.includes('/') ? norm.slice(norm.lastIndexOf('/') + 1) : norm
    const baseLow = base.toLowerCase()
    if (
      /^readme\.md$/i.test(baseLow) ||
      /architecture\.md$/i.test(baseLow) ||
      /(^|\/)package\.json$/i.test(low) ||
      (/^docs\//i.test(norm) && /\.md$/i.test(norm)) ||
      (/design/i.test(baseLow) && /\.md$/i.test(baseLow))
    ) {
      pathTextByPath[norm] = f.content.slice(0, 120000)
      candidates.push(norm)
    }
  }
  const ordered = pickDocumentationPaths(candidates)
  if (!ordered.length) return repoProfile
  return enrichRepoProfileWithDocumentation(repoProfile, pathTextByPath, ordered, ghDescription)
}
