import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const vercelConfig = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8'))

function getCspHeaderValue() {
  const route = vercelConfig.headers?.find((entry) => entry.source === '/(.*)')
  const csp = route?.headers?.find((header) => header.key === 'Content-Security-Policy')
  expect(csp?.value, 'Content-Security-Policy header must be defined in vercel.json').toBeTruthy()
  return String(csp.value)
}

function parseDirective(csp, directiveName) {
  const directives = csp
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
  const match = directives.find((part) => part.startsWith(`${directiveName} `) || part === directiveName)
  expect(match, `CSP must include ${directiveName}`).toBeTruthy()
  return match.slice(directiveName.length).trim().split(/\s+/).filter(Boolean)
}

function assertContainsAll(sources, required) {
  for (const origin of required) {
    expect(sources, `missing ${origin}`).toContain(origin)
  }
}

function assertNoHostWildcards(sources) {
  for (const source of sources) {
    expect(source.includes('*'), `wildcard source not allowed: ${source}`).toBe(false)
  }
}

describe('vercel.json CSP Firebase allowlist (DEFECT-MVP5-002)', () => {
  it('allows Auth, token refresh, Firestore, and Google sign-in without host wildcards', () => {
    const csp = getCspHeaderValue()
    const connectSrc = parseDirective(csp, 'connect-src')
    const scriptSrc = parseDirective(csp, 'script-src')
    const frameSrc = parseDirective(csp, 'frame-src')
    const formAction = parseDirective(csp, 'form-action')

    assertContainsAll(connectSrc, [
      "'self'",
      'https://api.openai.com',
      'https://api.github.com',
      'https://identitytoolkit.googleapis.com',
      'https://securetoken.googleapis.com',
      'https://firestore.googleapis.com',
      'https://firebase.googleapis.com',
      'https://www.googleapis.com',
      'https://apis.google.com',
      'https://accounts.google.com',
      'https://seclens-app.firebaseapp.com',
      'wss://firestore.googleapis.com',
      'https://vercel.live',
      'wss://ws-us3.pusher.com',
    ])

    assertContainsAll(scriptSrc, [
      'https://apis.google.com',
      'https://accounts.google.com',
      'https://vercel.live',
    ])
    assertContainsAll(frameSrc, [
      'https://accounts.google.com',
      'https://seclens-app.firebaseapp.com',
      'https://vercel.live',
    ])
    assertContainsAll(formAction, [
      "'self'",
      'https://accounts.google.com',
      'https://seclens-app.firebaseapp.com',
    ])

    assertNoHostWildcards(connectSrc)
    assertNoHostWildcards(scriptSrc)
    assertNoHostWildcards(frameSrc)
    assertNoHostWildcards(formAction)
  })

  it('keeps unrelated third-party origins out of connect-src', () => {
    const connectSrc = parseDirective(getCspHeaderValue(), 'connect-src')
    expect(connectSrc).not.toContain('https://cdn.example.com')
    expect(connectSrc.some((source) => source.startsWith('https://*.'))).toBe(false)
    expect(connectSrc).not.toContain('*')
  })
})
