/**
 * Local API server for E2E testing
 * Mirrors Vercel serverless function structure
 * Run with: npm run dev:api
 */

import express from 'express'
import cors from 'cors'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import dotenv from 'dotenv'
import fs from 'fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Load environment variables from .env.local using absolute path
const envPath = join(__dirname, '.env.local')
console.log('Loading environment from:', envPath)

// Check if file exists
if (fs.existsSync(envPath)) {
  console.log('✓ .env.local file exists')
  
  // Try loading .env.local first
  const envResult = dotenv.config({ path: envPath })
  if (envResult.error) {
    console.log('⚠️  Warning: Could not load .env.local:', envResult.error.message)
  } else {
    if (envResult.parsed && Object.keys(envResult.parsed).length > 0) {
      console.log('✓ Loaded .env.local successfully with dotenv')
      console.log('   Variables loaded:', Object.keys(envResult.parsed).join(', '))
    } else {
      console.log('⚠️  .env.local file exists but dotenv parsed nothing, trying manual parse...')
      // Try reading file directly
      try {
        const fileContent = fs.readFileSync(envPath, 'utf-8')
        // Handle both Windows (CRLF) and Unix (LF) line endings
        const lines = fileContent.split(/\r?\n/).filter(line => {
          const trimmed = line.trim()
          return trimmed && !trimmed.startsWith('#')
        })
        console.log('   File has', lines.length, 'non-empty lines')
        // Manually parse
        let loadedCount = 0
        lines.forEach((line, index) => {
          const trimmed = line.trim()
          // Remove any trailing carriage returns or spaces
          const cleanLine = trimmed.replace(/\r$/, '')
          
          // Try to match KEY=VALUE pattern
          const match = cleanLine.match(/^([^=]+)=(.*)$/)
          if (match) {
            const key = match[1].trim()
            const value = match[2].trim()
            if (key && value) {
              if (!process.env[key]) {
                process.env[key] = value
                loadedCount++
                console.log(`   ✓ Manually loaded: ${key}`)
              } else {
                console.log(`   ⚠ Already set: ${key}`)
              }
            } else {
              console.log(`   ⚠ Invalid line ${index + 1}: empty key or value`)
            }
          } else {
            console.log(`   ⚠ Line ${index + 1} doesn't match pattern: ${JSON.stringify(cleanLine.substring(0, 50))}`)
          }
        })
        if (loadedCount > 0) {
          console.log(`✓ Manually loaded ${loadedCount} environment variables`)
        } else {
          console.log('⚠️  No variables could be parsed from file')
        }
      } catch (err) {
        console.log('   Error reading file:', err.message)
      }
    }
  }
} else {
  console.log('⚠️  .env.local file not found at:', envPath)
}

// Also try loading from current directory (fallback)
dotenv.config() // Also load from .env if it exists

console.log('Environment check:')
console.log('  NODE_ENV:', process.env.NODE_ENV || 'not set')
console.log('  OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? `${process.env.OPENAI_API_KEY.substring(0, 10)}...` : 'NOT SET')
console.log('  Looking for .env.local at:', envPath)

// Set NODE_ENV to development if not set
if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = 'development'
}

const app = express()
const PORT = process.env.PORT || 3001

// Trust proxy for IP detection
app.set('trust proxy', true)

// CORS middleware - allow all origins in development
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps, curl, Postman, or proxied requests)
    if (!origin) return callback(null, true)
    
    const allowedOrigins = ['http://localhost:3000', 'http://localhost:5173', 'http://127.0.0.1:3000', 'http://127.0.0.1:5173']
    if (allowedOrigins.indexOf(origin) !== -1 || process.env.NODE_ENV === 'development') {
      callback(null, true)
    } else {
      callback(new Error('Not allowed by CORS'))
    }
  },
  credentials: true
}))

// Body parsing middleware
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// Request logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`)
  next()
})

