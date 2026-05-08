/**
 * MVP4 Stage 02 - repository inventory from flat path list / tree blobs.
 */

const TEXT_LIKE_EXT = /\.(md|txt|adoc|rst|json|ya?ml|toml|graphql|properties|gradle|xml|plist|cnf|conf|ini|env)$/i

/**
 * GitHub tree omits trailing slashes on files; normalized paths use forward slashes.
 * @param {string} path
 */
export function normalizeRepoPath(path) {
  return String(path || '').replace(/\\/g, '/').replace(/^\.\//, '')
}

/**
 * Rough binary hint by extension - full binary handling also occurs at fetch/decoding.
 * @param {string} path
 */
export function looksBinaryExtension(path) {
  const base = path.split('/').pop() || ''
  if (/\.(png|jpe?g|gif|webp|ico|bmp|pdf|docx?|xlsx?|pptx?|zip|tar|gz|tgz|7z|rar|exe|dll|so|dylib|woff2?|ttf|eot|mp3|mp4|webm|mov|avi|mkv|sqlite|db|bin)$/i.test(base)) {
    return true
  }
  if (/\.(lock|sum)$/i.test(base) && !/yarn\.lock$/i.test(base)) {
    return false
  }
  return /\.(jpg|jpeg)$/i.test(path)
}

/**
 * @typedef {{ tier1: number, tier2: number, tier3: number }} TierCounts
 * @param {string[]} paths normalized blob paths
 * @param {(p: string) => { tier: 1|2|3|null, omit?: boolean }} classify
 * @returns {{ totalFilesSeen: number, filesEligibleByTier: TierCounts }}
 */
export function countEligibleByTier(paths, classify) {
  const filesEligibleByTier = { tier1: 0, tier2: 0, tier3: 0 }
  let totalFilesSeen = 0

  for (const p of paths) {
    totalFilesSeen++
    const c = classify(p)
    if (c.omit || c.tier == null) continue
    if (c.tier === 1) filesEligibleByTier.tier1++
    else if (c.tier === 2) filesEligibleByTier.tier2++
    else filesEligibleByTier.tier3++
  }

  return { totalFilesSeen, filesEligibleByTier }
}

export { TEXT_LIKE_EXT }
