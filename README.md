# SecLens Web Application

SecLens provides on-demand security analysis for GitHub repositories.

## Quick Start

### Prerequisites

- Node.js 20+
- npm

### Install

```bash
git clone https://github.com/flowinternals/seclens-app.git
cd seclens-app
npm install
```

### Configure Environment

Create `.env.local` from `.env.example` and set required values.

Minimum required variables:

- `OPENAI_API_KEY`
- `VITE_API_URL`

Optional variables:

- `GITHUB_TOKEN`
- `GITHUB_API_TOKEN`
- `CORS_ALLOWLIST`
- `PORT`
- `NODE_ENV`
- `SECLENS_ALLOW_NO_ORIGIN_IN_PROD`
- `SECLENS_SERVER_API_KEY`

Never commit `.env.local` or any populated secrets.

## Run Locally

Start frontend and API together:

```bash
npm run dev:full
```

Or start separately:

```bash
npm run dev
npm run dev:api
```

## Build

```bash
npm run build
npm run preview
```

## API Usage

Primary analysis endpoint:

- `POST /api/analyze`

Example request body:

```json
{
  "repositoryUrl": "https://github.com/user/repo",
  "githubToken": "optional_token",
  "analysisModel": "optional_model"
}
```

## Deployment

Deploy on Vercel (or compatible Node/serverless environment) with environment variables configured securely.

At minimum in production:

- `OPENAI_API_KEY`
- `CORS_ALLOWLIST`

## Security Notes

- Keep secrets only in environment variables.
- Do not expose keys or tokens in logs, docs, screenshots, or commits.
- Rotate credentials immediately if exposure is suspected.

## Support

- Issues: [GitHub Issues](https://github.com/flowinternals/seclens-app/issues)
- Repository: [https://github.com/flowinternals/seclens-app](https://github.com/flowinternals/seclens-app)
