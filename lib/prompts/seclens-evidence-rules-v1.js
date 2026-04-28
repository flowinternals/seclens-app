/**
 * Shared evidence and safety rules for analysis and critic prompts.
 */

export function buildEvidenceRules() {
  return `Evidence discipline:
- Cite file paths from the repository content provided. Do not claim line numbers unless you are quoting numbered excerpts; use path:line unknown when uncertain.
- No CVE or dependency CVE claims unless package name AND version appear in provided files.
- Never echo real secrets, API keys, tokens, or JWTs. Use placeholders like [REDACTED] if needed.
- Forbidden: realistic GitHub tokens (ghp_, github_pat_), OpenAI-style sk- keys, or live-looking credentials in the report body.
- Distinguish evidence from inference; label gaps as Not evidenced.
- Do not create a vulnerability finding merely because server-side code reads an environment variable such as OPENAI_API_KEY. That is normally expected. Only flag exposure if evidence shows logging, client-side bundling, hardcoding, broad return to users, or another concrete leak path.
- Do not classify Firebase web/client config values (for example NEXT_PUBLIC_FIREBASE_API_KEY, NEXT_PUBLIC_FIREBASE_APP_ID, NEXT_PUBLIC_FIREBASE_PROJECT_ID) as secrets by themselves. These values are commonly public in client applications. Only flag Firebase issues when evidence shows private credential material (e.g., service account JSON/Admin SDK keys), overly permissive Firebase rules, or a concrete abuse path.
- Do not claim missing validation if the provided code shows validation or sanitization. If validation may be incomplete, cite the exact gap and use proportional severity.
- Severity must be proportional: use [Info] or [Low] for hygiene and hardening gaps unless there is a clear exploit path and impact in the provided evidence.`
}
