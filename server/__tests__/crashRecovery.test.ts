import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { promises as fs } from 'node:fs'
import { spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { applyMigrations } from '../db'
import { getDocumentMetadata, saveDocumentMetadata } from '../documentMetadata'
import { sha256Hex } from '../atomicTextWrite'
import { recoverInterruptedOperations } from '../crashRecovery'

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..')
const TSX_CLI = path.join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs')
const CRASH_CHILD = path.join(import.meta.dirname, 'fixtures', 'commit-crash-child.ts')
const RENAME_CRASH_CHILD = path.join(import.meta.dirname, 'fixtures', 'rename-crash-child.ts')

let vault: string
let db: InstanceType<typeof Database>

beforeEach(async () => {
  vault = await fs.mkdtemp(path.join(os.tmpdir(), 'docus-crash-'))
  db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  applyMigrations(db)
})

afterEach(async () => {
  db.close()
  await fs.rm(vault, { recursive: true, force: true })
})

async function seed(files: Record<string, string>): Promise<void> {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(vault, rel)
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.writeFile(abs, content, 'utf8')
  }
}

function journalFor(staged: string, replacement: string, expectedRaw: string, replacementRaw: string): string {
  return JSON.stringify({
    version: 1,
    op: 'replace',
    staged,
    replacement,
    expectedHash: sha256Hex(expectedRaw),
    replacementHash: sha256Hex(replacementRaw),
  })
}

async function namesIn(rel = '.'): Promise<string[]> {
  return fs.readdir(path.join(vault, rel)).catch(() => [] as string[])
}

function runRecovery() {
  return recoverInterruptedOperations(vault, db)
}

