# SecLens API endpoint inventory (CR-SECLENS-PIVOT-009)

Server-side classification for routes registered in `server.js` (local API) and mirrored under `/api/*` on Vercel.

| Path | Method | Classification | Auth | Role | Ownership / notes |
|------|--------|----------------|------|------|-------------------|
| `/api/health` | GET | `public` | - | - | Liveness; no secrets. |
| `/api/auth/provision-account` | POST | `public` | - | - | **Justification:** email onboarding creates Firebase user before first sign-in; rate limited. Does not trust arbitrary roles from body. |
| `/api/billing/webhook` | POST | `webhook` | Stripe signature | - | `stripe-signature` verified; rejects missing/invalid signature (`reasonCode`: `WEBHOOK_SIGNATURE_INVALID`). |
| `/api/scan-jobs` | POST | `authenticated_user` | Firebase ID token (Bearer) | - | Starts advisory run; quota tied to token uid. |
| `/api/scan-jobs` | GET | `authenticated_user` | Firebase ID token | - | Poll status only if `job.triggeredBy.uid` matches caller uid. |
| `/api/analyze` | POST | `authenticated_user` | Firebase ID token | - | Legacy synchronous analysis; same auth as scan-jobs. |
| `/api/download/markdown` | POST | `authenticated_user` | Firebase ID token | - | Export; body is report snapshot only. |
| `/api/download/text` | POST | `authenticated_user` | Firebase ID token | - | Same as markdown. |
| `/api/download/pdf` | POST | `authenticated_user` | Firebase ID token | Pro plan | `requireAuthWithBilling`; Pro subscription enforced after auth. |
| `/api/billing/subscription` | GET | `authenticated_user` | Firebase ID token | - | Reads caller subscription document only. |
| `/api/billing/checkout-session` | POST | `authenticated_user` | Firebase ID token | - | Stripe Checkout; metadata uses server-resolved uid. |
| `/api/billing/portal-session` | POST | `authenticated_user` | Firebase ID token | - | Portal for caller's Stripe customer id only. |
| `/api/admin/runs` | GET | `admin_only` | Firebase ID token | `admin` | Lists runs / telemetry. |
| `/api/admin/runs/:runId` | GET, DELETE | `admin_only` | Firebase ID token | `admin` | Run detail / delete. |
| `/api/admin/runs/:runId/post-mortem` | POST | `admin_only` | Firebase ID token | `admin` | Post-mortem bundle. |

## Shared utilities

- `authenticateRequest`, `authorizeAdminRequest`, `buildTriggeredByProfile` - `lib/server/adminAuth.js`
- `logProtectedEndpointRejection`, `assertResourceOwner`, `sendAuthFailureJson` - `lib/server/apiAuth.js`
- `requireAuthWithBilling` - `lib/server/billing.js`

## Internal automation note

`SECLENS_SERVER_API_KEY` + `x-seclens-key` relax **origin/CORS** checks in production (`productionAccessGuard.js`) only. It does **not** bypass Firebase authentication on application routes.
