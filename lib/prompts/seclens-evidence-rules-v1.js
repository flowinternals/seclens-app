/**
 * Shared evidence and safety rules for analysis and critic prompts.
 */

export function buildEvidenceRules() {
  return `Evidence discipline:
- When the prompt includes **Mandatory line citations (Stage 02)**, treat those \`path:start-end\` strings as authoritative for the bounded excerpts. Copy them verbatim into findings and Appendix A. Do not substitute \`path:line unknown\` where a canonical range exists.
- For Critical/High findings, tie **Exploit path:** and narrative to those same code paths and ranges — avoid generic policy-only wording when bounded code excerpts are supplied.
- Cite file paths from the repository content provided. If no manifest range exists for a path, use \`path:line unknown\` or describe the excerpt honestly — never invent numeric line numbers.
- No CVE or dependency CVE claims unless package name AND version appear in provided files.
- Never echo real secrets, API keys, tokens, or JWTs. Use placeholders like [REDACTED] if needed.
- Forbidden: realistic GitHub tokens (ghp_, github_pat_), OpenAI-style sk- keys, or live-looking credentials in the report body.
- Distinguish evidence from inference; label gaps as Not evidenced.
- Do not create a vulnerability finding merely because server-side code reads an environment variable such as OPENAI_API_KEY. That is normally expected. Only flag exposure if evidence shows logging, client-side bundling, hardcoding, broad return to users, or another concrete leak path.
- Do not classify Firebase web/client config values (for example NEXT_PUBLIC_FIREBASE_API_KEY, NEXT_PUBLIC_FIREBASE_APP_ID, NEXT_PUBLIC_FIREBASE_PROJECT_ID) as secrets by themselves. These values are commonly public in client applications. Only flag Firebase issues when evidence shows private credential material (e.g., service account JSON/Admin SDK keys), overly permissive Firebase rules, or a concrete abuse path.
- Do not treat placeholder/template configuration as secret exposure by itself. Placeholder indicators include empty assignments, obvious sample values, commented examples, setup instructions, and paths that reference secret files without including secret contents.
- Hard stop for env-template-only evidence: when evidence is limited to .env.example/.env.sample/.env.template-style files and shows placeholders/instructions/variable names/path references without populated secret material, do NOT emit vulnerability framing such as "Hardcoded Secrets", "Environment Variable Exposure", or "Secret Exposure". Use Info/config-review guidance, non-finding notes, or no finding.
- Do not claim a runtime control is absent or unenforced when the only evidence is template documentation such as .env.example/.env.sample/.env.template files. Those files can support scoped configuration notes, not concrete enforcement-failure findings.
- Do not claim missing validation if the provided code shows validation or sanitization. If validation may be incomplete, cite the exact gap and use proportional severity.
- Severity must be proportional: use [Info] or [Low] for hygiene and hardening gaps unless there is a clear exploit path and impact in the provided evidence.`
}
