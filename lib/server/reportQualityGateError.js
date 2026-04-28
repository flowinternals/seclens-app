/**
 * Report failed structural or safety validation after optional critic repair.
 */

export class ReportQualityGateError extends Error {
  /**
   * @param {string} message
   * @param {{ correlationId: string, categories: string[] }} meta
   */
  constructor(message, meta) {
    super(message)
    this.name = 'ReportQualityGateError'
    this.code = 'REPORT_QUALITY_GATE'
    this.correlationId = meta.correlationId
    this.categories = meta.categories
  }
}
