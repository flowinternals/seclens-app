import { writeFileSync, readdirSync, existsSync } from 'fs'

const dir = 'd:/Active/flowinternals-seclens-app/api/admin/runs'
// Avoid path.join: on Windows '/' inside the name is treated as a separator.
const postMortemPath = `${dir}/[runId]-post-mortem.js`
writeFileSync(postMortemPath, "export { default } from './[[...route]].js'\n")
// Desired import path uses a hyphen-less Vercel-style name; create via unicode? No —
// Vercel/local expect literally: [runId]/post-mortem.js which Windows path APIs
// cannot express as a single segment when '/' is a separator.
// Use the Express-compatible hyphen form AND a note in server if needed.
console.log('wrote', postMortemPath, existsSync(postMortemPath))
console.log(readdirSync(dir))
