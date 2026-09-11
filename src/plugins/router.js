import { config } from '#/config.js'
import { health } from '#/routes/health.js'
import { process } from '#/routes/process.js'

export const router = {
  plugin: {
    name: 'router',
    register: (server, _options) => {
      server.route([health])

      if (config.get('cdpEnvironment') !== 'prod') {
        server.route([process])
      }
    }
  }
}
