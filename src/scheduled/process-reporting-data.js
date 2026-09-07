import cron from 'node-cron'
import { rm, readdir, readFile } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { join } from 'node:path'
import { config } from '../config.js'
import { initialiseClient } from '@defra/grants-config-utils/s3-interactions'
import { createS3Client } from '@defra/grants-config-utils/s3-client'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { processRawEvents } from '../services/reporting-data-service.js'

export const startProcessReportingDataJob = (server) => {
  const schedule = config.get('jobs.processReportingData.schedule')
  cron.schedule(schedule, () => processReportingDataJob(server), {
    scheduled: true,
    timezone: 'UTC'
  })
  server.logger.info(`Process reporting data scheduled job started with schedule ${schedule}`)
}

export const processReportingDataJob = async (server) => {
  let tempDir

  try {
    server.logger.info('Running processReportingData job..')

    // Initialise S3 client for raw bucket. Needs doing now as listAllFiles command below will utilise this client automatically
    const s3Client = initialiseClient({
      region: config.get('aws.region'),
      endpoint: config.get('aws.endpointUrl'),
      forcePathStyle: config.get('aws.s3.forcePathStyle'),
      bucketNameOverride: config.get('aws.s3.rawBucketName')
    })

    // const files = await listAllFiles(server.logger)
    const files = []

    // if (files.length === 0) {
    //   server.logger.info('No files to process')
    //   return
    // }

    // Process events and generate CSV files
    tempDir = await processRawEvents(s3Client, files, server.logger)

    const dirFiles = await readdir(tempDir)
    if (dirFiles.length === 0) {
      server.logger.info('No files generated')
      return
    }

    const dstFolder = `Reporting/${config.get('cdpEnvironment')}/${new Date().getFullYear()}/${(new Date().getMonth() + 1).toString().padStart(2, '0')}`

    // Upload files to processed S3 bucket and SharePoint
    const outboundClient = createS3Client({
      region: config.get('aws.region'),
      endpoint: config.get('aws.endpointUrl'),
      forcePathStyle: config.get('aws.s3.forcePathStyle')
    })

    // Ensure SharePoint directory exists
    await server.sharepoint.createDirectory(dstFolder)

    for (const fileName of dirFiles) {
      const filePath = join(tempDir, fileName)

      // Upload to S3 using stream
      const s3Params = {
        Bucket: config.get('aws.s3.outputBucketName'),
        Key: `${dstFolder}/${fileName}`,
        Body: createReadStream(filePath)
      }
      await outboundClient.send(new PutObjectCommand(s3Params))
      server.logger.info(
        `Uploaded file to processed S3 bucket (${config.get('aws.s3.outputBucketName')}) - ${s3Params.Key}`
      )

      // Upload to SharePoint (reads file into memory individually)
      const content = await readFile(filePath)
      await server.sharepoint.uploadFile(dstFolder, fileName, content)
      server.logger.info({ fileName }, 'Uploaded file to SharePoint')
    }

    server.logger.info('Process reporting data job completed successfully')
  } catch (error) {
    server.logger.error(error, `Error running processReportingData job - ${JSON.stringify(error)}`)
  } finally {
    if (tempDir) {
      try {
        await rm(tempDir, { recursive: true, force: true })
        server.logger.info({ tempDir }, 'Cleaned up temporary directory')
      } catch (rmError) {
        server.logger.error(rmError, 'Failed to clean up temporary directory')
      }
    }
  }
}
