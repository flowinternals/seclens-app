import { describe, it, expect } from 'vitest'
import {
  classifyRepoPath,
  selectPathsByTiers,
  STRATEGY_VERSION,
} from '../../lib/server/fileSelection.js'

describe('fileSelection', () => {
  it('uses strategy version v1', () => {
    expect(STRATEGY_VERSION).toBe('v1')
  })

  it('classifies manifests and workflows as tier 1', () => {
    expect(classifyRepoPath('package.json').tier).toBe(1)
    expect(classifyRepoPath('services/api/package.json').tier).toBe(1)
    expect(classifyRepoPath('.github/workflows/ci.yml').tier).toBe(1)
    expect(classifyRepoPath('Dockerfile').tier).toBe(1)
  })

  it('classifies routes and middleware as tier 2', () => {
    expect(classifyRepoPath('src/routes/users.ts').tier).toBe(2)
    expect(classifyRepoPath('src/middleware/auth.ts').tier).toBe(2)
  })

  it('classifies ordinary modules as tier 3', () => {
    expect(classifyRepoPath('src/components/Button.tsx').tier).toBe(3)
    expect(classifyRepoPath('README.md').tier).toBe(3)
  })

  it('ignores vendor and dependency trees', () => {
    expect(classifyRepoPath('node_modules/foo/index.js').omit).toBe(true)
    expect(classifyRepoPath('vendor/x.go').omit).toBe(true)
  })

  it('selects deterministically: tier order then path sort', () => {
    const paths = ['z.js', 'package.json', 'src/a.js', '.github/workflows/x.yml', 'src/routes/b.ts']
    const plan = selectPathsByTiers(paths, 100)
    expect(plan.selected).toEqual([
      '.github/workflows/x.yml',
      'package.json',
      'src/routes/b.ts',
      'src/a.js',
      'z.js',
    ])
  })

  it('waterfalls tier caps: tier 1 first up to maxFiles', () => {
    const many = []
    for (let i = 0; i < 30; i++) many.push(`pkg${i}/package.json`)
    for (let i = 0; i < 30; i++) many.push(`tier3-${i}.js`)
    const plan = selectPathsByTiers(many, 15)
    expect(plan.selected.every((p) => p.endsWith('/package.json'))).toBe(true)
    expect(plan.omitted.some((o) => o.reason === 'cap')).toBe(true)
  })

  it('repeated runs produce identical selection order', () => {
    const blob = ['b.js', 'a.js', 'package.json']
    const p1 = selectPathsByTiers(blob, 10).selected.join('\n')
    const p2 = selectPathsByTiers(blob, 10).selected.join('\n')
    expect(p1).toBe(p2)
  })
})
