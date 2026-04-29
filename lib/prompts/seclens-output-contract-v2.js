/**
 * Output contract v2 — section order and prompt instructions (see design archive).
 * Contract version: 2.0.4-mvp4 (DEFECT-002: consume line-addressable citations; DEFECT-006 baseline)
 */

export const OUTPUT_CONTRACT_VERSION = '2.0.5-mvp4-cr009'

/** User-facing recommendations section (CR-009). Not "Quick Wins". */
export const SECTION_PRIORITIZED_RECOMMENDATIONS = 'Prioritized Recommendations'

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
  SECTION_PRIORITIZED_RECOMMENDATIONS,
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

Under each finding include: **Category:**, **Evidence:**, **Why it matters:**, **Fix (recommended):**, **Residual risk & tests:** as appropriate (and **Exploit path:** for Critical/High per rules below).

Key Finding construction protocol (mandatory, internal reasoning):
- First form a candidate set using this schema per candidate: \`title\`, \`severity\`, \`path\`, \`missing_control_or_rule\`, \`unsafe_code_path\`, \`impact\`, \`evidence_citations\`.
- Render a candidate into **Key Findings** only if all concrete fields above are non-empty and grounded in scanned evidence.
- If a candidate is generic/advisory or any concrete field is missing, do NOT keep it as a Key Finding. Move guidance to Prioritized Recommendations/Roadmap or scoped non-finding sections.
- Never output skeletal findings (heading/category only) in Key Findings.

**Stage 02 line citations (mandatory when the prompt includes a "Mandatory line citations" section):**
- For every file path that appears there with a \`path:start-end\` range, use that **exact** canonical string in **Evidence:** and anywhere else you cite that excerpt (including **Exploit path:** when it references the same code). Do **not** write \`path:line unknown\` for those paths.
- Use \`path:line unknown\` **only** for paths listed as line-unavailable in that section, or when no manifest line exists for that path.
- **Appendix A – Evidence Index** must list the **same** \`path:start-end\` strings for the files you relied on in Key Findings — do not show accurate ranges in Appendix A but downgrade to \`line unknown\` inside the finding for the same path.

If no "Mandatory line citations" section is present (legacy fixture run), cite paths honestly; use \`path:line unknown\` when ranges are not supplied — never invent line numbers.

Inventory & Attack Surface must be understandable to non-technical readers:
- If you mention Tier 1, Tier 2, or Tier 3 counts, include a short plain-English explanation of the tiers in that same section.
- Use this meaning unless the scan context provides a newer definition:
  - Tier 1: high-signal repository/security/config files such as dependency manifests, lockfiles, CI workflows, Docker/IaC, env templates, and security policy files.
  - Tier 2: application security surface such as routes, middleware, auth code, API handlers, server-side entry points, and tests around those paths.
  - Tier 3: supporting source or project context that can help explain findings but is lower-priority when the scan budget is tight.
- Do not assume the reader knows the tier system; avoid listing tier counts without explaining what they mean.

Severity calibration (mandatory):
- Key Findings admission test: only include a Key Finding when the report can name a concrete file/path weakness (what specific control/rule is missing or incorrect, and where that code path trusts/accepts/returns/logs data without the expected guard). Generic hardening suggestions without this bar belong in Prioritized Recommendations, Roadmap, or scoped non-finding sections.
- Use **Critical** or **High** ONLY when scanned evidence supports a realistic, material abuse scenario. Random downgrades are not allowed: if the issue is uncertain, use **Medium**, **Low**, or **Info**, or **Not evidenced**.
- Reading server-side secrets from \`process.env\` alone is normal — it is NOT by itself High/Critical. Reserve High/Critical for cases such as: hardcoded secrets in source, secrets returned to clients, secrets logged to client-visible output, auth bypass, injection with clear sink, RCE path, etc.
- Use **Medium** ONLY when evidence shows a concrete weakness or missing control in a specific code path with plausible impact. Do NOT use Medium for conditional language such as "if misconfigured", "could be stronger", "consider", "review", or "ensure" unless a specific evidenced weakness is also provided.
- **High**/**Medium** validation-type findings must name a specific missing rule/control/trust boundary (for example field/schema allowlist, ownership check, auth boundary, sink sanitization), not just "validation could be stronger."
- Generic advice such as "add rate limiting", "add security headers", "audit dependencies", or "improve linting/code quality" must not appear as vulnerability-style Key Findings unless the cited evidence proves the exact missing control in reviewed runtime/config layers.
- Prefer fewer concrete findings over broad generic coverage claims. If evidence is mixed/inconclusive, emit scoped observation + Prioritized Recommendations instead of a vulnerability finding.
- Do NOT label placeholder/template config as secret leakage by itself (for example: empty env assignments, commented sample keys, setup instructions, public Firebase client config values, or secret-file paths without credential contents). Secret-exposure findings require materially stronger evidence such as populated credentials, private key material, or a concrete leak path.
- Hard stop: if evidence is only env-template files (\`.env.example\`, \`.env.sample\`, \`.env.template\`) and no populated secret material is shown, do NOT emit vulnerability-labeled findings like "Hardcoded Secrets", "Environment Variable Exposure", or "Secret Exposure". Use [Info] configuration guidance, non-finding notes, or omit the finding.
- Do NOT claim runtime controls are absent/unenforced when the only evidence is template files like \`.env.example\`, \`.env.sample\`, or \`.env.template\`. Treat these as configuration hints unless code/runtime evidence also shows enforcement gaps.
- For EVERY **Critical** or **High** finding you MUST include these lines (non-empty body for each):
  - **Exploit path:** — concrete steps from the supplied evidence showing how an attacker could abuse the issue (no invented steps).
  - **Evidence:** — must reference at least one file path from the repository slice above.
- A **Critical** or **High** finding MUST NOT contain the phrase **Not evidenced** anywhere in that finding block. If you cannot meet the bar, downgrade severity or rewrite as Not evidenced outside High/Critical.

If no security findings apply within the scanned scope, Key Findings MUST explicitly state that **no findings were identified within the scanned scope** (do not claim the repo is globally secure).

Where you lack evidence, write **Not evidenced** and what would be needed.

For non-finding sections (especially Dependency & Supply Chain Notes, CI/CD & Operational Hardening, Web Security Controls, Docker/IaC Observations, Rate Limiting & Abuse Controls, File Upload Security, Session Management): avoid broad absence claims like "No X was observed" unless you provide a basis. **Stage 02:** the phrase \`Not evidenced in scanned files.\` **alone** is insufficient — pair it with at least one of:
- **named file paths** from the scan / evidence index (or the "Scanned paths hint" list if present),
- **file categories** you actually reviewed (for example "no upload middleware in scanned \`api/\` routes"),
- an explicit **missing-category** explanation with scan boundary,
- or a **coverage statement** tied to caps/omissions from the scan context.

If you state a control is not observed, include at least one of: scanned file paths, scanned file categories/scope, or a clear coverage limitation (for example, files not included in this scan).

Appendix B may use the approved empty pattern if no standalone snippets apply:
"No standalone snippets were generated for this scan. See the fix snippets embedded in Key Findings and Prioritized Recommendations."

End of contract rules.`
}
