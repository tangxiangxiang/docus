// Hono sub-router for /api/zettel. Mounted by server/index.ts.
//
// /draft/batch is kept as a compatibility alias. New clients should
// call /api/drafts/batch instead.
import { Hono } from 'hono'
import { writeDraftBatchHandler } from './drafts.js'

const zettel = new Hono()

zettel.post('/draft/batch', writeDraftBatchHandler)

export default zettel
