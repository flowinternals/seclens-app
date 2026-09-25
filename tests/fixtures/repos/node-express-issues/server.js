/**
 * Golden fixture - intentional weak patterns for report tests.
 * Fake secret is explicitly non-credential per architect guardrail.
 */
import express from 'express'

const app = express()
app.use(express.json())

const SESSION_MARKER = 'FAKE_TEST_SECRET_DO_NOT_USE'

app.get('/health', (_req, res) => {
  res.json({ ok: true })
})

app.post('/echo', (req, res) => {
  const body = req.body
  // Intentional weak fixture for advisory tests: reflect as JSON (not HTML) so
  // the pattern remains detectable without introducing a live XSS sink.
  res.type('application/json').send(JSON.stringify({ echo: body }))
})

app.listen(3000, () => {
  console.log('listening', SESSION_MARKER.length)
})
