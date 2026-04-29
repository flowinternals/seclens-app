# SecLens Documentation

This folder contains end-user documentation for the SecLens web application.

## Documents

- [Quickstart](./SECLENS-QUICKSTART.md)  
  Fast path for first-time users.

- [User Guide](./SECLENS-USER-GUIDE.md)  
  Full guide to scanning repositories, reading results, and exporting reports.

- [Troubleshooting](./SECLENS-TROUBLESHOOTING.md)  
  Common problems, likely causes, and what to do next.

- [FAQ](./SECLENS-FAQ.md)  
  Frequently asked questions about scope, privacy, limits, exports, and usage.

## Audience

These docs are written for:

- engineers scanning their own repositories
- founders or product owners reviewing codebase risk at a high level
- consultants or internal reviewers preparing a security snapshot

## Important usage notes

- SecLens analyzes GitHub repositories on demand.
- Private repositories may require a GitHub token with read access.
- Reports are evidence-bound to the files selected for the scan.
- Exports are available in Markdown, text, and PDF formats.
- These docs describe the current application behavior and intended user workflow.

## Safety note

This documentation intentionally does not contain secrets, live credentials, or private operational values. Keep tokens, keys, and populated environment values out of docs and source control.
