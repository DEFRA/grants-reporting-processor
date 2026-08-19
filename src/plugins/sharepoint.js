import { SharePointService } from '#/services/sharepoint-service.js'

export const sharepoint = {
  plugin: {
    name: 'sharepoint',
    version: '1.0.0',
    register: async function (server) {
      server.logger.info('Setting up SharePoint Service')
      const sharePointService = new SharePointService()
      server.decorate('server', 'sharepoint', sharePointService)
      server.decorate('request', 'sharepoint', () => sharePointService, { apply: true })
    }
  }
}
