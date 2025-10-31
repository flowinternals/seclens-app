/**
 * OpenAI API client for security analysis
 */

import OpenAI from 'openai'

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY
  
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is not set')
  }
  
  return new OpenAI({ apiKey })
}

export async function analyzeSecurity(repoData) {
  const client = getOpenAIClient()
  
  // Validate repoData
  if (!repoData || !repoData.files || !Array.isArray(repoData.files)) {
    throw new Error('Invalid repository data: files array is missing or invalid')
  }
  
  // Prepare file contents for analysis
  const fileContents = repoData.files.length > 0
    ? repoData.files
        .map(file => `File: ${file.path}\n\`\`\`\n${file.content.slice(0, 2000)}\n\`\`\`\n`)
        .join('\n---\n\n')
    : 'No files found in repository'
  
  const systemPrompt = `You are a security analysis expert. Analyze code repositories for security vulnerabilities, best practices, and potential security issues. Provide a comprehensive security report in markdown format.`

  const userPrompt = `Analyze the following GitHub repository for security vulnerabilities and provide recommendations:

Repository: ${repoData.owner}/${repoData.repo}
Description: ${repoData.description || 'No description'}
Primary Language: ${repoData.language || 'Unknown'}

Files to analyze:
${fileContents}

Please provide a comprehensive security analysis report in markdown format covering:
1. Executive Summary
2. Security Vulnerabilities Found (with severity levels)
3. Code Quality Issues
4. Best Practices Recommendations
5. Specific Remediation Steps

Format the report in a clear, professional markdown format suitable for developers and security teams.`

  try {
    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini', // Using gpt-4o-mini for cost efficiency
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      max_tokens: 2000,
      temperature: 0.3
    })
    
    const report = completion.choices[0]?.message?.content
    
    if (!report) {
      throw new Error('No response from OpenAI API')
    }
    
    return report
  } catch (error) {
    console.error('OpenAI API error:', error)
    console.error('Error type:', error.constructor.name)
    console.error('Error message:', error.message)
    console.error('Error status:', error.status)
    console.error('Error response:', error.response)
    
    if (error.status === 401) {
      throw new Error('Invalid OpenAI API key')
    } else if (error.status === 429) {
      throw new Error('OpenAI API rate limit exceeded')
    } else if (error.status === 500) {
      throw new Error('OpenAI API server error')
    }
    
    throw new Error(`Failed to generate security analysis: ${error.message}`)
  }
}

