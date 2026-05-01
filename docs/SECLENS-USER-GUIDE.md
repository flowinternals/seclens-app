# SecLens User Guide

## Overview

SecLens is a web application that analyzes a GitHub repository and produces a structured security report oriented toward **launch-readiness style** risk and hygiene. It is designed to give you a fast, **evidence-based snapshot** of repository risk without replacing a full manual review.

SecLens is most useful when you want to:

- get an initial security read on a repository
- review likely weaknesses in application or configuration code
- capture a reusable report for sharing or follow-up work
- compare results across repeated scans

## What SecLens analyzes

SecLens analyzes repository content fetched from GitHub and builds a report from selected evidence. The application also returns repository metadata and ingestion details that help explain what was scanned.

The scan output can include:

- a Markdown security report (versioned **report contract**; validated before you see it)
- repository URL, owner, name, language, default branch, scanned ref, and scanned SHA
- ingestion strategy metadata (for example **Stage 02**, `strategyVersion` **v2**)
- selected and omitted file counts
- coverage notes and cap-hit indicators
- **Telemetry** such as a correlation ID and token usage (draft, optional critic pass, totals), when exposed by your deployment

SecLens also performs a pre-scan eligibility pass. Non-germane files such as Markdown and plain-text documentation, PDFs, Office documents, images, and video or media assets are excluded before the security-relevant file counts are calculated.

## Supported repository types

SecLens can be used with:

- public GitHub repositories
- private GitHub repositories when the user provides valid read access

If a private repository cannot be accessed, the scan will fail and should be retried with the correct repository permissions.

## Private repository access

If you scan a private repository, SecLens may require a GitHub token.

Use a token that:

- has read access to the target repository
- is limited in scope to what is needed
- is not broader than necessary

Good practice:

- use a dedicated token for scanning
- avoid using a personal token with unnecessary write or admin access
- rotate the token if you suspect it has been exposed elsewhere

## How to run a scan

### 1. Enter the repository URL

Paste the repository URL into the input field. The URL should be a valid GitHub repository address.

Example:

```text
https://github.com/owner/repository
```

### 2. Add private repo access if needed

If the repository is private, enable the private repository option and supply a GitHub token with read access.

### 3. Start the scan

Submit the scan request. SecLens sends the repository information to its backend, fetches repository content from GitHub, selects evidence for analysis, and generates the report.

### 4. Review the result

When the scan succeeds, review:

- the report narrative
- the cited repository metadata
- any coverage limits or omissions
- the overall recommendations and next actions

### 5. Export the report

SecLens supports exporting the completed report as:

- Markdown
- plain text
- PDF

These exports are generated from the completed report currently visible in the application.

## How to read the report

A SecLens report should be treated as a scoped analysis, not an absolute proof that a repository is secure or insecure.

Pay attention to:

- concrete findings tied to repository evidence
- references to scanned files or code paths
- coverage statements that explain omitted or capped areas
- recommendations that are clearly connected to the scanned evidence

If a report indicates partial coverage, that means some files or repository areas were not fully included in the model input for that run.

## Coverage and limitations

SecLens uses bounded ingestion and selection rules. This helps keep scans deterministic and cost-aware, but it also means some repositories may be only partially covered in a given run.

Users should understand:

- not every file is guaranteed to be analyzed
- non-germane documentation and media files are excluded from security-review counts up front
- cap hits can affect scan depth
- omitted paths matter when judging confidence
- a clean report is not the same thing as a complete security audit

SecLens is best used as:

- an initial review
- a repeatable snapshot
- a prioritization tool

It is not a substitute for:

- manual code review
- architecture review
- live penetration testing
- compliance certification

## Common outcomes

### Public repository scan succeeds

This is the simplest case. Paste the URL, run the scan, and review or export the result.

### Private repository scan succeeds

The repository is accessible with the provided token and the report is generated normally.

### Private repository scan fails

Typical causes:

- the token is invalid or expired
- the token lacks repository read access
- the repository URL is wrong
- the requested branch or ref could not be resolved

### Report quality gate failure

If the generated report does not pass SecLens quality checks, the application may reject the report and ask you to retry the scan.

## Downloads and exports

SecLens supports three export formats:

### Markdown

Best for:

- preserving original report structure
- storing results in repos or internal docs
- reviewing diffs between scans

### Text

Best for:

- plain archival
- pasting into notes or tickets
- environments where rich formatting is not needed

### PDF

Best for:

- sharing with stakeholders
- attaching to reviews or assessments
- keeping a presentation-friendly copy

## Privacy and sensitive data guidance

When using SecLens, treat repository access and generated reports as sensitive workflow data.

Recommended user precautions:

- only scan repositories you are authorized to analyze
- use least-privilege GitHub tokens
- avoid sharing raw exports outside the intended audience
- review reports before forwarding them to third parties

Reports may contain security-relevant implementation details, file paths, configuration observations, or references to internal architecture. Handle them accordingly.

## Error handling and retry guidance

Retrying is reasonable when:

- the network request failed
- the quality gate failed
- the GitHub API returned a transient issue
- a download failed after report generation

Fix the underlying issue before retrying when:

- the repository URL is invalid
- the token is invalid or expired
- access to the repository is denied

## Best practices for users

- scan the exact repository and branch you care about
- verify repository visibility before starting
- use a dedicated read-only token for private repos where possible
- read the coverage summary before acting on conclusions
- keep exports with the project artifacts they relate to
- rerun scans after significant security or architecture changes

## When to run another scan

Run a fresh scan when:

- you change authentication or authorization logic
- you ship new API routes or background jobs
- you modify infrastructure or deployment configuration
- you add third-party integrations
- you need a current report for review, planning, or remediation tracking

## Related docs

- [Quickstart](./SECLENS-QUICKSTART.md)
- [Troubleshooting](./SECLENS-TROUBLESHOOTING.md)
- [FAQ](./SECLENS-FAQ.md)
