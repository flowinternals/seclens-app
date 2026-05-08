# SecLens Troubleshooting

## Cannot sign in or session expired

### What it usually means

Firebase Authentication rejected the request, or your browser session is no longer valid.

### What to do

- sign out and sign in again
- clear site data only if you understand the impact on saved sessions
- confirm your deployment's Firebase client env vars match the intended project

## Advisory run limit reached (429)

### What it usually means

You have exceeded the **rolling 30-day** advisory run quota for your plan (**Free** vs **Pro**).

### What to do

- wait until older runs fall outside the window
- upgrade to **Pro** if your deployment offers it and you need a higher limit
- contact support if the limit seems incorrect

## PDF export forbidden or billing error

### What it usually means

**PDF** requires an active **Pro** subscription in deployments with Stripe enabled.

### What to do

- open **Account -> Billing** and confirm subscription status
- use Markdown or text export if PDF is not available on your plan

## Repository URL is rejected

### What it usually means

The repository URL is malformed or not recognized as a valid GitHub repository URL.

### What to check

- the URL starts with `https://github.com/`
- the owner name is correct
- the repository name is correct
- the URL does not include unrelated query parameters or extra text

### Example of a valid format

```text
https://github.com/owner/repository
```

## Repository not found

### What it usually means

SecLens could not access the repository metadata from GitHub.

### What to check

- the repository exists
- the owner and repository names are spelled correctly
- the repository has not been renamed or deleted
- if the repository is private, you provided valid access

## Access denied for a private repository

### What it usually means

The repository is private and the provided token does not allow read access, is expired, or is invalid.

### What to check

- the private repository option is enabled
- the token is current
- the token has the needed read access
- the token was pasted correctly with no missing characters

## GitHub token invalid or expired

### What it usually means

GitHub rejected the provided token.

### What to do

- create or use a fresh token
- verify the token has read access to repository contents
- retry the scan with the updated token

## Branch or ref could not be resolved

### What it usually means

SecLens could access the repository but could not resolve the selected branch or ref during scan preparation.

### What to check

- the repository default branch still exists
- the repository token can read contents for the target repository
- the repository is in a healthy, accessible state on GitHub

## Scan fails with a quality-gate error

### What it usually means

The generated report did not pass internal validation checks.

### What to do

- retry the scan
- if the problem persists, treat it as an application issue rather than a repository-access issue

## Download fails

### What it usually means

The export request could not complete, you are not authenticated, or the report payload was not available in the expected format.

### What to do

- confirm you are **signed in** and your session is valid
- make sure the scan **job completed** before downloading
- retry the export
- try another export format (PDF requires **Pro** where billing applies)
- rerun the scan if the report state appears stale or incomplete

## The report seems incomplete

### What it usually means

The scan may have hit coverage caps or omitted files during evidence selection.

### What to check

- selected file count
- omitted file count
- cap-hit indicators
- coverage summary text

### What to do

- treat the report as scoped, not exhaustive
- rerun after major repository changes
- use the result as a prioritization aid, not a final audit conclusion

## Results do not match expectations

### Possible reasons

- the repository changed between scans
- the selected evidence changed because repository content changed
- different branches or refs were scanned
- a previous run had different environmental settings or limits

### What to do

- confirm the repository URL and branch context
- compare repository metadata in the result
- compare coverage summaries and cap-hit notes across runs

## The app seems slow

### What may be happening

- repository fetch and evidence assembly are still in progress
- the repository is large or complex
- upstream service latency is affecting the scan

### What to do

- wait for the run to complete
- retry later if the problem appears transient
- avoid starting multiple duplicate scans for the same repository at once

## I am unsure whether to trust the result

Use this checklist:

- does the report tie conclusions to evidence?
- does the repository metadata match what you intended to scan?
- does the coverage summary indicate omissions or caps?
- are you using the report as a scoped review rather than a full audit?

If the answer to any of those is no, treat the result as provisional and rerun or follow up with manual review.
