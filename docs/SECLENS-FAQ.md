# SecLens FAQ

## What is SecLens?

SecLens is a web application that scans a GitHub repository and produces an evidence-based **security advisory** (structured Markdown), plus metadata and export options. It is designed as an advisor-not a tool that proves vulnerabilities or complete coverage.

## Do I need an account?

Yes for normal product use. You **sign in** with SecLens (Firebase Authentication) to start scans and downloads.

## Who is SecLens for?

It is useful for engineers, security reviewers, founders, consultants, and teams who want a fast first-pass security read on a codebase.

## Does SecLens scan public repositories?

Yes.

## Does SecLens scan private repositories?

Yes, when the repository can be accessed with valid read permissions. In practice, that may require a GitHub token.

## What kind of GitHub token should I use?

Use the minimum token scope that gives read access to the target repository. Avoid broad personal tokens when a narrower token will do.

## Does SecLens need write access to my repository?

No user workflow in the current app is intended to require write access just to scan a repository.

## What does the app return after a successful scan?

A successful scan can return:

- the Markdown report
- report validation metadata (whether the draft passed checks or was repaired by the optional critic pass)
- token usage telemetry and a **correlation ID** (for operator diagnostics)
- repository metadata (including scanned ref and commit SHA)
- ingestion metadata (selection counts, cap hits, coverage summary)
- a timestamp

## Can I export the report?

Yes, when signed in. Export formats:

- Markdown
- text
- PDF - requires an **active Pro** subscription where Stripe billing is enabled

## Are there limits on how many scans I can run?

Yes. Accounts have a **rolling 30-day** limit on advisory runs (**Free** vs **Pro** quotas differ). If you hit the limit, wait for the window to roll, upgrade where offered, or contact support.

## What is Pro?

**Pro** is a paid plan (Stripe) that unlocks higher advisory run limits, larger per-file ingestion allowances where applicable, and **PDF** export. Exact entitlements depend on your deployment's billing configuration.

## Is the report always complete?

No. SecLens uses bounded selection and ingestion rules, so some scans may be partial. Check the coverage information before assuming the report is exhaustive.

## What does "coverage" mean in practice?

It means the report is based on the files selected and processed for that scan. If files were omitted or limits were hit, the result reflects that narrower scope.

## If the report says there are no major findings, is the repository secure?

Not necessarily. It means SecLens did not identify those findings within the scanned scope of that run. It is not a guarantee of complete security.

## Why would a private repo scan fail?

Common causes:

- invalid token
- expired token
- insufficient repository access
- incorrect repository URL
- branch or ref resolution problems

## Why would a report fail after the scan started?

The application includes report-quality validation. If the generated report does not pass that validation, the scan may fail and require a retry.

## Does SecLens support non-GitHub repositories?

The current app is built around GitHub repository URLs and GitHub access patterns.

## Does SecLens scan every file in the repository?

Not necessarily. The app uses a deterministic file-selection strategy and bounded ingestion caps.

Before those security-review counts are calculated, SecLens excludes non-germane files such as Markdown and plain-text documentation, PDFs, Office documents, images, and video or media assets. Those files are not counted as security-relevant files examined.

## What is the best way to use SecLens?

Use it as:

- an initial security review
- a repeatable project snapshot
- a prioritization tool for follow-up work

## What SecLens is not designed to replace

- Manual security review
- Compliance certification
- Proof that no vulnerabilities exist

## Can I share the PDF with stakeholders?

Yes, but review it first. Reports may include sensitive implementation details, file paths, or security observations that should not be forwarded casually.

## Should I keep old reports?

Usually yes. Keeping reports helps with comparison, remediation tracking, and change review over time.

## When should I run a new scan?

Run another scan after:

- meaningful code changes
- auth or permission changes
- deployment or infrastructure changes
- major dependency or integration changes
- remediation work on a previously identified issue

## Is a retry safe?

Usually yes for transient problems such as network issues, quality-gate failures, or export failures. For repository-access errors, fix the underlying input or permission issue first.

## Where should I start if I am new?

Start with [Quickstart](./SECLENS-QUICKSTART.md), then use [User Guide](./SECLENS-USER-GUIDE.md) for the full workflow.
