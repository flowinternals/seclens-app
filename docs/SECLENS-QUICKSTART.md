# SecLens Quickstart

## What SecLens does

SecLens generates an on-demand security review for a GitHub repository and returns:

- a security report in Markdown
- repository metadata
- ingestion coverage details
- export options for Markdown, text, and PDF

## Before you start

You need:

- a GitHub repository URL
- a GitHub token only if the repository is private or otherwise requires authenticated access

For private repositories, use a token with the minimum read access needed for the target repository.

## Scan a repository

1. Open SecLens.
2. Paste the GitHub repository URL.
3. If the repository is private, enable the private repository option and provide a GitHub token.
4. Start the scan.
5. Wait for the report to finish generating.

## Download the report

After a successful scan, you can download the report as:

- Markdown
- text
- PDF

## What to expect in the result

A typical result includes:

- the report itself
- repository owner, name, branch, and scanned SHA
- a coverage summary
- scan metadata such as selected file counts and cap hits

## Important caveat

SecLens does not claim full repository coverage on every run. Reports are based on the files selected and processed during that scan. If scan caps are hit or files are omitted, the report should be read as scoped, not exhaustive.

## If something goes wrong

Start here:

- repository not accessible: confirm the URL and repository visibility
- private repo access denied: retry with a valid read-access token
- report failed quality checks: retry the scan
- download failed: regenerate the report and try the export again

For more detail, see:

- [User Guide](./SECLENS-USER-GUIDE.md)
- [Troubleshooting](./SECLENS-TROUBLESHOOTING.md)
- [FAQ](./SECLENS-FAQ.md)
