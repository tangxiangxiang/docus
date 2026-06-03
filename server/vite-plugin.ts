import type { Plugin } from 'vite'
import app from './index.ts'

export function serverPlugin(): Plugin {
  return {
    name: 'docus-server',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next()
        const url = `http://localhost${req.url}`
        const headers = new Headers()
        for (const [k, v] of Object.entries(req.headers)) {
          if (Array.isArray(v)) v.forEach((vv) => headers.append(k, vv))
          else if (v != null) headers.set(k, String(v))
        }
        const method = req.method ?? 'GET'
        let body: Buffer | undefined
        if (method !== 'GET' && method !== 'HEAD' && req.readable) {
          const chunks: Buffer[] = []
          for await (const chunk of req) chunks.push(chunk as Buffer)
          body = Buffer.concat(chunks)
        }
        const fetchReq = new Request(url, {
          method,
          headers,
          body: body as any,
        })
        const fetchRes = await app.fetch(fetchReq)
        res.statusCode = fetchRes.status
        fetchRes.headers.forEach((v, k) => res.setHeader(k, v))
        if (fetchRes.body) {
          const buf = Buffer.from(await fetchRes.arrayBuffer())
          res.end(buf)
        } else {
          res.end()
        }
      })
    },
  }
}
