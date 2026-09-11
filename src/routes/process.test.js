import { describe, it, expect, vi, beforeEach } from 'vitest'
import { process, triggerJob } from './process.js'
import { acquireLock } from '#/common/helpers/mongo-lock.js'
import { processReportingDataJob } from '#/scheduled/process-reporting-data.js'

vi.mock('#/common/helpers/mongo-lock.js', () => ({
  acquireLock: vi.fn()
}))

vi.mock('#/scheduled/process-reporting-data.js', () => ({
  processReportingDataJob: vi.fn()
}))

describe('process route', () => {
  let mockServer
  let mockRequest
  let mockH
  let mockLock

  beforeEach(() => {
    vi.clearAllMocks()

    mockLock = {
      free: vi.fn().mockResolvedValue(true)
    }

    mockServer = {
      locker: {},
      logger: {
        info: vi.fn(),
        error: vi.fn()
      }
    }

    mockRequest = {
      server: mockServer
    }

    mockH = {
      response: vi.fn().mockImplementation((payload) => payload)
    }
  })

  describe('route configuration', () => {
    it('should configure GET /process route', () => {
      expect(process.method).toBe('GET')
      expect(process.path).toBe('/process')
      expect(typeof process.handler).toBe('function')
    })
  })

  describe('handler', () => {
    it('should return immediate success response', () => {
      acquireLock.mockResolvedValue(mockLock)

      const result = process.handler(mockRequest, mockH)

      expect(mockH.response).toHaveBeenCalledWith({ message: 'success' })
      expect(result).toEqual({ message: 'success' })
    })
  })

  describe('triggerJob', () => {
    it('should acquire lock, run job, and release lock on success', async () => {
      acquireLock.mockResolvedValue(mockLock)
      processReportingDataJob.mockResolvedValue()

      await triggerJob(mockServer)

      expect(acquireLock).toHaveBeenCalledWith(mockServer.locker, 'processReportingData', mockServer.logger)
      expect(processReportingDataJob).toHaveBeenCalledWith(mockServer)
      expect(mockLock.free).toHaveBeenCalled()
    })

    it('should not run job if lock cannot be acquired', async () => {
      acquireLock.mockResolvedValue(null)

      await triggerJob(mockServer)

      expect(acquireLock).toHaveBeenCalledWith(mockServer.locker, 'processReportingData', mockServer.logger)
      expect(processReportingDataJob).not.toHaveBeenCalled()
      expect(mockLock.free).not.toHaveBeenCalled()
    })

    it('should release lock and log error if processReportingDataJob throws', async () => {
      const error = new Error('Job execution failed')
      acquireLock.mockResolvedValue(mockLock)
      processReportingDataJob.mockRejectedValue(error)

      await triggerJob(mockServer)

      expect(acquireLock).toHaveBeenCalledWith(mockServer.locker, 'processReportingData', mockServer.logger)
      expect(processReportingDataJob).toHaveBeenCalledWith(mockServer)
      expect(mockServer.logger.error).toHaveBeenCalledWith(error, 'Error running process reporting data job')
      expect(mockLock.free).toHaveBeenCalled()
    })

    it('should log error if lock.free throws', async () => {
      const lockError = new Error('Free lock failed')
      mockLock.free.mockRejectedValue(lockError)
      acquireLock.mockResolvedValue(mockLock)
      processReportingDataJob.mockResolvedValue()

      await triggerJob(mockServer)

      expect(mockServer.logger.error).toHaveBeenCalledWith(lockError, 'Failed to release lock for processReportingData')
    })
  })
})
