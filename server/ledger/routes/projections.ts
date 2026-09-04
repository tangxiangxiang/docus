import { Hono } from 'hono'
import {
  parseOverviewScope,
  parseTrendMonths,
} from '../validation.js'
import {
  withLedgerErrors,
  type LedgerProjectionFactory,
} from './shared.js'

export function createProjectionRoutes(getProjections: LedgerProjectionFactory): Hono {
  const routes = new Hono()

  routes.get('/overview', (c) => withLedgerErrors(c, () => c.json(
    getProjections().getOverview(parseOverviewScope(c.req.query('scope'))),
  )))

  routes.get('/trend', (c) => withLedgerErrors(c, () => c.json(
    getProjections().getTrend(parseTrendMonths(c.req.query('months'))),
  )))

  return routes
}