describe('recoverInterruptedOperations (journaled replace)', () => {
  it('completes an interrupted save when both generations verify (nested dir)', async () => {
    // The exact state a kill -9 between takeover and link leaves behind:
    // formal path missing, staged old generation, save temp, durable
    // journal. Recovery must publish the new generation, not lose the
    // note, and leave zero artifacts.
    await seed({
      'inbox/.note.md.docus-staged-aaaa': '# base\n',
      'inbox/.note.md.docus-save-bbbb': '# replacement\n',
      'inbox/.note.md.docus-journal-cccc': journalFor(
        '.note.md.docus-staged-aaaa',
        '.note.md.docus-save-bbbb',
        '# base\n',
        '# replacement\n',
      ),
    })
    saveDocumentMetadata(db, { id: 'crash-survivor-id', path: 'inbox/note', title: 'Survivor', updatedAt: 1 })

    const report = await runRecovery()

    expect(await fs.readFile(path.join(vault, 'inbox/note.md'), 'utf8')).toBe('# replacement\n')
    expect(report.actions.some((a) => a.action === 'completed-save')).toBe(true)
    expect(report.actions.some((a) => a.action === 'failed')).toBe(false)
    // The replace protocol never touches metadata: the identity must
    // survive the crash + recovery untouched.
    expect(getDocumentMetadata(db, 'inbox/note')?.id).toBe('crash-survivor-id')
    expect(await namesIn('inbox')).toEqual(['note.md'])
  })

  it('restores the old generation when the staged bytes fail hash verification', async () => {
    await seed({
      '.note.md.docus-staged-aaaa': '# tampered staged\n',
      '.note.md.docus-save-bbbb': '# replacement\n',
      '.note.md.docus-journal-cccc': journalFor(
        '.note.md.docus-staged-aaaa',
        '.note.md.docus-save-bbbb',
        '# base\n',
        '# replacement\n',
      ),
    })

    const report = await runRecovery()

    expect(await fs.readFile(path.join(vault, 'note.md'), 'utf8')).toBe('# tampered staged\n')
    expect(report.actions.some((a) => a.action === 'restored')).toBe(true)
    expect(await namesIn()).toEqual(['note.md'])
  })

  it('restores the old generation when the save temp is missing', async () => {
    await seed({
      '.note.md.docus-staged-aaaa': '# base\n',
      '.note.md.docus-journal-cccc': journalFor(
        '.note.md.docus-staged-aaaa',
        '.note.md.docus-save-bbbb',
        '# base\n',
        '# replacement\n',
      ),
    })

    await runRecovery()

    expect(await fs.readFile(path.join(vault, 'note.md'), 'utf8')).toBe('# base\n')
    expect(await namesIn()).toEqual(['note.md'])
  })

  it('cleans staging when the target already exists (commit landed or external won)', async () => {
    await seed({
      'note.md': '# landed\n',
      '.note.md.docus-staged-aaaa': '# base\n',
      '.note.md.docus-save-bbbb': '# replacement\n',
      '.note.md.docus-journal-cccc': journalFor(
        '.note.md.docus-staged-aaaa',
        '.note.md.docus-save-bbbb',
        '# base\n',
        '# replacement\n',
      ),
    })

    const report = await runRecovery()

    expect(await fs.readFile(path.join(vault, 'note.md'), 'utf8')).toBe('# landed\n')
    expect(report.actions.some((a) => a.action === 'cleaned')).toBe(true)
    expect(await namesIn()).toEqual(['note.md'])
  })

  it('removes a stale journal whose takeover never happened', async () => {
    await seed({
      'note.md': '# untouched\n',
      '.note.md.docus-save-bbbb': '# replacement\n',
      '.note.md.docus-journal-cccc': journalFor(
        '.note.md.docus-staged-aaaa',
        '.note.md.docus-save-bbbb',
        '# base\n',
        '# replacement\n',
      ),
    })

    await runRecovery()

    expect(await fs.readFile(path.join(vault, 'note.md'), 'utf8')).toBe('# untouched\n')
    // Uncommitted save temp with a live target is provably stale.
    expect(await namesIn()).toEqual(['note.md'])
  })

  it('keeps a save temp whose target is gone (intent cannot be guessed)', async () => {
    await seed({
      '.note.md.docus-save-bbbb': '# replacement\n',
      '.note.md.docus-journal-cccc': journalFor(
        '.note.md.docus-staged-aaaa',
        '.note.md.docus-save-bbbb',
        '# base\n',
        '# replacement\n',
      ),
    })

    const report = await runRecovery()

    expect(await namesIn()).toEqual(['.note.md.docus-save-bbbb'])
    expect(report.actions.some((a) => a.action === 'quarantined')).toBe(true)
  })

  it('leaves an unrecognized journal in place and reports it', async () => {
    await seed({ '.note.md.docus-journal-cccc': '{not json' })

    const report = await runRecovery()

    expect(await namesIn()).toEqual(['.note.md.docus-journal-cccc'])
    expect(report.actions.some((a) => a.action === 'quarantined' && /unrecognized/.test(a.detail ?? ''))).toBe(true)
  })
})

describe('recoverInterruptedOperations (journal-less orphans)', () => {
  it('restores an orphaned staged generation when the path is empty', async () => {
    await seed({ '.note.md.docus-staged-aaaa': '# base\n' })

    const report = await runRecovery()

    expect(await fs.readFile(path.join(vault, 'note.md'), 'utf8')).toBe('# base\n')
    expect(report.actions.some((a) => a.action === 'restored')).toBe(true)
    expect(await namesIn()).toEqual(['note.md'])
  })

  it('quarantines an orphaned staged generation when the target exists', async () => {
    await seed({
      'note.md': '# external\n',
      '.note.md.docus-staged-aaaa': '# base\n',
    })

    const report = await runRecovery()

    expect(await fs.readFile(path.join(vault, 'note.md'), 'utf8')).toBe('# external\n')
    expect(await namesIn()).toContain('.note.md.docus-staged-aaaa')
    expect(report.actions.some((a) => a.action === 'quarantined')).toBe(true)
  })

  it('restores an interrupted conditional removal (conservative)', async () => {
    await seed({ '.note.md.docus-remove-aaaa': '# base\n' })

    await runRecovery()

    expect(await fs.readFile(path.join(vault, 'note.md'), 'utf8')).toBe('# base\n')
    expect(await namesIn()).toEqual(['note.md'])
  })

  it('removes removal staging when the target was recreated externally', async () => {
    await seed({
      'note.md': '# recreated\n',
      '.note.md.docus-remove-aaaa': '# base\n',
    })

    await runRecovery()

    expect(await namesIn()).toEqual(['note.md'])
  })

  it('removes an uncommitted save temp when the target exists', async () => {
    await seed({
      'note.md': '# current\n',
      '.note.md.docus-save-bbbb': '# replacement\n',
    })

    await runRecovery()

    expect(await namesIn()).toEqual(['note.md'])
  })

  it('keeps a save temp whose target is gone and reports it', async () => {
    await seed({ '.note.md.docus-save-bbbb': '# replacement\n' })

    const report = await runRecovery()

    expect(await namesIn()).toEqual(['.note.md.docus-save-bbbb'])
    expect(report.actions.some((a) => a.action === 'quarantined')).toBe(true)
  })
})

