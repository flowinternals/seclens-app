/**
 * Output contract v2 — section order and prompt instructions (see design archive).
 * Contract version: 2.0.3-mvp4 (DEFECT-006: bounded non-finding basis)
 */

export const OUTPUT_CONTRACT_VERSION = '2.0.3-mvp4'

/** Normalized ## titles in required order (compare via normalizeSectionTitle). */
export const SECTION_TITLES_ORDER = [
  'Executive Summary',
  'Inventory & Attack Surface',
  'Key Findings (Prioritized)',
  'Dependency & Supply Chain Notes',
  'CI/CD & Operational Hardening',
  'Web Security Controls',
  'Docker/IaC Observations',
  'Rate Limiting & Abuse Controls',
  'File Upload Security',
  'Session Management',
  'Quick Wins (Do These First)',
  'Roadmap & Success Criteria',
  'Confidence & Coverage',
  'Appendix A – Evidence Index',
  'Appendix B – Safe Config & Policy Snippets',
]

export const REPORT_TITLE = '# SecLens Security Report'

export function buildContractInstructions() {
  return `You MUST output a single Markdown document that obeys SecLens Output Contract v2 (${OUTPUT_CONTRACT_VERSION}).

Report title line (exact): ${REPORT_TITLE}

Immediately under the title, include this metadata block. Use the exact repository/ref/generated values supplied in the scan context when present:
- **Repository:** {owner}/{name} ({url})
- **Ref:** {git ref or branch, or "unknown" if not available}
- **Generated:** {ISO-8601 timestamp}
- **Languages:** {comma-separated list or "Unknown"}
- **Summary Risk:** {Critical|High|Medium|Low} — one sentence rationale.

Then include ALL of the following ## sections **in this exact order** (do not rename, merge, or skip):
${SECTION_TITLES_ORDER.map((t) => `## ${t}`).join('\n')}

Finding format (inside Key Findings): each finding MUST use a bracketed severity heading:
### [Critical] Title  OR  ### [High] Title  OR  ### [Medium] Title  OR  ### [Low] Title  OR  ### [Info] Title
Use [Info] only for advisory/hygiene items, not vulnerability claims.

Under each finding include: **Category:**, **Evidence:**, **Why it matters:**, **Fix (recommended):**, **Residual risk & tests:** as appropriate.
Evidence must cite repository paths. Until line-accurate ingestion exists, use \`path/to/file:line unknown\` or describe an excerpt honestly — do NOT invent numeric line numbers.

Severity calibration (mandatory):
- Use **Critical** or **High** ONLY when scanned evidence supports a realistic, material abuse scenario. Random downgrades are not allowed: if the issue is uncertain, use **Medium**, **Low**, or **Info**, or **Not evidenced**.
- Reading server-side secrets from \`process.env\` alone is normal — it is NOT by itself High/Critical. Reserve High/Critical for cases such as: hardcoded secrets in source, secrets returned to clients, secrets logged to client-visible output, auth bypass, injection with clear sink, RCE path, etc.
- Use **Medium** ONLY when evidence shows a concrete weakness or missing control in a specific code path with plausible impact. Do NOT use Medium for conditional language such as "if misconfigured", "could be stronger", "consider", "review", or "ensure" unless a specific evidenced weakness is also provided.
- For EVERY **Critical** or **High** finding you MUST include these lines (non-empty body for each):
  - **Exploit path:** — concrete steps from the supplied evidence showing how an attacker could abuse the issue (no invented steps).
  - **Evidence:** — must reference at least one file path from the repository slice above.
- A **Critical** or **High** finding MUST NOT contain the phrase **Not evidenced** anywhere in that finding block. If you cannot meet the bar, downgrade severity or rewrite as Not evidenced outside High/Critical.

If no security findings apply within the scanned scope, Key Findings MUST explicitly state that **no findings were identified within the scanned scope** (do not claim the repo is globally secure).

Where you lack evidence, write **Not evidenced** and what would be needed.

For non-finding sections (especially Dependency & Supply Chain Notes, CI/CD & Operational Hardening, Web Security Controls, Docker/IaC Observations, Rate Limiting & Abuse Controls, File Upload Security, Session Management): avoid broad absence claims like "No X was observed" unless you provide a basis. If you state a control is not observed, include at least one of:
- scanned file paths,
- scanned file categories/scope,
- explicit wording like "Not evidenced in scanned files",
- a clear coverage limitation (for example, files not included in this scan).

Appendix B may use the approved empty pattern if no standalone snippets apply:
"No standalone snippets were generated for this scan. See the fix snippets embedded in Key Findings and the actions in Quick Wins."

End of contract rules.`
}
