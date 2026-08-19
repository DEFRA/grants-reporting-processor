import { mkdtemp, rm } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pipeline } from 'node:stream/promises'
import { stringify } from 'csv-stringify'
import { config } from '../config.js'
import { initialiseClient } from '@defra/grants-config-utils/s3-interactions'
import { GetObjectCommand } from '@aws-sdk/client-s3'

const CSV_FILES = {
  'agreements.csv': [
    'SBI',
    'Agreement_ID',
    'Agreement_Type',
    'Agreement_status',
    'Agreement_start_date',
    'Agreement_end_date',
    'Agreement_value'
  ],
  'claims.csv': [
    'SBI',
    'Agreement_ID',
    'Claim_ID',
    'claim_status',
    'Claim_receipt_dt',
    'Claim_paid_date',
    'claim_value'
  ],
  'optiondata.csv': [
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
  'transactional.csv': ['Reference', 'Status', 'Event_dt', 'User_id']
}

/**
 * Processes raw events from S3 and generates CSV files in a temporary directory.
 * @param {Array<Object>} files List of files from S3 to process.
 * @param {Object} logger Logger instance.
 * @returns {Promise<string>} Path to the temporary directory containing the generated CSV files.
 */
export const processRawEvents = async (files, logger) => {
  let tempDir
  const activeStreams = []

  try {
    // Create temp directory for CSV files
    tempDir = await mkdtemp(join(tmpdir(), 'reporting-data-'))
    logger.info({ tempDir }, 'Created temporary directory for processing')

    // Initialise CSV stringifiers and write streams
    const targets = {}
    for (const [fileName, columns] of Object.entries(CSV_FILES)) {
      const stringifier = stringify({ header: true, columns })
      const filePath = join(tempDir, fileName)
      const writeStream = createWriteStream(filePath)

      const streamPipeline = pipeline(stringifier, writeStream)
      targets[fileName] = { stringifier, streamPipeline }
      activeStreams.push(streamPipeline)
    }

    // Initialise S3 client for raw bucket
    const s3Client = initialiseClient({
      region: config.get('aws.region'),
      endpoint: config.get('aws.endpointUrl'),
      forcePathStyle: config.get('aws.s3.forcePathStyle'),
      bucketNameOverride: config.get('aws.s3.rawBucketName')
    })

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

        // Map event to rows (one or more) for different files
        // if (event.type === 'agreement') {
        //   targets['agreements.csv'].stringifier.write([event.id, event.timestamp, event.name, event.value])
        // } else if (event.type === 'claim') {
        //   targets['claims.csv'].stringifier.write([event.id, event.timestamp, event.action, event.user])
        // } else if (event.type === 'option') {
        //   targets['optiondata.csv'].stringifier.write([event.id, event.timestamp, event.message, event.stack])
        // } else if (event.type === 'event') {
        //   targets['transactional.csv'].stringifier.write([event.id, event.timestamp, event.level, event.message])
        // }

        // Example to add to agreements csv
        targets['agreements.csv'].stringifier.write([
          '123456789',
          'AGREE_123',
          'Woodland',
          'ON_HOLD',
          '2026-01-11T10:00:00.000Z',
          '2027-01-11T10:00:00.000Z',
          '354'
        ])
      } catch (fileError) {
        logger.error({ key: file.Key, error: fileError.message }, 'Failed to process individual file')
      }
    }

    // Finalize all CSV stringifiers
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
