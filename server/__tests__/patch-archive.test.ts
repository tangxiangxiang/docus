// PATCH /api/posts/* archive-to-zettel whitelist.
//
// The menu's archive action is the ONLY client path that lets a file
// land in zettel/. The server is the second line of defense: even if the
// client guard in FileTree.onMove is bypassed, PATCH must refuse any
// targetPath under zettel/ unless the source currently lives under
// inbox/ or literature/.
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

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'docus-patch-archive-test-'))
  await fs.mkdir(path.join(tmpRoot, 'inbox'), { recursive: true })
  await fs.mkdir(path.join(tmpRoot, 'literature'), { recursive: true })
  await fs.mkdir(path.join(tmpRoot, 'archive'), { recursive: true })
  await fs.mkdir(path.join(tmpRoot, 'zettel'), { recursive: true })
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

  it('refuses zettel/* → zettel/* (zettel is read-only, no internal moves)', async () => {
    const r = await patch('/api/posts/zettel/perm', { targetPath: 'zettel/other' })
    // zettel/perm is NOT under inbox/ or literature/, so the whitelist
    // catches it. (The client also blocks this — the menu gate means
    // the action never gets here — but the server must agree.)
    expect(r.status).toBe(422)
    // Original file is untouched.
    expect(await fs.stat(path.join(tmpRoot, 'zettel', 'perm.md'))).toBeTruthy()
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