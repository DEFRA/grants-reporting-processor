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
  transactional: ['Reference', 'Status', 'Event_dt', 'User_id'],
  parcels: ['agreementId', 'parcel_reference']
}

const AGREEMENT_STATUS_INDEX = 3
const AGREEMENT_STARTDATE_INDEX = 4
const AGREEMENT_ENDDATE_INDEX = 5
const AGREEMENT_VALUE_INDEX = 6

const OPTION_PARCEL_REF_INDEX = 1
const OPTION_PARCEL_SIZE_INDEX = 2

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
 * @param {Object} metrics Metrics instance.
 * @returns {Promise<string>} Path to the temporary directory containing the generated CSV files.
 */
export const processRawEvents = async (s3Client, files, logger, metrics) => {
  let tempDir
  const activeStreams = []
  const agreementRows = new Map()
  const partialOptionsRows = new Map()
  const flushedOptionsAgreements = new Set()

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

        writeOrHoldBackRow(
          event.eventData,
          targets,
          agreementRows,
          partialOptionsRows,
          flushedOptionsAgreements,
          metrics
        )
      } catch (fileError) {
        logger.error(fileError, `Failed to process individual file - ${file.Key}`)
      }
    }

    for (const [, agreementRowData] of agreementRows.entries()) {
      targets['agreements'].stringifier.write(agreementRowData)
    }

    for (const [, optionsRows] of partialOptionsRows.entries()) {
      for (const rowData of optionsRows) {
        targets['optiondata'].stringifier.write(rowData)
      }
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
    await cleanupTempDir(tempDir, logger)

    throw error
  }
}

const cleanupTempDir = async (tempDir, logger) => {
  if (tempDir) {
    try {
      await rm(tempDir, { recursive: true, force: true })
      logger.info({ tempDir }, 'Cleaned up temporary directory after error')
    } catch (rmError) {
      logger.error(rmError, 'Failed to clean up temporary directory after error')
    }
  }
}

const writeOrHoldBackRow = (
  eventData,
  targets,
  agreementRows,
  partialOptionsRows,
  flushedOptionsAgreements,
  metrics
) => {
  if (eventData.eventType === AGREEMENT_CREATED) {
    writeAgreementCreatedEvent(targets, eventData, agreementRows, partialOptionsRows, flushedOptionsAgreements, metrics)
  } else if (eventData.eventType === AGREEMENT_STATUS_CHANGED) {
    writeAgreementStatusEvent(targets, eventData, agreementRows, partialOptionsRows, flushedOptionsAgreements, metrics)
  } else {
    throw new Error(`Unknown event type: ${eventData.eventType}`)
  }
}

const writeAgreementCreatedEvent = (
  targets,
  eventData,
  agreementRows,
  partialOptionsRows,
  flushedOptionsAgreements,
  metrics
) => {
  const agreementRowData = [
    eventData.sbi,
    eventData.agreementId,
    eventData.agreementType,
    eventData.agreementStatus,
    valueOrEmptyString(eventData.agreementStartDate),
    valueOrEmptyString(eventData.agreementEndDate),
    valueOrEmptyString(eventData.agreementValue)
  ]
  // Hold back all agreement rows until all status change events have been processed
  agreementRows.set(eventData.agreementId, agreementRowData)

  if (eventData.parcels?.length) {
    for (const parcel of eventData.parcels) {
      targets['parcels'].stringifier.write([eventData.agreementId, parcel])
    }
  }

  writeOrHoldBackOptionsRows(eventData, targets, partialOptionsRows, flushedOptionsAgreements, metrics)
}

const writeOrHoldBackOptionsRows = (eventData, targets, partialOptionsRows, flushedOptionsAgreements, metrics) => {
  if (flushedOptionsAgreements.has(eventData.agreementId)) {
    return
  }

  if (eventData.options?.length) {
    const optionsRows = eventData.options.map((option) => [
      eventData.agreementId,
      option.parcelReference,
      valueOrEmptyString(option.parcelSizeUnderAgreement),
      option.optionCode,
      autoPopulateOptionYear(option, metrics),
      valueOrEmptyString(option.optionStartDate),
      valueOrEmptyString(option.optionEndDate),
      valueOrEmptyString(option.optionQuantity),
      valueOrEmptyString(option.optionValue)
    ])

    if (optionsRows.some((row) => !isOptionsRowComplete(row))) {
      partialOptionsRows.set(eventData.agreementId, optionsRows)
    } else {
      for (const rowData of optionsRows) {
        targets['optiondata'].stringifier.write(rowData)
      }
      partialOptionsRows.delete(eventData.agreementId)
      flushedOptionsAgreements.add(eventData.agreementId)
    }
  }
}

const autoPopulateOptionYear = (option, metrics) => {
  if (!option.optionYear && option.optionStartDate && option.optionEndDate) {
    const { optionStartDate, optionEndDate } = option
    metrics.counter('auto-populated-option-year')
    return new Date(optionEndDate).getFullYear() - new Date(optionStartDate).getFullYear()
  }
  return valueOrEmptyString(option.optionYear)
}

const isOptionsRowComplete = (row) => {
  return !row.some((value, index) => {
    if (index === OPTION_PARCEL_REF_INDEX || index === OPTION_PARCEL_SIZE_INDEX) {
      return false
    }
    return value === ''
  })
}

const valueOrEmptyString = (value) => {
  return value ?? ''
}

const writeAgreementStatusEvent = (
  targets,
  eventData,
  agreementRows,
  partialOptionsRows,
  flushedOptionsAgreements,
  metrics
) => {
  // Write to transactional CSV
  targets['transactional'].stringifier.write([
    eventData.agreementId,
    eventData.agreementStatus,
    eventData.statusDate,
    eventData.userId ?? ''
  ])

  if (agreementRows.has(eventData.agreementId)) {
    const agreementRowData = agreementRows.get(eventData.agreementId)
    if (eventData.agreementStatus) {
      agreementRowData[AGREEMENT_STATUS_INDEX] = eventData.agreementStatus
    }
    if (eventData.agreementStartDate) {
      agreementRowData[AGREEMENT_STARTDATE_INDEX] = eventData.agreementStartDate
    }
    if (eventData.agreementEndDate) {
      agreementRowData[AGREEMENT_ENDDATE_INDEX] = eventData.agreementEndDate
    }
    if (eventData.agreementValue) {
      agreementRowData[AGREEMENT_VALUE_INDEX] = eventData.agreementValue
    }
    agreementRows.set(eventData.agreementId, agreementRowData)
  }

  writeOrHoldBackOptionsRows(eventData, targets, partialOptionsRows, flushedOptionsAgreements, metrics)
}
