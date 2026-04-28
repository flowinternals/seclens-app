/**
 * GitHub API client for fetching repository content
 */

import { sanitizeGitHubUrl, isValidGitHubUrl } from './sanitize.js'

export async function fetchRepositoryContent(repoUrl, options = {}) {
  try {
    // Validate and sanitize repository URL
    if (!repoUrl || typeof repoUrl !== 'string') {
      throw new Error('Repository URL is required')
    }
    
    if (!isValidGitHubUrl(repoUrl)) {
      // Try to sanitize it
      const sanitized = sanitizeGitHubUrl(repoUrl)
      if (!sanitized) {
        throw new Error('Invalid GitHub repository URL format')
      }
      repoUrl = sanitized
    }
    
    // Extract owner and repo from URL (already validated)
    const match = repoUrl.match(/github\.com\/([\w.-]+)\/([\w.-]+)/)
    if (!match) {
      throw new Error('Invalid GitHub repository URL')
    }
    
    const [, owner, repo] = match
    
    // Get GitHub token: prefer request-supplied token, fallback to env (rate limits)
    const githubToken = (options && options.githubToken && typeof options.githubToken === 'string' && options.githubToken.trim())
      ? options.githubToken.trim()
      : (process.env.GITHUB_TOKEN || process.env.GITHUB_API_TOKEN)
    
    // Log token usage only in development and without revealing token
    if (process.env.NODE_ENV === 'development') {
      console.log('Using GitHub token:', githubToken ? 'yes' : 'no')
    }

    // Helper to choose scheme based on token type
    const chooseScheme = (token) => {
      if (!token) return null
      // Fine-grained tokens typically start with 'github_pat_'; classic PAT often 'ghp_'
      if (token.startsWith('github_pat_')) return 'Bearer'
      if (token.startsWith('ghp_')) return 'token'
      // Default to 'token' first for classic PATs; we will retry with 'Bearer' on failure
      return 'token'
    }

    // Build headers (without Authorization first)
    const baseHeaders = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'SecLens-Security-Analyzer'
    }

    const schemesToTry = githubToken ? [chooseScheme(githubToken), 'Bearer', 'token'].filter(Boolean) : []

    async function fetchWithAuth(url, init = {}) {
      // Try unauthenticated first for public repos
      let response = await fetch(url, { headers: baseHeaders, ...init })
      if (response.ok || !githubToken) return response

      // If not ok and we have a token, retry with auth schemes
      for (const scheme of schemesToTry) {
        const headers = { ...baseHeaders, Authorization: `${scheme} ${githubToken}` }
        const retry = await fetch(url, { headers, ...init })
        if (retry.ok) return retry
        // If 401/403/404 against private repo, continue trying next scheme
        response = retry
      }
      return response
    }
    
    // Fetch repository metadata
    const repoResponse = await fetchWithAuth(`https://api.github.com/repos/${owner}/${repo}`)
    
    if (!repoResponse.ok) {
      // Log error details only in development
      if (process.env.NODE_ENV === 'development') {
        try {
          const errText = await repoResponse.text()
          console.error('GitHub repo metadata error:', repoResponse.status, errText?.slice(0, 300))
        } catch {}
      }
      if (repoResponse.status === 404) {
        // 404 for private repos without proper auth; surface clearer message
        const authed = !!githubToken
        throw new Error(authed
          ? 'Repository is private or access is denied with the provided token'
          : 'Repository not found or is private')
      }
      if (repoResponse.status === 401) {
        throw new Error('GitHub token is invalid or expired (401)')
      }
      if (repoResponse.status === 403) {
        // Check rate limit headers
        const rateLimitRemaining = repoResponse.headers.get('x-ratelimit-remaining')
        const rateLimitReset = repoResponse.headers.get('x-ratelimit-reset')
        
        if (rateLimitRemaining === '0') {
          const resetTime = rateLimitReset ? new Date(parseInt(rateLimitReset) * 1000).toISOString() : 'unknown'
          throw new Error(`GitHub API rate limit exceeded. Please try again later (reset at ${resetTime}). Consider setting GITHUB_TOKEN environment variable for higher limits.`)
        }
        throw new Error('GitHub API access forbidden (403). The repository may be private or token lacks repo access.')
      }
      throw new Error(`GitHub API error: ${repoResponse.status}`)
    }
    
    const repoData = await repoResponse.json()
    
    // Fetch repository contents (recursive tree)
    const contentsResponse = await fetchWithAuth(`https://api.github.com/repos/${owner}/${repo}/git/trees/main?recursive=1`)
    
    // Fallback to master branch if main doesn't exist
    let treeData = null
    if (!contentsResponse.ok) {
      if (contentsResponse.status === 403) {
        // Log error details only in development
        if (process.env.NODE_ENV === 'development') {
          try {
            const errText2 = await contentsResponse.text()
            console.error('GitHub tree (main) error:', contentsResponse.status, errText2?.slice(0, 300))
          } catch {}
        }
        throw new Error('GitHub API access forbidden. Rate limit may be exceeded or repository may be private.')
      }
      const masterResponse = await fetchWithAuth(`https://api.github.com/repos/${owner}/${repo}/git/trees/master?recursive=1`)
      if (masterResponse.ok) {
        treeData = await masterResponse.json()
      } else if (masterResponse.status === 403) {
        // Log error details only in development
        if (process.env.NODE_ENV === 'development') {
          try {
            const errText3 = await masterResponse.text()
            console.error('GitHub tree (master) error:', masterResponse.status, errText3?.slice(0, 300))
          } catch {}
        }
        throw new Error('GitHub API access forbidden. Rate limit may be exceeded, or repository is private without sufficient token scope.')
      }
    } else {
      treeData = await contentsResponse.json()
    }
    
    // Fetch key files for analysis (limit to important files)
    const importantFiles = [
      'package.json',
      'package-lock.json',
      'yarn.lock',
      'requirements.txt',
      'Dockerfile',
      '.env.example',
      '.gitignore',
      'README.md',
      'docker-compose.yml'
    ]
    
    const filesToAnalyze = []
    
    if (treeData && treeData.tree) {
      const relevantFiles = treeData.tree.filter(item => 
        item.type === 'blob' && 
        (importantFiles.some(f => item.path.includes(f)) || 
         item.path.endsWith('.js') || 
         item.path.endsWith('.py') || 
         item.path.endsWith('.ts') ||
         item.path.endsWith('.jsx') ||
         item.path.endsWith('.tsx'))
      ).slice(0, 20) // Limit to 20 files for performance
      
      for (const file of relevantFiles.slice(0, 10)) { // Limit to 10 files for API limits
        try {
          const fileResponse = await fetchWithAuth(`https://api.github.com/repos/${owner}/${repo}/contents/${file.path}`)
          
          if (fileResponse.ok) {
            const fileData = await fileResponse.json()
            if (fileData.encoding === 'base64' && fileData.content) {
              filesToAnalyze.push({
                path: file.path,
                content: Buffer.from(fileData.content, 'base64').toString('utf-8')
              })
            }
          } else if (fileResponse.status === 403) {
            console.warn(`Rate limited while fetching ${file.path}, continuing with available files`)
            break // Stop fetching more files if rate limited
          }
        } catch (err) {
          // Log error details only in development
          if (process.env.NODE_ENV === 'development') {
            console.error(`Error fetching file ${file.path}:`, err.message)
          }
        }
      }
    }
    
    if (filesToAnalyze.length === 0) {
      throw new Error('No files could be fetched from the repository. The repository may be empty, private, or GitHub API rate limits have been exceeded.')
    }
    
    return {
      owner,
      repo,
      name: repoData.name,
      description: repoData.description,
      language: repoData.language,
      files: filesToAnalyze,
      url: repoUrl
    }
  } catch (error) {
    // Log error details only in development
    if (process.env.NODE_ENV === 'development') {
      console.error('GitHub API error:', error.message)
    } else {
      console.error('GitHub API error: Request failed')
    }
    throw error
  }
}

