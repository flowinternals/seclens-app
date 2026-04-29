# SecLens Web Application

On-demand security analysis for GitHub repositories.

## Important Notes

- **Design documents:** `D:\Assets\flowinternals-seclens-app-Assets\design\mvp4 - launch-readiness\`
- **Secrets:** use environment variables only; never commit keys, tokens, or populated secret files
- **Scope:** this README reflects the current Stage 1 / Stage 2 architecture

## Features

- On-demand GitHub repository security analysis
- Markdown, text, and PDF report exports
- Report-quality validation with optional critic repair
- Deterministic Stage 02 repository ingestion with line-addressable excerpts
- Local self-scan harness for repeatable launch-readiness checks

## Technology Stack

### Frontend

- React
- Vite
- Tailwind CSS

### Backend

- Vercel serverless route handlers
- OpenAI API
- GitHub API

### Security

- Content Security Policy and hardened response headers
- DOMPurify and backend input validation
- CORS allowlist
- In-memory rate limiting

## Prerequisites

- Node.js 20+
- npm
- Git
- OpenAI API key
- Vercel account for deployment

## Installation

1. Clone the repository:

```bash
git clone https://github.com/flowinternals/seclens-app.git
cd seclens-app
```

2. Install dependencies:

```bash
npm install
```

3. Create `.env.local` from `.env.example` and set real values:

```env
OPENAI_API_KEY=your_openai_api_key_here
VITE_API_URL=http://localhost:3000
GITHUB_TOKEN=your_github_token_here
GITHUB_API_TOKEN=your_github_token_here
CORS_ALLOWLIST=http://localhost:3000,http://localhost:5173,http://127.0.0.1:3000,http://127.0.0.1:5173
PORT=3001
NODE_ENV=development
SECLENS_CRITIC_ENABLED=true
SECLENS_ANALYSIS_MODEL=gpt-4o-mini
SECLENS_CRITIC_MODEL=gpt-4o-mini
SECLENS_MAX_ANALYSIS_TOKENS=6144
SECLENS_MAX_CRITIC_TOKENS=10000
SECLENS_MAX_FILES_FETCHED=200
SECLENS_MAX_BYTES_PER_FILE=12000
SECLENS_MAX_TOTAL_BYTES_TO_MODEL=420000
SECLENS_MAX_REPO_TREE_ENTRIES=100000
```

Never commit `.env.local` or any file containing populated credentials.

## Repository Ingestion (MVP4 Stage 02)

Stage 02 ingestion:

- resolves the repository `default_branch` and commit SHA
- uses a deterministic tiered + related-context file-selection strategy (`v2`)
- builds line-addressable evidence excerpts using `path:start-end`
- applies bounded `SECLENS_MAX_*` caps
- returns branch/ref metadata and an ingestion summary in `/api/analyze`

The default JSON response does **not** include full omitted-path inventories or raw evidence payloads.

### Local Self-Scan

Run:

```bash
npm run self-scan
```

This writes `.seclens-self-scan/evidence-latest.json` with:

- the normalized evidence `bundle`
- ingestion summary metadata
- selection, omission, citation, and coverage data for repeatable QA comparison

Default local ref label is `local-working-tree` unless `SECLENS_SELF_SCAN_LABEL` is set.

### Stage 02 Coverage Profiles

Recommended launch-readiness defaults:

```env
SECLENS_MAX_FILES_FETCHED=200
SECLENS_MAX_BYTES_PER_FILE=12000
SECLENS_MAX_TOTAL_BYTES_TO_MODEL=420000
SECLENS_MAX_REPO_TREE_ENTRIES=100000
SECLENS_MAX_ANALYSIS_TOKENS=6144
SECLENS_MAX_CRITIC_TOKENS=10000
```

Optional deep QA profile for explicit high-coverage validation runs:

```env
SECLENS_MAX_FILES_FETCHED=250
SECLENS_MAX_BYTES_PER_FILE=12000
SECLENS_MAX_TOTAL_BYTES_TO_MODEL=500000
SECLENS_MAX_REPO_TREE_ENTRIES=150000
SECLENS_MAX_ANALYSIS_TOKENS=6144
SECLENS_MAX_CRITIC_TOKENS=10000
```

Coverage honesty remains required: reports are evidence-bound to selected scanned files and disclosed cap hits.

Guidance file:

```text
tests/fixtures/SELF-SCAN-OBSERVATIONS.md
```

## Development

### Start Both Frontend and API

```bash
npm run dev:full
```

This starts:

- frontend dev server on `http://localhost:3000`
- API server on `http://localhost:3001`

### Start Separately

```bash
npm run dev:api
npm run dev
```

