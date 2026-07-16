// HTTP-level tests for /api/history. Drives the Hono sub-router
// directly (not the full app) so the tests can swap repoRoot via
// setRepoRootForTesting against a fresh tempdir per test.
//
// The /capability route is the only one with global state (the
// `git --version` probe is cached). We reset it in beforeEach so
// each test starts fresh.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import historyRoutes, {
  setRepoRootForTesting,
  __resetRepoRootForTesting,
  __resetGitCapabilityForTesting,
} from '../history/routes.js'

let root: string

async function write(rel: string, body: string) {
  const abs = path.join(root, rel)
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await fs.writeFile(abs, body, 'utf8')
}

async function read(rel: string) {
  return fs.readFile(path.join(root, rel), 'utf8')
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'docus-history-routes-'))
  setRepoRootForTesting(root)
  __resetGitCapabilityForTesting()
  // /capability calls ensureRepo, which would create a real git repo
  // and a real .gitignore. Set the user config early so commits
  // made by /commits don't fail with "Author identity unknown".
  const { run } = await import('../history/git.js')
  // We need to init + config + write files in a specific order, but
  // the capability probe handles the init. So before each test we
  // just do the user config after the first /capability call.
  // Tests that don't need it skip this entirely.
})

afterEach(async () => {
  __resetRepoRootForTesting()
  __resetGitCapabilityForTesting()
  await fs.rm(root, { recursive: true, force: true })
})

async function configureGitUser() {
  const { run } = await import('../history/git.js')
  await run(root, ['config', 'user.name', 'Test User'])
  await run(root, ['config', 'user.email', 'test@example.com'])
}

async function call(method: string, urlPath: string, body?: unknown, autoExpected = true) {
  let requestBody = body
  if (
    autoExpected
    && method === 'POST'
    && urlPath === '/commits'
    && body
    && typeof body === 'object'
    && !('expected' in body)
  ) {
    const candidate = body as { paths?: unknown; message?: unknown }
    if (Array.isArray(candidate.paths) && candidate.paths.length > 0 && candidate.paths.every((filePath) => (
      typeof filePath === 'string' && !filePath.includes('..') && /^[a-z0-9/-]+\.md$/.test(filePath)
    ))) {
      const entries = await Promise.all(candidate.paths.map(async (filePath) => {
        try {
          const bytes = await fs.readFile(path.join(root, filePath))
          return [filePath, createHash('sha256').update(bytes).digest('hex')] as const
        } catch (error: any) {
          if (error?.code === 'ENOENT') return [filePath, null] as const
          throw error
        }
      }))
      requestBody = { ...candidate, expected: Object.fromEntries(entries) }
    }
  }
  const req = new Request(`http://localhost${urlPath}`, {
    method,
    headers: requestBody ? { 'content-type': 'application/json' } : undefined,
    body: requestBody ? JSON.stringify(requestBody) : undefined,
  })
  return historyRoutes.fetch(req)
}

describe('GET /api/history/capability', () => {
  it('reports gitAvailable=true and repoInitialized=true after first call', async () => {
    const r = await call('GET', '/capability')
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ gitAvailable: true, repoInitialized: true })
  })

  it('is idempotent on a second call', async () => {
    await call('GET', '/capability')
    const r2 = await call('GET', '/capability')
    expect(r2.status).toBe(200)
    expect(await r2.json()).toEqual({ gitAvailable: true, repoInitialized: true })
  })
})

