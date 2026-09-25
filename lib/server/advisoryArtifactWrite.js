/**
 * Contained local writes for advisory/QA artifacts.
 * Paths are forced under a resolved root; filenames are basename-slugged.
 */

import { mkdirSync, writeFileSync } from 'fs'
import { basename, join, resolve, sep } from 'path'

/**
 * @param {string} rootDir Absolute or relative directory that must contain the file
 * @param {string} fileName File name only (path separators stripped via basename)
 * @returns {string} Absolute path under rootDir
 */
export function resolveContainedArtifactPath(rootDir, fileName) {
  const root = resolve(rootDir)
  const safeName = basename(String(fileName || 'artifact').replace(/[^a-zA-Z0-9._-]+/g, '_')) || 'artifact'
  const outPath = resolve(join(root, safeName))
  const rootPrefix = root.endsWith(sep) ? root : `${root}${sep}`
  if (outPath !== root && !outPath.startsWith(rootPrefix)) {
    throw new Error('advisory artifact path escapes root directory')
  }
  return outPath
}

/**
 * Write UTF-8 text under a fixed root. Callers must only pass intentional advisory/QA payloads
 * (scan telemetry, live-validation snapshots, quality-gate debug) — never remote executables.
 *
 * @param {string} rootDir
 * @param {string} fileName
 * @param {string} utf8Text
 * @returns {string} Absolute path written
 */
export function writeContainedUtf8Artifact(rootDir, fileName, utf8Text) {
  const root = resolve(rootDir)
  mkdirSync(root, { recursive: true })
  const outPath = resolveContainedArtifactPath(root, fileName)
  const text = String(utf8Text ?? '')
  // Intentional local persistence of advisory/QA metadata (not executed as code).
  writeFileSync(outPath, text, 'utf8') // codeql[js/http-to-file-access]
  return outPath
}
