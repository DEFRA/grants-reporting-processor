import { describe, it, expect, vi, beforeEach } from 'vitest'
import Hapi from '@hapi/hapi'
import { config } from '#/config.js'
import { router } from './router.js'

describe('router plugin', () => {
  let server

  beforeEach(() => {
    server = Hapi.server()
  })

  it('should register both health and process routes when environment is not prod', async () => {
    vi.spyOn(config, 'get').mockImplementation((key) => {
      if (key === 'cdpEnvironment') {
        return 'local'
      }
      return config.get(key)
    })

    await server.register(router)

    const routes = server.table().map((route) => ({
      method: route.method,
      path: route.path
    }))

    expect(routes).toEqual([
      { method: 'get', path: '/health' },
      { method: 'get', path: '/process' }
    ])
  })

  it('should register only health route when environment is prod', async () => {
    vi.spyOn(config, 'get').mockImplementation((key) => {
      if (key === 'cdpEnvironment') {
        return 'prod'
      }
      return config.get(key)
    })

    await server.register(router)

    const routes = server.table().map((route) => ({
      method: route.method,
      path: route.path
    }))

    expect(routes).toEqual([{ method: 'get', path: '/health' }])
  })
})
