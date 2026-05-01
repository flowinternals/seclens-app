/**
 * Static import / require resolution for repo-relative paths (CR-2.1-003 / DEFECT-003 shortlist expansion).
 */

import { posix as pathPosix } from 'path'
import { normalizeRepoPath } from './repoInventory.js'

function dirnamePosix(p) {
  const path = normalizeRepoPath(p)
  const idx = path.lastIndexOf('/')
  return idx === -1 ? '' : path.slice(0, idx)
}

/**
 * @param {string} text
 * @returns {string[]}
 */
export function parseImportSpecifiers(text) {
  const out = []
  if (!text) return out
  const importRe = /import\s+[^'"]*?from\s+['"]([^'"]+)['"]/g
  const dynamicImportRe = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  const requireRe = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  let m
  while ((m = importRe.exec(text))) out.push(m[1])
  while ((m = dynamicImportRe.exec(text))) out.push(m[1])
  while ((m = requireRe.exec(text))) out.push(m[1])
  return out
}

/**
 * @param {string} anchorPath normalized repo path
 * @param {string} spec import string
 * @param {Set<string> | Iterable<string>} eligiblePaths
 * @param {string[]} [aliasAtRoots]
 * @returns {string | null}
 */
export function resolveImportToRepoPath(anchorPath, spec, eligiblePaths, aliasAtRoots = []) {
  const eligibleSet = eligiblePaths instanceof Set ? eligiblePaths : new Set(eligiblePaths)
  const tryCandidates = (base) => {
    const candidates = [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      `${base}.js`,
      `${base}.jsx`,
      `${base}.mjs`,
      `${base}.cjs`,
      `${base}/index.ts`,
      `${base}/index.tsx`,
      `${base}/index.js`,
      `${base}/index.jsx`,
      `${base}/index.mjs`,
      `${base}/index.cjs`,
    ]
    for (const c of candidates) {
      if (eligibleSet.has(c)) return c
    }
    return null
  }

  if (spec.startsWith('./') || spec.startsWith('../')) {
    const base = pathPosix.normalize(pathPosix.join(dirnamePosix(anchorPath), spec))
    return tryCandidates(base)
  }
  if (spec.startsWith('@/')) {
    const fromRoot = spec.slice(2)
    for (const aliasRootRaw of aliasAtRoots) {
      const aliasRoot = String(aliasRootRaw || '').replace(/^\/+|\/+$/g, '')
      const base = aliasRoot ? `${aliasRoot}/${fromRoot}` : fromRoot
      const hit = tryCandidates(base)
      if (hit) return hit
    }
    return null
  }
  return null
}
