# SecLens Quickstart

## What SecLens does

SecLens provides an on-demand **security advisory** for a GitHub repository: a structured report, repository and ingestion metadata, and export options. It does **not** assert confirmed vulnerabilities or full-repo coverage.

## Before you start

You need:

- a SecLens account (register or sign in on the app)
- a GitHub repository URL
- a GitHub token **only** if the repository is private or you need authenticated GitHub API access

For private repositories, use a token with the minimum read access needed for the target repository.

## Run a scan

1. Open SecLens and **sign in** (or create an account).
2. Paste the GitHub repository URL.
3. If the repository is private, enable the private repository option and provide a GitHub token.
4. Start the scan. The app creates a **scan job** and shows progress while it runs.
5. When the job completes, read the advisory report in the main view.

## Advisory run limits

Each account has a **rolling 30-day** limit on how many advisory runs can be started. Limits differ between **Free** and **Pro**; if you hit the cap, the app will say so and you can wait, upgrade where offered, or contact support.

## Download the report

After a successful scan:

- **Markdown** and **plain text** - available from the export actions when signed in.
- **PDF** - requires an active **Pro** subscription (billing is managed under **Account -> Billing** where enabled).

## What to expect in the result

A typical completed job includes:

- the advisory report (Markdown; structured to the current **report / advisory contract** version shown in the UI or API)
- repository owner, name, branch, and scanned SHA
- ingestion metadata (how much of the repo was selected versus omitted)
- optional **telemetry**: correlation ID and model token usage (useful when reporting issues)

## Coverage and scope

SecLens does not claim full repository coverage on every run. Read the coverage summary and cap information before acting on conclusions.

## If something goes wrong

Start here:

- **Not signed in or session expired** - sign in again and retry.
- **Advisory run limit reached** - wait for the rolling window, upgrade if appropriate, or contact support.
- repository not accessible: confirm the URL and visibility.
- private repo access denied: retry with a valid read-access token.
- report failed quality checks: retry the scan.
- **PDF** rejected: confirm Pro subscription is active; try Markdown or text.
- download failed: regenerate or retry export after the report is fully loaded.

For more detail, see:

- [User Guide](./SECLENS-USER-GUIDE.md)
- [Troubleshooting](./SECLENS-TROUBLESHOOTING.md)
- [FAQ](./SECLENS-FAQ.md)
