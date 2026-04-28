/**
 * Load a synthetic repo tree for tests (golden fixtures).
 */

import { readFileSync, readdirSync } from 'fs'
import { join, relative } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

function walkFiles(dir) {
  const out = []
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name)
    if (ent.isDirectory()) {
      out.push(...walkFiles(p))
    } else {
      out.push(p)
    }
  }
  return out
}

/**
 * @param {'tiny-react-safe'|'node-express-issues'} name
 */
export function buildRepoDataFromFixture(name) {
  const root = join(__dirname, 'repos', name)
  const absFiles = walkFiles(root)
  const files = absFiles.map((abs) => ({
    path: relative(root, abs).replace(/\\/g, '/'),
    content: readFileSync(abs, 'utf8'),
  }))
  return {
    owner: 'fixture',
    repo: name,
    description: `Golden fixture: ${name}`,
    language: 'JavaScript',
    url: `https://github.com/fixture/${name}`,
    files,
  }
}
