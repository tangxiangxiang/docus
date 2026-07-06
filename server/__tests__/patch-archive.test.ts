// PATCH /api/posts/* archive-to-zettel whitelist.
//
// The archive action and classified drops onto zettel subfolders can land a
// file in zettel/. The server is the second line of defense: PATCH must refuse
// any targetPath under zettel/ unless the source currently lives under inbox/
// or literature/.
//
// We mock filePathFor into a per-test tmp dir (same pattern as
// get-post.test.ts and split.test.ts) so the test never touches the
// real src/content/ vault.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import app from '../index'

let tmpRoot: string
vi.mock('../paths.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../paths.js')>()
  return {
    ...mod,
    filePathFor: (p: string) => path.join(tmpRoot, p + '.md'),
  }
})

async function patch(urlPath: string, body: unknown) {
  const req = new Request(`http://localhost${urlPath}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return app.fetch(req)
}

async function del(urlPath: string) {
  const req = new Request(`http://localhost${urlPath}`, { method: 'DELETE' })
  return app.fetch(req)
}

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'docus-patch-archive-test-'))
  await fs.mkdir(path.join(tmpRoot, 'inbox'), { recursive: true })
  await fs.mkdir(path.join(tmpRoot, 'literature'), { recursive: true })
  await fs.mkdir(path.join(tmpRoot, 'archive'), { recursive: true })
  await fs.mkdir(path.join(tmpRoot, 'zettel'), { recursive: true })
  await fs.mkdir(path.join(tmpRoot, 'zettel', 'concepts'), { recursive: true })
  await fs.writeFile(path.join(tmpRoot, 'inbox', 'foo.md'), '---\ntitle: Foo\n---\n\nbody\n', 'utf8')
  await fs.writeFile(path.join(tmpRoot, 'literature', 'ahrens.md'), '---\ntitle: Ahrens\n---\n\nbody\n', 'utf8')
  await fs.writeFile(path.join(tmpRoot, 'archive', 'old.md'), '---\ntitle: Old\n---\n\nbody\n', 'utf8')
  await fs.writeFile(path.join(tmpRoot, 'zettel', 'perm.md'), '---\ntitle: Perm\n---\n\nbody\n', 'utf8')
})

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true })
})

describe('PATCH /api/posts/* archive-to-zettel whitelist', () => {
  it('moves inbox/foo.md to zettel/foo.md', async () => {
    const r = await patch('/api/posts/inbox/foo', { targetPath: 'zettel/foo' })
    expect(r.status).toBe(200)
    expect(await fs.stat(path.join(tmpRoot, 'zettel', 'foo.md'))).toBeTruthy()
    // Source is gone.
    await expect(fs.stat(path.join(tmpRoot, 'inbox', 'foo.md'))).rejects.toThrow()
  })

  it('moves literature/ahrens.md to zettel/ahrens.md', async () => {
    const r = await patch('/api/posts/literature/ahrens', { targetPath: 'zettel/ahrens' })
    expect(r.status).toBe(200)
    expect(await fs.stat(path.join(tmpRoot, 'zettel', 'ahrens.md'))).toBeTruthy()
  })

  it('moves inbox/foo.md to a zettel subfolder for classified archiving', async () => {
    const r = await patch('/api/posts/inbox/foo', { targetPath: 'zettel/concepts/foo' })
    expect(r.status).toBe(200)
    expect(await fs.stat(path.join(tmpRoot, 'zettel', 'concepts', 'foo.md'))).toBeTruthy()
  })

  it('allows zettel/* → zettel/* reclassification', async () => {
    const r = await patch('/api/posts/zettel/perm', { targetPath: 'zettel/concepts/perm' })
    expect(r.status).toBe(200)
    expect(await fs.stat(path.join(tmpRoot, 'zettel', 'concepts', 'perm.md'))).toBeTruthy()
  })

  it('refuses zettel/* → inbox/* (permanent notes stay in zettel)', async () => {
    const r = await patch('/api/posts/zettel/perm', { targetPath: 'inbox/perm' })
    expect(r.status).toBe(422)
    expect(await fs.stat(path.join(tmpRoot, 'zettel', 'perm.md'))).toBeTruthy()
    await expect(fs.stat(path.join(tmpRoot, 'inbox', 'perm.md'))).rejects.toThrow()
  })

  it('refuses zettel rename via PATCH body.name (server backstop)', async () => {
    // The client hides the rename menu item inside zettel via canModify,
    // but a non-UI caller hitting the API directly must still be blocked.
    const r = await patch('/api/posts/zettel/perm', { name: 'renamed' })
    expect(r.status).toBe(422)
    expect(await fs.stat(path.join(tmpRoot, 'zettel', 'perm.md'))).toBeTruthy()
    await expect(fs.stat(path.join(tmpRoot, 'zettel', 'renamed.md'))).rejects.toThrow()
  })

  it('refuses DELETE inside zettel/ (server backstop)', async () => {
    // Same rationale as the rename guard: the client hides the menu
    // item, but a non-UI caller hitting the API directly must be blocked.
    const r = await del('/api/posts/zettel/perm')
    expect(r.status).toBe(422)
    expect(await fs.stat(path.join(tmpRoot, 'zettel', 'perm.md'))).toBeTruthy()
  })

  it('treats case-variant Zettel/ prefix as zettel (refuses zettel → non-zettel move)', async () => {
    // isInZettel is case-insensitive on purpose: macOS APFS (the default
    // dev filesystem) collapses case variants to the same dir at the OS
    // level, so the protocol layer must too. Without this, a capital-Z
    // path could escape the "zettel notes stay in zettel" gate.
    // Seed a file under the case-variant path and try to move it out.
    await fs.writeFile(path.join(tmpRoot, 'Zettel', 'perm.md'), '---\ntitle: P\n---\n\nbody\n', 'utf8')
    const r = await patch('/api/posts/Zettel/perm', { targetPath: 'inbox/perm' })
    expect(r.status).toBe(422)
    expect(await fs.stat(path.join(tmpRoot, 'Zettel', 'perm.md'))).toBeTruthy()
    await expect(fs.stat(path.join(tmpRoot, 'inbox', 'perm.md'))).rejects.toThrow()
  })

  it('refuses archive/old.md → zettel/old (source not in inbox/literature)', async () => {
    // The user-defined `archive/` folder is user content but not part
    // of the Zettelkasten ingest flow — only inbox/ and literature/
    // notes are eligible to be archived.
    const r = await patch('/api/posts/archive/old', { targetPath: 'zettel/old' })
    expect(r.status).toBe(422)
    expect(await fs.stat(path.join(tmpRoot, 'archive', 'old.md'))).toBeTruthy()
    await expect(fs.stat(path.join(tmpRoot, 'zettel', 'old.md'))).rejects.toThrow()
  })

  it('still allows ordinary inbox → literature moves (not blocked by whitelist)', async () => {
    // The whitelist only catches moves INTO zettel/. Ordinary moves
    // between user folders must still work.
    const r = await patch('/api/posts/inbox/foo', { targetPath: 'literature/foo' })
    expect(r.status).toBe(200)
    expect(await fs.stat(path.join(tmpRoot, 'literature', 'foo.md'))).toBeTruthy()
  })
})
