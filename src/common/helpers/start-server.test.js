import { startProcessReportingDataJob } from '#/scheduled/process-reporting-data.js'

vi.mock('#/scheduled/process-reporting-data.js')
describe('#startServer', () => {
  let createServerSpy
  let startServerImport
  let createServerImport

  beforeAll(async () => {
    vi.stubEnv('PORT', '3098')
    createServerImport = await import('#/server.js')
    startServerImport = await import('./start-server.js')

    const mockServer = {
      start: vi.fn().mockResolvedValue(),
      logger: {
        info: vi.fn(),
        child: vi.fn().mockReturnThis()
      }
    }

    createServerSpy = vi.spyOn(createServerImport, 'createServer').mockResolvedValue(mockServer)
  })

  afterAll(() => {
    vi.resetAllMocks()
  })

  describe('When server starts', () => {
    test('Should start up server as expected', async () => {
      await startServerImport.startServer()

      expect(createServerSpy).toHaveBeenCalled()
      expect(startProcessReportingDataJob).toHaveBeenCalled()
    })
  })

  describe('When server start fails', () => {
    test('Should log failed startup message', async () => {
      createServerSpy.mockRejectedValue(new Error('Server failed to start'))

      await expect(startServerImport.startServer()).rejects.toThrow('Server failed to start')
    })
  })
})
