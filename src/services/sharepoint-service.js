import { Client, OneDriveLargeFileUploadTask, FileUpload } from '@microsoft/microsoft-graph-client'
import { ClientAssertionCredential } from '@azure/identity'
import { config } from '#/config.js'
import { createLogger } from '#/common/helpers/logging/logger.js'
import { TokenCredentialAuthenticationProvider } from '@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials/index.js'
import { generateToken } from '@defra/grants-config-utils/grants-config-broker-token'

const logger = createLogger()

export class SharePointService {
  constructor(stsClient) {
    try {
      const credential = new ClientAssertionCredential(
        config.get('microsoft.azure.tenantId'),
        config.get('microsoft.azure.clientId'),
        async () => {
          const token = await generateToken(stsClient)

          const [, payload] = token.split('.')

          const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))

          createLogger().info(
            JSON.stringify({
              issuer: claims.iss,
              subject: claims.sub,
              audience: claims.aud
            })
          )

          return token
        }
      )

      const authProvider = new TokenCredentialAuthenticationProvider(credential, {
        scopes: ['https://graph.microsoft.com/.default']
      })

      this.client = Client.initWithMiddleware({
        authProvider
      })

      this.siteId = config.get('microsoft.sharepoint.siteId')
      this.driveId = config.get('microsoft.sharepoint.driveId')
      this.sitePath = config.get('microsoft.sharepoint.sitePath')
      this.driveName = config.get('microsoft.sharepoint.driveName')
    } catch (error) {
      logger.error(error, 'Failed to initialize SharePointService')
      throw error
    }
  }

  /**
   * Creates a directory in the target SharePoint library.
   * @param {string} folderName The name of the folder to create.
   * @returns {Promise<Object>} The created folder object.
   */
  async createDirectory(folderName) {
    await this._ensureConfig()

    try {
      logger.info({ folderName }, 'Creating directory in SharePoint')
      return this.client.api(`/sites/${this.siteId}/drives/${this.driveId}/root/children`).post({
        name: folderName,
        folder: {},
        '@microsoft.graph.conflictBehavior': 'replace'
      })
    } catch (error) {
      logger.error({ folderName, error }, 'Failed to create directory in SharePoint')
      throw error
    }
  }

  /**
   * Uploads a file to a specific folder in SharePoint using an upload session.
   * This is recommended for all file sizes and required for files > 4MB.
   * @param {string} folderName The name of the folder.
   * @param {string} fileName The name of the file.
   * @param {string|Buffer} content The content of the file.
   * @returns {Promise<Object>} The uploaded file object.
   */
  async uploadFile(folderName, fileName, content) {
    await this._ensureConfig()

    try {
      logger.info({ folderName, fileName }, 'Uploading file to SharePoint using upload session')

      const url = `/sites/${this.siteId}/drives/${this.driveId}/root:/${folderName}/${fileName}:/createUploadSession`
      const payloadOptions = {
        conflictBehavior: 'replace',
        fileName
      }

      const session = await OneDriveLargeFileUploadTask.createUploadSession(this.client, url, payloadOptions)

      const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content)
      const fileObj = new FileUpload(buffer, fileName, buffer.length)

      const task = new OneDriveLargeFileUploadTask(this.client, fileObj, session)
      const uploadResult = await task.upload()

      return uploadResult.responseBody
    } catch (error) {
      logger.error({ folderName, fileName, error }, 'Failed to upload file to SharePoint')
      throw error
    }
  }

  /**
   * Uploads multiple files to a specific folder in SharePoint.
   * @param {string} folderName The name of the folder.
   * @param {Array<{name: string, content: string|Buffer}>} files The files to upload.
   * @returns {Promise<Array<Object>>} The results of the uploads.
   */
  async uploadFiles(folderName, files) {
    const results = []
    for (const file of files) {
      results.push(await this.uploadFile(folderName, file.name, file.content))
    }
    return results
  }

  /**
   * Creates a directory and uploads multiple files to it.
   * @param {string} folderName The name of the folder to create.
   * @param {Array<{name: string, content: string|Buffer}>} files The files to upload.
   * @returns {Promise<Array<Object>>} The results of the uploads.
   */
  async createDirectoryAndUploadFiles(folderName, files) {
    await this.createDirectory(folderName)
    return this.uploadFiles(folderName, files)
  }

  async _resolveIds() {
    if (this.siteId && this.driveId) {
      return
    }

    try {
      if (!this.siteId && this.sitePath) {
        logger.info({ sitePath: this.sitePath }, 'Resolving SharePoint Site ID')
        const site = await this.client.api(`/sites/${this.sitePath}`).get()
        this.siteId = site.id
      }

      if (this.siteId && !this.driveId && this.driveName) {
        logger.info({ siteId: this.siteId, driveName: this.driveName }, 'Resolving SharePoint Drive ID')
        const drives = await this.client.api(`/sites/${this.siteId}/drives`).get()
        const drive = drives.value.find((d) => d.name === this.driveName)
        if (drive) {
          this.driveId = drive.id
        } else {
          throw new Error(`Drive with name "${this.driveName}" not found on site "${this.siteId}"`)
        }
      }
    } catch (error) {
      logger.error({ error, sitePath: this.sitePath, driveName: this.driveName }, 'Failed to resolve SharePoint IDs')
      throw error
    }
  }

  async _ensureConfig() {
    await this._resolveIds()
    if (!this.siteId || !this.driveId) {
      throw new Error('SharePoint Site ID and Drive ID must be configured or resolvable via Site Path and Drive Name')
    }
  }
}