describe('GET /api/history/status', () => {
  beforeEach(async () => {
    await call('GET', '/capability') // bootstraps the repo
    await configureGitUser()
  })

  it('returns empty dirty list when the working tree is clean', async () => {
    // The vault-managed .gitignore/.gitattributes exist on disk, but
    // the route hides them so the first History view starts clean.
    const r = await call('GET', '/status')
    expect(r.status).toBe(200)
    const body = await r.json() as { dirty: any[]; available: boolean }
    expect(body.available).toBe(true)
    const paths = body.dirty.map((e) => e.path).sort()
    expect(paths).toEqual([])
  })

  it('reports new and modified files', async () => {
    await write('inbox/a.md', 'one')
    await call('POST', '/commits', { paths: ['inbox/a.md'], message: 'seed' })
    await write('inbox/a.md', 'one (changed)')
    await write('inbox/b.md', 'new')
    const r = await call('GET', '/status')
    const body = await r.json() as { dirty: { path: string; worktree: string; index: string }[] }
    const byPath = Object.fromEntries(body.dirty.map((e) => [e.path, e]))
    expect(byPath['inbox/a.md'].worktree).toBe('M')
    expect(byPath['inbox/b.md']).toEqual({ index: '?', worktree: '?', path: 'inbox/b.md' })
  })

  it('hides non-Markdown files that the commit contract cannot accept', async () => {
    await write('note.md', 'note')
    await write('assets/image.png', 'not really a png')
    await write('attachment.pdf', 'not really a pdf')

    const r = await call('GET', '/status')
    const body = await r.json() as { dirty: { path: string }[] }

    const paths = body.dirty.map((entry) => entry.path)
    expect(paths).toContain('note.md')
    expect(paths).not.toContain('assets/image.png')
    expect(paths).not.toContain('attachment.pdf')
  })
})

describe('GET /api/history/log', () => {
  beforeEach(async () => {
    await call('GET', '/capability')
    await configureGitUser()
  })

  it('returns commits newest-first across multiple /commits calls', async () => {
    await write('a.md', '1')
    await call('POST', '/commits', { paths: ['a.md'], message: 'one' })
    await new Promise((r) => setTimeout(r, 1100))
    await write('b.md', '2')
    await call('POST', '/commits', { paths: ['b.md'], message: 'two' })
    const r = await call('GET', '/log')
    const body = await r.json() as { commits: { subject: string }[] }
    expect(body.commits.map((c) => c.subject)).toEqual(['two', 'one'])
  }, 15_000)

  it('filters by path', async () => {
    await write('a.md', '1')
    await call('POST', '/commits', { paths: ['a.md'], message: 'touch a' })
    await write('b.md', '1')
    await call('POST', '/commits', { paths: ['b.md'], message: 'touch b' })
    const r = await call('GET', '/log?path=b.md')
    const body = await r.json() as { commits: { subject: string }[] }
    expect(body.commits.map((c) => c.subject)).toEqual(['touch b'])
  }, 15_000)

  it('rejects invalid path filters', async () => {
    const r = await call('GET', '/log?path=../outside.md')
    expect(r.status).toBe(400)
  })

  // Regression: a freshly-initialized vault (no commits yet) used to
  // return 500 with `git log failed: ... does not have any commits yet`,
  // which the client treated as `{ error: ... }`, then the History
  // panel crashed on `h.log.value.length` (undefined.length). The
  // route should now treat the empty-repo case as a successful empty
  // log so the panel can render "No commits yet." instead of crashing.
  it('returns an empty list (not 500) on a freshly-initialized repo with no commits', async () => {
    const r = await call('GET', '/log?limit=200')
    expect(r.status).toBe(200)
    const body = await r.json() as { commits: unknown[] }
    expect(body.commits).toEqual([])
  })

  // Companion regression: same empty-repo case but for /diff. The
  // HistoryPanel defaults the file selection to HEAD~1..HEAD, and
  // HEAD~1 on a fresh vault used to throw "ambiguous argument" from
  // git show — surfacing as a 500 on /diff and breaking the panel
  // before the user could even stage their first commit. After the
  // rawAt fix, both refs resolve to null and the diff is just an
  // empty shape (zero stats) — the panel renders "no previous
  // version" gracefully.
  it('returns an empty diff (not 500) when both refs are HEAD~1/HEAD on an empty repo', async () => {
    const r = await call('GET', '/diff?path=inbox/init.md&old=HEAD~1&new=HEAD')
    expect(r.status).toBe(200)
    const body = await r.json() as { diff: { stats: { added: number; removed: number; equal: number }; ops: unknown[] } }
    expect(body.diff.stats).toEqual({ added: 0, removed: 0, equal: 0 })
    expect(body.diff.ops).toEqual([])
  })
})

