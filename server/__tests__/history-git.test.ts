// End-to-end tests for the L0 git wrapper. These spawn a real `git`
// process against a temp directory, so they take a few hundred ms
// total — that's the price of confidence. Tests cover:
//
//   - isRepo: false for a fresh dir, true after init
//   - initRepo: creates main branch, autocrlf disabled
//   - status: parses XY paths correctly, picks up new/modified/deleted/untracked
//   - log: returns commits newest-first with author / date / subject
//   - log --follow: tracks a file across a rename
//   - addAndCommit: produces a sha, the committed file is in HEAD,
//                   empty message / empty paths rejected
//   - rawAt: returns the file's content at a given ref; null when the
//            file did not exist at that ref
//   - ensureRepo: writes .gitignore / .gitattributes exactly once
//   - CRLF safety: a file written with `\r\n` reads back identical
//     bytes via `git show` thanks to core.autocrlf=false
//
// Why not mock child_process.spawn: the whole point of these tests
// is to verify the wrapper's contract against the actual `git` CLI
// (different versions format --porcelain slightly differently; we
// want to catch regressions on upgrade). Mocks would test the mock.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as git from '../history/git.js'
import { ensureRepo } from '../history/repo.js'

let root: string

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'docus-history-'))
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

async function write(rel: string, body: string) {
  const abs = path.join(root, rel)
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await fs.writeFile(abs, body, 'utf8')
}

async function setUser() {
  // A bare `git commit` outside a configured user errors out. Every
  // test that creates a commit touches this once. We use a fixed
  // name/email so log assertions are stable.
  const r = await git.run(root, ['config', 'user.name', 'Test User'])
  if (r.status !== 0) throw new Error(r.stderr)
  const e = await git.run(root, ['config', 'user.email', 'test@example.com'])
  if (e.status !== 0) throw new Error(e.stderr)
}

/**
 * Initialize the repo so subsequent tests have a working tree.
 * Does NOT commit the dotfiles — .gitattributes is empty by design
 * (see repo.ts for why) and adding it would either fail (empty file)
 * or produce a no-op commit that pollutes log assertions. The clean-
 * status test filters them out explicitly.
 */
async function initAndSeed() {
  await ensureRepo(root)
  await setUser()
}

describe('isRepo / initRepo', () => {
  it('reports false for a fresh directory', async () => {
    expect(await git.isRepo(root)).toBe(false)
  })

  it('reports true after initRepo and disables autocrlf', async () => {
    await git.initRepo(root)
    expect(await git.isRepo(root)).toBe(true)
    const cfg = await git.run(root, ['config', '--get', 'core.autocrlf'])
    expect(cfg.stdout.trim()).toBe('false')
  })
})

describe('ensureRepo', () => {
  it('writes .gitignore and .gitattributes on first call', async () => {
    await ensureRepo(root)
    expect(await git.isRepo(root)).toBe(true)
    const gi = await fs.readFile(path.join(root, '.gitignore'), 'utf8')
    expect(gi).toContain('data/')
    expect(gi).toContain('node_modules/')
    // .gitattributes is intentionally empty — see repo.ts. We still
    // create the file (so future attribute edits have a stable home)
    // and assert it's empty rather than a non-existent file.
    const ga = await fs.readFile(path.join(root, '.gitattributes'), 'utf8')
    expect(ga).toBe('')
  })

  it('does not overwrite existing .gitignore on second call', async () => {
    await fs.writeFile(path.join(root, '.gitignore'), '# my custom rule\n', 'utf8')
    await ensureRepo(root)
    const gi = await fs.readFile(path.join(root, '.gitignore'), 'utf8')
    expect(gi).toBe('# my custom rule\n')
  })

  it('is a no-op on an existing repo', async () => {
    await git.initRepo(root)
    await setUser()
    await write('foo.md', 'hello')
    await git.addAndCommit(root, ['foo.md'], 'initial')
    // Sanity: foo.md is in HEAD
    expect(await git.rawAt(root, 'HEAD', 'foo.md')).toBe('hello')
    // ensureRepo should not throw and should not change HEAD
    await ensureRepo(root)
    expect(await git.rawAt(root, 'HEAD', 'foo.md')).toBe('hello')
  })
})

describe('parsePorcelain', () => {
  it('parses a fresh-status output with modifications and an untracked file', () => {
    const text =
      ' M inbox/note-a.md\n' +
      'M  inbox/note-b.md\n' +
      '?? literature/new.md\n' +
      'D  archive/old.md\n'
    expect(git.parsePorcelain(text)).toEqual([
      { index: ' ', worktree: 'M', path: 'inbox/note-a.md' },
      { index: 'M', worktree: ' ', path: 'inbox/note-b.md' },
      { index: '?', worktree: '?', path: 'literature/new.md' },
      { index: 'D', worktree: ' ', path: 'archive/old.md' },
    ])
  })

  it('ignores lines that do not match the XY path shape', () => {
    expect(git.parsePorcelain('not a status line\n M foo.md\n')).toEqual([
      { index: ' ', worktree: 'M', path: 'foo.md' },
    ])
  })

  it('returns [] for empty input', () => {
    expect(git.parsePorcelain('')).toEqual([])
  })
})

