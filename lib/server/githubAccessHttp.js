/**
 * Map GitHub access errors (from probeGithubRepositoryAccess / fetchRepositoryContent) to HTTP status + JSON.
 * @param {unknown} error
 * @returns {{ status: number, body: Record<string, unknown> }}
 */
export function githubAccessFailureHttp(error) {
  const msg = error instanceof Error ? error.message : String(error || '')

  if (msg.includes('invalid or expired (401)') || msg.includes('GitHub token is invalid')) {
    return { status: 401, body: { error: 'GitHub token invalid or expired.' } }
  }

  if (msg.includes('not found') && !msg.includes('private') && !msg.includes('Repository not found, or')) {
    return { status: 404, body: { error: 'Repository not found.' } }
  }

  if (
    msg.includes('private') ||
    msg.includes('access is denied') ||
    msg.includes('403') ||
    msg.toLowerCase().includes('forbidden') ||
    msg.includes('Repository not found, or')
  ) {
    return {
      status: 403,
      body: {
        error:
          'Access to the repository was denied. For a private repository, enable "Private repository" and paste a read-only GitHub token with repo access (or set GITHUB_TOKEN on the server).',
        ...(process.env.NODE_ENV === 'development' && { details: msg }),
      },
    }
  }

  if (msg.includes('not found')) {
    return { status: 404, body: { error: 'Repository not found.' } }
  }

  if (msg.includes('rate limit exceeded')) {
    return {
      status: 429,
      body: {
        error: msg,
      },
    }
  }

  return {
    status: 400,
    body: {
      error: msg || 'Repository access check failed.',
      ...(process.env.NODE_ENV === 'development' && error instanceof Error && { details: error.message }),
    },
  }
}