describe('GET /api/history/file', () => {
  beforeEach(async () => {
    await call('GET', '/capability')
    await configureGitUser()
  })

  it('returns raw content of HEAD', async () => {
    await write('note.md', 'hello')
    await call('POST', '/commits', { paths: ['note.md'], message: 'v1' })
    const r = await call('GET', '/file?path=note.md')
    const body = await r.json() as { content: string; ref: string }
    expect(body.content).toBe('hello')
    expect(body.ref).toBe('HEAD')
  })

  it('returns raw content of a specific sha', async () => {
    await write('note.md', 'v1')
    const c1 = (await (await call('POST', '/commits', { paths: ['note.md'], message: 'v1' })).json()) as { sha: string }
    await write('note.md', 'v2')
    await call('POST', '/commits', { paths: ['note.md'], message: 'v2' })
    const r = await call('GET', `/file?path=note.md&ref=${c1.sha}`)
    const body = await r.json() as { content: string }
    expect(body.content).toBe('v1')
  })

  it('returns 404 when the file did not exist at the ref', async () => {
    await write('a.md', '1')
    const c1 = (await (await call('POST', '/commits', { paths: ['a.md'], message: 'seed' })).json()) as { sha: string }
    await write('b.md', '2')
    await call('POST', '/commits', { paths: ['b.md'], message: 'add b' })
    const r = await call('GET', `/file?path=b.md&ref=${c1.sha}`)
    expect(r.status).toBe(404)
  })

  it('returns 400 when path is missing', async () => {
    const r = await call('GET', '/file')
    expect(r.status).toBe(400)
  })

  it('rejects path traversal for WORKTREE reads', async () => {
    const r = await call('GET', '/file?path=../package.json&ref=WORKTREE')
    expect(r.status).toBe(400)
  })

  it('rejects invalid refs', async () => {
    const r = await call('GET', '/file?path=note.md&ref=main')
    expect(r.status).toBe(400)
  })
})

