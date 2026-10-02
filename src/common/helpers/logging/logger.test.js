import { createLogger, trackEvent } from './logger.js'

describe('logger', () => {
  test('createLogger returns a pino logger instance', () => {
    const logger = createLogger()
    expect(logger).toBeDefined()
    expect(typeof logger.info).toBe('function')
    expect(typeof logger.error).toBe('function')
  })

  test('trackEvent logs an info entry with the expected structure', () => {
    const logger = createLogger()
    const spy = vi.spyOn(logger, 'info').mockImplementation(() => {})

    const category = 'test-category'
    const type = 'example-event'

    trackEvent(logger, type, category, { ref: '12345' })

    expect(spy).toHaveBeenCalledWith({
      event: {
        type,
        category,
        ref: '12345'
      }
    })

    spy.mockRestore()
  })
})
