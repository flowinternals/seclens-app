import { mkdirSync, writeFileSync, readFileSync, copyFileSync, existsSync } from 'fs'
import { join, resolve } from 'path'

export function createRunArtifactDir(repoRoot, runId) {
  const dir = resolve(repoRoot, '.seclens-live-validation', 'spo-oracle', runId)
  mkdirSync(dir, { recursive: true })
  return dir
}

export function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

export function writeText(path, value) {
  writeFileSync(path, String(value ?? ''), 'utf8')
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

/**
 * Verified promotion to Assets. Returns paths or throws.
 */
export function promoteOutcomeToAssets({
  localOutcomePath,
  assetsRoot,
  fileName,
}) {
  if (!assetsRoot) {
    throw new Error('SECLENS_ASSETS_ROOT is required for canonical promotion')
  }
  if (!localOutcomePath || !existsSync(localOutcomePath)) {
    throw new Error(`Local outcome missing: ${localOutcomePath}`)
  }
  const destDir = resolve(assetsRoot, 'testing', 'unit-acceptance-criteria')
  mkdirSync(destDir, { recursive: true })
  const destPath = join(destDir, fileName)
  copyFileSync(localOutcomePath, destPath)
  const localBody = readFileSync(localOutcomePath, 'utf8')
  const destBody = readFileSync(destPath, 'utf8')
  if (localBody !== destBody) {
    throw new Error(`Canonical write verification failed for ${destPath}`)
  }
  return { canonicalOutcomePath: destPath }
}

/**
 * Fail if Playwright output dirs contain known secrets.
 */
export function assertArtifactsDoNotContainSecrets(dirPaths, secrets = []) {
  const needles = secrets.map((s) => String(s || '').trim()).filter((s) => s.length >= 8)
  if (!needles.length) return
  for (const dir of dirPaths) {
    if (!dir || !existsSync(dir)) continue
    // Shallow check of common Playwright files only (avoid huge walks in unit use).
    const names = ['trace.zip', 'video.webm', 'error-context.md', 'test-failed-1.png']
    for (const name of names) {
      const p = join(dir, name)
      if (!existsSync(p)) continue
      // binary-safe-ish: read as utf8 and search; zip may not decode cleanly but still catches plaintext dumps
      try {
        const body = readFileSync(p, 'utf8')
        for (const needle of needles) {
          if (body.includes(needle)) {
            throw new Error(`Secret material found in Playwright artifact: ${p}`)
          }
        }
      } catch (err) {
        if (String(err.message || '').includes('Secret material')) throw err
      }
    }
  }
}