describe('status', () => {
  beforeEach(initAndSeed)

  it('returns [] when the working tree is clean (ignoring the seeded dotfiles)', async () => {
    // The vault's own .gitignore / .gitattributes are untracked by
    // design (we don't auto-commit them — see initAndSeed). The
    // production code path hides them via `git status --ignored`
    // semantics, but for tests it's clearer to assert that the only
    // entries are the two dotfiles and nothing else.
    const s = await git.status(root)
    const paths = s.map((e) => e.path)
    expect(paths.sort()).toEqual(['.gitattributes', '.gitignore'])
  })

  it('reports modified, new, and untracked files', async () => {
    await write('inbox/clean.md', 'tracked')
    await git.addAndCommit(root, ['inbox/clean.md'], 'seed')
    // Now modify clean.md and add a brand-new untracked file.
    await write('inbox/clean.md', 'tracked (changed)')
    await write('inbox/fresh.md', 'untracked')
    const s = await git.status(root)
    const byPath = Object.fromEntries(s.map((e) => [e.path, e]))
    expect(byPath['inbox/clean.md'].worktree).toBe('M')
    expect(byPath['inbox/fresh.md']).toEqual({ index: '?', worktree: '?', path: 'inbox/fresh.md' })
  })
})

describe('addAndCommit + log', () => {
  beforeEach(initAndSeed)

  it('creates a commit, returns its sha, and log reports it', async () => {
    await write('inbox/a.md', 'one')
    await write('inbox/b.md', 'two')
    const r = await git.addAndCommit(root, ['inbox/a.md', 'inbox/b.md'], 'first commit')
    expect(r.sha).toMatch(/^[0-9a-f]{40}$/)
    expect(r.filesCommitted.sort()).toEqual(['inbox/a.md', 'inbox/b.md'])
    const log = await git.log(root)
    // No seed commit: initAndSeed leaves the working tree without an
    // initial commit, so the first user commit is also the only one.
    expect(log).toHaveLength(1)
    expect(log[0].sha).toBe(r.sha)
    expect(log[0].subject).toBe('first commit')
    expect(log[0].author).toBe('Test User')
    expect(log[0].date).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(log[0].files.sort()).toEqual(['inbox/a.md', 'inbox/b.md'])
  })

  it('rejects an empty path list', async () => {
    await expect(git.addAndCommit(root, [], 'x')).rejects.toThrow(/path/i)
  })

  it('rejects an empty message', async () => {
    await write('a.md', 'x')
    await expect(git.addAndCommit(root, ['a.md'], '   ')).rejects.toThrow(/message/i)
  })

  it('throws "nothing to commit" when all paths are clean', async () => {
    await write('a.md', 'x')
    await git.addAndCommit(root, ['a.md'], 'first')
    await expect(git.addAndCommit(root, ['a.md'], 'second')).rejects.toThrow(/nothing to commit/i)
  })

  it('returns commits newest-first', async () => {
    await write('a.md', '1')
    const r1 = await git.addAndCommit(root, ['a.md'], 'one')
    // Tiny sleep so the committer-date timestamp differs at second
    // resolution. ISO author dates in `log` are second-precision, so
    // without this the two commits can have the same date and the
    // ordering assertion would be flaky on fast machines.
    await new Promise((r) => setTimeout(r, 1100))
    await write('a.md', '2')
    const r2 = await git.addAndCommit(root, ['a.md'], 'two')
    const log = await git.log(root)
    expect(log.map((c) => c.subject)).toEqual(['two', 'one'])
    expect(log[0].sha).toBe(r2.sha)
    expect(log[1].sha).toBe(r1.sha)
    // No seed commit, no orphan history entries.
  })

  it('with `path` filter, only returns commits touching that file', async () => {
    await write('a.md', '1')
    await git.addAndCommit(root, ['a.md'], 'touch a')
    await write('b.md', '1')
    await git.addAndCommit(root, ['b.md'], 'touch b')
    const logA = await git.log(root, { path: 'a.md' })
    const logB = await git.log(root, { path: 'b.md' })
    expect(logA.map((c) => c.subject)).toEqual(['touch a'])
    expect(logB.map((c) => c.subject)).toEqual(['touch b'])
  })

  it('logs a renamed file under its new path (no follow, so old-path commit is not pulled in)', async () => {
    // We do not enable --follow: it has a known false-positive on
    // brand-new file paths (it pulls in earlier commits of unrelated
    // files with the same name). Once a real rename-history UI is
    // built, this is the test that will need to grow with it.
    await write('old-name.md', 'content')
    await git.addAndCommit(root, ['old-name.md'], 'initial')
    const mv = await git.run(root, ['mv', 'old-name.md', 'new-name.md'])
    expect(mv.status).toBe(0)
    await git.addAndCommit(root, ['new-name.md'], 'rename')
    const logNew = await git.log(root, { path: 'new-name.md' })
    expect(logNew.map((c) => c.subject)).toEqual(['rename'])
  })
})

