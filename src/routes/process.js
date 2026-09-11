import { acquireLock } from '#/common/helpers/mongo-lock.js'
import { processReportingDataJob } from '#/scheduled/process-reporting-data.js'

export const triggerJob = async (server) => {
  let lock
  try {
    lock = await acquireLock(server.locker, 'processReportingData', server.logger)
    if (!lock) {
      return
    }

    await processReportingDataJob(server)
  } catch (error) {
    server.logger.error(error, 'Error running process reporting data job')
  } finally {
    if (lock) {
      try {
        await lock.free()
      } catch (lockError) {
        server.logger.error(lockError, 'Failed to release lock for processReportingData')
      }
    }
  }
}

export const process = {
  method: 'GET',
  path: '/process',
  handler: (request, h) => {
    //no await here as we want to return immediately and not wait for the job to complete
    triggerJob(request.server)
    return h.response({ message: 'success' })
  }
}
