import { Hono } from 'hono'
import fs from 'node:fs/promises'
import path from 'node:path'
import matter from 'gray-matter'

const POSTS_DIR = path.resolve(process.cwd(), 'src/content/posts')
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/

export interface PostSummary {
  slug: string
  title: string
  date: string
  tags: string[]
  summary?: string
  size: number
  mtime: number
}

function assertSafeSlug(slug: string): string {
  if (!SLUG_RE.test(slug)) {
    throw new Error(`Invalid slug: ${slug}`)
  }
  // Path containment check: resolved file must be inside POSTS_DIR
  const fp = path.resolve(POSTS_DIR, `${slug}.md`)
  if (!fp.startsWith(POSTS_DIR + path.sep)) {
    throw new Error(`Slug escapes posts dir: ${slug}`)
  }
  return slug
}

function filePathFor(slug: string): string {
  return path.join(POSTS_DIR, `${assertSafeSlug(slug)}.md`)
}

async function readPostFile(slug: string): Promise<{ raw: string; frontmatter: Record<string, unknown>; content: string }> {
  const raw = await fs.readFile(filePathFor(slug), 'utf-8')
  const { data, content } = matter(raw)
  return { raw, frontmatter: data, content }
}

async function listPosts(): Promise<PostSummary[]> {
  const entries = await fs.readdir(POSTS_DIR)
  const files = entries.filter((f) => f.endsWith('.md'))
  const posts = await Promise.all(
    files.map(async (file): Promise<PostSummary> => {
      const slug = file.replace(/\.md$/, '')
      const fullPath = path.join(POSTS_DIR, file)
      const stat = await fs.stat(fullPath)
      const { frontmatter } = await readPostFile(slug)
      const fm = frontmatter as Record<string, unknown>
      return {
        slug,
        title: (fm.title as string) ?? slug,
        date: (fm.date as string) ?? '',
        tags: (fm.tags as string[]) ?? [],
        summary: (fm.summary as string) ?? '',
        size: stat.size,
        mtime: stat.mtimeMs,
      }
    }),
  )
  return posts.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
}

export function buildApp() {
  const app = new Hono()

  app.use('*', async (c, next) => {
    // Lightweight CORS for direct curl/extension access during dev
    c.header('Access-Control-Allow-Origin', '*')
    c.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
    c.header('Access-Control-Allow-Headers', 'Content-Type')
    if (c.req.method === 'OPTIONS') return c.body(null, 204)
    await next()
  })

  app.get('/api/health', (c) => c.json({ ok: true }))

  app.get('/api/posts', async (c) => {
    return c.json({ posts: await listPosts() })
  })

  app.get('/api/posts/:slug', async (c) => {
    const slug = c.req.param('slug')
    try {
      const post = await readPostFile(slug)
      return c.json({ slug, ...post })
    } catch (e: unknown) {
      const err = e as NodeJS.ErrnoException
      if (err.code === 'ENOENT') return c.json({ error: 'not found' }, 404)
      if (err.message?.startsWith('Invalid slug') || err.message?.startsWith('Slug escapes')) {
        return c.json({ error: err.message }, 400)
      }
      throw e
    }
  })

  app.post('/api/posts', async (c) => {
    let body: { slug?: string; raw?: string }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'invalid json' }, 400)
    }
    if (!body.slug || typeof body.raw !== 'string') {
      return c.json({ error: 'slug and raw required' }, 400)
    }
    try {
      assertSafeSlug(body.slug)
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400)
    }
    const fp = filePathFor(body.slug)
    try {
      await fs.access(fp)
      return c.json({ error: 'exists' }, 409)
    } catch {
      /* does not exist — proceed */
    }
    await fs.writeFile(fp, body.raw, 'utf-8')
    return c.json({ ok: true, slug: body.slug })
  })

  app.put('/api/posts/:slug', async (c) => {
    const slug = c.req.param('slug')
    let body: { raw?: string }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'invalid json' }, 400)
    }
    if (typeof body.raw !== 'string') {
      return c.json({ error: 'raw required' }, 400)
    }
    let fp: string
    try {
      fp = filePathFor(slug)
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400)
    }
    try {
      await fs.access(fp)
    } catch {
      return c.json({ error: 'not found' }, 404)
    }
    await fs.writeFile(fp, body.raw, 'utf-8')
    return c.json({ ok: true })
  })

  app.delete('/api/posts/:slug', async (c) => {
    const slug = c.req.param('slug')
    let fp: string
    try {
      fp = filePathFor(slug)
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400)
    }
    try {
      await fs.unlink(fp)
    } catch (e) {
      const err = e as NodeJS.ErrnoException
      if (err.code === 'ENOENT') return c.json({ error: 'not found' }, 404)
      throw e
    }
    return c.json({ ok: true })
  })

  app.patch('/api/posts/:slug/rename', async (c) => {
    const oldSlug = c.req.param('slug')
    let body: { newSlug?: string }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'invalid json' }, 400)
    }
    if (!body.newSlug) {
      return c.json({ error: 'newSlug required' }, 400)
    }
    let oldPath: string
    let newPath: string
    try {
      oldPath = filePathFor(oldSlug)
      assertSafeSlug(body.newSlug)
      newPath = filePathFor(body.newSlug)
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400)
    }
    if (oldPath === newPath) return c.json({ ok: true, slug: oldSlug })
    try {
      await fs.access(newPath)
      return c.json({ error: 'exists' }, 409)
    } catch {
      /* ok */
    }
    await fs.rename(oldPath, newPath)
    return c.json({ ok: true, slug: body.newSlug })
  })

  return app
}
