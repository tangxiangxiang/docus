import { Hono } from 'hono'
import { createAccountRoutes } from './accounts.js'
import { createCategoryRoutes } from './categories.js'
import { createSettingsRoutes } from './settings.js'
import { ledgerServiceForRequest, type LedgerServiceFactory } from './shared.js'

export function createLedgerRoutes(
  getService: LedgerServiceFactory = ledgerServiceForRequest,
): Hono {
  const routes = new Hono()
  routes.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store')
    await next()
  })
  routes.route('/settings', createSettingsRoutes(getService))
  routes.route('/accounts', createAccountRoutes(getService))
  routes.route('/categories', createCategoryRoutes(getService))
  return routes
}

const ledgerRoutes = createLedgerRoutes()

export default ledgerRoutes
