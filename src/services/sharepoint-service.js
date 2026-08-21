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
        async () => generateToken(stsClient)
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
   * @param {string} folderPath The path & name of the folder to create.
   * @returns {Promise<Object>} The created folder object.
   */
  async createDirectory(folderPath) {
    await this._ensureConfig()

    try {
      logger.info(`Creating directory in SharePoint for ${folderPath}`)

      const parts = folderPath.split('/').filter(Boolean)
      let parentId = 'root'

      for (const folderName of parts) {
        const children = await this.client
          .api(`/sites/${this.siteId}/drives/${this.driveId}/items/${parentId}/children`)
          .get()

        let folder = children.value.find((item) => item.name === folderName && item.folder)

        if (!folder) {
          folder = await this.client
            .api(`/sites/${this.siteId}/drives/${this.driveId}/items/${parentId}/children`)
            .post({
              name: folderName,
              folder: {},
              '@microsoft.graph.conflictBehavior': 'fail'
            })
        }

        parentId = folder.id
      }

      return parentId
    } catch (error) {
      logger.error(error, `Failed to create directory (${folderPath}) in SharePoint`)
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
      logger.info(`Uploading file to SharePoint using upload session to ${folderName}/${fileName}`)

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
      logger.error(error, `Failed to upload file ${folderName}/${fileName} to SharePoint`)
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
        logger.info(`Resolving SharePoint Site ID for path ${this.sitePath}`)
        const site = await this.client.api(`/sites/${this.sitePath}`).get()
        this.siteId = site.id
      }

      if (this.siteId && !this.driveId && this.driveName) {
        logger.info(
          `Resolving SharePoint Drive ID - ${JSON.stringify({ siteId: this.siteId, driveName: this.driveName })}`
        )
        const drives = await this.client.api(`/sites/${this.siteId}/drives`).get()
        const drive = drives.value.find((d) => d.name === this.driveName)
        if (drive) {
          this.driveId = drive.id
        } else {
          throw new Error(`Drive with name "${this.driveName}" not found on site "${this.siteId}"`)
        }
      }
    } catch (error) {
      logger.error(
        error,
        `Failed to resolve SharePoint IDs for ${JSON.stringify({ sitePath: this.sitePath, drive: this.driveName })}`
      )
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
