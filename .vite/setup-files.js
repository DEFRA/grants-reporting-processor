import { afterAll, beforeAll, vi } from 'vitest'
import createFetchMock from 'vitest-fetch-mock'

const fetchMock = createFetchMock(vi)

vi.mock('@azure/identity', () => {
  const mockToken = { token: 'mock-token', expiresOnTimestamp: Date.now() + 3600000 }
  const mockCredential = {
    getToken: vi.fn().mockResolvedValue(mockToken)
  }
  return {
    ClientAssertionCredential: vi.fn().mockImplementation(function () {
      return mockCredential
    })
  }
})

beforeAll(async () => {
  // Setup fetch mock
  fetchMock.enableMocks()
  global.fetch = fetchMock
  global.fetchMock = fetchMock
})

afterAll(async () => {
  fetchMock.disableMocks()
})
