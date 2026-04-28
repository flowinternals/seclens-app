import { describe, expect, it } from 'vitest'
import { getIngestionCaps } from '../../lib/server/ingestionCaps.js'

describe('getIngestionCaps', () => {
  it('uses Stage 02 launch defaults when env is unset', () => {
    const prev = {
      files: process.env.SECLENS_MAX_FILES_FETCHED,
      perFile: process.env.SECLENS_MAX_BYTES_PER_FILE,
      total: process.env.SECLENS_MAX_TOTAL_BYTES_TO_MODEL,
      tree: process.env.SECLENS_MAX_REPO_TREE_ENTRIES,
    }
    delete process.env.SECLENS_MAX_FILES_FETCHED
    delete process.env.SECLENS_MAX_BYTES_PER_FILE
    delete process.env.SECLENS_MAX_TOTAL_BYTES_TO_MODEL
    delete process.env.SECLENS_MAX_REPO_TREE_ENTRIES

    const caps = getIngestionCaps()

    expect(caps).toEqual({
      maxFiles: 120,
      maxBytesPerFile: 8000,
      maxTotalBytes: 300000,
      maxTreeEntries: 50000,
    })

    if (prev.files === undefined) delete process.env.SECLENS_MAX_FILES_FETCHED
    else process.env.SECLENS_MAX_FILES_FETCHED = prev.files
    if (prev.perFile === undefined) delete process.env.SECLENS_MAX_BYTES_PER_FILE
    else process.env.SECLENS_MAX_BYTES_PER_FILE = prev.perFile
    if (prev.total === undefined) delete process.env.SECLENS_MAX_TOTAL_BYTES_TO_MODEL
    else process.env.SECLENS_MAX_TOTAL_BYTES_TO_MODEL = prev.total
    if (prev.tree === undefined) delete process.env.SECLENS_MAX_REPO_TREE_ENTRIES
    else process.env.SECLENS_MAX_REPO_TREE_ENTRIES = prev.tree
  })
})