// Mock Vercel request/response objects
function createVercelHandler(handler) {
  return async (req, res) => {
    // Convert Express req/res to Vercel-like format
    const vercelReq = {
      method: req.method,
      headers: req.headers,
      body: req.body,
      query: req.query,
      url: req.url,
      ip: req.ip || req.socket?.remoteAddress
    }

    let responseSent = false

    const vercelRes = {
      status: (code) => {
        if (!responseSent && !res.headersSent) {
          res.status(code)
        }
        return vercelRes
      },
      json: (data) => {
        if (!responseSent && !res.headersSent) {
          responseSent = true
          try {
            // Set content-type header explicitly
            res.setHeader('Content-Type', 'application/json')
            res.json(data)
          } catch (err) {
            console.error('Error sending JSON response:', err)
            responseSent = true // Mark as sent even if error
            // Try to send error response
            if (!res.headersSent) {
              try {
                res.status(500).send(JSON.stringify({ error: 'Failed to send response' }))
              } catch (e) {
                console.error('Failed to send error response:', e)
              }
            }
          }
        }
        return vercelRes
      },
      send: (data) => {
        if (!responseSent && !res.headersSent) {
          responseSent = true
          try {
            res.send(data)
          } catch (err) {
            console.error('Error sending response:', err)
            responseSent = true
          }
        }
        return vercelRes
      },
      end: () => {
        if (!responseSent && !res.headersSent) {
          responseSent = true
          try {
            res.end()
          } catch (err) {
            console.error('Error ending response:', err)
            responseSent = true
          }
        }
        return vercelRes
      },
      setHeader: (key, value) => {
        if (!responseSent && !res.headersSent) {
          res.setHeader(key, value)
        }
        return vercelRes
      },
      headers: res.headers
    }

    try {
      console.log('Calling handler with:', {
        method: vercelReq.method,
        url: vercelReq.url,
        hasBody: !!vercelReq.body
      })
      
      const result = await handler(vercelReq, vercelRes)
      
      // If handler returns a promise that resolves, check if response was sent
      if (result && typeof result.then === 'function') {
        await result
      }
      
      // If handler didn't send a response, send a default one
      if (!responseSent && !res.headersSent) {
        console.warn('Handler did not send a response')
        try {
          res.status(500).json({ error: 'Handler did not send a response' })
        } catch (sendError) {
          console.error('Failed to send default response:', sendError)
        }
      } else {
        console.log('Handler completed successfully, response sent:', responseSent)
      }
    } catch (error) {
      console.error('Handler error:', error)
      console.error('Error name:', error.name)
      console.error('Error message:', error.message)
      console.error('Error stack:', error.stack)
      if (!responseSent && !res.headersSent) {
        try {
          res.status(500).json({ 
            error: 'Internal server error',
            message: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
          })
        } catch (jsonError) {
          console.error('Failed to send JSON error response:', jsonError)
          try {
            res.status(500).send(`Internal server error: ${error.message}`)
          } catch (sendError) {
            console.error('Failed to send text error response:', sendError)
          }
        }
      }
    }
  }
}

// Import and register API routes
async function registerRoutes() {
  try {
    console.log('Registering API routes...')
    // Health endpoint
    app.get('/api/health', (req, res) => {
      res.json({
        status: 'ok',
        nodeEnv: process.env.NODE_ENV || 'development',
        hasOpenAIKey: !!process.env.OPENAI_API_KEY,
        hasGitHubToken: !!(process.env.GITHUB_TOKEN || process.env.GITHUB_API_TOKEN)
      })
    })
    console.log('✓ Registered /api/health')
    
    // Analyze endpoint
    const analyzeHandler = await import('./api/analyze.js')
    app.post('/api/analyze', createVercelHandler(analyzeHandler.default))
    app.options('/api/analyze', (req, res) => {
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
      res.status(204).end()
    })
    console.log('✓ Registered /api/analyze')

    // Download endpoints
    const markdownHandler = await import('./api/download/markdown.js')
    app.post('/api/download/markdown', createVercelHandler(markdownHandler.default))
    app.options('/api/download/markdown', (req, res) => {
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
      res.status(204).end()
    })
    console.log('✓ Registered /api/download/markdown')

    const textHandler = await import('./api/download/text.js')
    app.post('/api/download/text', createVercelHandler(textHandler.default))
    app.options('/api/download/text', (req, res) => {
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
      res.status(204).end()
    })
    console.log('✓ Registered /api/download/text')

    const pdfHandler = await import('./api/download/pdf.js')
    app.post('/api/download/pdf', createVercelHandler(pdfHandler.default))
    app.options('/api/download/pdf', (req, res) => {
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
      res.status(204).end()
    })
    console.log('✓ Registered /api/download/pdf')

    console.log('✓ All API routes registered')
  } catch (error) {
    console.error('Error registering routes:', error)
    console.error('Error stack:', error.stack)
    throw error
  }
}

// Start server
async function startServer() {
  try {
    await registerRoutes()

    app.listen(PORT, () => {
      console.log(`\n🚀 Local API server running on http://localhost:${PORT}`)
      console.log(`📡 API endpoints available:`)
      console.log(`   POST http://localhost:${PORT}/api/analyze`)
      console.log(`   POST http://localhost:${PORT}/api/download/markdown`)
      console.log(`   POST http://localhost:${PORT}/api/download/text`)
      console.log(`   POST http://localhost:${PORT}/api/download/pdf`)
      console.log(`\n💡 Environment check:`)
      if (!process.env.OPENAI_API_KEY) {
        console.log(`⚠️  WARNING: OPENAI_API_KEY is not set!`)
      } else {
        console.log(`✓ OPENAI_API_KEY is configured`)
        console.log(`   Key starts with: ${process.env.OPENAI_API_KEY.substring(0, 10)}...`)
      }
      if (process.env.GITHUB_TOKEN || process.env.GITHUB_API_TOKEN) {
        const tok = process.env.GITHUB_TOKEN || process.env.GITHUB_API_TOKEN
        console.log(`✓ GitHub token detected (starts with: ${tok.substring(0, 6)}...)`)
      } else {
        console.log('⚠️  GITHUB_TOKEN not set (higher GitHub API limits unavailable)')
      }
      console.log()
    })
  } catch (error) {
    console.error('Failed to start server:', error)
    console.error('Error stack:', error.stack)
    process.exit(1)
  }
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason)
  if (reason instanceof Error) {
    console.error('Error stack:', reason.stack)
  }
})

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error)
  console.error('Error stack:', error.stack)
  process.exit(1)
})

startServer().catch(console.error)
