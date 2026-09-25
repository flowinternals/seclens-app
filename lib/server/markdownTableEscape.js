/**
 * Escape values embedded in GitHub-flavoured markdown table cells.
 * Backslashes must be escaped before pipes so `\|` cannot break column structure
 * (CodeQL js/incomplete-sanitization).
 *
 * @param {unknown} value
 * @returns {string}
 */
export function escapeMarkdownTableCell(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n+/g, ' ')
    .trim()
}
