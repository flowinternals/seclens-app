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

When Stage 02 line citations are provided, ground each substantive finding in those cited ranges and name the concrete code behavior visible in the excerpts.

Before writing the final report, run an internal admission pass:
- For each potential finding, identify: exact file/path, exact missing control/rule, exact unsafe code path, plausible impact, and citation(s).
- If any of those are missing, demote to scoped observation/Quick Wins instead of Key Findings.
- Prefer anchor-linked reasoning (anchor route/security path + linked control/helper evidence) over single-file generic claims.`
}
