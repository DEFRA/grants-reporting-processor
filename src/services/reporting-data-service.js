import { mkdtemp, rm } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pipeline } from 'node:stream/promises'
import { stringify } from 'csv-stringify'
import { config } from '../config.js'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { AGREEMENT_CREATED, AGREEMENT_STATUS_CHANGED } from '@defra/grants-reporting-publisher/constants'

const CSV_FILES = {
  agreements: [
    'SBI',
    'Agreement_ID',
    'Agreement_Type',
    'Agreement_status',
    'Agreement_start_date',
    'Agreement_end_date',
    'Agreement_value'
  ],
  claims: ['SBI', 'Agreement_ID', 'Claim_ID', 'claim_status', 'Claim_receipt_dt', 'Claim_paid_date', 'claim_value'],
  optiondata: [
    'Agreement_ID',
    'Parcel_reference',
    'Parcel_Size_under_agreement',
    'Option_code',
    'Option_year',
    'Option_start_dt',
    'Option_end_dt',
    'Option_qty',
    'Option_value'
  ],
  transactional: ['Reference', 'Status', 'Event_dt', 'User_id']
}

const padStart = (number) => {
  return number.toString().padStart(2, '0')
}

const createCsvFilename = (prefix) => {
  const now = new Date()
  return `${prefix} ${now.getFullYear()}-${padStart(now.getMonth() + 1)}-${padStart(now.getDate())} ${padStart(now.getHours())}${padStart(now.getMinutes())}${padStart(now.getSeconds())}.csv`
}

/**
 * Processes raw events from S3 and generates CSV files in a temporary directory.
 * @param s3Client
 * @param {Array<Object>} files List of files from S3 to process.
 * @param {Object} logger Logger instance.
 * @returns {Promise<string>} Path to the temporary directory containing the generated CSV files.
 */
export const processRawEvents = async (s3Client, files, logger) => {
  let tempDir
  const activeStreams = []
  const partialRows = new Map()

  try {
    // Create temp directory for CSV files
    tempDir = await mkdtemp(join(tmpdir(), 'reporting-data-'))
    logger.info({ tempDir }, 'Created temporary directory for processing')

    // Initialise CSV stringifiers and write streams
    const targets = {}
    for (const [filePrefix, columns] of Object.entries(CSV_FILES)) {
      const stringifier = stringify({ header: true, columns })
      const fileName = createCsvFilename(filePrefix)
      const filePath = join(tempDir, fileName)
      const writeStream = createWriteStream(filePath)

      const streamPipeline = pipeline(stringifier, writeStream)
      targets[filePrefix] = { stringifier, streamPipeline }
      activeStreams.push(streamPipeline)
    }

    for (const file of files) {
      try {
        logger.debug({ key: file.Key }, 'Processing file')
        const getParams = {
          Bucket: config.get('aws.s3.rawBucketName'),
          Key: file.Key
        }
        const response = await s3Client.send(new GetObjectCommand(getParams))
        const content = await response.Body.transformToString()
        const event = JSON.parse(content)
        logger.debug({ event }, 'Event parsed')

        writeOrHoldBackRow(event.eventData, targets, partialRows)
      } catch (fileError) {
        logger.error(fileError, `Failed to process individual file - ${file.Key}`)
      }
    }

    for (const [, agreementRowData] of partialRows.entries()) {
      targets['agreements'].stringifier.write(agreementRowData)
    }

    // Finalise all CSV stringifiers
    for (const target of Object.values(targets)) {
      target.stringifier.end()
    }

    // Wait for all files to be fully written to disk
    await Promise.all(activeStreams)
    logger.info('All CSV files finalised on disk')

    return tempDir
  } catch (error) {
    logger.error(error, 'Error generating CSV files')
    if (tempDir) {
      try {
        await rm(tempDir, { recursive: true, force: true })
        logger.info({ tempDir }, 'Cleaned up temporary directory after error')
      } catch (rmError) {
        logger.error(rmError, 'Failed to clean up temporary directory after error')
      }
    }
    throw error
  }
}

const writeOrHoldBackRow = (eventData, targets, partialRows) => {
  if (eventData.eventType === AGREEMENT_CREATED) {
    writeAgreementCreatedEvent(targets, eventData, partialRows)
  } else if (eventData.eventType === AGREEMENT_STATUS_CHANGED) {
    writeAgreementStatusEvent(targets, eventData, partialRows)
  } else {
    throw new Error(`Unknown event type: ${eventData.eventType}`)
  }
}

const writeAgreementCreatedEvent = (targets, eventData, partialRows) => {
  const agreementRowData = [
    eventData.sbi,
    eventData.agreementId,
    eventData.agreementType,
    eventData.agreementStatus,
    eventData.agreementStartDate ?? '',
    eventData.agreementEndDate ?? '',
    eventData.agreementValue ?? ''
  ]
  // Write to agreements CSV, or hold back for later if any fields are missing
  if (agreementRowData.includes('')) {
    partialRows.set(eventData.agreementId, agreementRowData)
  } else {
    targets['agreements'].stringifier.write(agreementRowData)
  }

  if (eventData.options.length) {
    for (const option of eventData.options) {
      targets['optiondata'].stringifier.write([
        eventData.agreementId,
        option.parcelReference,
        option.parcelSizeUnderAgreement ?? '',
        option.optionCode,
        option.optionYear ?? '',
        option.optionStartDate ?? '',
        option.optionEndDate ?? '',
        option.optionQuantity ?? '',
        option.optionValue ?? ''
      ])
    }
  }
}

const writeAgreementStatusEvent = (targets, eventData, partialRows) => {
  // Write to transactional CSV
  targets['transactional'].stringifier.write([
    eventData.agreementId,
    eventData.agreementStatus,
    eventData.statusDate,
    eventData.userId ?? ''
  ])

  if (
    partialRows.has(eventData.agreementId) &&
    (eventData.agreementStartDate || eventData.agreementEndDate || eventData.agreementValue)
  ) {
    const agreementRowData = partialRows.get(eventData.agreementId)
    if (eventData.agreementStartDate) {
      agreementRowData[4] = eventData.agreementStartDate
    }
    if (eventData.agreementEndDate) {
      agreementRowData[5] = eventData.agreementEndDate
    }
    if (eventData.agreementValue) {
      agreementRowData[6] = eventData.agreementValue
    }

    partialRows.set(eventData.agreementId, agreementRowData)
  }
}
