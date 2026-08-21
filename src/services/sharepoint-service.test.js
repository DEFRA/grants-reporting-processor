import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@microsoft/microsoft-graph-client', () => {
  const mockUpload = vi.fn()
  const mockCreateUploadSession = vi.fn()
  const OneDriveLargeFileUploadTask = vi.fn().mockImplementation(function () {
    return {
      upload: mockUpload
    }
  })
  OneDriveLargeFileUploadTask.createUploadSession = mockCreateUploadSession

  return {
    Client: {
      initWithMiddleware: vi.fn()
    },
    OneDriveLargeFileUploadTask,
    FileUpload: vi.fn().mockImplementation(function () {
      return {}
    }),
    // Expose mocks for testing
    _mockUpload: mockUpload,
    _mockCreateUploadSession: mockCreateUploadSession
  }
})

vi.mock('@azure/identity', () => ({
  ClientAssertionCredential: vi.fn()
}))

vi.mock('@aws-sdk/client-sts', () => ({
  STSClient: vi.fn()
}))

vi.mock('@defra/grants-config-utils/grants-config-broker-token', () => ({
  generateToken: vi.fn()
}))

vi.mock('@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials/index.js', () => ({
  TokenCredentialAuthenticationProvider: vi.fn().mockImplementation(function () {
    return {}
  })
}))

vi.mock('#/config.js', () => ({
  config: {
    get: vi.fn()
  }
}))

vi.mock('#/common/helpers/logging/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn()
  })
}))

import { SharePointService } from './sharepoint-service.js'
import {
  Client,
  OneDriveLargeFileUploadTask,
  FileUpload,
  _mockUpload,
  _mockCreateUploadSession
} from '@microsoft/microsoft-graph-client'
import { ClientAssertionCredential } from '@azure/identity'
import { generateToken } from '@defra/grants-config-utils/grants-config-broker-token'
import { TokenCredentialAuthenticationProvider } from '@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials/index.js'
import { config } from '#/config.js'