describe('recoverInterruptedOperations (delete quarantine)', () => {
  it('completes an interrupted file delete and reconciles metadata', async () => {
    await seed({ 'gone.md.docus-delete-123': '# old\n' })
    saveDocumentMetadata(db, { id: 'gone-id', path: 'gone', title: 'Gone', updatedAt: 1 })

    const report = await runRecovery()

    expect(await namesIn()).toEqual([])
    expect(getDocumentMetadata(db, 'gone')).toBeNull()
    expect(report.actions.some((a) => a.action === 'completed-delete')).toBe(true)
  })

  it('completes an interrupted folder delete under its whole prefix', async () => {
    await seed({ 'gone.docus-delete-123/a.md': '# a\n' })
    saveDocumentMetadata(db, { id: 'gone-a-id', path: 'gone/a', title: 'A', updatedAt: 1 })

    const report = await runRecovery()

    expect(await namesIn()).toEqual([])
    expect(getDocumentMetadata(db, 'gone/a')).toBeNull()
    expect(report.actions.some((a) => a.action === 'completed-delete')).toBe(true)
  })

  it('leaves quarantine in place when the path was re-used', async () => {
    await seed({
      'gone.md': '# new generation\n',
      'gone.md.docus-delete-123': '# old\n',
    })
    saveDocumentMetadata(db, { id: 'fresh-id', path: 'gone', title: 'Fresh', updatedAt: 1 })

    const report = await runRecovery()

    expect(await fs.readFile(path.join(vault, 'gone.md'), 'utf8')).toBe('# new generation\n')
    expect(await namesIn()).toContain('gone.md.docus-delete-123')
    // The new generation's identity is untouched.
    expect(getDocumentMetadata(db, 'gone')?.id).toBe('fresh-id')
    expect(report.actions.some((a) => a.action === 'quarantined')).toBe(true)
  })
})

