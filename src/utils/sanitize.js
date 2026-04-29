import DOMPurify from 'dompurify';

/**
 * Sanitizes HTML content to prevent XSS attacks
 * @param {string} html - HTML string to sanitize
 * @returns {string} Sanitized HTML string
 */
export function sanitizeHtml(html) {
  if (!html || typeof html !== 'string') return '';
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'code', 'pre', 'blockquote'],
    ALLOWED_ATTR: [],
    KEEP_CONTENT: true
  });
}

/**
 * Sanitizes plain text to prevent XSS attacks
 * Escapes HTML special characters
 * @param {string} text - Text string to sanitize
 * @returns {string} Sanitized text string
 */
export function sanitizeText(text) {
  if (!text || typeof text !== 'string') return '';
  
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

/**
 * Validates GitHub repository URL format
 * @param {string} url - URL to validate
 * @returns {boolean} True if valid GitHub URL format
 */
export function isValidGitHubUrl(url) {
  if (!url || typeof url !== 'string') return false;
  
  const githubUrlPattern =
    /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(?:\/tree\/(?:[A-Za-z0-9._/-]+))?\/?$/;
  return githubUrlPattern.test(url.trim());
}

function isSafeGitRef(ref) {
  if (!ref || typeof ref !== 'string') return false;
  const trimmed = ref.trim();
  if (!trimmed || trimmed.length > 255) return false;
  if (trimmed.startsWith('/') || trimmed.endsWith('/')) return false;
  if (trimmed.includes('..') || trimmed.includes('@{') || trimmed.includes('\\')) return false;
  if (trimmed.endsWith('.lock') || /\s/.test(trimmed)) return false;
  return /^[A-Za-z0-9._/-]+$/.test(trimmed);
}

/**
 * Sanitizes a GitHub URL by extracting and validating the repository path
 * @param {string} url - GitHub URL to sanitize
 * @returns {string|null} Sanitized URL or null if invalid
 */
export function sanitizeGitHubUrl(url) {
  if (!url || typeof url !== 'string') return null;
  
  const trimmed = url.trim();
  const unsafeTreeRefPattern = /\/tree\/[^?#]*(\.\.|@{|\\|\s)/;
  if (unsafeTreeRefPattern.test(trimmed)) return null;

  const normalized = trimmed.startsWith('http://') || trimmed.startsWith('https://') ? trimmed : `https://${trimmed}`;
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    return null;
  }

  if (parsed.hostname !== 'github.com') return null;

  const segments = parsed.pathname.split('/').filter(Boolean);
  if (segments.length < 2) return null;

  const owner = segments[0];
  const repo = segments[1].replace(/\.git$/i, '');
  let sanitized = `https://github.com/${owner}/${repo}`;

  if (segments[2] === 'tree' && segments.length >= 4) {
    const ref = decodeURIComponent(segments.slice(3).join('/'));
    if (!isSafeGitRef(ref)) return null;
    sanitized = `${sanitized}/tree/${ref}`;
  }
  
  // Validate the sanitized URL
  if (isValidGitHubUrl(sanitized)) {
    return sanitized;
  }
  
  return null;
}

