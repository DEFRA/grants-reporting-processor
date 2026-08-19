import { describe, it, expect, vi, beforeAll } from 'vitest'
import Hapi from '@hapi/hapi'
import { sharepoint } from './sharepoint.js'

vi.mock('#/services/sharepoint-service.js', () => ({
  SharePointService: vi.fn().mockImplementation(function () {
    return {
      createDirectory: vi.fn(),
      uploadFile: vi.fn()
    }
  })
}))

describe('sharepoint plugin', () => {
  let server

  beforeAll(async () => {
    server = Hapi.server()
    server.decorate('server', 'logger', {
      info: vi.fn(),
      error: vi.fn()
    })
    await server.register(sharepoint)
  })

  it('should decorate server with sharepoint service', () => {
    expect(server.sharepoint).toBeDefined()
  })
})