describe('GET /api/history/diff', () => {
  beforeEach(async () => {
    await call('GET', '/capability')
    await configureGitUser()
  })

  it('returns line-level ops between two refs', async () => {
    await write('note.md', 'one\ntwo\nthree\n')
    const c1 = (await (await call('POST', '/commits', { paths: ['note.md'], message: 'v1' })).json()) as { sha: string }
    await write('note.md', 'one\nTWO\nthree\nfour\n')
    const c2 = (await (await call('POST', '/commits', { paths: ['note.md'], message: 'v2' })).json()) as { sha: string }
    const r = await call('GET', `/diff?path=note.md&old=${c1.sha}&new=${c2.sha}`)
    const body = await r.json() as { diff: { ops: { op: string; text: string }[]; stats: { added: number; removed: number; equal: number } } }
    expect(body.diff.stats).toEqual({ added: 2, removed: 1, equal: 2 })
    const removeOp = body.diff.ops.find((o) => o.op === 'remove')
    const addOp = body.diff.ops.find((o) => o.op === 'add' && o.text === 'TWO')
    expect(removeOp?.text).toBe('two')
    expect(addOp).toBeDefined()
  })

  it('handles a file that did not exist on the old side', async () => {
    // First commit adds a.md; then we diff (empty) -> v1.
    await call('GET', '/capability') // ensure repo
    await write('a.md', 'one\ntwo\n')
    const c1 = (await (await call('POST', '/commits', { paths: ['a.md'], message: 'add a' })).json()) as { sha: string }
    const r = await call('GET', `/diff?path=a.md&old=4b825dc642cb6eb9a060e54bf8d69288fbee4904&new=${c1.sha}`)
    // 4b825dc... is the empty-tree sha — the "old side" of an added file.
    const body = await r.json() as { diff: { stats: { added: number; removed: number } } }
    expect(body.diff.stats.added).toBe(2)
    expect(body.diff.stats.removed).toBe(0)
  })

  it('handles a root commit diff via sha~1 without rejecting the ref', async () => {
    await write('first.md', 'one\ntwo\n')
    const c1 = (await (await call('POST', '/commits', { paths: ['first.md'], message: 'add first' })).json()) as { sha: string }
    const r = await call('GET', `/diff?path=first.md&old=${c1.sha}~1&new=${c1.sha}`)
    expect(r.status).toBe(200)
    const body = await r.json() as { diff: { stats: { added: number; removed: number; equal: number } } }
    expect(body.diff.stats).toEqual({ added: 2, removed: 0, equal: 0 })
  })

  it('returns 400 when refs are missing', async () => {
    const r = await call('GET', '/diff?path=x')
    expect(r.status).toBe(400)
  })

  // The WORKTREE ref is a sentinel meaning "the file as it sits on
  // disk right now". Diffing HEAD..WORKTREE lets the user see their
  // uncommitted edits without staging + committing first. The route
  // passes the sentinel through to rawAt, which reads from disk.
  it('returns the worktree-vs-HEAD diff via the WORKTREE sentinel', async () => {
    await write('note.md', 'one\ntwo\nthree\n')
    await call('POST', '/commits', { paths: ['note.md'], message: 'v1' })
    // Overwrite on disk without committing — this is the user's
    // uncommitted edit, exactly what the diff should surface.
    await write('note.md', 'one\nTWO\nthree\nfour\n')
    const r = await call('GET', '/diff?path=note.md&old=HEAD&new=WORKTREE')
    expect(r.status).toBe(200)
    const body = await r.json() as { diff: { ops: { op: string; text: string }[]; stats: { added: number; removed: number } } }
    expect(body.diff.stats.added).toBe(2)
    expect(body.diff.stats.removed).toBe(1)
  })

  it('represents a deleted working-tree file as removals from HEAD', async () => {
    await write('deleted.md', 'one\ntwo\n')
    await call('POST', '/commits', { paths: ['deleted.md'], message: 'seed deleted file' })
    await fs.unlink(path.join(root, 'deleted.md'))

    const r = await call('GET', '/diff?path=deleted.md&old=HEAD&new=WORKTREE')
    expect(r.status).toBe(200)
    const body = await r.json() as { diff: { ops: Array<{ op: string; text: string }>; stats: { added: number; removed: number; equal: number } } }
    expect(body.diff.stats).toEqual({ added: 0, removed: 2, equal: 0 })
    expect(body.diff.ops.map((op) => [op.op, op.text])).toEqual([
      ['remove', 'one'],
      ['remove', 'two'],
    ])
  })

  it('rejects invalid diff paths and refs', async () => {
    const badPath = await call('GET', '/diff?path=.git/config&old=HEAD&new=WORKTREE')
    expect(badPath.status).toBe(400)
    const badRef = await call('GET', '/diff?path=note.md&old=main&new=WORKTREE')
    expect(badRef.status).toBe(400)
  })
})

