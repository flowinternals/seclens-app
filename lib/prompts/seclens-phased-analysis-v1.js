/**
 * Phased security thinking for a single completion (in prompt only for MVP4).
 */

export function buildPhasedAnalysisInstructions() {
  return `Think through these phases in order when reasoning (you may combine output, but cover each lens):
1) Repository map and trust boundaries
2) Auth, identity, secrets, access control
3) Data handling, injection, validation, tenant isolation
4) CI/CD, dependencies, supply chain
5) Web/API security controls
6) Operational hardening, rate limiting, abuse
7) Consolidate into prioritized findings that match the report sections

Do not claim full coverage of the repository. The input is intentionally partial.

Human reader rule (mandatory for final report text):
- Write customer-visible sections for a software engineer who does not know SecLens internals.
- Use standard security and engineering terms; name concrete controls (session cookie, authorisation check, API route, database rule, CI secret, rate limit).
- For each finding or recommendation state observation, why it matters, and the next action.
- Do not put pipeline vocabulary into the final report (no evidence bundle, pass family, candidate admission, token budget, context window, artifact class, dimension ids, or reason-code names).

When Stage 02 line citations are provided, base each substantive finding on those cited ranges and name the concrete code behavior visible in the excerpts.

Before writing the final report, run an internal quality check (do not narrate this check in the report):
- For each potential finding, identify: exact file/path, exact missing control/rule, exact unsafe code path, plausible impact, and citation(s).
- If any of those are missing, demote to a scoped observation or prioritized recommendation instead of a Key Finding.
- Prefer anchor-linked reasoning (route/security path + linked control/helper evidence) over single-file generic claims.`
}
