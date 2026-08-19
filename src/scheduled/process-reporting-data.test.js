import { describe, it, expect, vi, beforeEach } from 'vitest'
import cron from 'node-cron'
import { config } from '../config.js'
import { initialiseClient, listAllFiles } from '@defra/grants-config-utils/s3-interactions'
import { createS3Client } from '@defra/grants-config-utils/s3-client'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { startProcessReportingDataJob, processReportingDataJob } from './process-reporting-data.js'

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
  PutObjectCommand: vi.fn()
}))

describe('process-reporting-data', () => {
  let mockServer

  beforeEach(() => {
    vi.clearAllMocks()
    mockServer = {
      logger: {
        info: vi.fn(),
        error: vi.fn()
      },
      sharepoint: {
        createDirectoryAndUploadFiles: vi.fn()
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
      expect(mockServer.logger.info).toHaveBeenCalledWith(
        'Process reporting data scheduled job started with schedule 0 0 * * *'
      )

      // Verify callback
      const callback = cron.schedule.mock.calls[0][1]

      // We need to mock some stuff for processReportingDataJob to not fail
      listAllFiles.mockResolvedValue([])
      createS3Client.mockReturnValue({ send: vi.fn().mockResolvedValue({}) })

      callback()

      expect(mockServer.logger.info).toHaveBeenCalledWith('Running processReportingData job..')
    })
  })

  describe('processReportingDataJob', () => {
    it('should process reporting data successfully', async () => {
      const mockFiles = ['file1.json', 'file2.json']
      listAllFiles.mockResolvedValue(mockFiles)

      const mockS3Client = {
        send: vi.fn().mockResolvedValue({})
      }
      createS3Client.mockReturnValue(mockS3Client)

      config.get.mockImplementation((key) => {
        if (key === 'aws.region') return 'us-east-1'
        if (key === 'aws.endpointUrl') return 'http://localhost:4566'
        if (key === 'aws.s3.forcePathStyle') return true
        if (key === 'aws.s3.rawBucketName') return 'my-raw-bucket'
        if (key === 'aws.s3.outputBucketName') return 'my-output-bucket'
        if (key === 'cdpEnvironment') return 'dev'
        return null
      })

      // We need to fix the bug in the code where it calls server.logger as a function
      // for this test to pass if we are testing the current state.
      // But let's see it fail first.

      await processReportingDataJob(mockServer)

      expect(initialiseClient).toHaveBeenCalledWith({
        region: 'us-east-1',
        endpoint: 'http://localhost:4566',
        forcePathStyle: true,
        bucketNameOverride: 'my-raw-bucket'
      })

      expect(listAllFiles).toHaveBeenCalledWith(mockServer.logger)
      expect(mockServer.logger.info).toHaveBeenCalledWith(expect.stringContaining('Reporting events files found:'))

      expect(createS3Client).toHaveBeenCalledWith({
        region: 'us-east-1',
        endpoint: 'http://localhost:4566',
        forcePathStyle: true
      })

      expect(PutObjectCommand).toHaveBeenCalledTimes(2)
      expect(mockS3Client.send).toHaveBeenCalledTimes(2)

      expect(mockServer.sharepoint.createDirectoryAndUploadFiles).toHaveBeenCalledWith(
        expect.stringMatching(/^dev\/\d{4}\/\d{2}$/),
        [
          { name: 'example1.csv', content: 'A,B,C' },
          { name: 'example2.csv', content: 'E,F,G' }
        ]
      )

      expect(mockServer.logger.info).toHaveBeenCalledWith('Process reporting data job completed successfully')
    })

    it('should log an error if job fails', async () => {
      const error = new Error('Some error')
      listAllFiles.mockRejectedValue(error)

      await processReportingDataJob(mockServer)

      expect(mockServer.logger.error).toHaveBeenCalledWith(error, 'Error running processReportingData job')
    })
  })
})
