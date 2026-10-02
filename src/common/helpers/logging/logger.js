import { pino } from 'pino'

import { loggerOptions } from '#/plugins/logger-options.js'

const logger = pino(loggerOptions)

export function createLogger() {
  return logger
}

export const trackEvent = (loggerInstance, type, category, properties) => {
  loggerInstance.info({
    event: {
      type,
      category,
      ...properties
    }
  })
}
