export const ADVISORY_CONTRACT_VERSION = 'SECLENS-ADVISORY-CONTRACT-V1'

export const ADVISORY_ALLOWED_STATUS = Object.freeze([
  'RUNNING',
  'SUCCESS',
  'WARNING',
  'FAILED',
  'SKIPPED',
])

export const ADVISORY_ALLOWED_APPLICABILITY = Object.freeze(['applicable', 'not_applicable'])

export const ADVISORY_STATUS_REQUIRING_REASON = new Set(['WARNING', 'FAILED', 'SKIPPED'])

export const ADVISORY_PROHIBITED_TERMS = Object.freeze([
  'scanner confirmed',
  'confirmed vulnerability',
  'vulnerability found',
  'exploit confirmed',
  'unsafe code',
  'security failure proven',
  'no vulnerabilities found',
  'clean and secure',
])

export function advisoryStatusRequiresReasonCode(status) {
  return ADVISORY_STATUS_REQUIRING_REASON.has(String(status || '').toUpperCase())
}

export function isAllowedAdvisoryStatus(status) {
  return ADVISORY_ALLOWED_STATUS.includes(String(status || '').toUpperCase())
}

export function isAllowedAdvisoryApplicability(applicability) {
  return ADVISORY_ALLOWED_APPLICABILITY.includes(String(applicability || '').toLowerCase())
}

