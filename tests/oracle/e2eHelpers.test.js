import { describe, expect, it } from 'vitest'
import {
  buildScanUrl,
  evaluateBaselineGuard,
  parseGithubRepoUrl,
} from '../e2e/helpers/baseline.js'
import { pollScanJobUntilTerminal } from '../e2e/helpers/pollJob.js'
import { resolveE2eTarget, parseGithubSecretsFile, loadGithubTokenForTarget } from '../e2e/helpers/target.js'

describe('baseline guard', () => {
  it('strict fails on SHA drift', () => {
    const result = evaluateBaselineGuard({
      resolvedSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      baselineSha: '8bbb1efaf2cfa638f66fbf769a4c6ddda1cbc4da',
      mode: 'strict',
    })
    expect(result.proceed).toBe(false)
    expect(result.baselineComparison).toBe('baseline_changed')
  })

  it('allow-drift proceeds with baseline_changed', () => {
    const result = evaluateBaselineGuard({
      resolvedSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      baselineSha: '8bbb1efaf2cfa638f66fbf769a4c6ddda1cbc4da',
      mode: 'allow-drift',
    })
    expect(result.proceed).toBe(true)
    expect(result.baselineComparison).toBe('baseline_changed')
  })

  it('proceeds unverified when no baseline SHA is configured', () => {
    const result = evaluateBaselineGuard({
      resolvedSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      baselineSha: null,
      mode: 'strict',
    })
    expect(result.proceed).toBe(true)
    expect(result.baselineComparison).toBe('unverified')
  })

  it('builds SHA-pinned URL in strict mode', () => {
    expect(
      buildScanUrl({ owner: 'github', repo: 'brakeman', sha: 'abc123', mode: 'strict' })
    ).toContain('/tree/abc123')
  })

  it('parses github tree URLs', () => {
    expect(parseGithubRepoUrl('https://github.com/github/brakeman')).toEqual({
      owner: 'github',
      repo: 'brakeman',
      ref: null,
      url: 'https://github.com/github/brakeman',
    })
  })
})

describe('resolveE2eTarget / github secrets', () => {
  it('uses SECLENS_E2E_REPO_URL when set', () => {
    const prev = process.env.SECLENS_E2E_REPO_URL
    process.env.SECLENS_E2E_REPO_URL = 'https://github.com/github/securitylab'
    try {
      const t = resolveE2eTarget()
      expect(t.owner).toBe('github')
      expect(t.repo).toBe('securitylab')
      expect(t.isPrivate).toBe(false)
    } finally {
      if (prev == null) delete process.env.SECLENS_E2E_REPO_URL
      else process.env.SECLENS_E2E_REPO_URL = prev
    }
  })

  it('binds spekify PAT from github.txt line with url + token', () => {
    const parsed = parseGithubSecretsFile(
      'D:/Assets/flowinternals-seclens-app-Assets/security/secrets/github.txt'
    )
    const spekify = parsed.repoTokens.find(
      (e) => e.owner === 'flowinternals' && e.repo === 'spekify-app'
    )
    expect(spekify?.token).toMatch(/^ghp_/)
    const token = loadGithubTokenForTarget({
      owner: 'flowinternals',
      repo: 'spekify-app',
    })
    expect(token).toBe(spekify.token)
  })

  it('binds SPO PAT from itc2-pat.txt (token + url on separate lines)', () => {
    const parsed = parseGithubSecretsFile(
      'D:/Assets/flowinternals-seclens-app-Assets/security/secrets/itc2-pat.txt'
    )
    const spo = parsed.repoTokens.find(
      (e) => e.owner === 'ITC2-AUS' && e.repo === 'SPO_Management'
    )
    expect(spo?.token).toMatch(/^github_pat_/)
    const token = loadGithubTokenForTarget({
      owner: 'ITC2-AUS',
      repo: 'SPO_Management',
    })
    expect(token).toBe(spo.token)
  })
})

describe('pollScanJobUntilTerminal', () => {
  it('returns completed payload and respects jobId', async () => {
    let calls = 0
    const result = await pollScanJobUntilTerminal({
      baseUrl: 'http://example.test',
      jobId: 'job-1',
      absoluteDeadlineMs: 5000,
      initialIntervalMs: 1,
      maxIntervalMs: 1,
      sleep: async () => {},
      getAuthHeaders: async () => ({ Authorization: 'Bearer x' }),
      fetchImpl: async () => {
        calls += 1
        if (calls === 1) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ jobId: 'job-1', status: 'running' }),
          }
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            jobId: 'job-1',
            status: 'completed',
            analysisModel: 'gpt-5-nano',
            report: '# ok',
          }),
        }
      },
    })
    expect(result.status).toBe('completed')
    expect(result.payload.analysisModel).toBe('gpt-5-nano')
  })
})