describe('POST /api/history/commits', () => {
  beforeEach(async () => {
    await call('GET', '/capability')
    await configureGitUser()
  })

  it('creates a commit and returns its sha + filesCommitted', async () => {
    await write('a.md', '1')
    const r = await call('POST', '/commits', { paths: ['a.md'], message: 'first' })
    expect(r.status).toBe(201)
    const body = await r.json() as { sha: string; filesCommitted: string[] }
    expect(body.sha).toMatch(/^[0-9a-f]{40}$/)
    expect(body.filesCommitted).toEqual(['a.md'])
  })

  it('returns 400 on empty paths', async () => {
    const r = await call('POST', '/commits', { paths: [], message: 'x' })
    expect(r.status).toBe(400)
  })

  it('returns 400 on empty message', async () => {
    const r = await call('POST', '/commits', { paths: ['a.md'], message: '   ' })
    expect(r.status).toBe(400)
  })

  it('returns 400 on non-string path entry', async () => {
    const r = await call('POST', '/commits', { paths: ['a.md', 42], message: 'x' })
    expect(r.status).toBe(400)
  })

  it('returns 400 on unsafe or non-note paths', async () => {
    const outside = await call('POST', '/commits', { paths: ['../outside.md'], message: 'x' })
    expect(outside.status).toBe(400)
    const dotfile = await call('POST', '/commits', { paths: ['.gitignore'], message: 'x' })
    expect(dotfile.status).toBe(400)
  })

  it('returns a clear 409 when the selected path is no longer dirty', async () => {
    await write('a.md', 'x')
    await call('POST', '/commits', { paths: ['a.md'], message: 'first' })
    const r = await call('POST', '/commits', { paths: ['a.md'], message: 'second' })
    expect(r.status).toBe(409)
    expect(((await r.json()) as { error: string }).error).toBe('selection is stale; no longer changed: a.md')
  })

  it('requires expected content hashes for every commit request', async () => {
    await write('a.md', 'x')
    const r = await call('POST', '/commits', { paths: ['a.md'], message: 'x' }, false)
    expect(r.status).toBe(400)
    expect(((await r.json()) as { error: string }).error).toBe('expected content hashes required')
  })

  it('returns 409 without committing when content changes after hash capture', async () => {
    await write('a.md', 'click-time content')
    const hashesResponse = await call('POST', '/content-hashes', { paths: ['a.md'] })
    const { hashes } = await hashesResponse.json() as { hashes: Record<string, string> }
    await write('a.md', 'restored or externally changed content')

    const r = await call('POST', '/commits', {
      paths: ['a.md'],
      message: 'must preserve click-time boundary',
      expected: hashes,
    })

    expect(r.status).toBe(409)
    expect(((await r.json()) as { error: string }).error).toBe('content changed before commit: a.md')
    const log = await (await call('GET', '/log')).json() as { commits: unknown[] }
    expect(log.commits).toEqual([])
  })

  it('rejects the whole batch when one selected path became clean', async () => {
    await write('clean.md', 'clean')
    await call('POST', '/commits', { paths: ['clean.md'], message: 'seed' })
    await write('dirty.md', 'dirty')

    const r = await call('POST', '/commits', {
      paths: ['clean.md', 'dirty.md'],
      message: 'must not partially commit',
    })

    expect(r.status).toBe(409)
    expect(((await r.json()) as { error: string }).error).toContain('clean.md')
    const log = await (await call('GET', '/log')).json() as { commits: Array<{ subject: string }> }
    expect(log.commits.map((commit) => commit.subject)).toEqual(['seed'])
    const status = await (await call('GET', '/status')).json() as { dirty: Array<{ path: string }> }
    expect(status.dirty.map((entry) => entry.path)).toContain('dirty.md')
  })

  it('commits an externally deleted selected file', async () => {
    await write('deleted.md', 'before\n')
    await call('POST', '/commits', { paths: ['deleted.md'], message: 'seed' })
    await fs.unlink(path.join(root, 'deleted.md'))

    const r = await call('POST', '/commits', { paths: ['deleted.md'], message: 'delete note' })

    expect(r.status).toBe(201)
    const body = await r.json() as { filesCommitted: string[] }
    expect(body.filesCommitted).toEqual(['deleted.md'])
    const { rawAt } = await import('../history/git.js')
    expect(await rawAt(root, 'HEAD', 'deleted.md')).toBeNull()
  })

  it('commits both sides of an externally moved file', async () => {
    await write('old.md', 'moved\n')
    await call('POST', '/commits', { paths: ['old.md'], message: 'seed' })
    await fs.rename(path.join(root, 'old.md'), path.join(root, 'new.md'))

    const r = await call('POST', '/commits', {
      paths: ['old.md', 'new.md'],
      message: 'move note',
    })

    expect(r.status).toBe(201)
    const body = await r.json() as { filesCommitted: string[] }
    // Git detects the delete+add pair as a rename, and --name-only reports
    // the destination path for that single logical change.
    expect(body.filesCommitted).toEqual(['new.md'])
    const { rawAt } = await import('../history/git.js')
    expect(await rawAt(root, 'HEAD', 'old.md')).toBeNull()
    expect(await rawAt(root, 'HEAD', 'new.md')).toBe('moved\n')
  })

  it('commits a multi-file batch in one commit', async () => {
    await write('a.md', '1')
    await write('b.md', '2')
    const r = await call('POST', '/commits', { paths: ['a.md', 'b.md'], message: 'batch' })
    expect(r.status).toBe(201)
    const body = await r.json() as { filesCommitted: string[] }
    expect(body.filesCommitted.sort()).toEqual(['a.md', 'b.md'])
  })
})

