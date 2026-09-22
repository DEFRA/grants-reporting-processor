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
  stringify: vi.fn().mockImplementation(() => ({
    write: vi.fn(),
    end: vi.fn()
  }))
}))

describe('reporting-data-service', () => {
  let mockLogger
  let mockS3Client
  let mockMetrics

  beforeEach(() => {
    vi.clearAllMocks()
    mockLogger = {
      info: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    }

    mockMetrics = {
      counter: vi.fn()
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
      'LIVE',
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
      'LIVE',
      '2026-01-11T10:00:00.000Z',
      '2027-01-11T10:00:00.000Z',
      '500'
    ])
  })

  it('should handle option data with missing optional fields in AGREEMENT_CREATED event', async () => {
    const mockFiles = [{ Key: 'event1.json' }]
    mockS3Client.send.mockResolvedValueOnce({
      Body: {
        transformToString: vi.fn().mockResolvedValue(
          JSON.stringify({
            eventData: {
              eventType: AGREEMENT_CREATED,
              sbi: '123456789',
              agreementId: 'AGREE_OPT_MINIMAL',
              agreementType: 'Woodland',
              agreementStatus: 'LIVE',
              agreementStartDate: '2026-01-01T00:00:00.000Z',
              agreementEndDate: '2027-01-01T00:00:00.000Z',
              agreementValue: '1000',
              options: [
                {
                  parcelReference: 'PARCEL_MINIMAL',
                  optionCode: 'OPT_MIN'
                }
              ]
            }
          })
        )
      }
    })

    await processRawEvents(mockS3Client, mockFiles, mockLogger)

    const optionDataStringifier = vi
      .mocked(stringify)
      .mock.results.find((r) => r.value.write.mock.calls.some((c) => c[0][0] === 'AGREE_OPT_MINIMAL')).value

    expect(optionDataStringifier.write).toHaveBeenCalledWith([
      'AGREE_OPT_MINIMAL',
      'PARCEL_MINIMAL',
      '',
      'OPT_MIN',
      '',
      '',
      '',
      '',
      ''
    ])
  })

  it('should handle AGREEMENT_STATUS_CHANGED when userId is omitted', async () => {
    const mockFiles = [{ Key: 'event1.json' }]
    mockS3Client.send.mockResolvedValueOnce({
      Body: {
        transformToString: vi.fn().mockResolvedValue(
          JSON.stringify({
            eventData: {
              eventType: AGREEMENT_STATUS_CHANGED,
              agreementId: 'AGREE_NO_USER',
              agreementStatus: 'LIVE',
              statusDate: '2026-02-01T00:00:00.000Z'
            }
          })
        )
      }
    })

    await processRawEvents(mockS3Client, mockFiles, mockLogger)

    const transactionalStringifier = vi
      .mocked(stringify)
      .mock.results.find((r) => r.value.write.mock.calls.some((c) => c[0][0] === 'AGREE_NO_USER')).value

    expect(transactionalStringifier.write).toHaveBeenCalledWith([
      'AGREE_NO_USER',
      'LIVE',
      '2026-02-01T00:00:00.000Z',
      ''
    ])
  })

  it('should handle AGREEMENT_STATUS_CHANGED with only agreementStartDate updating a partial row', async () => {
    const mockFiles = [{ Key: 'event1.json' }, { Key: 'event2.json' }]
    mockS3Client.send
      .mockResolvedValueOnce({
        Body: {
          transformToString: vi.fn().mockResolvedValue(
            JSON.stringify({
              eventData: {
                eventType: AGREEMENT_CREATED,
                sbi: '123456789',
                agreementId: 'AGREE_START_ONLY',
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
                agreementId: 'AGREE_START_ONLY',
                agreementStatus: 'LIVE',
                statusDate: '2026-02-01T00:00:00.000Z',
                userId: 'user1',
                agreementStartDate: '2026-01-11T10:00:00.000Z'
              }
            })
          )
        }
      })

    await processRawEvents(mockS3Client, mockFiles, mockLogger)

    const agreementStringifier = vi
      .mocked(stringify)
      .mock.results.find((r) => r.value.write.mock.calls.some((c) => c[0][1] === 'AGREE_START_ONLY')).value

    expect(agreementStringifier.write).toHaveBeenCalledWith([
      '123456789',
      'AGREE_START_ONLY',
      'Woodland',
      'LIVE',
      '2026-01-11T10:00:00.000Z',
      '',
      ''
    ])
  })

  it('should handle AGREEMENT_STATUS_CHANGED with only agreementEndDate updating a partial row', async () => {
    const mockFiles = [{ Key: 'event1.json' }, { Key: 'event2.json' }]
    mockS3Client.send
      .mockResolvedValueOnce({
        Body: {
          transformToString: vi.fn().mockResolvedValue(
            JSON.stringify({
              eventData: {
                eventType: AGREEMENT_CREATED,
                sbi: '123456789',
                agreementId: 'AGREE_END_ONLY',
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
                agreementId: 'AGREE_END_ONLY',
                agreementStatus: 'LIVE',
                statusDate: '2026-02-01T00:00:00.000Z',
                userId: 'user1',
                agreementEndDate: '2027-01-11T10:00:00.000Z'
              }
            })
          )
        }
      })

    await processRawEvents(mockS3Client, mockFiles, mockLogger)

    const agreementStringifier = vi
      .mocked(stringify)
      .mock.results.find((r) => r.value.write.mock.calls.some((c) => c[0][1] === 'AGREE_END_ONLY')).value

    expect(agreementStringifier.write).toHaveBeenCalledWith([
      '123456789',
      'AGREE_END_ONLY',
      'Woodland',
      'LIVE',
      '',
      '2027-01-11T10:00:00.000Z',
      ''
    ])
  })

  it('should handle AGREEMENT_STATUS_CHANGED with only agreementValue updating a partial row', async () => {
    const mockFiles = [{ Key: 'event1.json' }, { Key: 'event2.json' }]
    mockS3Client.send
      .mockResolvedValueOnce({
        Body: {
          transformToString: vi.fn().mockResolvedValue(
            JSON.stringify({
              eventData: {
                eventType: AGREEMENT_CREATED,
                sbi: '123456789',
                agreementId: 'AGREE_VAL_ONLY',
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
                agreementId: 'AGREE_VAL_ONLY',
                agreementStatus: 'LIVE',
                statusDate: '2026-02-01T00:00:00.000Z',
                userId: 'user1',
                agreementValue: '750'
              }
            })
          )
        }
      })

    await processRawEvents(mockS3Client, mockFiles, mockLogger)

    const agreementStringifier = vi
      .mocked(stringify)
      .mock.results.find((r) => r.value.write.mock.calls.some((c) => c[0][1] === 'AGREE_VAL_ONLY')).value

    expect(agreementStringifier.write).toHaveBeenCalledWith([
      '123456789',
      'AGREE_VAL_ONLY',
      'Woodland',
      'LIVE',
      '',
      '',
      '750'
    ])
  })

  it('should handle AGREEMENT_STATUS_CHANGED without date/value updates for a partial row', async () => {
    const mockFiles = [{ Key: 'event1.json' }, { Key: 'event2.json' }]
    mockS3Client.send
      .mockResolvedValueOnce({
        Body: {
          transformToString: vi.fn().mockResolvedValue(
            JSON.stringify({
              eventData: {
                eventType: AGREEMENT_CREATED,
                sbi: '123456789',
                agreementId: 'AGREE_NO_UPDATES',
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
                agreementId: 'AGREE_NO_UPDATES',
                agreementStatus: 'LIVE',
                statusDate: '2026-02-01T00:00:00.000Z',
                userId: 'user1'
              }
            })
          )
        }
      })

    await processRawEvents(mockS3Client, mockFiles, mockLogger)

    const agreementStringifier = vi
      .mocked(stringify)
      .mock.results.find((r) => r.value.write.mock.calls.some((c) => c[0][1] === 'AGREE_NO_UPDATES')).value

    expect(agreementStringifier.write).toHaveBeenCalledWith([
      '123456789',
      'AGREE_NO_UPDATES',
      'Woodland',
      'LIVE',
      '',
      '',
      ''
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

  it('should cleanup tempDir successfully on error when tempDir was created', async () => {
    const pipelineError = new Error('Pipeline failure')
    vi.mocked(pipeline).mockRejectedValueOnce(pipelineError)
    fsPromises.rm.mockResolvedValueOnce()

    await expect(processRawEvents(mockS3Client, [{ Key: 'any.json' }], mockLogger)).rejects.toThrow('Pipeline failure')
    expect(fsPromises.rm).toHaveBeenCalledWith('/tmp/reporting-data-123', { recursive: true, force: true })
    expect(mockLogger.info).toHaveBeenCalledWith(
      { tempDir: '/tmp/reporting-data-123' },
      'Cleaned up temporary directory after error'
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

  it('should buffer partial options rows and flush them only when complete or at the end', async () => {
    const mockFiles = [{ Key: 'event1.json' }, { Key: 'event2.json' }]

    // 1. AGREEMENT_CREATED with missing option data
    mockS3Client.send
      .mockResolvedValueOnce({
        Body: {
          transformToString: vi.fn().mockResolvedValue(
            JSON.stringify({
              eventData: {
                eventType: AGREEMENT_CREATED,
                sbi: '123456789',
                agreementId: 'AGREE_OPT_PARTIAL',
                agreementType: 'Woodland',
                agreementStatus: 'DRAFT',
                agreementStartDate: '2026-01-01T00:00:00.000Z',
                agreementEndDate: '2027-01-01T00:00:00.000Z',
                agreementValue: '1000',
                options: [
                  {
                    parcelReference: 'PARCEL_1',
                    parcelSizeUnderAgreement: null, // missing
                    optionCode: 'OPT_1',
                    optionYear: '2026',
                    optionStartDate: '2026-01-11T10:00:00.000Z',
                    optionEndDate: '2027-01-11T10:00:00.000Z',
                    optionQuantity: '5',
                    optionValue: null // missing
                  }
                ]
              }
            })
          )
        }
      })
      // 2. AGREEMENT_STATUS_CHANGED with complete option data
      .mockResolvedValueOnce({
        Body: {
          transformToString: vi.fn().mockResolvedValue(
            JSON.stringify({
              eventData: {
                eventType: AGREEMENT_STATUS_CHANGED,
                agreementId: 'AGREE_OPT_PARTIAL',
                agreementStatus: 'LIVE',
                statusDate: '2026-02-01T00:00:00.000Z',
                userId: 'user1',
                options: [
                  {
                    parcelReference: 'PARCEL_1',
                    parcelSizeUnderAgreement: '10', // now present
                    optionCode: 'OPT_1',
                    optionYear: '2026',
                    optionStartDate: '2026-01-11T10:00:00.000Z',
                    optionEndDate: '2027-01-11T10:00:00.000Z',
                    optionQuantity: '5',
                    optionValue: '500' // now present
                  }
                ]
              }
            })
          )
        }
      })

    await processRawEvents(mockS3Client, mockFiles, mockLogger)

    const optionDataStringifier = vi
      .mocked(stringify)
      .mock.results.find((r) => r.value.write.mock.calls.some((c) => c[0][0] === 'AGREE_OPT_PARTIAL')).value

    // Should only be called ONCE with the complete data
    expect(optionDataStringifier.write).toHaveBeenCalledTimes(1)
    expect(optionDataStringifier.write).toHaveBeenCalledWith([
      'AGREE_OPT_PARTIAL',
      'PARCEL_1',
      '10',
      'OPT_1',
      '2026',
      '2026-01-11T10:00:00.000Z',
      '2027-01-11T10:00:00.000Z',
      '5',
      '500'
    ])
  })

  it('should flush partial options rows at the end if they remain incomplete', async () => {
    const mockFiles = [{ Key: 'event1.json' }]

    mockS3Client.send.mockResolvedValueOnce({
      Body: {
        transformToString: vi.fn().mockResolvedValue(
          JSON.stringify({
            eventData: {
              eventType: AGREEMENT_CREATED,
              sbi: '123456789',
              agreementId: 'AGREE_OPT_STILL_PARTIAL',
              agreementType: 'Woodland',
              agreementStatus: 'DRAFT',
              agreementStartDate: '2026-01-01T00:00:00.000Z',
              agreementEndDate: '2027-01-01T00:00:00.000Z',
              agreementValue: '1000',
              options: [
                {
                  parcelReference: 'PARCEL_1',
                  parcelSizeUnderAgreement: null, // missing
                  optionCode: 'OPT_1',
                  optionYear: '2026',
                  optionStartDate: '2026-01-11T10:00:00.000Z',
                  optionEndDate: '2027-01-11T10:00:00.000Z',
                  optionQuantity: '5',
                  optionValue: null // missing
                }
              ]
            }
          })
        )
      }
    })

    await processRawEvents(mockS3Client, mockFiles, mockLogger)

    const optionDataStringifier = vi
      .mocked(stringify)
      .mock.results.find((r) => r.value.write.mock.calls.some((c) => c[0][0] === 'AGREE_OPT_STILL_PARTIAL')).value

    expect(optionDataStringifier.write).toHaveBeenCalledWith([
      'AGREE_OPT_STILL_PARTIAL',
      'PARCEL_1',
      '',
      'OPT_1',
      '2026',
      '2026-01-11T10:00:00.000Z',
      '2027-01-11T10:00:00.000Z',
      '5',
      ''
    ])
  })

  it('should continue to hold options rows if they remain incomplete after a status change', async () => {
    const mockFiles = [{ Key: 'event1.json' }, { Key: 'event2.json' }]

    mockS3Client.send
      .mockResolvedValueOnce({
        Body: {
          transformToString: vi.fn().mockResolvedValue(
            JSON.stringify({
              eventData: {
                eventType: AGREEMENT_CREATED,
                agreementId: 'AGREE_OPT_STAY_PARTIAL',
                options: [{ parcelReference: 'P1', parcelSizeUnderAgreement: null }]
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
                agreementId: 'AGREE_OPT_STAY_PARTIAL',
                agreementStatus: 'LIVE',
                statusDate: '2026-02-01T00:00:00.000Z',
                options: [{ parcelReference: 'P1', parcelSizeUnderAgreement: null }]
              }
            })
          )
        }
      })

    await processRawEvents(mockS3Client, mockFiles, mockLogger)

    const optionDataStringifier = vi
      .mocked(stringify)
      .mock.results.find((r) => r.value.write.mock.calls.some((c) => c[0][0] === 'AGREE_OPT_STAY_PARTIAL')).value

    // Should be called ONCE at the end
    expect(optionDataStringifier.write).toHaveBeenCalledTimes(1)
  })

  it('should NOT hold back options rows if only parcelReference or parcelSizeUnderAgreement are blank', async () => {
    const mockFiles = [{ Key: 'event1.json' }, { Key: 'event2.json' }]

    // 1. AGREEMENT_CREATED with blank parcel fields
    mockS3Client.send
      .mockResolvedValueOnce({
        Body: {
          transformToString: vi.fn().mockResolvedValue(
            JSON.stringify({
              eventData: {
                eventType: AGREEMENT_CREATED,
                sbi: '123456789',
                agreementId: 'AGREE_BLANK_PARCEL',
                agreementType: 'Woodland',
                agreementStatus: 'LIVE',
                agreementStartDate: '2026-01-01T00:00:00.000Z',
                agreementEndDate: '2027-01-01T00:00:00.000Z',
                agreementValue: '1000',
                options: [
                  {
                    parcelReference: '',
                    parcelSizeUnderAgreement: '',
                    optionCode: 'OPT_1',
                    optionYear: '2026',
                    optionStartDate: '2026-01-11T10:00:00.000Z',
                    optionEndDate: '2027-01-11T10:00:00.000Z',
                    optionQuantity: '5',
                    optionValue: '500'
                  }
                ]
              }
            })
          )
        }
      })
      // 2. Another AGREEMENT_CREATED that is definitely complete
      .mockResolvedValueOnce({
        Body: {
          transformToString: vi.fn().mockResolvedValue(
            JSON.stringify({
              eventData: {
                eventType: AGREEMENT_CREATED,
                sbi: '987654321',
                agreementId: 'AGREE_OTHER',
                agreementType: 'Woodland',
                agreementStatus: 'LIVE',
                agreementStartDate: '2026-01-01T00:00:00.000Z',
                agreementEndDate: '2027-01-01T00:00:00.000Z',
                agreementValue: '2000',
                options: [
                  {
                    parcelReference: 'P2',
                    parcelSizeUnderAgreement: '20',
                    optionCode: 'OPT_2',
                    optionYear: '2026',
                    optionStartDate: '2026-01-11T10:00:00.000Z',
                    optionEndDate: '2027-01-11T10:00:00.000Z',
                    optionQuantity: '10',
                    optionValue: '1000'
                  }
                ]
              }
            })
          )
        }
      })

    await processRawEvents(mockS3Client, mockFiles, mockLogger)

    const optionDataStringifier = vi
      .mocked(stringify)
      .mock.results.find((r) => r.value.write.mock.calls.some((c) => c[0][0] === 'AGREE_OTHER')).value

    const calls = optionDataStringifier.write.mock.calls
    expect(calls[0][0][0]).toBe('AGREE_BLANK_PARCEL')
    expect(calls[1][0][0]).toBe('AGREE_OTHER')
  })

  it('should STILL hold back options rows if other fields are blank', async () => {
    const mockFiles = [{ Key: 'event1.json' }, { Key: 'event2.json' }]

    // 1. AGREEMENT_CREATED with blank optionValue
    mockS3Client.send
      .mockResolvedValueOnce({
        Body: {
          transformToString: vi.fn().mockResolvedValue(
            JSON.stringify({
              eventData: {
                eventType: AGREEMENT_CREATED,
                sbi: '123456789',
                agreementId: 'AGREE_MISSING_VALUE',
                agreementType: 'Woodland',
                agreementStatus: 'LIVE',
                agreementStartDate: '2026-01-01T00:00:00.000Z',
                agreementEndDate: '2027-01-01T00:00:00.000Z',
                agreementValue: '1000',
                options: [
                  {
                    parcelReference: 'P1',
                    parcelSizeUnderAgreement: '10',
                    optionCode: 'OPT_1',
                    optionYear: '2026',
                    optionStartDate: '2026-01-11T10:00:00.000Z',
                    optionEndDate: '2027-01-11T10:00:00.000Z',
                    optionQuantity: '5',
                    optionValue: '' // missing
                  }
                ]
              }
            })
          )
        }
      })
      // 2. Another AGREEMENT_CREATED that is definitely complete
      .mockResolvedValueOnce({
        Body: {
          transformToString: vi.fn().mockResolvedValue(
            JSON.stringify({
              eventData: {
                eventType: AGREEMENT_CREATED,
                sbi: '987654321',
                agreementId: 'AGREE_OTHER',
                agreementType: 'Woodland',
                agreementStatus: 'LIVE',
                agreementStartDate: '2026-01-01T00:00:00.000Z',
                agreementEndDate: '2027-01-01T00:00:00.000Z',
                agreementValue: '2000',
                options: [
                  {
                    parcelReference: 'P2',
                    parcelSizeUnderAgreement: '20',
                    optionCode: 'OPT_2',
                    optionYear: '2026',
                    optionStartDate: '2026-01-11T10:00:00.000Z',
                    optionEndDate: '2027-01-11T10:00:00.000Z',
                    optionQuantity: '10',
                    optionValue: '1000'
                  }
                ]
              }
            })
          )
        }
      })

    await processRawEvents(mockS3Client, mockFiles, mockLogger)

    const optionDataStringifier = vi
      .mocked(stringify)
      .mock.results.find((r) => r.value.write.mock.calls.some((c) => c[0][0] === 'AGREE_OTHER')).value

    const calls = optionDataStringifier.write.mock.calls
    expect(calls[0][0][0]).toBe('AGREE_OTHER')
    expect(calls[1][0][0]).toBe('AGREE_MISSING_VALUE')
  })

  it('should only flush options rows for a single agreementId once, even if complete data arrives multiple times', async () => {
    const mockFiles = [{ Key: 'event1.json' }, { Key: 'event2.json' }, { Key: 'event3.json' }]

    // 1. AGREEMENT_CREATED with missing option data
    mockS3Client.send
      .mockResolvedValueOnce({
        Body: {
          transformToString: vi.fn().mockResolvedValue(
            JSON.stringify({
              eventData: {
                eventType: AGREEMENT_CREATED,
                sbi: '123456789',
                agreementId: 'AGREE_DUPE_TEST',
                agreementType: 'Woodland',
                agreementStatus: 'DRAFT',
                agreementStartDate: '2026-01-01T00:00:00.000Z',
                agreementEndDate: '2027-01-01T00:00:00.000Z',
                agreementValue: '1000',
                options: [
                  {
                    parcelReference: 'PARCEL_1',
                    parcelSizeUnderAgreement: null,
                    optionCode: 'OPT_1',
                    optionYear: '2026',
                    optionStartDate: '2026-01-11T10:00:00.000Z',
                    optionEndDate: '2027-01-11T10:00:00.000Z',
                    optionQuantity: '5',
                    optionValue: null
                  }
                ]
              }
            })
          )
        }
      })
      // 2. AGREEMENT_STATUS_CHANGED with complete option data
      .mockResolvedValueOnce({
        Body: {
          transformToString: vi.fn().mockResolvedValue(
            JSON.stringify({
              eventData: {
                eventType: AGREEMENT_STATUS_CHANGED,
                agreementId: 'AGREE_DUPE_TEST',
                agreementStatus: 'LIVE',
                statusDate: '2026-02-01T00:00:00.000Z',
                userId: 'user1',
                options: [
                  {
                    parcelReference: 'PARCEL_1',
                    parcelSizeUnderAgreement: '10',
                    optionCode: 'OPT_1',
                    optionYear: '2026',
                    optionStartDate: '2026-01-11T10:00:00.000Z',
                    optionEndDate: '2027-01-11T10:00:00.000Z',
                    optionQuantity: '5',
                    optionValue: '500'
                  }
                ]
              }
            })
          )
        }
      })
      // 3. Subsequent AGREEMENT_STATUS_CHANGED with same complete option data
      .mockResolvedValueOnce({
        Body: {
          transformToString: vi.fn().mockResolvedValue(
            JSON.stringify({
              eventData: {
                eventType: AGREEMENT_STATUS_CHANGED,
                agreementId: 'AGREE_DUPE_TEST',
                agreementStatus: 'LIVE',
                statusDate: '2026-03-01T00:00:00.000Z',
                userId: 'user1',
                options: [
                  {
                    parcelReference: 'PARCEL_1',
                    parcelSizeUnderAgreement: '10',
                    optionCode: 'OPT_1',
                    optionYear: '2026',
                    optionStartDate: '2026-01-11T10:00:00.000Z',
                    optionEndDate: '2027-01-11T10:00:00.000Z',
                    optionQuantity: '5',
                    optionValue: '500'
                  }
                ]
              }
            })
          )
        }
      })

    await processRawEvents(mockS3Client, mockFiles, mockLogger)

    const optionDataStringifier = vi
      .mocked(stringify)
      .mock.results.find((r) => r.value.write.mock.calls.some((c) => c[0][0] === 'AGREE_DUPE_TEST')).value

    // CRITICAL: Should only be called ONCE for the agreement, despite multiple complete events
    expect(optionDataStringifier.write).toHaveBeenCalledTimes(1)
  })

  describe('autopopulating option year and metrics recording', () => {
    it('should autopopulate optionYear and record metric when optionYear is missing and start and end dates are present in AGREEMENT_CREATED event', async () => {
      const mockFiles = [{ Key: 'event1.json' }]
      mockS3Client.send.mockResolvedValueOnce({
        Body: {
          transformToString: vi.fn().mockResolvedValue(
            JSON.stringify({
              eventData: {
                eventType: AGREEMENT_CREATED,
                sbi: '123456789',
                agreementId: 'AGREE_AUTO_YEAR',
                agreementType: 'Woodland',
                agreementStatus: 'LIVE',
                agreementStartDate: '2026-01-01T00:00:00.000Z',
                agreementEndDate: '2028-01-01T00:00:00.000Z',
                agreementValue: '1000',
                options: [
                  {
                    parcelReference: 'PARCEL_1',
                    parcelSizeUnderAgreement: '10',
                    optionCode: 'OPT_1',
                    optionStartDate: '2026-01-01T00:00:00.000Z',
                    optionEndDate: '2029-01-01T00:00:00.000Z',
                    optionQuantity: '5',
                    optionValue: '100'
                  }
                ]
              }
            })
          )
        }
      })

      await processRawEvents(mockS3Client, mockFiles, mockLogger, mockMetrics)

      const optionDataStringifier = vi
        .mocked(stringify)
        .mock.results.find((r) => r.value.write.mock.calls.some((c) => c[0][0] === 'AGREE_AUTO_YEAR')).value

      expect(optionDataStringifier.write).toHaveBeenCalledWith([
        'AGREE_AUTO_YEAR',
        'PARCEL_1',
        '10',
        'OPT_1',
        3,
        '2026-01-01T00:00:00.000Z',
        '2029-01-01T00:00:00.000Z',
        '5',
        '100'
      ])
      expect(mockMetrics.counter).toHaveBeenCalledWith('auto-populated-option-year')
      expect(mockMetrics.counter).toHaveBeenCalledTimes(1)
    })

    it('should autopopulate optionYear and record metric when optionYear is missing and start and end dates are present in AGREEMENT_STATUS_CHANGED event', async () => {
      const mockFiles = [{ Key: 'event1.json' }, { Key: 'event2.json' }]
      mockS3Client.send
        .mockResolvedValueOnce({
          Body: {
            transformToString: vi.fn().mockResolvedValue(
              JSON.stringify({
                eventData: {
                  eventType: AGREEMENT_CREATED,
                  sbi: '123456789',
                  agreementId: 'AGREE_STATUS_AUTO_YEAR',
                  agreementType: 'Woodland',
                  agreementStatus: 'DRAFT',
                  agreementStartDate: '2026-01-01T00:00:00.000Z',
                  agreementEndDate: '2028-01-01T00:00:00.000Z',
                  agreementValue: '1000',
                  options: [
                    {
                      parcelReference: 'PARCEL_1',
                      parcelSizeUnderAgreement: null,
                      optionCode: 'OPT_1',
                      optionStartDate: '2026-01-01T00:00:00.000Z',
                      optionEndDate: '2027-01-01T00:00:00.000Z',
                      optionQuantity: '5',
                      optionValue: null
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
                  agreementId: 'AGREE_STATUS_AUTO_YEAR',
                  agreementStatus: 'LIVE',
                  statusDate: '2026-02-01T00:00:00.000Z',
                  userId: 'user1',
                  options: [
                    {
                      parcelReference: 'PARCEL_1',
                      parcelSizeUnderAgreement: '10',
                      optionCode: 'OPT_1',
                      optionStartDate: '2026-01-01T00:00:00.000Z',
                      optionEndDate: '2027-01-01T00:00:00.000Z',
                      optionQuantity: '5',
                      optionValue: '200'
                    }
                  ]
                }
              })
            )
          }
        })

      await processRawEvents(mockS3Client, mockFiles, mockLogger, mockMetrics)

      const optionDataStringifier = vi
        .mocked(stringify)
        .mock.results.find((r) => r.value.write.mock.calls.some((c) => c[0][0] === 'AGREE_STATUS_AUTO_YEAR')).value

      expect(optionDataStringifier.write).toHaveBeenCalledWith([
        'AGREE_STATUS_AUTO_YEAR',
        'PARCEL_1',
        '10',
        'OPT_1',
        1,
        '2026-01-01T00:00:00.000Z',
        '2027-01-01T00:00:00.000Z',
        '5',
        '200'
      ])
      expect(mockMetrics.counter).toHaveBeenCalledWith('auto-populated-option-year')
    })

    it('should NOT autopopulate optionYear or record metric if optionYear is already provided', async () => {
      const mockFiles = [{ Key: 'event1.json' }]
      mockS3Client.send.mockResolvedValueOnce({
        Body: {
          transformToString: vi.fn().mockResolvedValue(
            JSON.stringify({
              eventData: {
                eventType: AGREEMENT_CREATED,
                sbi: '123456789',
                agreementId: 'AGREE_EXISTING_YEAR',
                agreementType: 'Woodland',
                agreementStatus: 'LIVE',
                agreementStartDate: '2026-01-01T00:00:00.000Z',
                agreementEndDate: '2028-01-01T00:00:00.000Z',
                agreementValue: '1000',
                options: [
                  {
                    parcelReference: 'PARCEL_1',
                    parcelSizeUnderAgreement: '10',
                    optionCode: 'OPT_1',
                    optionYear: '2026',
                    optionStartDate: '2026-01-01T00:00:00.000Z',
                    optionEndDate: '2027-01-01T00:00:00.000Z',
                    optionQuantity: '5',
                    optionValue: '100'
                  }
                ]
              }
            })
          )
        }
      })

      await processRawEvents(mockS3Client, mockFiles, mockLogger, mockMetrics)

      const optionDataStringifier = vi
        .mocked(stringify)
        .mock.results.find((r) => r.value.write.mock.calls.some((c) => c[0][0] === 'AGREE_EXISTING_YEAR')).value

      expect(optionDataStringifier.write).toHaveBeenCalledWith([
        'AGREE_EXISTING_YEAR',
        'PARCEL_1',
        '10',
        'OPT_1',
        '2026',
        '2026-01-01T00:00:00.000Z',
        '2027-01-01T00:00:00.000Z',
        '5',
        '100'
      ])
      expect(mockMetrics.counter).not.toHaveBeenCalled()
    })

    it('should NOT autopopulate optionYear or record metric if optionStartDate is missing', async () => {
      const mockFiles = [{ Key: 'event1.json' }]
      mockS3Client.send.mockResolvedValueOnce({
        Body: {
          transformToString: vi.fn().mockResolvedValue(
            JSON.stringify({
              eventData: {
                eventType: AGREEMENT_CREATED,
                sbi: '123456789',
                agreementId: 'AGREE_NO_START',
                agreementType: 'Woodland',
                agreementStatus: 'LIVE',
                agreementStartDate: '2026-01-01T00:00:00.000Z',
                agreementEndDate: '2028-01-01T00:00:00.000Z',
                agreementValue: '1000',
                options: [
                  {
                    parcelReference: 'PARCEL_1',
                    parcelSizeUnderAgreement: '10',
                    optionCode: 'OPT_1',
                    optionEndDate: '2027-01-01T00:00:00.000Z',
                    optionQuantity: '5',
                    optionValue: '100'
                  }
                ]
              }
            })
          )
        }
      })

      await processRawEvents(mockS3Client, mockFiles, mockLogger, mockMetrics)

      const optionDataStringifier = vi
        .mocked(stringify)
        .mock.results.find((r) => r.value.write.mock.calls.some((c) => c[0][0] === 'AGREE_NO_START')).value

      expect(optionDataStringifier.write).toHaveBeenCalledWith([
        'AGREE_NO_START',
        'PARCEL_1',
        '10',
        'OPT_1',
        '',
        '',
        '2027-01-01T00:00:00.000Z',
        '5',
        '100'
      ])
      expect(mockMetrics.counter).not.toHaveBeenCalled()
    })

    it('should NOT autopopulate optionYear or record metric if optionEndDate is missing', async () => {
      const mockFiles = [{ Key: 'event1.json' }]
      mockS3Client.send.mockResolvedValueOnce({
        Body: {
          transformToString: vi.fn().mockResolvedValue(
            JSON.stringify({
              eventData: {
                eventType: AGREEMENT_CREATED,
                sbi: '123456789',
                agreementId: 'AGREE_NO_END',
                agreementType: 'Woodland',
                agreementStatus: 'LIVE',
                agreementStartDate: '2026-01-01T00:00:00.000Z',
                agreementEndDate: '2028-01-01T00:00:00.000Z',
                agreementValue: '1000',
                options: [
                  {
                    parcelReference: 'PARCEL_1',
                    parcelSizeUnderAgreement: '10',
                    optionCode: 'OPT_1',
                    optionStartDate: '2026-01-01T00:00:00.000Z',
                    optionQuantity: '5',
                    optionValue: '100'
                  }
                ]
              }
            })
          )
        }
      })

      await processRawEvents(mockS3Client, mockFiles, mockLogger, mockMetrics)

      const optionDataStringifier = vi
        .mocked(stringify)
        .mock.results.find((r) => r.value.write.mock.calls.some((c) => c[0][0] === 'AGREE_NO_END')).value

      expect(optionDataStringifier.write).toHaveBeenCalledWith([
        'AGREE_NO_END',
        'PARCEL_1',
        '10',
        'OPT_1',
        '',
        '2026-01-01T00:00:00.000Z',
        '',
        '5',
        '100'
      ])
      expect(mockMetrics.counter).not.toHaveBeenCalled()
    })

    it('should record multiple metrics when multiple options are autopopulated', async () => {
      const mockFiles = [{ Key: 'event1.json' }]
      mockS3Client.send.mockResolvedValueOnce({
        Body: {
          transformToString: vi.fn().mockResolvedValue(
            JSON.stringify({
              eventData: {
                eventType: AGREEMENT_CREATED,
                sbi: '123456789',
                agreementId: 'AGREE_MULTI_OPT',
                agreementType: 'Woodland',
                agreementStatus: 'LIVE',
                agreementStartDate: '2026-01-01T00:00:00.000Z',
                agreementEndDate: '2028-01-01T00:00:00.000Z',
                agreementValue: '1000',
                options: [
                  {
                    parcelReference: 'PARCEL_1',
                    parcelSizeUnderAgreement: '10',
                    optionCode: 'OPT_1',
                    optionStartDate: '2026-01-01T00:00:00.000Z',
                    optionEndDate: '2027-01-01T00:00:00.000Z',
                    optionQuantity: '5',
                    optionValue: '100'
                  },
                  {
                    parcelReference: 'PARCEL_2',
                    parcelSizeUnderAgreement: '20',
                    optionCode: 'OPT_2',
                    optionStartDate: '2026-01-01T00:00:00.000Z',
                    optionEndDate: '2028-01-01T00:00:00.000Z',
                    optionQuantity: '10',
                    optionValue: '200'
                  }
                ]
              }
            })
          )
        }
      })

      await processRawEvents(mockS3Client, mockFiles, mockLogger, mockMetrics)

      expect(mockMetrics.counter).toHaveBeenCalledTimes(2)
      expect(mockMetrics.counter).toHaveBeenCalledWith('auto-populated-option-year')
    })
  })

  describe('holding back agreement rows and ensuring most recent status', () => {
    it('should hold back agreement rows until all events are processed and output the latest status after multiple status changes', async () => {
      const mockFiles = [{ Key: 'event1.json' }, { Key: 'event2.json' }, { Key: 'event3.json' }]
      mockS3Client.send
        .mockResolvedValueOnce({
          Body: {
            transformToString: vi.fn().mockResolvedValue(
              JSON.stringify({
                eventData: {
                  eventType: AGREEMENT_CREATED,
                  sbi: '123456789',
                  agreementId: 'AGREE_MULTI_STATUS',
                  agreementType: 'Woodland',
                  agreementStatus: 'DRAFT',
                  agreementStartDate: '2026-01-01T00:00:00.000Z',
                  agreementEndDate: '2027-01-01T00:00:00.000Z',
                  agreementValue: '1000'
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
                  agreementId: 'AGREE_MULTI_STATUS',
                  agreementStatus: 'LIVE',
                  statusDate: '2026-02-01T00:00:00.000Z',
                  userId: 'user1'
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
                  agreementId: 'AGREE_MULTI_STATUS',
                  agreementStatus: 'TERMINATED',
                  statusDate: '2026-03-01T00:00:00.000Z',
                  userId: 'user2'
                }
              })
            )
          }
        })

      await processRawEvents(mockS3Client, mockFiles, mockLogger)

      const agreementStringifier = vi
        .mocked(stringify)
        .mock.results.find((r) => r.value.write.mock.calls.some((c) => c[0][1] === 'AGREE_MULTI_STATUS')).value

      expect(agreementStringifier.write).toHaveBeenCalledTimes(1)
      expect(agreementStringifier.write).toHaveBeenCalledWith([
        '123456789',
        'AGREE_MULTI_STATUS',
        'Woodland',
        'TERMINATED',
        '2026-01-01T00:00:00.000Z',
        '2027-01-01T00:00:00.000Z',
        '1000'
      ])
    })

    it('should output agreement row with original status if no status change events occur', async () => {
      const mockFiles = [{ Key: 'event1.json' }]
      mockS3Client.send.mockResolvedValueOnce({
        Body: {
          transformToString: vi.fn().mockResolvedValue(
            JSON.stringify({
              eventData: {
                eventType: AGREEMENT_CREATED,
                sbi: '123456789',
                agreementId: 'AGREE_NO_STATUS_CHANGE',
                agreementType: 'Woodland',
                agreementStatus: 'IN_REVIEW',
                agreementStartDate: '2026-01-01T00:00:00.000Z',
                agreementEndDate: '2027-01-01T00:00:00.000Z',
                agreementValue: '2500'
              }
            })
          )
        }
      })

      await processRawEvents(mockS3Client, mockFiles, mockLogger)

      const agreementStringifier = vi
        .mocked(stringify)
        .mock.results.find((r) => r.value.write.mock.calls.some((c) => c[0][1] === 'AGREE_NO_STATUS_CHANGE')).value

      expect(agreementStringifier.write).toHaveBeenCalledWith([
        '123456789',
        'AGREE_NO_STATUS_CHANGE',
        'Woodland',
        'IN_REVIEW',
        '2026-01-01T00:00:00.000Z',
        '2027-01-01T00:00:00.000Z',
        '2500'
      ])
    })

    it('should handle AGREEMENT_STATUS_CHANGED when agreementStatus is missing on status change event without modifying agreement status', async () => {
      const mockFiles = [{ Key: 'event1.json' }, { Key: 'event2.json' }]
      mockS3Client.send
        .mockResolvedValueOnce({
          Body: {
            transformToString: vi.fn().mockResolvedValue(
              JSON.stringify({
                eventData: {
                  eventType: AGREEMENT_CREATED,
                  sbi: '123456789',
                  agreementId: 'AGREE_STATUS_MISSING',
                  agreementType: 'Woodland',
                  agreementStatus: 'LIVE',
                  agreementStartDate: '2026-01-01T00:00:00.000Z',
                  agreementEndDate: '2027-01-01T00:00:00.000Z',
                  agreementValue: '1000'
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
                  agreementId: 'AGREE_STATUS_MISSING',
                  statusDate: '2026-02-01T00:00:00.000Z',
                  userId: 'user1',
                  agreementValue: '999'
                }
              })
            )
          }
        })

      await processRawEvents(mockS3Client, mockFiles, mockLogger)

      const agreementStringifier = vi
        .mocked(stringify)
        .mock.results.find((r) => r.value.write.mock.calls.some((c) => c[0][1] === 'AGREE_STATUS_MISSING')).value

      expect(agreementStringifier.write).toHaveBeenCalledWith([
        '123456789',
        'AGREE_STATUS_MISSING',
        'Woodland',
        'LIVE',
        '2026-01-01T00:00:00.000Z',
        '2027-01-01T00:00:00.000Z',
        '999'
      ])
    })

    it('should handle AGREEMENT_STATUS_CHANGED for an unknown agreementId gracefully', async () => {
      const mockFiles = [{ Key: 'event1.json' }]
      mockS3Client.send.mockResolvedValueOnce({
        Body: {
          transformToString: vi.fn().mockResolvedValue(
            JSON.stringify({
              eventData: {
                eventType: AGREEMENT_STATUS_CHANGED,
                agreementId: 'AGREE_UNKNOWN_ID',
                agreementStatus: 'LIVE',
                statusDate: '2026-02-01T00:00:00.000Z',
                userId: 'user1'
              }
            })
          )
        }
      })

      await processRawEvents(mockS3Client, mockFiles, mockLogger)

      const transactionalStringifier = vi
        .mocked(stringify)
        .mock.results.find((r) => r.value.write.mock.calls.some((c) => c[0][0] === 'AGREE_UNKNOWN_ID')).value

      expect(transactionalStringifier.write).toHaveBeenCalledWith([
        'AGREE_UNKNOWN_ID',
        'LIVE',
        '2026-02-01T00:00:00.000Z',
        'user1'
      ])
    })

    it('should hold back multiple agreements and output all of them with their latest statuses', async () => {
      const mockFiles = [{ Key: 'event1.json' }, { Key: 'event2.json' }, { Key: 'event3.json' }, { Key: 'event4.json' }]
      mockS3Client.send
        .mockResolvedValueOnce({
          Body: {
            transformToString: vi.fn().mockResolvedValue(
              JSON.stringify({
                eventData: {
                  eventType: AGREEMENT_CREATED,
                  sbi: '111111111',
                  agreementId: 'AGREE_A',
                  agreementType: 'Woodland',
                  agreementStatus: 'DRAFT',
                  agreementStartDate: '2026-01-01T00:00:00.000Z',
                  agreementEndDate: '2027-01-01T00:00:00.000Z',
                  agreementValue: '1000'
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
                  eventType: AGREEMENT_CREATED,
                  sbi: '222222222',
                  agreementId: 'AGREE_B',
                  agreementType: 'Woodland',
                  agreementStatus: 'ON_HOLD',
                  agreementStartDate: '2026-02-01T00:00:00.000Z',
                  agreementEndDate: '2027-02-01T00:00:00.000Z',
                  agreementValue: '2000'
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
                  agreementId: 'AGREE_A',
                  agreementStatus: 'LIVE',
                  statusDate: '2026-03-01T00:00:00.000Z',
                  userId: 'user1'
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
                  agreementId: 'AGREE_B',
                  agreementStatus: 'REJECTED',
                  statusDate: '2026-03-05T00:00:00.000Z',
                  userId: 'user2'
                }
              })
            )
          }
        })

      await processRawEvents(mockS3Client, mockFiles, mockLogger)

      const agreementStringifier = vi
        .mocked(stringify)
        .mock.results.find((r) => r.value.write.mock.calls.some((c) => c[0][1] === 'AGREE_A')).value

      expect(agreementStringifier.write).toHaveBeenCalledWith([
        '111111111',
        'AGREE_A',
        'Woodland',
        'LIVE',
        '2026-01-01T00:00:00.000Z',
        '2027-01-01T00:00:00.000Z',
        '1000'
      ])
      expect(agreementStringifier.write).toHaveBeenCalledWith([
        '222222222',
        'AGREE_B',
        'Woodland',
        'REJECTED',
        '2026-02-01T00:00:00.000Z',
        '2027-02-01T00:00:00.000Z',
        '2000'
      ])
    })
  })
})
