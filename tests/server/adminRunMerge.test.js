import { describe, expect, it } from 'vitest'
import { mergePersistedRunWithInMemoryJob } from '../../lib/server/adminRunMerge.js'

describe('mergePersistedRunWithInMemoryJob', () => {
  it('returns persisted when memory is absent', () => {
    const p = { runId: '1', status: 'SUCCESS' }
    expect(mergePersistedRunWithInMemoryJob(p, null)).toBe(p)
  })

  it('returns memory when persisted is absent', () => {
    const m = { jobId: '1', dashboard: { dimensions: [{ id: 'a' }], runState: 'completed' } }
    expect(mergePersistedRunWithInMemoryJob(null, m)).toBe(m)
  })

  it('overlays dashboard from memory when Firestore run lacks dimension payloads', () => {
    const persisted = { runId: 'r1', status: 'SUCCESS' }
    const mem = {
      jobId: 'r1',
      dashboard: {
        runState: 'completed',
        dimensions: [{ dimensionId: 'd1', label: 'Auth' }],
      },
    }
    const out = mergePersistedRunWithInMemoryJob(persisted, mem)
    expect(out.dashboard).toBe(mem.dashboard)
  })

  it('does not replace persisted dashboard that already has dimensions', () => {
    const dash = { dimensions: [{ dimensionId: 'p' }], runState: 'completed' }
    const persisted = { runId: 'r1', dashboard: dash }
    const mem = {
      jobId: 'r1',
      dashboard: { dimensions: [{ dimensionId: 'm' }], runState: 'completed' },
    }
    const out = mergePersistedRunWithInMemoryJob(persisted, mem)
    expect(out.dashboard).toBe(dash)
  })
})
