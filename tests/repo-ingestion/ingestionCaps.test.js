import { describe, expect, it } from 'vitest'
import { getIngestionCaps, getRetrievalPolicy } from '../../lib/server/ingestionCaps.js'

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
      maxFiles: 900,
      maxBytesPerFile: 500000,
      maxTotalBytes: 12000000,
      maxTreeEntries: 300000,
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

describe('getRetrievalPolicy', () => {
  it('defaults to recall-first when no retrieval env is set', () => {
    const prevMode = process.env.SECLENS_VALIDATION_MODE
    const prevRecall = process.env.SECLENS_RECALL_FIRST_VALIDATION
    delete process.env.SECLENS_VALIDATION_MODE
    delete process.env.SECLENS_RECALL_FIRST_VALIDATION

    const policy = getRetrievalPolicy()
    expect(policy).toEqual({ validationMode: 'recall_first', recallFirst: true })

    if (prevMode === undefined) delete process.env.SECLENS_VALIDATION_MODE
    else process.env.SECLENS_VALIDATION_MODE = prevMode
    if (prevRecall === undefined) delete process.env.SECLENS_RECALL_FIRST_VALIDATION
    else process.env.SECLENS_RECALL_FIRST_VALIDATION = prevRecall
  })

  it('allows explicit disable via SECLENS_RECALL_FIRST_VALIDATION=false', () => {
    const prevMode = process.env.SECLENS_VALIDATION_MODE
    const prevRecall = process.env.SECLENS_RECALL_FIRST_VALIDATION
    delete process.env.SECLENS_VALIDATION_MODE
    process.env.SECLENS_RECALL_FIRST_VALIDATION = 'false'

    const policy = getRetrievalPolicy()
    expect(policy).toEqual({ validationMode: 'balanced', recallFirst: false })

    if (prevMode === undefined) delete process.env.SECLENS_VALIDATION_MODE
    else process.env.SECLENS_VALIDATION_MODE = prevMode
    if (prevRecall === undefined) delete process.env.SECLENS_RECALL_FIRST_VALIDATION
    else process.env.SECLENS_RECALL_FIRST_VALIDATION = prevRecall
  })
})