describe('SharePointService', () => {
  const mockSiteId = 'mock-site-id'
  const mockDriveId = 'mock-drive-id'
  let mockClient

  beforeEach(() => {
    vi.clearAllMocks()
    config.get.mockImplementation((key) => {
      if (key === 'microsoft.sharepoint.siteId') return mockSiteId
      if (key === 'microsoft.sharepoint.driveId') return mockDriveId
      if (key === 'microsoft.azure.tenantId') return 'mock-tenant-id'
      if (key === 'microsoft.azure.clientId') return 'mock-client-id'
      return null
    })

    mockClient = {
      api: vi.fn().mockReturnThis(),
      get: vi.fn(),
      post: vi.fn()
    }
    Client.initWithMiddleware.mockReturnValue(mockClient)
    _mockUpload.mockReset()
    _mockCreateUploadSession.mockReset()
  })

  it('should initialize with ClientAssertionCredential', () => {
    const service = new SharePointService()
    expect(service).toBeInstanceOf(SharePointService)
    expect(ClientAssertionCredential).toHaveBeenCalledWith('mock-tenant-id', 'mock-client-id', expect.any(Function))
    expect(TokenCredentialAuthenticationProvider).toHaveBeenCalledWith(expect.any(ClientAssertionCredential), {
      scopes: ['https://graph.microsoft.com/.default']
    })
    expect(Client.initWithMiddleware).toHaveBeenCalledWith({
      authProvider: expect.any(Object)
    })
  })

  it('should call generateToken in the assertion callback', async () => {
    const mockStsClient = { send: vi.fn() }
    generateToken.mockResolvedValue(
      'mock-token.ewogImlzcyI6ICJzb21ldGhpbmciLAogICJzdWIiOiAidGhlLXB1YiIsCiAgImF1ZCI6ICJwZW9wbGUtY2xhcHBpbmciCn0='
    )
    const sps = new SharePointService(mockStsClient)

    const callback = vi.mocked(ClientAssertionCredential).mock.calls[0][2]

    await callback()

    expect(sps).not.toBeUndefined()
    expect(generateToken).toHaveBeenCalled()
  })

  it('should log and throw error if initialization fails', () => {
    vi.mocked(ClientAssertionCredential).mockImplementationOnce(() => {
      throw new Error('Init Failed')
    })

    expect(() => new SharePointService()).toThrow('Init Failed')
  })

  it('should create a directory', async () => {
    mockClient.get.mockResolvedValue({ value: [] })
    mockClient.post.mockResolvedValue({ id: 'folder-id' })

    const service = new SharePointService()
    const result = await service.createDirectory('test-folder')

    expect(Client.initWithMiddleware).toHaveBeenCalled()
    expect(mockClient.api).toHaveBeenCalledWith(`/sites/${mockSiteId}/drives/${mockDriveId}/items/root/children`)
    expect(mockClient.post).toHaveBeenCalledWith({
      name: 'test-folder',
      folder: {},
      '@microsoft.graph.conflictBehavior': 'fail'
    })
    expect(result).toBe('folder-id')
  })

  it('should upload a file using upload session', async () => {
    const mockSession = { url: 'mock-url' }
    _mockCreateUploadSession.mockResolvedValue(mockSession)
    _mockUpload.mockResolvedValue({ responseBody: { id: 'file-id' } })

    const service = new SharePointService()
    const result = await service.uploadFile('test-folder', 'test.csv', 'content')

    expect(_mockCreateUploadSession).toHaveBeenCalledWith(
      mockClient,
      `/sites/${mockSiteId}/drives/${mockDriveId}/root:/test-folder/test.csv:/createUploadSession`,
      { conflictBehavior: 'replace', fileName: 'test.csv' }
    )
    expect(OneDriveLargeFileUploadTask).toHaveBeenCalled()
    expect(_mockUpload).toHaveBeenCalled()
    expect(result).toEqual({ id: 'file-id' })
  })

  it('should upload a file using a Buffer', async () => {
    _mockCreateUploadSession.mockResolvedValue({ url: 'mock-url' })
    _mockUpload.mockResolvedValue({ responseBody: { id: 'file-id' } })

    const service = new SharePointService()
    const content = Buffer.from('buffer-content')
    await service.uploadFile('test-folder', 'test.csv', content)

    expect(FileUpload).toHaveBeenCalledWith(content, 'test.csv', content.length)
  })

  it('should upload multiple files', async () => {
    _mockCreateUploadSession.mockResolvedValue({ url: 'mock-url' })
    _mockUpload.mockResolvedValue({ responseBody: { id: 'file-id' } })

    const service = new SharePointService()
    const files = [
      { name: '1.csv', content: 'c1' },
      { name: '2.csv', content: 'c2' }
    ]
    const results = await service.uploadFiles('test-folder', files)

    expect(_mockUpload).toHaveBeenCalledTimes(2)
    expect(results).toHaveLength(2)
  })

  it('should create a directory and upload multiple files', async () => {
    mockClient.get.mockResolvedValue({ value: [] })
    mockClient.post.mockResolvedValue({ id: 'folder-id' })
    _mockCreateUploadSession.mockResolvedValue({ url: 'mock-url' })
    _mockUpload.mockResolvedValue({ responseBody: { id: 'file-id' } })

    const service = new SharePointService()
    const files = [
      { name: '1.csv', content: 'c1' },
      { name: '2.csv', content: 'c2' }
    ]
    const results = await service.createDirectoryAndUploadFiles('test-folder', files)

    expect(mockClient.post).toHaveBeenCalled()
    expect(_mockUpload).toHaveBeenCalledTimes(2)
    expect(results).toHaveLength(2)
  })

  it('should throw error if config is missing', async () => {
    config.get.mockReturnValue(null)
    const service = new SharePointService()
    await expect(service.createDirectory('test')).rejects.toThrow(
      'SharePoint Site ID and Drive ID must be configured or resolvable via Site Path and Drive Name'
    )
  })

  it('should resolve siteId and driveId if missing but path and name are provided', async () => {
    config.get.mockImplementation((key) => {
      if (key === 'microsoft.sharepoint.sitePath') return 'tenant.sharepoint.com:/sites/mysite'
      if (key === 'microsoft.sharepoint.driveName') return 'MyDrive'
      return null
    })

    mockClient.get
      .mockResolvedValueOnce({ id: 'resolved-site-id' }) // site lookup
      .mockResolvedValueOnce({
        value: [
          { name: 'OtherDrive', id: 'other-id' },
          { name: 'MyDrive', id: 'resolved-drive-id' }
        ]
      }) // drive lookup
      .mockResolvedValueOnce({ value: [] }) // folder check

    mockClient.post.mockResolvedValue({ id: 'folder-id' })

    const service = new SharePointService()
    const result = await service.createDirectory('test-folder')

    expect(mockClient.api).toHaveBeenCalledWith('/sites/tenant.sharepoint.com:/sites/mysite')
    expect(mockClient.api).toHaveBeenCalledWith('/sites/resolved-site-id/drives')
    expect(mockClient.api).toHaveBeenCalledWith('/sites/resolved-site-id/drives/resolved-drive-id/items/root/children')
    expect(service.siteId).toBe('resolved-site-id')
    expect(service.driveId).toBe('resolved-drive-id')
    expect(result).toBe('folder-id')
  })

  it('should throw error if drive name not found', async () => {
    config.get.mockImplementation((key) => {
      if (key === 'microsoft.sharepoint.sitePath') return 'tenant.sharepoint.com:/sites/mysite'
      if (key === 'microsoft.sharepoint.driveName') return 'NonExistentDrive'
      return null
    })

    mockClient.get
      .mockResolvedValueOnce({ id: 'resolved-site-id' }) // site lookup
      .mockResolvedValueOnce({
        value: [{ name: 'OtherDrive', id: 'other-id' }]
      }) // drive lookup

    const service = new SharePointService()
    await expect(service.createDirectory('test')).rejects.toThrow(
      'Drive with name "NonExistentDrive" not found on site "resolved-site-id"'
    )
  })

  it('should catch and rethrow error during resolution', async () => {
    config.get.mockImplementation((key) => {
      if (key === 'microsoft.sharepoint.sitePath') return 'tenant.sharepoint.com:/sites/mysite'
      return null
    })

    mockClient.get.mockRejectedValue(new Error('Resolution Failed'))

    const service = new SharePointService()
    await expect(service.createDirectory('test')).rejects.toThrow('Resolution Failed')
  })

  it('should create nested directories', async () => {
    mockClient.get
      .mockResolvedValueOnce({ value: [] }) // no folder1
      .mockResolvedValueOnce({ value: [] }) // no folder2
    mockClient.post.mockResolvedValueOnce({ id: 'folder1-id' }).mockResolvedValueOnce({ id: 'folder2-id' })

    const service = new SharePointService()
    const result = await service.createDirectory('folder1/folder2')

    expect(mockClient.api).toHaveBeenCalledWith(`/sites/${mockSiteId}/drives/${mockDriveId}/items/root/children`)
    expect(mockClient.api).toHaveBeenCalledWith(`/sites/${mockSiteId}/drives/${mockDriveId}/items/folder1-id/children`)
    expect(mockClient.post).toHaveBeenCalledTimes(2)
    expect(result).toBe('folder2-id')
  })

  it('should skip creating directory if it already exists', async () => {
    mockClient.get.mockResolvedValue({
      value: [{ name: 'existing-folder', folder: {}, id: 'existing-id' }]
    })

    const service = new SharePointService()
    const result = await service.createDirectory('existing-folder')

    expect(mockClient.get).toHaveBeenCalled()
    expect(mockClient.post).not.toHaveBeenCalled()
    expect(result).toBe('existing-id')
  })

  it('should catch and rethrow error during directory creation', async () => {
    const error = new Error('Graph Error')
    mockClient.get.mockRejectedValue(error)

    const service = new SharePointService()
    await expect(service.createDirectory('test')).rejects.toThrow('Graph Error')
  })

  it('should catch and rethrow error during file upload', async () => {
    const error = new Error('Upload Error')
    _mockCreateUploadSession.mockRejectedValue(error)

    const service = new SharePointService()
    await expect(service.uploadFile('test-folder', 'test.csv', 'content')).rejects.toThrow('Upload Error')
  })
})
