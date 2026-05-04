import { describe, it, expect } from 'vitest'
import { sanitizeMarkdown } from '../../lib/server/sanitize.js'

describe('sanitizeMarkdown (dangerous URL schemes)', () => {
  it('neutralizes javascript:, data:, and vbscript: in markdown links', () => {
    expect(sanitizeMarkdown('[x](javascript:alert(1))')).toBe('[x](#)')
    expect(sanitizeMarkdown('[x](vbscript:msgbox(1))')).toBe('[x](#)')
    expect(sanitizeMarkdown('[x](DATA:text/html,<p>x</p>)')).toBe('[x](#)')
  })

  it('neutralizes obfuscated javascript scheme (entity + whitespace)', () => {
    expect(sanitizeMarkdown('[x](java&#115;cript:alert(1))')).toBe('[x](#)')
    expect(sanitizeMarkdown('[x](java script:alert(1))')).toBe('[x](#)')
    expect(sanitizeMarkdown('[x](javascript&#58;alert(1))')).toBe('[x](#)')
  })

  it('preserves http(s), mailto, relative, and fragment targets', () => {
    expect(sanitizeMarkdown('[ok](https://example.com)')).toBe('[ok](https://example.com)')
    expect(sanitizeMarkdown('[ok](HTTP://example.com/path)')).toBe('[ok](HTTP://example.com/path)')
    expect(sanitizeMarkdown('[e](mailto:a@b.co)')).toBe('[e](mailto:a@b.co)')
    expect(sanitizeMarkdown('[r](/docs)')).toBe('[r](/docs)')
    expect(sanitizeMarkdown('[a](#x)')).toBe('[a](#x)')
  })

  it('rewrites dangerous href and src in simple HTML', () => {
    expect(sanitizeMarkdown('<a href="javascript:alert(1)">t</a>')).toBe('<a href="#">t</a>')
    expect(sanitizeMarkdown("<a href='data:text/html,x'>t</a>")).toBe("<a href='#'>t</a>")
    expect(sanitizeMarkdown('<img src="javascript:alert(1)" alt="x" />')).toBe(
      '<img src="#" alt="x" />'
    )
  })

  it('still strips script, iframe, and strips inline event handler prefixes', () => {
    expect(sanitizeMarkdown('<script>1</script>hi')).toBe('hi')
    expect(sanitizeMarkdown('<iframe src="x"></iframe>')).toBe('')
    const withClick = sanitizeMarkdown('<a href="https://a" onclick="bad()">x</a>')
    expect(withClick).not.toContain('onclick')
    expect(withClick).toContain('https://a')
  })

  it('strips nested and obfuscated script openings (no regex tag-strip bypass)', () => {
    expect(sanitizeMarkdown('<script><script>alert(1)</script></script>')).toBe('')
    expect(sanitizeMarkdown('<ScRiPt>x</ScRiPt>y')).toBe('y')
    expect(sanitizeMarkdown('<scr<script>ipt>1</script>')).toBe('<scr')
  })

  it('strips iframes with attributes and leaves safe tags', () => {
    expect(sanitizeMarkdown('<p>ok</p><iframe src="https://e"></iframe>')).toBe('<p>ok</p>')
    expect(sanitizeMarkdown('before<IFRAME src=x></IFRAME>after')).toBe('beforeafter')
  })

  it('does not strip non-handler attributes that contain the letters "on" (e.g. longitude)', () => {
    const s = sanitizeMarkdown('<a href="https://a" data-longitude="10">m</a>')
    expect(s).toContain('data-longitude="10"')
    expect(s).toContain('https://a')
  })
})
