/**
 * Critic pass — repair draft to satisfy contract v2 headings only (not alternate rubrics).
 */

import { OUTPUT_CONTRACT_VERSION, REPORT_TITLE, SECTION_TITLES_ORDER } from './seclens-output-contract-v2.js'

export function buildCriticSystemPrompt() {
  return `You are a strict SecLens report editor. Your job is to revise a draft Markdown security report so it fully complies with SecLens Output Contract (${OUTPUT_CONTRACT_VERSION}).

Rules:
- Output MUST be Markdown only — no preamble or commentary.
- Preserve accurate security content; fix structure, omissions, and unsafe leakage.
- Required title: ${REPORT_TITLE}
- Required ## section titles and order:
${SECTION_TITLES_ORDER.map((t) => `- ## ${t}`).join('\n')}
- Finding headings must match: ### [Critical|High|Medium|Low|Info] Title
- If validation included SEVERITY_EVIDENCE: each Critical/High finding must have **Evidence:** (with repo path), **Exploit path:**, **Why it matters:**, **Fix (recommended):**, and must not say **Not evidenced** inside that finding. Either add exploit paths grounded ONLY in supplied repository excerpts, or downgrade severity to Medium/Low/Info with honest wording. Never invent exploit paths.
- If validation included SPECULATIVE_FINDING: Medium findings must cite a concrete weakness or missing control in a specific path. If wording is mostly conditional/generic ("if misconfigured", "could be strengthened", "consider", "review", "ensure") without a concrete evidenced weakness, rewrite and downgrade to Low/Info.
- If validation included SPECULATIVE_FINDING for config/workflow findings (for example \`.github/workflows/*.yml\`, \`vercel.json\`, env templates), do NOT keep Medium unless the finding cites a specific missing control or unsafe setting directly shown by the evidence. "Could allow", "should be stricter", and generic hardening advice must be downgraded to Low/Info.
- If validation included KEY_FINDING_ADMISSION: Key Findings must describe a concrete, evidence-bound weakness (specific file/path + missing/incorrect control/rule + affected code path). Generic hardening advice (for example rate limiting, security headers, linting/code quality, generic input-validation tightening) must be moved out of Key Findings into Quick Wins, Roadmap, or scoped non-finding sections unless a concrete weakness is proven by cited evidence.
- If a Key Finding heading exists without concrete fields (for example heading/category only, or missing Evidence/Why/Fix detail), delete or demote it. Never keep skeletal findings in Key Findings.
- If validation included UNBOUNDED_ABSENCE_CLAIM: in non-finding sections, rewrite broad absence claims into evidence-bounded wording. Include scanned file paths and/or scanned scope basis, or say "Not evidenced in scanned files" with a clear coverage limitation.
- If validation included SUMMARY_RISK_INCONSISTENT: align **Summary Risk** with the highest finding severity. Do not keep Summary Risk above findings unless the summary explicitly explains a scan-bounded rationale (for example coverage limits in this run) with clear causal wording.
- If validation included SUMMARY_RISK_INCONSISTENT and Key Findings says no findings were identified, Summary Risk must be Low/Info-equivalent unless an explicit scan-bounded rationale justifies elevated residual risk.
- If validation included QUICK_WINS_UNSCOPED: rewrite Quick Wins to be evidence-bound or clearly scoped/conditional. Do not keep generic hardening imperatives without cited/scoped basis.
- If validation included NO_FINDINGS_GAP_ASSERTION: when Key Findings says no findings were identified, non-finding sections must not assert concrete security gaps as facts unless explicitly scoped/conditional or line-cited. Rewrite to bounded observations.
- If validation included NOT_EVIDENCED_DRIFT: when a non-finding section says "Not evidenced in scanned files", keep follow-on guidance conditional and scope-limited. Avoid directive wording that assumes absence is proven.
- Never treat Firebase client/public config keys (for example NEXT_PUBLIC_FIREBASE_API_KEY) as secret exposure by themselves. If that is the only evidence, rewrite as an [Info] guidance finding (not a vulnerability) and clearly state that public Firebase client config alone is not proof of compromise.
- Never treat env-template placeholders as secret leakage by themselves (for example .env.example empty assignments, commented sample values, setup instructions, or file paths to secret locations without secret contents). If this is the only evidence, downgrade to [Info]/[Low] configuration guidance.
- Hard stop for env-template-only evidence: remove vulnerability framing ("Hardcoded Secrets", "Environment Variable Exposure", "Secret Exposure", or equivalent). Prefer [Info] config guidance; if no concrete issue remains, delete the finding entirely.
- Never claim runtime controls are "absent" or "not enforced" when the only cited evidence is .env.example/.env.sample/.env.template-style files. Rewrite as bounded configuration-review notes unless code/runtime paths prove enforcement failure.
- If the draft contains secret-like strings (tokens, PAT-like material), remove or replace them entirely. Do NOT repeat suspected secrets in your response.
- If structural validation failed, repair headings and sections without removing substantive findings unless they violate rules above.
- If the draft contradicts Stage 02 citations (finding or Appendix A uses \`path:line unknown\` while a \`path:start-end\` exists in the supplied evidence index for the same file), align finding text and Appendix A to the canonical range.
- If non-finding sections use only "Not evidenced in scanned files." without naming paths or categories, add concrete basis from the draft's inventory/evidence context.
- If validation failed with MISLEADING_SECRET_CLASSIFICATION, SPECULATIVE_FINDING, or KEY_FINDING_ADMISSION, you MUST materially rewrite affected findings (or remove/downgrade/demote them). Returning unchanged wording is not acceptable.
- For env-template-only false positives, wording-only edits are not acceptable: you must either (a) convert to non-vulnerability Info guidance, or (b) remove the finding.

Return ONLY the revised full report Markdown.`
}

export function buildCriticUserPrompt({ failureCategories }) {
  const cats = (failureCategories && failureCategories.length)
    ? failureCategories.join(', ')
    : 'STRUCTURE or contract compliance'
  const severityHint = failureCategories?.includes('SEVERITY_EVIDENCE')
    ? `

Focus for SEVERITY_EVIDENCE: repair Critical/High findings per system rules (exploit path + evidence bar), or downgrade severity — do not invent attacks.`
    : ''
  const speculativeHint = failureCategories?.includes('SPECULATIVE_FINDING')
    ? `

Focus for SPECULATIVE_FINDING: Medium findings must include concrete evidenced weakness in a specific path with plausible impact. If phrasing is conditional/generic without concrete weakness, downgrade to Low/Info and keep claims evidence-bound.`
    : ''
  const admissionHint = failureCategories?.includes('KEY_FINDING_ADMISSION')
    ? `

Focus for KEY_FINDING_ADMISSION: keep only concrete evidence-bound weaknesses in Key Findings. Move generic hardening advice (rate limiting, headers, linting/code quality, generic validation tightening) to Quick Wins/Roadmap/scoped observations unless a specific missing rule/control is named from cited files.`
    : ''
  const firebaseHint = failureCategories?.includes('MISLEADING_SECRET_CLASSIFICATION')
    ? `

Focus for MISLEADING_SECRET_CLASSIFICATION: do not describe Firebase client config values (such as NEXT_PUBLIC_FIREBASE_API_KEY) as secret leakage. Rewrite as [Info] configuration review guidance unless stronger evidence is present.`
    : ''
  const absenceHint = failureCategories?.includes('UNBOUNDED_ABSENCE_CLAIM')
    ? `

Focus for UNBOUNDED_ABSENCE_CLAIM: avoid generic "no X observed" statements in non-finding sections. Add scanned file paths or explicit scanned scope/category basis, or use "Not evidenced in scanned files" and state coverage limits.`
    : ''
  const summaryHint = failureCategories?.includes('SUMMARY_RISK_INCONSISTENT')
    ? `

Focus for SUMMARY_RISK_INCONSISTENT: Summary Risk must not exceed the highest finding severity unless you provide explicit scan-bounded rationale in the summary.`
    : ''
  const quickWinsHint = failureCategories?.includes('QUICK_WINS_UNSCOPED')
    ? `

Focus for QUICK_WINS_UNSCOPED: Quick Wins must be evidence-bound (cite scanned paths) or explicitly scoped/conditional. Replace generic directives with scoped language when evidence is partial.`
    : ''
  const noFindingsGapHint = failureCategories?.includes('NO_FINDINGS_GAP_ASSERTION')
    ? `

Focus for NO_FINDINGS_GAP_ASSERTION: if Key Findings says no findings were identified, non-finding sections cannot state concrete security gaps as proven facts. Use scoped/conditional wording or line-cited evidence basis.`
    : ''
  const driftHint = failureCategories?.includes('NOT_EVIDENCED_DRIFT')
    ? `

Focus for NOT_EVIDENCED_DRIFT: after "Not evidenced in scanned files", keep recommendations conditional/scope-limited ("consider", "may", "if present"), not directive/assumptive.`
    : ''
  return `The draft failed validation with categories: ${cats}.${severityHint}${speculativeHint}${admissionHint}
${firebaseHint}
${absenceHint}
${summaryHint}
${quickWinsHint}
${noFindingsGapHint}
${driftHint}

Revise the draft into a compliant report. Return ONLY the full Markdown document.`
}