describe('real subprocess crash + startup recovery', () => {
  function spawnChild(env: Record<string, string>, fixture: string = CRASH_CHILD) {
    return spawn(process.execPath, [TSX_CLI, fixture], {
      env: { ...process.env, ...env },
      stdio: 'pipe',
    })
  }

  /** A self-inflicted SIGKILL surfaces as signal 'SIGKILL' or exit
   * code 137 (128 + 9) depending on the platform/libuv path. */
  function expectHardKill(result: { code: number | null; signal: NodeJS.Signals | null }) {
    expect(result.signal === 'SIGKILL' || result.code === 137).toBe(true)
  }

  async function waitExit(child: ReturnType<typeof spawn>): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('crash child timed out')), 20000)
      child.on('exit', (code, signal) => {
        clearTimeout(timer)
        resolve({ code, signal })
      })
      child.on('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
    })
  }

  it('recovers the formal path after a kill -9 inside the commit window', async () => {
    // The reviewer scenario: the child runs the REAL commit protocol
    // and dies (SIGKILL, no handlers) right after the takeover rename.
    const abs = path.join(vault, 'note.md')
    await seed({ 'note.md': '# base\n' })
    saveDocumentMetadata(db, { id: 'pre-crash-id', path: 'note', title: 'Note', updatedAt: 1 })

    const child = spawnChild({
      DOCUS_CRASH_TARGET: abs,
      DOCUS_CRASH_EXPECTED: '# base\n',
      DOCUS_CRASH_REPLACEMENT: '# replacement\n',
      DOCUS_CRASH_POINT: 'takeover',
    })
    expectHardKill(await waitExit(child))

    // The formal path is missing and only hidden staging files remain
    // — exactly the "note vanished" disk state the recovery fixes.
    const namesBefore = await namesIn()
    expect(namesBefore).not.toContain('note.md')
    expect(namesBefore.some((n) => n.startsWith('.note.md.docus-staged-'))).toBe(true)
    expect(namesBefore.some((n) => n.startsWith('.note.md.docus-save-'))).toBe(true)
    expect(namesBefore.some((n) => n.startsWith('.note.md.docus-journal-'))).toBe(true)

    const report = await runRecovery()

    // Both generations verify against the journal hashes, so the
    // interrupted save completes: the new content lands.
    expect(await fs.readFile(abs, 'utf8')).toBe('# replacement\n')
    expect(report.actions.some((a) => a.action === 'completed-save')).toBe(true)
    expect(report.actions.some((a) => a.action === 'failed')).toBe(false)
    // No documentId lost: metadata was never part of the replace
    // protocol and survives the crash + recovery byte-for-byte.
    expect(getDocumentMetadata(db, 'note')?.id).toBe('pre-crash-id')
    expect(await namesIn()).toEqual(['note.md'])
  })

  it('recovers when the process dies after the journal write but before takeover', async () => {
    const abs = path.join(vault, 'note.md')
    await seed({ 'note.md': '# base\n' })

    const child = spawnChild({
      DOCUS_CRASH_TARGET: abs,
      DOCUS_CRASH_EXPECTED: '# base\n',
      DOCUS_CRASH_REPLACEMENT: '# replacement\n',
      DOCUS_CRASH_POINT: 'journal',
    })
    expectHardKill(await waitExit(child))

    const report = await runRecovery()

    // Takeover never happened: the target is untouched and the stale
    // journal + uncommitted temp are cleaned.
    expect(await fs.readFile(abs, 'utf8')).toBe('# base\n')
    expect(report.actions.some((a) => a.action === 'failed')).toBe(false)
    expect(await namesIn()).toEqual(['note.md'])
  })

  it('auto-recovers on a real service restart (prod entry, HTTP probe)', async () => {
    // Full "restart the service" evidence: a temp vault holds the
    // crashed-commit state; the real production entry (server/prod.ts)
    // is spawned, runs recovery before listening, and the recovered
    // content is then served over HTTP.
    const workdir = await fs.mkdtemp(path.join(os.tmpdir(), 'docus-restart-'))
    const restartVault = path.join(workdir, 'vault')
    try {
      await fs.mkdir(restartVault, { recursive: true })
      // Hand-craft the crashed state: target missing + staged old
      // generation + save temp + journal with matching hashes.
      const staged = '.crash-note.md.docus-staged-aaaa'
      const save = '.crash-note.md.docus-save-bbbb'
      await fs.writeFile(path.join(restartVault, staged), '# base\n', 'utf8')
      await fs.writeFile(path.join(restartVault, save), '# replacement\n', 'utf8')
      await fs.writeFile(
        path.join(restartVault, '.crash-note.md.docus-journal-cccc'),
        journalFor(staged, save, '# base\n', '# replacement\n'),
        'utf8',
      )

      const server = spawn(process.execPath, [TSX_CLI, path.join(REPO_ROOT, 'server', 'prod.ts')], {
        cwd: workdir,
        env: { ...process.env, VAULT_DIR: restartVault, PORT: '0', HOST: '127.0.0.1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      try {
        const port = await new Promise<number>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('server did not start listening')), 20000)
          let buffer = ''
          server.stdout?.on('data', (chunk: Buffer) => {
            buffer += chunk.toString('utf8')
            const match = /listening on http:\/\/[^:\s]+:(\d+)/.exec(buffer)
            if (match) {
              clearTimeout(timer)
              resolve(Number(match[1]))
            }
          })
          server.on('exit', (code) => {
            clearTimeout(timer)
            reject(new Error(`server exited early (code ${code}):\n${buffer}`))
          })
        })

        const response = await fetch(`http://127.0.0.1:${port}/api/posts/crash-note`)
        expect(response.status).toBe(200)
        const body = await response.json() as { raw: string }
        expect(body.raw).toBe('# replacement\n')
      } finally {
        server.kill('SIGKILL')
        await new Promise((resolve) => { server.on('exit', resolve) })
      }
    } finally {
      await fs.rm(workdir, { recursive: true, force: true })
    }
  })

  it('completes an interrupted rename after a kill -9 inside the link window, without losing the documentId', async () => {
    // The reviewer scenario applied to rename: the child runs the REAL
    // create-only move and dies (SIGKILL) right after the destination
    // link lands, before the staging name is removed. The vault is
    // left with the source MISSING and two names on one inode;
    // recovery must complete the rename and keep the documentId.
    const fromAbs = path.join(vault, 'old.md')
    const toAbs = path.join(vault, 'new.md')
    await seed({ 'old.md': '# doc\n' })
    saveDocumentMetadata(db, { id: 'pre-rename-id', path: 'old', title: 'Doc', updatedAt: 1 })

    const child = spawnChild({ DOCUS_CRASH_FROM: fromAbs, DOCUS_CRASH_TO: toAbs }, RENAME_CRASH_CHILD)
    expectHardKill(await waitExit(child))

    // Crash state: source gone, staging + destination both name the
    // same inode.
    const namesBefore = await namesIn()
    expect(namesBefore).not.toContain('old.md')
    expect(namesBefore).toContain('new.md')
    const stagingName = namesBefore.find((n) => n.startsWith('.old.md.docus-rename-'))
    expect(stagingName).toBeDefined()
    const stagingStat = await fs.stat(path.join(vault, stagingName!))
    const destStat = await fs.stat(toAbs)
    expect(stagingStat.ino).toBe(destStat.ino)

    const report = await runRecovery()

    expect(report.actions.some((a) => a.action === 'completed-rename')).toBe(true)
    expect(report.actions.some((a) => a.action === 'failed')).toBe(false)
    expect(await fs.readFile(toAbs, 'utf8')).toBe('# doc\n')
    // The identity followed the bytes — no documentId lost.
    expect(getDocumentMetadata(db, 'new')?.id).toBe('pre-rename-id')
    expect(getDocumentMetadata(db, 'old')).toBeNull()
    expect((await namesIn()).some((n) => n.includes('.docus-rename-'))).toBe(false)
    expect(await namesIn()).toEqual(['new.md'])
  })
})

