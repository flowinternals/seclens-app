# Self-scan expected observations (SecLens MVP4 Stage 02)

Use `npm run self-scan` from the repository root before launch or after ingestion changes. Compare `.seclens-self-scan/evidence-latest.json` between runs. Each snapshot includes the full normalized **`bundle`** (selection, omitted paths/reasons, evidence excerpts with line ranges, coverage flags) plus **`apiIngestion`** summary metadata.

## What should stay stable (qualitative)

- **Strategy version** remains `v1` while the tier ruleset is frozen.
- **Tier 1 precedence** — `package.json`, lockfiles, `.github/workflows/*`, and Dockerfiles should appear ahead of arbitrary app modules when file budget is tight.
- **Caps** — with default `SECLENS_MAX_*` values, `ingestion.capHits` may list one or more limits on large repositories; coverage copy should describe partial scans honestly (no implied full-repo review).

## What will change (normal drift)

- **Counts** (`selectedFileCount`, `omittedFileCount`) as the working tree changes.
- **Citation hints** and file paths as code moves.
- **SHA / ref metadata** — local self-scan uses a fixed `local-working-tree` ref label, not a Git SHA.

For GitHub-backed scans, expect `defaultBranch`, `scannedRef`, and `scannedSha` to match the repository’s default branch and resolved commit.
