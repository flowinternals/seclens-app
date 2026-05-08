import { describe, expect, it } from 'vitest'
import {
  buildAiIdePromptFromRecommendation,
  looksLikeRepoPath,
  validateAiIdePrompt,
  splitPromptsByValidity,
} from '../../lib/server/aiPromptQuality.js'

describe('aiPromptQuality', () => {
  it('accepts typical repo-relative paths', () => {
    expect(looksLikeRepoPath('src/app/route.ts')).toBe(true)
    expect(looksLikeRepoPath('.github/workflows/ci.yml')).toBe(true)
    expect(looksLikeRepoPath('x')).toBe(false)
  })

  it('builds a prompt object that passes validation', () => {
    const prompt = buildAiIdePromptFromRecommendation({
      recommendation: {
        title: 'Verify ownership binding',
        text:
          'Ensure project-scoped mutations verify the authenticated principal against server-side session identity before writes.',
        evidenceTarget: 'src/api/projects/update.ts:12-80',
      },
      dimensionId: 'auth_session_authorization',
      dimensionLabel: 'Auth / Session / Authorization',
      reviewedPaths: ['src/api/projects/update.ts', 'src/lib/auth/session.ts'],
      repoProfile: {
        primaryProfile: 'web_app',
        profiles: ['web_app'],
        technologyStack: ['typescript'],
        architectureSignals: ['api_handlers'],
        confidence: 'medium',
      },
    })
    expect(prompt).not.toBeNull()
    const v = validateAiIdePrompt(prompt, 'auth_session_authorization')
    expect(v.ok).toBe(true)
    expect(v.issues).toEqual([])
  })

  it('splitPromptsByValidity marks all-invalid when every prompt fails', () => {
    const bad = {
      title: 'x',
      dimensionId: 'auth_session_authorization',
      targetFiles: [],
      repoContext: '',
      reviewFocus: '',
      controlExpectation: '',
      inspectionInstructions: '',
      remediationInstructions: '',
      testInstructions: '',
      expectedOutcome: '',
      prompt: 'short',
    }
    const gate = splitPromptsByValidity([bad], 'auth_session_authorization')
    expect(gate.allInvalid).toBe(true)
    expect(gate.promptsForUser.length).toBe(0)
  })
})