describe('recoverInterruptedOperations (rename staging, journal-less)', () => {
  it('restores an orphaned rename staging when the source path is empty', async () => {
    await seed({ '.note.md.docus-rename-aaaa': '# ours\n' })

    const report = await runRecovery()

    expect(await fs.readFile(path.join(vault, 'note.md'), 'utf8')).toBe('# ours\n')
    expect(report.actions.some((a) => a.action === 'restored')).toBe(true)
    expect(await namesIn()).toEqual(['note.md'])
  })

  it('quarantines rename staging when the source path was re-used externally', async () => {
    await seed({
      'note.md': '# external\n',
      '.note.md.docus-rename-aaaa': '# ours\n',
    })

    const report = await runRecovery()

    expect(await fs.readFile(path.join(vault, 'note.md'), 'utf8')).toBe('# external\n')
    expect(await namesIn()).toContain('.note.md.docus-rename-aaaa')
    expect(report.actions.some((a) => a.action === 'quarantined')).toBe(true)
  })

  it('completes the metadata move when an inode partner proves the link landed', async () => {
    // Crash between link(2) and the staging unlink: staging and the
    // destination name the same inode. Recovery identifies the
    // partner by inode, removes the staging name, and completes the
    // metadata move the process died before running.
    await seed({ '.old.md.docus-rename-aaaa': '# doc\n' })
    await fs.link(path.join(vault, '.old.md.docus-rename-aaaa'), path.join(vault, 'moved.md'))
    saveDocumentMetadata(db, { id: 'rename-id', path: 'old', title: 'Doc', updatedAt: 1 })

    const report = await runRecovery()

    expect(report.actions.some((a) => a.action === 'completed-rename')).toBe(true)
    expect(await fs.readFile(path.join(vault, 'moved.md'), 'utf8')).toBe('# doc\n')
    expect(getDocumentMetadata(db, 'moved')?.id).toBe('rename-id')
    expect(getDocumentMetadata(db, 'old')).toBeNull()
    expect((await namesIn()).some((n) => n.includes('.docus-rename-'))).toBe(false)
  })
})

