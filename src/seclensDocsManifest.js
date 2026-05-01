/**
 * Bundles repository /docs/*.md for in-app viewing (Vite ?raw).
 * Keep ORDER in sync with files under /docs at project root.
 */
const rawByRelPath = import.meta.glob('../docs/*.md', { query: '?raw', import: 'default', eager: true })

const ORDER = [
  'SECLENS-QUICKSTART.md',
  'SECLENS-USER-GUIDE.md',
  'SECLENS-FAQ.md',
  'SECLENS-TROUBLESHOOTING.md',
]

const LABEL_BY_FILE = {
  'SECLENS-QUICKSTART.md': 'Quickstart',
  'SECLENS-USER-GUIDE.md': 'User guide',
  'SECLENS-FAQ.md': 'FAQ',
  'SECLENS-TROUBLESHOOTING.md': 'Troubleshooting',
}

function entryFromKey(relPath, content) {
  const file = relPath.replace(/^.*\//, '')
  const slug = file.replace(/\.md$/i, '')
  return {
    file,
    slug,
    label: LABEL_BY_FILE[file] || slug.replace(/-/g, ' '),
    content: String(content || ''),
  }
}

export function getSeclensDocsEntries() {
  const entries = Object.entries(rawByRelPath).map(([relPath, content]) => entryFromKey(relPath, content))
  const byFile = new Map(entries.map((e) => [e.file, e]))
  return ORDER.map((file) => byFile.get(file)).filter(Boolean)
}

export function getDefaultDocsSlug() {
  const entries = getSeclensDocsEntries()
  return entries[0]?.slug || null
}
