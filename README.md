# SecLens Web Application

SecLens is a **repository security advisor** for GitHub: it profiles repos, runs a bounded evidence selection pipeline, and produces structured advisory reports (Markdown), plus exports. The product is positioned as **evidence-bound guidance**, not confirmed vulnerability detection.

Users **sign in with Firebase Authentication**. Scans run as **asynchronous jobs** (`POST /api/scan-jobs`) with polling; **Firestore** stores billing and usage; **Stripe** powers Pro subscriptions. **PDF export** requires an active **Pro** subscription.

## Quick Start

### Prerequisites

- Node.js 20+
- npm
- Firebase project (Auth + Firestore) and Stripe account if you enable billing features locally or in production

### Install

```bash
git clone https://github.com/flowinternals/seclens-app.git
cd seclens-app
npm install
```

### Configure Environment

Copy `.env.example` to `.env.local` and set values. Never commit `.env.local` or secrets.

**Required for a working authenticated app**

- `OPENAI_API_KEY`
- Firebase **client** vars (`VITE_FIREBASE_*`) for the SPA
- Firebase **Admin** vars (`FIREBASE_SERVICE_ACCOUNT_JSON` or `FIREBASE_PROJECT_ID` + `FIREBASE_CLIENT_EMAIL` + `FIREBASE_PRIVATE_KEY`) so the API can verify ID tokens and access Firestore

**Required for production deployments**

- `CORS_ALLOWLIST` - comma-separated allowed browser origins

**Common optional / feature-specific**

- `GITHUB_TOKEN` or `GITHUB_API_TOKEN` - higher GitHub API limits for server-side fetch
- Stripe: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO_MONTHLY`, `STRIPE_PRICE_PRO_YEARLY`, `VITE_STRIPE_PUBLISHABLE_KEY`
- `SECLENS_SERVER_API_KEY` - optional; with header `x-seclens-key`, relaxes production origin checks for automation only (**does not** bypass Firebase auth on application routes)
- `SECLENS_ALLOW_NO_ORIGIN_IN_PROD` - only if non-browser callers without `Origin` are intentional
- Report/model tuning: `SECLENS_CRITIC_ENABLED`, `SECLENS_ANALYSIS_MODEL`, `SECLENS_MAX_*`, etc. (see `.env.example`)

The Vite dev server runs on **port 3000** and proxies `/api` to the local API on **port 3001** (`vite.config.js`). The client calls relative `/api/...` paths by default.

### Firebase CLI (`firebase.json`)

The repo includes **`firebase.json`**, **`.firebaserc`**, and **`firestore.indexes.json`** so Firestore rules and indexes deploy with the Firebase CLI. The default project alias in **`.firebaserc`** is `seclens-app`; if you use another Firebase project, run `firebase use --add` and pick the correct project (it should match **`VITE_FIREBASE_PROJECT_ID`** and **`FIREBASE_PROJECT_ID`**).

**Flowinternals:** The canonical Firebase **web SDK config** used to populate `VITE_FIREBASE_*` in `.env.local` is maintained in the private Assets checkout at **`flowinternals-seclens-app-Assets/security/secrets/firebase.txt`**. That file is not part of this app repository; copy fields from there into env vars locally and never commit secrets.

1. Install dependencies (includes **`firebase-tools`** as a dev dependency).
2. `firebase login` once on the machine.
3. Deploy **Firestore security rules** from this repo (required so client Auth + Firestore are not stuck on deny-all defaults):

   ```bash
   npm run firebase:deploy:rules
   ```

4. Optional: **`npm run firebase:emulators`** starts Auth + Firestore emulators (see `firebase.json` -> `emulators`) for local testing without touching production.
5. Optional: **`npm run firebase:deploy:hosting`** publishes the Vite **`dist/`** build to Firebase Hosting (production may still be Vercel; use this only if you host the SPA on Firebase).

**Listing Auth users (no MCP):** The Firebase CLI does not expose `auth:get`, but **`firebase auth:export`** dumps all accounts to a file. From the repo root after `firebase login`:

```bash
npm run firebase:auth:export
```

That writes **`.firebase-auth-export.tmp.json`** (gitignored). The file includes sensitive fields (e.g. password hashes); treat it as secret, inspect locally, then delete. To print only `localId` / `email`, you can use `node` or `jq` on that file. There is no built-in CLI filter by UID; export all users and filter in your tool of choice.

## Run Locally

Frontend + API together:

```bash
npm run dev:full
```

Or separately:

```bash
npm run dev        # Vite -> http://localhost:3000
npm run dev:api    # Express API -> http://localhost:3001
```

Open the app (typically `http://localhost:3000`), register or sign in, then run a scan from the home route.

## Build

```bash
npm run build
npm run preview
```

## API Overview

For route-by-route classification (auth, webhooks, admin), see **`docs/api-endpoint-inventory.md`**.

Typical flows:

- **`POST /api/scan-jobs`** - start an advisory scan (Bearer Firebase ID token); returns a job id -> poll **`GET /api/scan-jobs?jobId=...`**
- **`POST /api/analyze`** - legacy synchronous analysis (also authenticated)
- **`POST /api/download/markdown`** / **`text`** - export current report (authenticated)
- **`POST /api/download/pdf`** - PDF export (**Pro** subscription required)

Example **scan job** request body:

```json
{
  "repositoryUrl": "https://github.com/user/repo",
  "githubToken": "optional_token_for_private_or_rate_limits",
  "analysisModel": "optional_openai_model_id"
}
```

## Product Documentation

End-user and operator-oriented docs live in **`docs/`** (quickstart, user guide, FAQ, troubleshooting).

## Deployment

Deploy on Vercel (or a compatible Node/serverless environment). Configure all required secrets in the project settings. Set **`CORS_ALLOWLIST`** to your deployed frontend origin(s). Configure the Stripe webhook endpoint to **`/api/billing/webhook`** with the signing secret.

## Security Notes

- Keep secrets only in server-side environment variables; never put secrets in `VITE_*` vars.
- Do not expose keys or tokens in logs, docs, screenshots, or commits.
- Rotate credentials immediately if exposure is suspected.

## Support

- Issues: [GitHub Issues](https://github.com/flowinternals/seclens-app/issues)
- Repository: [https://github.com/flowinternals/seclens-app](https://github.com/flowinternals/seclens-app)
