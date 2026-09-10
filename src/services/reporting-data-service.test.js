import { describe, it, expect, vi, beforeEach } from 'vitest'
import { config } from '../config.js'
import * as fsPromises from 'node:fs/promises'
import * as fs from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { stringify } from 'csv-stringify'
import { processRawEvents } from './reporting-data-service.js'
import { AGREEMENT_CREATED, AGREEMENT_STATUS_CHANGED } from '@defra/grants-reporting-publisher/constants'

vi.mock('../config.js', () => ({
  config: {
    get: vi.fn()
  }
}))

vi.mock('@defra/grants-config-utils/s3-interactions', () => ({
  initialiseClient: vi.fn()
}))

vi.mock('@aws-sdk/client-s3', () => ({
  GetObjectCommand: vi.fn()
}))

vi.mock('node:fs/promises', () => ({
  mkdtemp: vi.fn().mockResolvedValue('/tmp/reporting-data-123'),
  rm: vi.fn().mockResolvedValue()
}))

vi.mock('node:fs', () => ({
  createWriteStream: vi.fn().mockReturnValue({})
}))

vi.mock('node:stream/promises', () => ({
  pipeline: vi.fn().mockResolvedValue()
}))

vi.mock('csv-stringify', () => ({
  stringify: vi.fn().mockReturnValue({
    write: vi.fn(),
    end: vi.fn()
  })
}))

