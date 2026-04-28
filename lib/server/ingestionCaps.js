/**
 * MVP4 Stage 02 — bounded ingestion caps (env-configurable).
 */

export function getIngestionCaps() {
  const maxFiles = parseInt(process.env.SECLENS_MAX_FILES_FETCHED || '120', 10)
  const maxBytesPerFile = parseInt(process.env.SECLENS_MAX_BYTES_PER_FILE || '8000', 10)
  const maxTotalBytes = parseInt(process.env.SECLENS_MAX_TOTAL_BYTES_TO_MODEL || '300000', 10)
  const maxTreeEntries = parseInt(process.env.SECLENS_MAX_REPO_TREE_ENTRIES || '50000', 10)

  return {
    maxFiles: Number.isFinite(maxFiles) ? Math.max(1, Math.min(maxFiles, 500)) : 120,
    maxBytesPerFile: Number.isFinite(maxBytesPerFile) ? Math.max(256, Math.min(maxBytesPerFile, 2_000_000)) : 8000,
    maxTotalBytes: Number.isFinite(maxTotalBytes) ? Math.max(1024, Math.min(maxTotalBytes, 2_000_000)) : 300000,
    maxTreeEntries: Number.isFinite(maxTreeEntries) ? Math.max(100, Math.min(maxTreeEntries, 500_000)) : 50000,
  }
}