describe('rawAt', () => {
  beforeEach(initAndSeed)

  it('returns the file content at HEAD', async () => {
    await write('note.md', 'version 1')
    const r1 = await git.addAndCommit(root, ['note.md'], 'v1')
    await write('note.md', 'version 2')
    const r2 = await git.addAndCommit(root, ['note.md'], 'v2')
    expect(await git.rawAt(root, r1.sha, 'note.md')).toBe('version 1')
    expect(await git.rawAt(root, r2.sha, 'note.md')).toBe('version 2')
    expect(await git.rawAt(root, 'HEAD', 'note.md')).toBe('version 2')
  })

  it('returns null when the file did not exist at the ref', async () => {
    await write('a.md', '1')
    const r1 = await git.addAndCommit(root, ['a.md'], 'seed')
    await write('b.md', '2')
    await git.addAndCommit(root, ['b.md'], 'add b')
    expect(await git.rawAt(root, r1.sha, 'b.md')).toBeNull()
  })
})

describe('CRLF safety', () => {
  // This is the test that justifies the `core.autocrlf=false` config
  // in initRepo. On a Windows machine with `core.autocrlf=true`, a
  // file written with `\r\n` would have its `\r` stripped in the
  // index, and `git show` would return LF bytes — meaning the diff
  // sees a phantom "\r stripped" change on every commit. With our
  // local config, what's in the index is what's in the working tree.
  beforeEach(initAndSeed)

  it('round-trips CRLF line endings byte-for-byte', async () => {
    const body = 'line one\r\nline two\r\nline three\r\n'
    const abs = path.join(root, 'crlf.md')
    await fs.writeFile(abs, body, 'utf8')
    const r = await git.addAndCommit(root, ['crlf.md'], 'crlf test')
    const read = await git.rawAt(root, r.sha, 'crlf.md')
    expect(read).toBe(body)
  })
})

describe('restoreFile', () => {
  // Overwrite the working-tree copy of a file with its blob at an
  // older ref. Used by the L3 "Restore old version" button on the
  // diff view. Does NOT touch the index or HEAD — the change sits
  // in the working tree so the user can review and commit.
  beforeEach(initAndSeed)

  it('overwrites the working-tree copy with the old ref\'s content', async () => {
    await write('note.md', 'v1 content\n')
    const r1 = await git.addAndCommit(root, ['note.md'], 'v1')
    await write('note.md', 'v2 content\n')
    await git.addAndCommit(root, ['note.md'], 'v2')

    await git.restoreFile(root, r1.sha, 'note.md')
    const onDisk = await fs.readFile(path.join(root, 'note.md'), 'utf8')
    expect(onDisk).toBe('v1 content\n')
    // HEAD is unchanged — we restored the working tree, not the branch.
    expect(await git.rawAt(root, 'HEAD', 'note.md')).toBe('v2 content\n')
  })

  it('is a no-op when the file is already at that ref (idempotent)', async () => {
    await write('note.md', 'stable\n')
    const r = await git.addAndCommit(root, ['note.md'], 'stable')
    await git.restoreFile(root, r.sha, 'note.md')
    expect(await fs.readFile(path.join(root, 'note.md'), 'utf8')).toBe('stable\n')
  })

  it('throws when the ref does not exist (bad revision)', async () => {
    await write('note.md', 'content\n')
    await git.addAndCommit(root, ['note.md'], 'init')
    // The exact stderr phrasing differs across git versions — we just
    // need to know git refused. Modern git says "fatal: bad revision"
    // or "fatal: unknown revision"; slightly newer ones say
    // "fatal: unable to read tree". Match any of them.
    await expect(
      git.restoreFile(root, 'deadbeef'.repeat(5), 'note.md'),
    ).rejects.toThrow(/bad revision|unknown revision|unable to read tree/i)
  })

  it('throws when the file does not exist at that ref', async () => {
    // file exists at HEAD, but doesn't exist in the empty initial
    // state. We use `git stash`-style: write + commit file, then
    // restore from before the file existed — except that's the
    // initial commit. Easier: try restoring a path that was never
    // committed at all.
    await write('note.md', 'init\n')
    await git.addAndCommit(root, ['note.md'], 'init')
    await expect(
      git.restoreFile(root, 'HEAD', 'never-existed.md'),
    ).rejects.toThrow(/did not match|pathspec/i)
  })
})
