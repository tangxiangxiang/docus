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

serve({ fetch: app.fetch, port: PORT, hostname: HOST }, (info) => {
  console.log(`[docus] listening on http://${info.address}:${info.port}`)
})