### Report-Quality Testing

For local MVP4 testing, set:

```env
SECLENS_CRITIC_ENABLED=true
```

Then restart `npm run dev:api` or `npm run dev:full`.

If critic repair is disabled, failed reports return:

```text
422 REPORT_QUALITY_GATE
```

### Build

```bash
npm run build
npm run preview
```

## Deployment

SecLens is deployed on Vercel.

Required Vercel environment variables:

| Variable | Description | Required |
|---|---|---|
| `OPENAI_API_KEY` | OpenAI API key for analysis | Yes |
| `CORS_ALLOWLIST` | Allowed production origins | Yes |
| `GITHUB_TOKEN` | Higher GitHub rate limits / private repo access | No |
| `SECLENS_CRITIC_ENABLED` | Enable critic repair in staging/prod tests | Recommended |
| `SECLENS_ANALYSIS_MODEL` | Primary analysis model | No |
| `SECLENS_CRITIC_MODEL` | Critic model | No |
| `SECLENS_MAX_ANALYSIS_TOKENS` | Analysis token cap | No |
| `SECLENS_MAX_CRITIC_TOKENS` | Critic token cap | No |
| `SECLENS_MAX_FILES_FETCHED` | Stage 02 file-selection cap | No |
| `SECLENS_MAX_BYTES_PER_FILE` | Stage 02 per-file excerpt cap | No |
| `SECLENS_MAX_TOTAL_BYTES_TO_MODEL` | Stage 02 total evidence cap | No |
| `SECLENS_MAX_REPO_TREE_ENTRIES` | Stage 02 tree cap | No |

## Project Structure

```text
seclens-app/
├── api/                    # Vercel route handlers
│   ├── analyze.js         # Main analysis endpoint
│   └── download/          # Export endpoints
├── lib/
│   ├── prompts/           # Output contract, evidence rules, critic rules
│   └── server/            # Ingestion, validation, downloads, rate limiting
├── scripts/               # Local helper scripts (including self-scan)
├── src/                   # Frontend application
├── tests/                 # Repo-ingestion and report-quality tests
├── public/                # Static assets
├── vercel.json           # Vercel routing and headers
├── vite.config.js        # Vite configuration
└── package.json          # Scripts and dependencies
```

## Security Notes

- Secrets must stay in environment variables, not in source or docs
- `.env.local` and `.seclens-self-scan/` are gitignored local artifacts
- Quality-gate debug artifacts are development helpers and should remain local-only
- Production logs should not contain tokens, keys, or raw secret material

## Download Endpoints

Shared server-side download utilities live in:

```text
lib/server/downloadUtils.js
```

Endpoints:

- `/api/download/markdown`
- `/api/download/text`
- `/api/download/pdf`

## API Endpoints

### `/api/analyze`

**Method:** `POST`

**Body:**

```json
{
  "repositoryUrl": "https://github.com/user/repo",
  "githubToken": "optional_personal_access_token"
}
```

**Success response shape:**

```json
{
  "report": "Security analysis report in markdown format...",
  "reportContractVersion": "2.0.4-mvp4",
  "reportValidation": {
    "ok": true,
    "repairedAfterCritic": false
  },
  "telemetry": {
    "correlationId": "uuid",
    "tokenUsage": {
      "draft": { "prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0 },
      "critic": null,
      "total": { "prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0 }
    }
  },
  "repository": {
    "url": "https://github.com/user/repo",
    "owner": "user",
    "name": "repo",
    "language": "JavaScript",
    "defaultBranch": "main",
    "scannedRef": "main",
    "scannedSha": "commitsha"
  },
  "ingestion": {
    "strategyVersion": "v2",
    "selectedFileCount": 40,
    "omittedFileCount": 120,
    "selectedReasonCounts": { "tier1_priority": 8, "tier2_anchor_route": 12, "related_middleware": 4 },
    "anchorCount": 18,
    "relatedContextCount": 11,
    "backfillCount": 9,
    "capHits": ["MAX_FILES_FETCHED"],
    "coverageSummary": "Partial coverage due to configured caps."
  },
  "timestamp": "2026-01-09T12:00:00Z"
}
```

## Launch Readiness

Current MVP4 work is tracked in:

```text
D:\Assets\flowinternals-seclens-app-Assets\design\mvp4 - launch-readiness\
```

## Support

- Issues: [GitHub Issues](https://github.com/flowinternals/seclens-app/issues)
- Repository: [https://github.com/flowinternals/seclens-app](https://github.com/flowinternals/seclens-app)
- Design documents: `D:\Assets\flowinternals-seclens-app-Assets\design\mvp4 - launch-readiness\`