describe('recoverInterruptedOperations (folder-rename journal)', () => {
  function folderJournal(srcRel: string, destRel: string): string {
    return JSON.stringify({ version: 1, op: 'folder-rename', srcRel, destRel })
  }

  it('completes the metadata prefix move when the directory move landed', async () => {
    await seed({ 'ren/a.md': '# a\n' })
    await fs.writeFile(path.join(vault, '.proj.docus-journal-cccc'), folderJournal('proj', 'ren'), 'utf8')
    saveDocumentMetadata(db, { id: 'ren-a-id', path: 'proj/a', title: 'A', updatedAt: 1 })

    const report = await runRecovery()

    expect(report.actions.some((a) => a.action === 'completed-rename')).toBe(true)
    expect(getDocumentMetadata(db, 'ren/a')?.id).toBe('ren-a-id')
    expect(getDocumentMetadata(db, 'proj/a')).toBeNull()
    expect((await namesIn()).some((n) => n.includes('.docus-journal-'))).toBe(false)
  })

  it('is idempotent when the metadata move already landed before the crash', async () => {
    await seed({ 'ren/a.md': '# a\n' })
    await fs.writeFile(path.join(vault, '.proj.docus-journal-cccc'), folderJournal('proj', 'ren'), 'utf8')
    saveDocumentMetadata(db, { id: 'ren-a-id', path: 'ren/a', title: 'A', updatedAt: 1 })

    const report = await runRecovery()

    expect(report.actions.some((a) => a.action === 'completed-rename')).toBe(true)
    expect(getDocumentMetadata(db, 'ren/a')?.id).toBe('ren-a-id')
    expect((await namesIn()).some((n) => n.includes('.docus-journal-'))).toBe(false)
  })

  it('removes a stale journal when the source tree is still in place', async () => {
    await seed({ 'proj/a.md': '# a\n' })
    await fs.writeFile(path.join(vault, '.proj.docus-journal-cccc'), folderJournal('proj', 'ren'), 'utf8')
    saveDocumentMetadata(db, { id: 'proj-a-id', path: 'proj/a', title: 'A', updatedAt: 1 })

    const report = await runRecovery()

    expect(report.actions.some((a) => a.action === 'cleaned')).toBe(true)
    expect(getDocumentMetadata(db, 'proj/a')?.id).toBe('proj-a-id')
    expect((await namesIn()).some((n) => n.includes('.docus-journal-'))).toBe(false)
  })

  it('removes our own empty gate directory and the stale journal', async () => {
    // Crash between the mkdir gate and the rename: src tree intact,
    // dest is our own EMPTY directory — proven ours by being empty.
    await seed({ 'proj/a.md': '# a\n' })
    await fs.mkdir(path.join(vault, 'ren'))
    await fs.writeFile(path.join(vault, '.proj.docus-journal-cccc'), folderJournal('proj', 'ren'), 'utf8')

    await runRecovery()

    expect(await namesIn()).toEqual(['proj'])
    expect((await namesIn()).some((n) => n.includes('.docus-journal-'))).toBe(false)
  })

  it('leaves an externally claimed destination untouched and cleans the journal', async () => {
    // Both directories exist with the source tree intact: the move
    // never landed; the non-empty destination is external content.
    await seed({ 'proj/a.md': '# a\n', 'ren/external.md': '# external\n' })
    await fs.writeFile(path.join(vault, '.proj.docus-journal-cccc'), folderJournal('proj', 'ren'), 'utf8')

    await runRecovery()

    expect(await fs.readFile(path.join(vault, 'ren/external.md'), 'utf8')).toBe('# external\n')
    expect(await fs.readFile(path.join(vault, 'proj/a.md'), 'utf8')).toBe('# a\n')
    expect((await namesIn()).some((n) => n.includes('.docus-journal-'))).toBe(false)
  })

  it('reports and keeps the journal when neither path exists', async () => {
    await fs.writeFile(path.join(vault, '.proj.docus-journal-cccc'), folderJournal('proj', 'ren'), 'utf8')

    const report = await runRecovery()

    expect(report.actions.some((a) => a.action === 'failed')).toBe(true)
    expect(await namesIn()).toContain('.proj.docus-journal-cccc')
  })
})
