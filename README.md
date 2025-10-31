# SecLens Web Application

On-demand security analysis for GitHub repositories.

## Important Notes

- **Design Documents:** All plans and designs are located in `/Assets/designs/`
- **Environment Variables:** All API keys must be set via environment variables, never hardcoded in the codebase
- **Security:** Never commit secrets or API keys to the repository

## Features

- 🔍 **On-Demand Security Analysis** - Analyze any public GitHub repository with a single URL input
- 📊 **Detailed Security Reports** - Comprehensive security findings with recommendations
- 📥 **Multiple Export Formats** - Download reports as Markdown (.md), Plain Text (.txt), or PDF (.pdf)
- 🔒 **Security-First Design** - Built with security hardening from the ground up
- 🚀 **Zero-Friction Access** - No login or sign-up required
- 📱 **Responsive Design** - Works seamlessly on desktop and mobile devices
- ⚡ **Fast & Scalable** - Serverless architecture with automatic scaling

## Technology Stack

### Frontend
- **React** - Component-based UI framework
- **Vite** - Fast build tool and dev server
- **TailwindCSS** - Utility-first CSS framework

### Backend
- **Vercel Serverless Functions** - Node.js 20+ serverless API endpoints
- **OpenAI API** - AI-powered security analysis
- **GitHub API** - Repository content fetching

### Security
- Content Security Policy (CSP)
- DOMPurify for input sanitization
- Rate limiting (IP-based)
- CORS protection
- reCAPTCHA v3 bot protection
- Security headers (X-Frame-Options, X-Content-Type-Options, etc.)

## Prerequisites

Before you begin, ensure you have the following:

- **Node.js** 20+ installed
- **npm** or **yarn** package manager
- **Git** for version control
- **Vercel account** (for deployment)
- **OpenAI API key** (obtain from OpenAI Console)
- **Google reCAPTCHA v3** site key (for bot protection)

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

3. Set up environment variables:
   - Copy `.env.example` to `.env.local` (DO NOT commit `.env.local`)
   - Fill in your actual values in `.env.local`:
```env
# Required: OpenAI API Configuration
OPENAI_API_KEY=your_openai_api_key_here

# Required: reCAPTCHA Configuration (for frontend)
VITE_RECAPTCHA_SITE_KEY=your_recaptcha_site_key_here

# Required: API URL (for frontend)
VITE_API_URL=http://localhost:3000

# Optional: GitHub API Token (for higher rate limits)
GITHUB_TOKEN=your_github_token_here
# Alternative name for GitHub token
GITHUB_API_TOKEN=your_github_token_here

# Required for Production: CORS Configuration
# Comma-separated list of allowed origins (e.g., "https://yourdomain.com,https://www.yourdomain.com")
# For development, defaults to localhost origins if not set
CORS_ALLOWLIST=http://localhost:3000,http://localhost:5173,http://127.0.0.1:3000,http://127.0.0.1:5173

# Optional: Server Port (for local development server)
PORT=3001

# Optional: Node Environment
NODE_ENV=development
```

   **⚠️ CRITICAL:** Never commit `.env.local` or any file containing API keys to the repository.

## Development

### E2E Testing Setup

For end-to-end testing before deploying to Vercel, use the local development server:

**Start Both Frontend and API Server:**

```bash
npm run dev:full
```

This starts:
- Frontend dev server on `http://localhost:3000`
- API server on `http://localhost:3001`
- API requests are automatically proxied from frontend to API server

**Or Start Separately:**

```bash
# Terminal 1: Start API server
npm run dev:api

# Terminal 2: Start frontend
npm run dev
```

### Individual Servers

**Frontend Only:**

```bash
npm run dev
```

The application will be available at `http://localhost:3000`.

⚠️ **Note:** API endpoints will return 404 if API server is not running.

**API Server Only:**

```bash
npm run dev:api
```

API server runs on `http://localhost:3001` and handles all `/api/*` routes.

### Environment Variables for Local Testing

Make sure to set `OPENAI_API_KEY` in your environment:

**Windows (PowerShell):**
```powershell
$env:OPENAI_API_KEY="your_api_key_here"
npm run dev:full
```

**Windows (CMD):**
```cmd
set OPENAI_API_KEY=your_api_key_here
npm run dev:full
```

**Linux/Mac:**
```bash
export OPENAI_API_KEY="your_api_key_here"
npm run dev:full
```

Or create a `.env.local` file in the project root (it will be automatically loaded):
```env
OPENAI_API_KEY=your_api_key_here
```

### Build for Production