describe('POST /api/history/repair-index', () => {
  beforeEach(async () => {
    await call('GET', '/capability')
    await configureGitUser()
  })

  it('restores persisted repair status and repairs by opaque transaction token', async () => {
    await write('a.md', 'committed')
    const git = await import('../history/git.js')
    const result = await git.addAndCommit(root, ['a.md'], 'version', {
      expected: { 'a.md': createHash('sha256').update('committed').digest('hex') },
      syncIndexForTesting: vi.fn().mockResolvedValue({ status: 1, stdout: '', stderr: 'locked' }),
    })

    const before = await (await call('GET', '/status')).json() as { dirty: Array<{ path: string }> }
    expect(before.dirty.map((entry) => entry.path)).toContain('a.md')

    const persisted = await (await call('GET', '/repair-status')).json() as {
      transactions: Array<{ token: string; head: string; paths: string[] }>
    }
    expect(persisted.transactions).toEqual([
      expect.objectContaining({ token: result.indexRepair?.token, head: result.sha, paths: ['a.md'] }),
    ])

    const response = await call('POST', '/repair-index', { token: result.indexRepair?.token })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ repaired: true })
    const after = await (await call('GET', '/status')).json() as { dirty: Array<{ path: string }> }
    expect(after.dirty.map((entry) => entry.path)).not.toContain('a.md')
    expect(await (await call('GET', '/repair-status')).json()).toEqual({ transactions: [] })
  })

  it('returns 409 instead of clearing index content staged after the failure', async () => {
    await write('a.md', 'committed')
    const git = await import('../history/git.js')
    const result = await git.addAndCommit(root, ['a.md'], 'version', {
      expected: { 'a.md': createHash('sha256').update('committed').digest('hex') },
      syncIndexForTesting: vi.fn().mockResolvedValue({ status: 1, stdout: '', stderr: 'locked' }),
    })
    await write('a.md', 'user staged this')
    expect((await git.run(root, ['add', '--', 'a.md'])).status).toBe(0)

    const response = await call('POST', '/repair-index', { token: result.indexRepair?.token })
    expect(response.status).toBe(409)
    expect((await git.run(root, ['show', ':a.md'])).stdout).toBe('user staged this')

    const discard = await call('POST', '/repair-index/discard', {
      token: result.indexRepair?.token,
    })
    expect(discard.status).toBe(200)
    expect(await discard.json()).toEqual({ discarded: true })
    expect((await git.run(root, ['show', ':a.md'])).stdout).toBe('user staged this')
    expect(await (await call('GET', '/repair-status')).json()).toEqual({ transactions: [] })
  })
})

