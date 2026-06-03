import { Hono } from 'hono'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import matter from 'gray-matter'
import { filePathFor, folderPathFor, POSTS_DIR } from './paths.js'
import { listPostsFlat, buildTree, listSubtreePaths } from './tree.js'

// Local type defs — kept in sync with src/lib/api.ts (Task 5). Don't import from src/
// until that task lands to avoid coupling server type to a moving client surface.
interface PostSummary {
  path: string
  title: string
  date: string
  tags: string[]
  summary?: string
  size: number
  mtime: number
}
interface PostDetail {
  path: string
  raw: string
  frontmatter: Record<string, unknown>
  size: number
  mtime: number
}

const SEGMENT_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/

const app = new Hono()

function bad(c: any, msg: string, code = 400) { return c.json({ error: msg }, code) }

async function exists(p: string) {
  try { await fs.stat(p); return true } catch { return false }
}

app.get('/api/health', (c) => c.json({ ok: true }))

app.get('/api/tree', async (c) => {
  const tree = await buildTree()
  return c.json(tree)
})

app.get('/api/posts', async (c) => {
  const posts = await listPostsFlat()
  return c.json(posts)
})

// Create a new post. Body: { path: string, title?: string }
app.post('/api/posts', async (c) => {
  const body = await c.req.json().catch(() => null) as { path?: string; title?: string } | null
  if (!body || typeof body.path !== 'string') return bad(c, 'path required')
  // Validate only the final segment (the rest is path-validated by filePathFor).
  if (!SEGMENT_RE.test(body.path.replace(/^posts\//, '').split('/').pop() ?? '')) {
    return bad(c, 'invalid final segment')
  }
  let abs: string
  try { abs = filePathFor(body.path) } catch (e: any) { return bad(c, e.message) }
  if (await exists(abs)) return bad(c, 'file exists', 409)
  await fs.mkdir(path.dirname(abs), { recursive: true })
  const title = body.title ?? body.path.split('/').pop()!
  const today = new Date().toISOString().slice(0, 10)
  const slug = title.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
  const body_text = `---\ntitle: ${title}\ndate: ${today}\ntags: []\nslug: ${slug}\n---\n\n# ${title}\n`
  await fs.writeFile(abs, body_text, 'utf8')
  const st = await fs.stat(abs)
  return c.json({
    path: body.path,
    title,
    date: today,
    tags: [],
    size: st.size,
    mtime: st.mtimeMs,
  } satisfies PostSummary, 201)
})

// PUT a file (save raw content). Body: { raw: string }
app.put('/api/posts/*', async (c) => {
  const splat = c.req.path.replace(/^\/api\/posts\//, '')
  let abs: string
  try { abs = filePathFor(`posts/${splat}`) } catch (e: any) { return bad(c, e.message) }
  if (!await exists(abs)) return bad(c, 'not found', 404)
  const body = await c.req.json().catch(() => null) as { raw?: string } | null
  if (!body || typeof body.raw !== 'string') return bad(c, 'raw required')
  await fs.writeFile(abs, body.raw, 'utf8')
  return c.json({ ok: true })
})

// PATCH a file: rename within folder (name) or move (targetPath). Exactly one.
app.patch('/api/posts/*', async (c) => {
  const splat = c.req.path.replace(/^\/api\/posts\//, '')
  const srcPath = `posts/${splat}`
  let src: string
  try { src = filePathFor(srcPath) } catch (e: any) { return bad(c, e.message) }
  if (!await exists(src)) return bad(c, 'not found', 404)

  const body = await c.req.json().catch(() => null) as { name?: string; targetPath?: string } | null
  if (!body || (body.name === undefined && body.targetPath === undefined)) {
    return bad(c, 'name or targetPath required')
  }
  if (body.name !== undefined && body.targetPath !== undefined) {
    return bad(c, 'pass exactly one of name / targetPath')
  }

  let dest: string
  let destPath: string
  if (body.name !== undefined) {
    if (!SEGMENT_RE.test(body.name)) return bad(c, 'invalid name')
    const parent = path.dirname(src)
    dest = path.join(parent, body.name + '.md')
    const parentRel = path.dirname(srcPath)
    destPath = parentRel === 'posts' ? `posts/${body.name}` : `${parentRel}/${body.name}`
  } else {
    try { dest = filePathFor(body.targetPath!) } catch (e: any) { return bad(c, e.message) }
    destPath = body.targetPath!
    // Cycle check: cannot move into own descendant.
    if (dest !== src && body.targetPath!.startsWith(srcPath + '/')) {
      return bad(c, 'cannot move into descendant', 422)
    }
  }
  if (await exists(dest)) return bad(c, 'destination exists', 409)
  await fs.rename(src, dest)
  const st = await fs.stat(dest)
  return c.json({
    path: destPath,
    title: destPath.split('/').pop()!,
    date: '',
    tags: [],
    size: st.size,
    mtime: st.mtimeMs,
  } satisfies PostSummary)
})

// Delete a file
app.delete('/api/posts/*', async (c) => {
  const splat = c.req.path.replace(/^\/api\/posts\//, '')
  let abs: string
  try { abs = filePathFor(`posts/${splat}`) } catch (e: any) { return bad(c, e.message) }
  if (!await exists(abs)) return bad(c, 'not found', 404)
  await fs.unlink(abs)
  return c.json({ ok: true })
})

// Read a single post (raw + frontmatter)
app.get('/api/posts/*', async (c) => {
  const splat = c.req.path.replace(/^\/api\/posts\//, '')
  let abs: string
  try { abs = filePathFor(`posts/${splat}`) } catch (e: any) { return bad(c, e.message) }
  if (!await exists(abs)) return bad(c, 'not found', 404)
  const raw = await fs.readFile(abs, 'utf8')
  const parsed = matter(raw)
  const st = await fs.stat(abs)
  return c.json({
    path: `posts/${splat}`,
    raw,
    frontmatter: parsed.data,
    size: st.size,
    mtime: st.mtimeMs,
  } satisfies PostDetail)
})

// Create an empty folder. Body: { path: string }
app.post('/api/folders', async (c) => {
  const body = await c.req.json().catch(() => null) as { path?: string } | null
  if (!body || typeof body.path !== 'string') return bad(c, 'path required')
  if (!body.path.split('/').every((seg) => SEGMENT_RE.test(seg))) {
    return bad(c, 'invalid segment')
  }
  let abs: string
  try { abs = folderPathFor(body.path) } catch (e: any) { return bad(c, e.message) }
  if (await exists(abs)) return bad(c, 'folder exists', 409)
  await fs.mkdir(abs, { recursive: true })
  return c.json({ path: body.path }, 201)
})

// Rename a folder (single-segment rename, cascades on disk).
app.patch('/api/folders/*', async (c) => {
  const splat = c.req.path.replace(/^\/api\/folders\//, '')
  const srcPath = `posts/${splat}`
  let src: string
  try { src = folderPathFor(srcPath) } catch (e: any) { return bad(c, e.message) }
  if (!await exists(src)) return bad(c, 'not found', 404)

  const body = await c.req.json().catch(() => null) as { newPath?: string } | null
  if (!body || typeof body.newPath !== 'string') return bad(c, 'newPath required')
  // Validate: newPath parent must match srcPath parent, only last segment differs.
  const srcParent = path.dirname(srcPath)
  const newParent = path.dirname(body.newPath)
  if (srcParent !== newParent) return bad(c, 'only single-segment rename allowed', 422)
  let dest: string
  try { dest = folderPathFor(body.newPath) } catch (e: any) { return bad(c, e.message) }
  if (await exists(dest)) return bad(c, 'destination exists', 409)
  await fs.rename(src, dest)
  // Collect affected file paths for client cache refresh.
  const moved = await listSubtreePaths(POSTS_DIR, body.newPath)
  return c.json({ path: body.newPath, moved })
})

// Delete a folder recursively. Requires ?recursive=true if non-empty.
app.delete('/api/folders/*', async (c) => {
  const splat = c.req.path.replace(/^\/api\/folders\//, '')
  const folderP = `posts/${splat}`
  let abs: string
  try { abs = folderPathFor(folderP) } catch (e: any) { return bad(c, e.message) }
  if (!await exists(abs)) return bad(c, 'not found', 404)
  const recursive = c.req.query('recursive') === 'true'
  const all = await listSubtreePaths(POSTS_DIR, folderP)
  if (all.length > 0 && !recursive) {
    return bad(c, 'folder is not empty; pass ?recursive=true to delete', 400)
  }
  await fs.rm(abs, { recursive: true, force: true })
  return c.json({ deleted: all })
})

export default app