Create a production build:

```bash
npm run build
```

Preview the production build locally:

```bash
npm run preview
```

## Deployment

SecLens is deployed on **Vercel** for both frontend hosting and serverless functions.

### Vercel Deployment

1. Connect your GitHub repository to Vercel
2. Configure environment variables in Vercel dashboard:
   - `OPENAI_API_KEY` (obtain from OpenAI Console)
   - `RECAPTCHA_SITE_KEY` (obtain from Google reCAPTCHA Console)
   - `RECAPTCHA_SECRET_KEY` (obtain from Google reCAPTCHA Console)
3. Deploy automatically on push (Vercel handles this automatically)

### Environment Variables

Set these in your Vercel project settings:

| Variable | Description | Required | Source |
|----------|-------------|----------|--------|
| `OPENAI_API_KEY` | OpenAI API key for security analysis | Yes | OpenAI Console |
| `RECAPTCHA_SITE_KEY` | Google reCAPTCHA v3 site key | Yes | Google reCAPTCHA Console |
| `RECAPTCHA_SECRET_KEY` | Google reCAPTCHA v3 secret key | Yes | Google reCAPTCHA Console |
| `CORS_ALLOWLIST` | Comma-separated list of allowed origins (e.g., "https://yourdomain.com,https://www.yourdomain.com") | Yes (Production) | Your production domain(s) |
| `GITHUB_TOKEN` | GitHub API token for higher rate limits | No | GitHub Settings → Developer Settings → Personal Access Tokens |
| `NODE_ENV` | Environment mode (development/production) | No | Automatically set by Vercel |

**⚠️ Important Notes:**
- `CORS_ALLOWLIST` is **required in production** - without it, all CORS requests will be denied
- Never commit secrets to the repository. Use environment variables only.
- For local development, `CORS_ALLOWLIST` defaults to localhost origins if not set
- See `.env.example` for a complete list of all environment variables

## Project Structure

```
seclens-app/
├── api/                    # Vercel serverless functions
│   ├── analyze.js         # Main analysis endpoint
│   └── utils/             # Utility functions
│       ├── cors.js        # CORS middleware
│       ├── github.js      # GitHub API client
│       ├── openai.js      # OpenAI API client
│       └── rateLimit.js   # Rate limiting
├── src/
│   ├── components/        # React components
│   ├── utils/             # Utility functions
│   │   └── sanitize.js   # Input sanitization utilities
│   └── App.jsx           # Main application component
├── public/                # Static assets
├── vercel.json           # Vercel configuration (headers, routing)
├── vite.config.js        # Vite build configuration
├── tailwind.config.js    # TailwindCSS configuration
└── package.json          # Dependencies and scripts
```

## Security Features

SecLens implements comprehensive security measures:

### Content Security Policy (CSP)
- Strict CSP headers preventing XSS attacks
- No inline scripts or eval allowed
- Frame-ancestors 'none' to prevent clickjacking

### Input Sanitization
- Frontend and backend input validation
- DOMPurify for HTML sanitization
- GitHub URL format validation

### Rate Limiting
- IP-based rate limiting (configurable limits)
- HTTP 429 responses for exceeded limits
- Prevents API abuse and DDoS

### CORS Protection
- Strict CORS policies configured via `CORS_ALLOWLIST` environment variable
- Origin allowlist enforced (production domain + localhost for dev)
- No wildcard policies in production
- Production requires explicit origin configuration

### Bot Protection
- reCAPTCHA v3 integration (invisible to users)
- Token verification on backend

### Security Headers
- `X-Frame-Options: DENY` - Prevents clickjacking
- `X-Content-Type-Options: nosniff` - Prevents MIME type sniffing
- `Referrer-Policy: no-referrer` - Prevents referrer leakage
- `Strict-Transport-Security` - Enforces HTTPS connections
- `X-Permitted-Cross-Domain-Policies: none` - Prevents cross-domain policy files
- `Permissions-Policy` - Restricts browser features (camera, microphone, geolocation)
- Content Security Policy (CSP) - Strict CSP preventing XSS attacks

### Secret Management
- ✅ All API keys stored in environment variables only
- ✅ No secrets in code, logs, or comments
- ✅ `.env.local` excluded from git via `.gitignore`
- ✅ No secrets stored in the repository

## Download Endpoints Architecture

The three download endpoints share robust, centralized utilities to reduce duplication and improve safety.