describe('POST /api/history/drop', () => {
  beforeEach(async () => {
    await call('GET', '/capability')
    await configureGitUser()
  })

  it('removes the latest commit while keeping its changes in the working tree', async () => {
    await write('note.md', 'v1\n')
    const c1 = (await (await call('POST', '/commits', { paths: ['note.md'], message: 'v1' })).json()) as { sha: string }
    await write('note.md', 'v2\n')
    const c2 = (await (await call('POST', '/commits', { paths: ['note.md'], message: 'v2' })).json()) as { sha: string }

    const r = await call('POST', '/drop', { sha: c2.sha })
    expect(r.status).toBe(201)
    const body = await r.json() as { sha: string; filesCommitted: string[] }
    expect(body.sha).toBe(c1.sha)
    expect(body.filesCommitted).toEqual(['note.md'])
    expect(await read('note.md')).toBe('v2\n')

    const status = await (await call('GET', '/status')).json() as { dirty: Array<{ path: string }> }
    expect(status.dirty.map((e) => e.path)).toContain('note.md')

    const log = await (await call('GET', '/log')).json() as { commits: Array<{ sha: string }> }
    expect(log.commits.map((c) => c.sha)).toEqual([c1.sha])
  })

  it('rejects dropping an older commit', async () => {
    await write('note.md', 'v1\n')
    const c1 = (await (await call('POST', '/commits', { paths: ['note.md'], message: 'v1' })).json()) as { sha: string }
    await write('note.md', 'v2\n')
    await call('POST', '/commits', { paths: ['note.md'], message: 'v2' })

    const r = await call('POST', '/drop', { sha: c1.sha })
    expect(r.status).toBe(409)
  })

  it('can drop the root commit and leave its files untracked', async () => {
    await write('note.md', 'root\n')
    const c1 = (await (await call('POST', '/commits', { paths: ['note.md'], message: 'root' })).json()) as { sha: string }

    const r = await call('POST', '/drop', { sha: c1.sha })
    expect(r.status).toBe(201)
    const body = await r.json() as { sha: string; filesCommitted: string[] }
    expect(body.sha).toBe('')
    expect(body.filesCommitted).toEqual(['note.md'])
    expect(await read('note.md')).toBe('root\n')

    const status = await (await call('GET', '/status')).json() as { dirty: Array<{ path: string; index: string; worktree: string }> }
    expect(status.dirty).toContainEqual(expect.objectContaining({ path: 'note.md', index: '?', worktree: '?' }))

    const log = await (await call('GET', '/log')).json() as { commits: Array<{ sha: string }> }
    expect(log.commits).toEqual([])
  })

  it('keeps unrelated staged files staged when dropping the root commit', async () => {
    await write('root.md', 'root\n')
    const rootCommit = (await (await call('POST', '/commits', { paths: ['root.md'], message: 'root' })).json()) as { sha: string }
    await write('staged-later.md', 'later\n')
    const { run } = await import('../history/git.js')
    expect((await run(root, ['add', '--', 'staged-later.md'])).status).toBe(0)

    const r = await call('POST', '/drop', { sha: rootCommit.sha })
    expect(r.status).toBe(201)
    const status = await (await call('GET', '/status')).json() as { dirty: Array<{ path: string; index: string; worktree: string }> }
    expect(status.dirty).toContainEqual(expect.objectContaining({ path: 'root.md', index: '?', worktree: '?' }))
    expect(status.dirty).toContainEqual(expect.objectContaining({ path: 'staged-later.md', index: 'A', worktree: ' ' }))
  })

  it('rejects unsupported sha syntax', async () => {
    const r = await call('POST', '/drop', { sha: 'HEAD' })
    expect(r.status).toBe(400)
  })
})

// Sanity: if git is missing, the whole router should report 503
// instead of throwing. We mock git.run to simulate ENOENT once.
describe('graceful degradation when git is unavailable', () => {
  it('returns 503 on /status when git cannot be spawned', async () => {
    const gitMod = await import('../history/git.js')
    const spy = vi.spyOn(gitMod, 'run').mockImplementation(async () => {
      throw new gitMod.GitUnavailableError(new Error('ENOENT'))
    })
    try {
      const r = await call('GET', '/status')
      expect(r.status).toBe(503)
      const body = await r.json() as { available: boolean }
      expect(body.available).toBe(false)
    } finally {
      spy.mockRestore()
      // Restore real capability for any subsequent test in the file
      __resetGitCapabilityForTesting()
    }
  })
})

