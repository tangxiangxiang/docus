// Hono sub-router for /api/zettel. Mounted by server/index.ts.
//
// /draft/batch is kept as a compatibility alias. New clients should
// call /api/drafts/batch instead.
import { Hono } from 'hono'
import type { Database as DatabaseT } from 'better-sqlite3'
import { getDb } from './db.js'
import { writeDraftBatchHandler } from './drafts.js'

export function createZettelRoutes(dbProvider: () => DatabaseT = getDb) {
  const routes = new Hono()
  routes.post('/draft/batch', (c) => writeDraftBatchHandler(c, dbProvider()))
  return routes
}

export default createZettelRoutes()
