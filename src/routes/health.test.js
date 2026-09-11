import { describe, it, expect, vi } from 'vitest'
import { health } from './health.js'

describe('health route', () => {
  it('should configure GET /health route', () => {
    expect(health.method).toBe('GET')
    expect(health.path).toBe('/health')
    expect(typeof health.handler).toBe('function')
  })

  it('should return success response', () => {
    const mockH = {
      response: vi.fn().mockImplementation((payload) => payload)
    }

    const result = health.handler({}, mockH)

    expect(mockH.response).toHaveBeenCalledWith({ message: 'success' })
    expect(result).toEqual({ message: 'success' })
  })
})