describe('reporting-data-service', () => {
  let mockLogger
  let mockS3Client

  beforeEach(() => {
    vi.clearAllMocks()
    mockLogger = {
      info: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    }

    mockS3Client = {
      send: vi.fn()
    }

    config.get.mockImplementation((key) => {
      if (key === 'aws.region') return 'us-east-1'
      if (key === 'aws.endpointUrl') return 'http://localhost:4566'
      if (key === 'aws.s3.forcePathStyle') return true
      if (key === 'aws.s3.rawBucketName') return 'raw-bucket'
      return null
    })
  })

  it('should process events and generate CSV files', async () => {
    const mockFiles = [{ Key: 'event1.json' }, { Key: 'event2.json' }]
    mockS3Client.send
      .mockResolvedValueOnce({
        Body: {
          transformToString: vi.fn().mockResolvedValue(
            JSON.stringify({
              eventData: {
                eventType: AGREEMENT_CREATED,
                sbi: '123456789',
                agreementId: 'AGREE_123',
                agreementType: 'Woodland',
                agreementStatus: 'ON_HOLD',
                agreementStartDate: '2026-01-11T10:00:00.000Z',
                agreementEndDate: '2027-01-11T10:00:00.000Z',
                agreementValue: '354',
                options: [
                  {
                    parcelReference: 'PARCEL_1',
                    parcelSizeUnderAgreement: '10',
                    optionCode: 'OPT_1',
                    optionYear: '2026',
                    optionStartDate: '2026-01-11T10:00:00.000Z',
                    optionEndDate: '2027-01-11T10:00:00.000Z',
                    optionQuantity: '5',
                    optionValue: '100'
                  }
                ]
              }
            })
          )
        }
      })
      .mockResolvedValueOnce({
        Body: {
          transformToString: vi.fn().mockResolvedValue(
            JSON.stringify({
              eventData: {
                eventType: AGREEMENT_STATUS_CHANGED,
                agreementId: 'AGREE_123',
                agreementStatus: 'LIVE',
                statusDate: '2026-02-01T00:00:00.000Z',
                userId: 'user1'
              }
            })
          )
        }
      })

    const tempDir = await processRawEvents(mockS3Client, mockFiles, mockLogger)

    expect(tempDir).toBe('/tmp/reporting-data-123')
    expect(fsPromises.mkdtemp).toHaveBeenCalled()
    expect(stringify).toHaveBeenCalledTimes(4)
    expect(fs.createWriteStream).toHaveBeenCalledTimes(4)
    expect(pipeline).toHaveBeenCalledTimes(4)
    expect(mockS3Client.send).toHaveBeenCalledTimes(2)

    // Check if agreement was written
    const agreementStringifier = vi
      .mocked(stringify)
      .mock.results.find((r) => r.value.write.mock.calls.some((c) => c[0][2] === 'Woodland')).value
    expect(agreementStringifier.write).toHaveBeenCalledWith([
      '123456789',
      'AGREE_123',
      'Woodland',
      'ON_HOLD',
      '2026-01-11T10:00:00.000Z',
      '2027-01-11T10:00:00.000Z',
      '354'
    ])

    expect(mockLogger.info).toHaveBeenCalledWith('All CSV files finalised on disk')
  })

  it('should buffer partial agreement rows and flush them to agreements stringifier', async () => {
    const mockFiles = [{ Key: 'event1.json' }, { Key: 'event2.json' }]
    mockS3Client.send
      .mockResolvedValueOnce({
        Body: {
          transformToString: vi.fn().mockResolvedValue(
            JSON.stringify({
              eventData: {
                eventType: AGREEMENT_CREATED,
                sbi: '123456789',
                agreementId: 'AGREE_PARTIAL',
                agreementType: 'Woodland',
                agreementStatus: 'DRAFT',
                agreementStartDate: null,
                agreementEndDate: null,
                agreementValue: null,
                options: []
              }
            })
          )
        }
      })
      .mockResolvedValueOnce({
        Body: {
          transformToString: vi.fn().mockResolvedValue(
            JSON.stringify({
              eventData: {
                eventType: AGREEMENT_STATUS_CHANGED,
                agreementId: 'AGREE_PARTIAL',
                agreementStatus: 'LIVE',
                statusDate: '2026-02-01T00:00:00.000Z',
                userId: 'user1',
                agreementStartDate: '2026-01-11T10:00:00.000Z',
                agreementEndDate: '2027-01-11T10:00:00.000Z',
                agreementValue: '500'
              }
            })
          )
        }
      })

    await processRawEvents(mockS3Client, mockFiles, mockLogger)

    const agreementStringifier = vi
      .mocked(stringify)
      .mock.results.find((r) => r.value.write.mock.calls.some((c) => c[0][1] === 'AGREE_PARTIAL')).value

    expect(agreementStringifier.write).toHaveBeenCalledWith([
      '123456789',
      'AGREE_PARTIAL',
      'Woodland',
      'DRAFT',
      '2026-01-11T10:00:00.000Z',
      '2027-01-11T10:00:00.000Z',
      '500'
    ])
  })

  it('should handle individual file processing errors', async () => {
    const mockFiles = [{ Key: 'bad.json' }]
    mockS3Client.send.mockRejectedValue(new Error('S3 Error'))

    await processRawEvents(mockS3Client, mockFiles, mockLogger)

    expect(mockLogger.error).toHaveBeenCalledWith(new Error('S3 Error'), 'Failed to process individual file - bad.json')
  })

  it('should throw and cleanup on major error', async () => {
    const error = new Error('Major failure')
    fsPromises.mkdtemp.mockRejectedValueOnce(error)

    await expect(processRawEvents(mockS3Client, [], mockLogger)).rejects.toThrow('Major failure')
    expect(mockLogger.error).toHaveBeenCalledWith(error, 'Error generating CSV files')
    // rm not called because tempDir was never set
    expect(fsPromises.rm).not.toHaveBeenCalled()
  })

  it('should handle unknown event types gracefully', async () => {
    const mockFiles = [{ Key: 'unknown.json' }]
    mockS3Client.send.mockResolvedValueOnce({
      Body: {
        transformToString: vi.fn().mockResolvedValue(
          JSON.stringify({
            eventData: {
              eventType: 'UNKNOWN_EVENT'
            }
          })
        )
      }
    })

    await processRawEvents(mockS3Client, mockFiles, mockLogger)

    expect(mockLogger.error).toHaveBeenCalledWith(
      new Error('Unknown event type: UNKNOWN_EVENT'),
      'Failed to process individual file - unknown.json'
    )
  })

  it('should handle error when rm fails during cleanup', async () => {
    const pipelineError = new Error('Pipeline failure')
    const rmError = new Error('RM failure')
    vi.mocked(pipeline).mockRejectedValueOnce(pipelineError)
    fsPromises.rm.mockRejectedValueOnce(rmError)

    await expect(processRawEvents(mockS3Client, [{ Key: 'any.json' }], mockLogger)).rejects.toThrow('Pipeline failure')
    expect(mockLogger.error).toHaveBeenCalledWith(rmError, 'Failed to clean up temporary directory after error')
  })
})
