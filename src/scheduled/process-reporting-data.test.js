import { describe, it, expect, vi, beforeEach } from 'vitest'
import cron from 'node-cron'
import { config } from '../config.js'
import { initialiseClient, listAllFiles } from '@defra/grants-config-utils/s3-interactions'
import { createS3Client } from '@defra/grants-config-utils/s3-client'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import * as fsPromises from 'node:fs/promises'
import { startProcessReportingDataJob, processReportingDataJob } from './process-reporting-data.js'
import { processRawEvents } from '../services/reporting-data-service.js'

vi.mock('node-cron', () => ({
  default: {
    schedule: vi.fn()
  }
}))

vi.mock('../config.js', () => ({
  config: {
    get: vi.fn()
  }
}))

vi.mock('@defra/grants-config-utils/s3-interactions', () => ({
  initialiseClient: vi.fn(),
  listAllFiles: vi.fn()
}))

vi.mock('@defra/grants-config-utils/s3-client', () => ({
  createS3Client: vi.fn()
}))

vi.mock('@aws-sdk/client-s3', () => ({
  PutObjectCommand: vi.fn(),
  GetObjectCommand: vi.fn()
}))

vi.mock('../services/reporting-data-service.js', () => ({
  processRawEvents: vi.fn()
}))

vi.mock('node:fs/promises', () => ({
  rm: vi.fn().mockResolvedValue(),
  readdir: vi.fn().mockResolvedValue(['events.csv']),
  readFile: vi.fn().mockResolvedValue(Buffer.from('csv-content'))
}))

vi.mock('node:fs', () => ({
  createReadStream: vi.fn().mockReturnValue({})
}))

describe('process-reporting-data', () => {
  let mockServer

  beforeEach(() => {
    vi.clearAllMocks()
    mockServer = {
      logger: {
        info: vi.fn(),
        error: vi.fn(),
        debug: vi.fn()
      },
      sharepoint: {
        createDirectory: vi.fn().mockResolvedValue(),
        uploadFile: vi.fn().mockResolvedValue()
      }
    }
  })

  describe('startProcessReportingDataJob', () => {
    it('should schedule the job correctly', () => {
      config.get.mockReturnValue('0 0 * * *')
      startProcessReportingDataJob(mockServer)
      expect(cron.schedule).toHaveBeenCalledWith('0 0 * * *', expect.any(Function), {
        scheduled: true,
        timezone: 'UTC'
      })
    })
  })

  describe('processReportingDataJob', () => {
    it('should process reporting data successfully', async () => {
      const mockFiles = [{ Key: 'file1.json' }]
      listAllFiles.mockResolvedValue(mockFiles)
      processRawEvents.mockResolvedValue('/tmp/reporting-data-123')

      const mockS3Client = {
        send: vi.fn().mockResolvedValue({})
      }
      initialiseClient.mockReturnValue(mockS3Client)
      createS3Client.mockReturnValue(mockS3Client)

      config.get.mockImplementation((key) => {
        if (key === 'aws.region') return 'us-east-1'
        if (key === 'aws.endpointUrl') return 'http://localhost:4566'
        if (key === 'aws.s3.forcePathStyle') return true
        if (key === 'aws.s3.rawBucketName') return 'raw-bucket'
        if (key === 'aws.s3.outputBucketName') return 'output-bucket'
        if (key === 'cdpEnvironment') return 'dev'
        return null
      })

      await processReportingDataJob(mockServer)

      expect(initialiseClient).toHaveBeenCalledWith({
        region: 'us-east-1',
        endpoint: 'http://localhost:4566',
        forcePathStyle: true,
        bucketNameOverride: 'raw-bucket'
      })
      expect(listAllFiles).toHaveBeenCalledWith(mockServer.logger)
      expect(processRawEvents).toHaveBeenCalledWith(mockS3Client, mockFiles, mockServer.logger)
      expect(fsPromises.readdir).toHaveBeenCalledWith('/tmp/reporting-data-123')
      expect(mockServer.sharepoint.createDirectory).toHaveBeenCalledWith(
        expect.stringMatching(/^Reporting\/dev\/\d{4}\/\d{2}$/)
      )
      expect(mockS3Client.send).toHaveBeenCalledWith(expect.any(PutObjectCommand))
      expect(mockServer.sharepoint.uploadFile).toHaveBeenCalled()
      expect(fsPromises.rm).toHaveBeenCalledWith('/tmp/reporting-data-123', expect.any(Object))
      expect(mockServer.logger.info).toHaveBeenCalledWith('Process reporting data job completed successfully')
    })

    it('should not call processRawEvents if no files found', async () => {
      listAllFiles.mockResolvedValue([])

      await processReportingDataJob(mockServer)

      expect(listAllFiles).toHaveBeenCalled()
      expect(processRawEvents).not.toHaveBeenCalled()
      expect(mockServer.logger.info).toHaveBeenCalledWith('No files to process')
    })

    it('should log an error if job fails', async () => {
      const error = new Error('Major failure')
      listAllFiles.mockRejectedValue(error)

      await processReportingDataJob(mockServer)

      expect(mockServer.logger.error).toHaveBeenCalledWith(error, 'Error running processReportingData job - {}')
    })
  })
})
