import { Hono } from 'hono'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import matter from 'gray-matter'
import { filePathFor, folderPathFor, CONTENT_DIR } from './paths.js'
import { listPostsFlat, buildTree, listSubtreePaths } from './tree.js'
import { getIndex as getLinkIndex } from './linkIndex.js'
import aiRoutes from './ai/routes.js'
import type { PostSummary, PostDetail } from '../src/lib/api.js'

// The server is intentionally not in the type-check graph (no tsconfig include),
// but the wire shapes still have to agree with the client. Importing the same
// types that the client uses means there is a single source of truth for the
// JSON contract — and the previous local copy was already drifting (missing
// `summary?: string`), so a shared import also fixes a latent type bug.

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
  if (!SEGMENT_RE.test(body.path.split('/').pop() ?? '')) {
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
  // Update the link index AFTER the disk write succeeds. Best-effort:
  // a failure here just leaves a stale entry; the next rebuild fixes it.
  try {
    const idx = await getLinkIndex()
    idx.applyWrite(body.path, body_text)
  } catch { /* ignore */ }
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
  try { abs = filePathFor(splat) } catch (e: any) { return bad(c, e.message) }
  if (!await exists(abs)) return bad(c, 'not found', 404)
  const body = await c.req.json().catch(() => null) as { raw?: string } | null
  if (!body || typeof body.raw !== 'string') return bad(c, 'raw required')
  await fs.writeFile(abs, body.raw, 'utf8')
  try {
    const idx = await getLinkIndex()
    idx.applyWrite(splat, body.raw)
  } catch { /* ignore */ }
  return c.json({ ok: true })
})

// PATCH a file: rename within folder (name) or move (targetPath). Exactly one.
app.patch('/api/posts/*', async (c) => {
  const splat = c.req.path.replace(/^\/api\/posts\//, '')
  const srcPath = splat
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
    destPath = parentRel ? `${parentRel}/${body.name}` : body.name
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
  // Update the link index AFTER the rename succeeds. Read the new
  // content so the new path's outbound links are extracted against
  // the post-rename state of the world.
  try {
    const idx = await getLinkIndex()
    const newRaw = await fs.readFile(dest, 'utf8')
    idx.applyRename(srcPath, destPath, newRaw)
  } catch { /* ignore */ }
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
  try { abs = filePathFor(splat) } catch (e: any) { return bad(c, e.message) }
  if (!await exists(abs)) return bad(c, 'not found', 404)
  await fs.unlink(abs)
  try {
    const idx = await getLinkIndex()
    idx.applyDelete(splat)
  } catch { /* ignore */ }
  return c.json({ ok: true })
})

// Read a single post (raw + frontmatter)
app.get('/api/posts/*', async (c) => {
  const splat = c.req.path.replace(/^\/api\/posts\//, '')
  let abs: string
  try { abs = filePathFor(splat) } catch (e: any) { return bad(c, e.message) }
  if (!await exists(abs)) return bad(c, 'not found', 404)
  const raw = await fs.readFile(abs, 'utf8')
  const parsed = matter(raw)
  const st = await fs.stat(abs)
  return c.json({
    path: splat,
    raw,
    content: parsed.content,
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
  const srcPath = splat
  let src: string
  try { src = folderPathFor(srcPath) } catch (e: any) { return bad(c, e.message) }
  if (!await exists(src)) return bad(c, 'not found', 404)

  const body = await c.req.json().catch(() => null) as { newPath?: string } | null
  if (!body || typeof body.newPath !== 'string') return bad(c, 'newPath required')
  const newPath = body.newPath
  // Validate: newPath parent must match srcPath parent, only last segment differs.
  const srcParent = path.dirname(srcPath)
  const newParent = path.dirname(body.newPath)
  if (srcParent !== newParent) return bad(c, 'only single-segment rename allowed', 422)
  let dest: string
  try { dest = folderPathFor(body.newPath) } catch (e: any) { return bad(c, e.message) }
  if (await exists(dest)) return bad(c, 'destination exists', 409)
  await fs.rename(src, dest)
  // Collect affected file paths for client cache refresh.
  const moved = await listSubtreePaths(CONTENT_DIR, newPath)
  // Update the link index. We need the OLD subtree paths (to apply
  // delete) and the NEW subtree paths + raws (to apply write with
  // the new source-dir for resolution).
  try {
    const idx = await getLinkIndex()
    const oldPaths = await listSubtreePaths(CONTENT_DIR, srcPath)
    const pairs = await Promise.all(moved.map(async (newPath) => {
      const oldPath = srcPath + newPath.slice(newPath.length)
      const newRaw = await fs.readFile(filePathFor(newPath), 'utf8')
      return { oldPath, newPath, newRaw }
    }))
    // Only cascade files that actually existed in the old subtree.
    const oldSet = new Set(oldPaths)
    idx.applyFolderRename(pairs.filter((p) => oldSet.has(p.oldPath)))
  } catch { /* ignore */ }
  return c.json({ path: body.newPath, moved })
})

// Delete a folder recursively. Requires ?recursive=true if non-empty.
app.delete('/api/folders/*', async (c) => {
  const splat = c.req.path.replace(/^\/api\/folders\//, '')
  const folderP = splat
  let abs: string
  try { abs = folderPathFor(folderP) } catch (e: any) { return bad(c, e.message) }
  if (!await exists(abs)) return bad(c, 'not found', 404)
  const recursive = c.req.query('recursive') === 'true'
  const all = await listSubtreePaths(CONTENT_DIR, folderP)
  if (all.length > 0 && !recursive) {
    return bad(c, 'folder is not empty; pass ?recursive=true to delete', 400)
  }
  await fs.rm(abs, { recursive: true, force: true })
  try {
    const idx = await getLinkIndex()
    idx.applyFolderDelete(all)
  } catch { /* ignore */ }
  return c.json({ deleted: all })
})

// Link index endpoints. The full snapshot is what the client uses to
// render wiki links (for existence checks) and to power the Links
// panel's outgoing column. Backlinks are computed on demand from the
// forward map.
app.get('/api/links/index', async (c) => {
  const idx = await getLinkIndex()
  return c.json(idx.snapshot())
})

app.get('/api/backlinks', async (c) => {
  const target = c.req.query('path')
  if (!target) return bad(c, 'path required')
  const idx = await getLinkIndex()
  return c.json(idx.getBacklinks(target))
})

app.route('/api/ai', aiRoutes)

export default app
