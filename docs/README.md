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

## Summary

- SecLens analyzes GitHub repositories on demand.
- Private repositories may require a GitHub token with read access.
- Reports are **evidence-bound** to the files selected for that run (**Stage 02** ingestion with configurable caps); they are launch-readiness style snapshots, not proof of full-repo coverage.
- Successful API responses can include a **correlation ID** and **token usage** telemetry (useful when reporting issues to operators).
- Exports are available in Markdown, text, and PDF formats.

## Scope of this documentation

All pages in this `docs/` folder are self-contained for **this** repository. They link only to other files in the same folder and do not point to documentation, design archives, or specs kept outside the project.
