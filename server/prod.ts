// Production entry point. The dev server (server/vite-plugin.ts)
// mounts the Hono app on Vite's middleware; in production we run a
// real Node HTTP server via @hono/node-server, serve the Vite build
// output as static assets, and fall back to index.html for SPA routes
// (the router has a catch-all splat for /vault/:pathMatch(.*)*).
//
// Run with `tsx server/prod.ts` (or compile to JS first).
import 'dotenv/config'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import app from './index.ts'
import { CONTENT_DIR } from './paths.ts'
import { ensureInitialFolders } from './seed.ts'
import { getDb } from './db.ts'
import { migrateVaultMetadata } from './metadataMigration.ts'
import { recoverInterruptedOperations } from './crashRecovery.ts'

const PORT = Number(process.env.PORT ?? 3000)
const HOST = process.env.HOST ?? '0.0.0.0'
const DIST_DIR = path.resolve(process.cwd(), 'dist')

// Cached index.html so the SPA fallback is cheap on every navigation.
let indexHtmlCache: string | null = null
async function getIndexHtml(): Promise<string> {
  if (indexHtmlCache) return indexHtmlCache
  indexHtmlCache = await readFile(path.join(DIST_DIR, 'index.html'), 'utf8')
  return indexHtmlCache
}

// /assets/* and other static files come straight off disk. Everything
// else that isn't /api/* falls through to index.html so vue-router's
// HTML5 history mode (createWebHistory) keeps working after a refresh.
app.use(
  '/*',
  serveStatic({
    root: path.relative(process.cwd(), DIST_DIR) || '.',
  }),
)
app.get('*', async (c) => {
  // Already handled by serveStatic above if a real file matched; this
  // catches SPA paths like /vault/inbox/foo that have no on-disk file.
  if (c.req.path.startsWith('/api/')) return c.notFound()
  const html = await getIndexHtml()
  return c.html(html)
})

// Seed the three vault root folders (inbox / literature / archive)
// before the HTTP server starts accepting requests. Idempotent — existing
// folders and files are left alone; only missing roots are created.
// See server/seed.ts for the rationale.
await ensureInitialFolders(CONTENT_DIR)
console.log(`[docus] content dir: ${CONTENT_DIR}`)

// Reconcile operations interrupted by a previous crash (kill -9, power
// loss, container stop) BEFORE the server accepts a single request —
// a note left missing between the takeover and the commit of an atomic
// save must reappear before any client can observe it. Never throws.
const recovery = await recoverInterruptedOperations(CONTENT_DIR, getDb())
if (recovery.actions.length > 0) {
  console.log(`[docus] crash recovery: resolved ${recovery.actions.length} interrupted operation(s)`)
  for (const action of recovery.actions) {
    console.log(`[docus] crash recovery: ${action.action} ${action.file}${action.detail ? ` (${action.detail})` : ''}`)
  }
}
// Only scan live vault metadata after crash recovery has restored every
// formal path. Otherwise an interrupted takeover can be misclassified
// as an orphan during this very startup.
const metadataReport = await migrateVaultMetadata(getDb(), CONTENT_DIR)
console.log(`[docus] metadata migration: ${JSON.stringify(metadataReport)}`)

serve({ fetch: app.fetch, port: PORT, hostname: HOST }, (info) => {
  console.log(`[docus] listening on http://${info.address}:${info.port}`)
})
