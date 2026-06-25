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

async function call(method: string, urlPath: string, body?: unknown) {
  const req = new Request(`http://localhost${urlPath}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
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
    // After /capability the .gitignore/.gitattributes are untracked.
    // The route returns the raw git status — those dotfiles are the
    // only entries, which is what a fresh vault looks like.
    const r = await call('GET', '/status')
    expect(r.status).toBe(200)
    const body = await r.json() as { dirty: any[]; available: boolean }
    expect(body.available).toBe(true)
    const paths = body.dirty.map((e) => e.path).sort()
    expect(paths).toEqual(['.gitattributes', '.gitignore'])
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
  })

  it('filters by path', async () => {
    await write('a.md', '1')
    await call('POST', '/commits', { paths: ['a.md'], message: 'touch a' })
    await write('b.md', '1')
    await call('POST', '/commits', { paths: ['b.md'], message: 'touch b' })
    const r = await call('GET', '/log?path=b.md')
    const body = await r.json() as { commits: { subject: string }[] }
    expect(body.commits.map((c) => c.subject)).toEqual(['touch b'])
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

  it('returns 409 "nothing to commit" when all paths are clean', async () => {
    await write('a.md', 'x')
    await call('POST', '/commits', { paths: ['a.md'], message: 'first' })
    const r = await call('POST', '/commits', { paths: ['a.md'], message: 'second' })
    expect(r.status).toBe(409)
    expect(((await r.json()) as { error: string }).error).toMatch(/nothing to commit/i)
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
  // Body: { path, ref }. Returns { path, ref } on success.
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
    const body = await r.json() as { path: string; ref: string }
    expect(body.path).toBe('note.md')
    expect(body.ref).toBe(sha1)
    // On-disk content is now v1
    const onDisk = await fs.readFile(path.join(root, 'note.md'), 'utf8')
    expect(onDisk).toBe('v1\n')
    // HEAD is unchanged — restore does not touch the branch
    const gitMod = await import('../history/git.js')
    expect(await gitMod.rawAt(root, 'HEAD', 'note.md')).toBe('v2\n')
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