- Shared utilities in `api/utils/downloadUtils.js`:
  - `generateFilename` – safe filenames with date stamps
  - `setDownloadHeaders` – consistent download headers (no sniffing)
  - `prepareMarkdown` – sanitizes markdown output
  - `markdownToPlainText` – converts markdown to sanitized plaintext (used by text/PDF)
  - `handleDownloadError` – standardized, non-sensitive error responses
- Refactored handlers:
  - `api/download/markdown.js`
  - `api/download/text.js`
  - `api/download/pdf.js`

All outputs are sanitized; headers prevent MIME sniffing; errors are consistent and do not leak internals.

## Error Handling & Logging Policy

- Descriptive but safe errors: client responses include clear messages without exposing internals
- Environment-aware logging:
  - Development: detailed logs (messages and stacks) for debugging
  - Production: generic logs only, no sensitive values, tokens, or headers
- Standardized server errors for downloads include a stable `code` field for easier client handling

## Environment & Configuration (No Secrets in Logs)

- CORS: Configure allowed origins via `CORS_ALLOWLIST` (comma-separated). Production requires explicit values
- Keys/Tokens: Use environment variables (never logged or echoed in production)
- Validation: Required variables are validated at startup; production does not display variable contents
- Secrets management: Environment variables are sourced from a secure secrets vault/service and injected at runtime. Do not store secrets in the repository; enforce rotation and least-privilege access.

## CI / Security Automation

- Dependency audit: `npm audit` scripts added (`npm run audit`, `npm run audit:fix`)
- GitHub Actions workflow `security-audit.yml` runs audits on PRs, pushes to main, and weekly schedule

## Rate Limiting (Roadmap)

Current rate limiting is in-memory and suitable for development.

- Planned upgrade: integrate a persistent store (e.g., Vercel KV or Redis) to ensure consistent limits across cold starts and instances

## API Endpoints

### `/api/analyze`
Analyzes a GitHub repository and returns a security report.

**Method:** POST  
**Body:**
```json
{
  "repositoryUrl": "https://github.com/user/repo",
  "recaptchaToken": "recaptcha_token_here"
}
```

**Response:**
```json
{
  "report": "Security analysis report in markdown format...",
  "repository": {
    "url": "https://github.com/user/repo",
    "owner": "user",
    "name": "repo",
    "language": "JavaScript"
  },
  "timestamp": "2025-01-09T12:00:00Z"
}
```

### `/api/download/markdown`
Generates and downloads a Markdown (.md) file of the report.

### `/api/download/text`
Generates and downloads a Plain Text (.txt) file of the report.

### `/api/download/pdf`
Generates and downloads a PDF (.pdf) file of the report.

## Usage

1. **Enter Repository URL** - Paste a GitHub repository URL in the input field
2. **Start Analysis** - Click the "Scan" button to begin analysis
3. **View Report** - The security report appears in the results panel
4. **Download Report** - Click download buttons to export in your preferred format

## Architecture

- **Stateless Design** - No database, no user sessions, no persistent storage
- **Serverless** - All backend logic runs in Vercel serverless functions
- **Single-Page Application** - No page reloads, smooth user experience
- **CDN Delivery** - Frontend served via Vercel's global CDN

## Development Roadmap

The project follows a staged build plan (see `/Assets/designs/BUILD_PLAN.txt`):

- ✅ **Stage 1:** Project Foundation & Core Infrastructure
- ✅ **Stage 2:** Frontend UI & Layout
- ✅ **Stage 3:** Backend API & GitHub Integration
- ⏳ **Stage 4:** Download Functionality & Report Generation
- ⏳ **Stage 5:** Security Hardening & Production Readiness

See `/Assets/designs/BUILD_PLAN.txt` for detailed implementation stages.

## Contributing

Contributions are welcome! Please follow these guidelines:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Security Considerations

- **No Data Persistence** - Reports are generated on-demand and not stored
- **Generic Error Messages** - No sensitive information leaked to clients
- **Bundle Inspection** - Pre-deployment checks ensure no secrets in build output
- **Secure File Downloads** - Content sanitized before file generation
- **Environment Variables Only** - All secrets must be set via environment variables, never hardcoded

## Browser Support

- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Edge (latest)

## License

ISC

## Support

For issues, questions, or contributions:
- **Issues:** [GitHub Issues](https://github.com/flowinternals/seclens-app/issues)
- **Repository:** [https://github.com/flowinternals/seclens-app](https://github.com/flowinternals/seclens-app)
- **Design Documents:** `/Assets/designs/`

## Acknowledgments

Built with security-by-design principles and modern web technologies.

---

**SecLens** - Security analysis made simple.
