import { Hono } from 'hono'
import {
  parseIdempotencyKey,
  parseTransactionCreateRequest,
} from '../validation.js'
import {
  ledgerReplayResponse,
  readLedgerJson,
  withLedgerErrors,
  type LedgerServiceFactory,
} from './shared.js'

export function createTransactionRoutes(getService: LedgerServiceFactory): Hono {
  const routes = new Hono()

  routes.post('/', (c) => withLedgerErrors(c, async () => {
    const request = parseTransactionCreateRequest(await readLedgerJson(c))
    const idempotencyKey = parseIdempotencyKey(c.req.header('Idempotency-Key'))
    return ledgerReplayResponse(c, getService().createTransaction(request, idempotencyKey))
  }))

  routes.get('/:id', (c) => withLedgerErrors(c, () => c.json(
    getService().getTransaction(c.req.param('id')),
  )))

  routes.patch('/:id', (c) => withLedgerErrors(c, async () => {
    const body = await readLedgerJson(c)
    return c.json(getService().patchTransaction(c.req.param('id'), body))
  }))

  routes.delete('/:id', (c) => withLedgerErrors(c, async () => {
    const body = await readLedgerJson(c)
    return c.json(getService().deleteTransaction(c.req.param('id'), body))
  }))

  return routes
}
