# SecLens Documentation

This folder contains end-user and operator-facing documentation for the SecLens web application.

## Documents

- [Quickstart](./SECLENS-QUICKSTART.md)  
  Fast path for first-time users (account, scan job, exports).

- [User Guide](./SECLENS-USER-GUIDE.md)  
  Full guide to signing in, scanning repositories, reading advisory results, quotas, and exporting reports.

- [Troubleshooting](./SECLENS-TROUBLESHOOTING.md)  
  Common problems (auth, quota, GitHub access, quality gates, downloads).

- [FAQ](./SECLENS-FAQ.md)  
  Scope, privacy, limits, plans, and exports.

- [API endpoint inventory](./api-endpoint-inventory.md)  
  Server-side route classification (public / authenticated / admin / webhooks) for operators and integrators.

## Audience

These docs are written for:

- engineers scanning their own repositories
- founders or product owners reviewing codebase risk at a high level
- consultants or internal reviewers preparing a security snapshot
- operators configuring deployments or debugging auth and billing

## Summary

- SecLens is a **security advisor** for GitHub repositories: signed-in users run **scans** that fetch bounded evidence and produce structured advisory reports-not confirmed vulnerability proofs.
- **Firebase Authentication** is required for scans and exports in normal product use.
- **Async scan jobs** (`POST /api/scan-jobs` + polling) are the primary workflow.
- **Rolling advisory run limits** apply per account (Free vs **Pro**); see the user guide and FAQ.
- **PDF** export requires an active **Pro** subscription (Stripe); Markdown and text exports are available to signed-in users per server policy.
- Reports are **evidence-bound** to selected files and caps; read coverage metadata before treating a run as exhaustive.
- Successful responses can include **telemetry** (correlation ID, token usage) for support.

## Scope of this folder

Pages here are written for **this** repository. Cross-links stay inside `docs/` except where we reference the root `README.md` for environment setup.
