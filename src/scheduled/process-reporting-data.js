import cron from 'node-cron'
import { config } from '../config.js'
import { initialiseClient, listAllFiles } from '@defra/grants-config-utils/s3-interactions'
import { createS3Client } from '@defra/grants-config-utils/s3-client'
import { PutObjectCommand } from '@aws-sdk/client-s3'

export const startProcessReportingDataJob = (server) => {
  const schedule = config.get('jobs.processReportingData.schedule')
  cron.schedule(schedule, () => processReportingDataJob(server), {
    scheduled: true,
    timezone: 'UTC'
  })
  server.logger.info(`Process reporting data scheduled job started with schedule ${schedule}`)
}

export const processReportingDataJob = async (server) => {
  try {
    server.logger.info('Running processReportingData job..')

    // Get files from raw bucket
    initialiseClient({
      region: config.get('aws.region'),
      endpoint: config.get('aws.endpointUrl'),
      forcePathStyle: config.get('aws.s3.forcePathStyle'),
      bucketNameOverride: config.get('aws.s3.rawBucketName')
    })

    const files = await listAllFiles(server.logger)
    server.logger.info(
      `Reporting events files found:
      ${files.map((f) => '• ' + f).join('\n')}\n`
    )

    // Process into CSV files
    const exampleFiles = [
      { name: 'example1.csv', content: 'A,B,C' },
      { name: 'example2.csv', content: 'E,F,G' }
    ]

    const dstFolder = `${config.get('cdpEnvironment')}/${new Date().getFullYear()}/${(new Date().getMonth() + 1).toString().padStart(2, '0')}`

    //Upload files to processed S3 bucket
    const outboundClient = createS3Client({
      region: config.get('aws.region'),
      endpoint: config.get('aws.endpointUrl'),
      forcePathStyle: config.get('aws.s3.forcePathStyle')
    })

    for (const file of exampleFiles) {
      const params = {
        Bucket: config.get('aws.s3.outputBucketName'),
        Key: `${dstFolder}/${file.name}`,
        Body: file.content
      }
      await outboundClient.send(new PutObjectCommand(params))
    }

    //Upload those files via sharepoint
    await server.sharepoint.createDirectoryAndUploadFiles(dstFolder, exampleFiles)

    server.logger.info('Process reporting data job completed successfully')
  } catch (error) {
    server.logger.error(error, 'Error running processReportingData job')
  }
}