describe('POST /api/history/restore', () => {
  // Body: { path, ref }. Returns the restored bytes and mtime on success.
  // - 400 if path or ref missing
  // - 404 if the file does not exist at ref (rawAt pre-check)
  // - 503 when git is unavailable
  // - 200 + on-disk overwrite otherwise
  beforeEach(async () => {
    // /capability triggers ensureRepo which writes .gitignore /
    // .gitattributes — same idempotent setup the other tests rely on.
    await call('GET', '/capability')
    await configureGitUser()
  })

  it('overwrites the working-tree file with the content at ref', async () => {
    await write('note.md', 'v1\n')
    const c1 = await call('POST', '/commits', { paths: ['note.md'], message: 'v1' })
    expect(c1.status).toBe(201)
    const sha1 = (await c1.json() as { sha: string }).sha
    await write('note.md', 'v2\n')
    const c2 = await call('POST', '/commits', { paths: ['note.md'], message: 'v2' })
    expect(c2.status).toBe(201)

    const r = await call('POST', '/restore', { path: 'note.md', ref: sha1 })
    expect(r.status).toBe(200)
    const body = await r.json() as { path: string; ref: string; raw: string; mtime: number }
    expect(body.path).toBe('note.md')
    expect(body.ref).toBe(sha1)
    expect(body.raw).toBe('v1\n')
    expect(body.mtime).toBeGreaterThan(0)
    // On-disk content is now v1
    const onDisk = await fs.readFile(path.join(root, 'note.md'), 'utf8')
    expect(onDisk).toBe('v1\n')
    // HEAD is unchanged — restore does not touch the branch
    const gitMod = await import('../history/git.js')
    expect(await gitMod.rawAt(root, 'HEAD', 'note.md')).toBe('v2\n')
    const status = await call('GET', '/status')
    expect(status.status).toBe(200)
    expect(await status.json()).toMatchObject({
      dirty: [expect.objectContaining({ path: 'note.md', index: ' ', worktree: 'M' })],
    })
  })

  it('returns 400 when path is missing', async () => {
    const r = await call('POST', '/restore', { ref: 'HEAD' })
    expect(r.status).toBe(400)
    const body = await r.json() as { error: string }
    expect(body.error).toMatch(/path/i)
  })

  it('returns 400 when ref is missing', async () => {
    const r = await call('POST', '/restore', { path: 'note.md' })
    expect(r.status).toBe(400)
    const body = await r.json() as { error: string }
    expect(body.error).toMatch(/ref/i)
  })

  it('returns 400 on unsafe path or unsupported ref syntax', async () => {
    const unsafePath = await call('POST', '/restore', { path: '../outside.md', ref: 'HEAD' })
    expect(unsafePath.status).toBe(400)
    const branchRef = await call('POST', '/restore', { path: 'note.md', ref: 'main' })
    expect(branchRef.status).toBe(400)
  })

  // WORKTREE is a sentinel meaning "the file as it sits on disk".
  // Restoring TO the working tree is meaningless (you can't restore
  // to the thing you're overwriting), so the route rejects it
  // explicitly rather than letting it fall through to git checkout
  // and produce a confusing "invalid reference" error.
  it('returns 400 when ref is the WORKTREE sentinel', async () => {
    await write('note.md', 'committed\n')
    await call('POST', '/commits', { paths: ['note.md'], message: 'seed' })
    const r = await call('POST', '/restore', { path: 'note.md', ref: 'WORKTREE' })
    expect(r.status).toBe(400)
    const body = await r.json() as { error: string }
    expect(body.error).toMatch(/working tree/i)
  })

  it('returns 404 when the file does not exist at the requested ref', async () => {
    await write('a.md', 'one\n')
    await call('POST', '/commits', { paths: ['a.md'], message: 'init' })
    // 'never-existed.md' was never committed
    const r = await call('POST', '/restore', { path: 'never-existed.md', ref: 'HEAD' })
    expect(r.status).toBe(404)
    const body = await r.json() as { error: string }
    expect(body.error).toMatch(/does not exist/i)
  })

  it('returns 404 for a bad revision', async () => {
    await write('a.md', 'one\n')
    await call('POST', '/commits', { paths: ['a.md'], message: 'init' })
    const r = await call('POST', '/restore', {
      path: 'a.md',
      ref: 'deadbeef'.repeat(5),
    })
    expect(r.status).toBe(404)
  })

  it('returns 503 when git is unavailable', async () => {
    const gitMod = await import('../history/git.js')
    const spy = vi.spyOn(gitMod, 'run').mockImplementation(async () => {
      throw new gitMod.GitUnavailableError(new Error('ENOENT'))
    })
    // The parent beforeEach's GET /capability already populated
    // `_gitAvailable = true` via the real git. probeGit() caches
    // that result, so without resetting here the route would skip
    // the 503 branch and hit the mocked git.run inside ensureRepo /
    // rawAt / restoreFile, which throws GitUnavailableError and
    // surfaces as a 500 instead. Reset AFTER installing the spy so
    // the next probe runs against the mock.
    __resetGitCapabilityForTesting()
    try {
      const r = await call('POST', '/restore', { path: 'a.md', ref: 'HEAD' })
      expect(r.status).toBe(503)
    } finally {
      spy.mockRestore()
      __resetGitCapabilityForTesting()
    }
  })
})
