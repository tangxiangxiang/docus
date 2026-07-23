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
import { prepareRenameReferenceJournal } from '../renameReferenceJournal'

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..')
const TSX_CLI = path.join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs')
const CRASH_CHILD = path.join(import.meta.dirname, 'fixtures', 'commit-crash-child.ts')
const RENAME_CRASH_CHILD = path.join(import.meta.dirname, 'fixtures', 'rename-crash-child.ts')
const RENAME_METADATA_CRASH_CHILD = path.join(import.meta.dirname, 'fixtures', 'rename-metadata-crash-child.ts')

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
    const quarantineSave = (await namesIn()).find((name) => name.startsWith('.note.md.docus-quarantine-save-'))!
    expect(quarantineSave).toBeTruthy()
    expect(await namesIn()).toContain('.note.md.docus-journal-cccc')
    expect(await namesIn()).toContain('note.md')
    await runRecovery()
    await runRecovery()
    expect(await fs.readFile(path.join(vault, quarantineSave), 'utf8')).toBe('# replacement\n')
    expect(await fs.readFile(path.join(vault, '.note.md.docus-journal-cccc'), 'utf8'))
      .toContain('manual-recovery-required')
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

  it('completes a crash-interrupted save quarantine transition from either payload name', async () => {
    await seed({
      'note.md': '# restored\n',
      '.note.md.docus-save-bbbb': '# replacement\n',
      '.note.md.docus-journal-cccc': JSON.stringify({
        version: 1,
        op: 'replace',
        staged: '.note.md.docus-staged-aaaa',
        replacement: '.note.md.docus-save-bbbb',
        pendingReplacement: '.note.md.docus-quarantine-save-dddd',
        expectedHash: sha256Hex('# restored\n'),
        replacementHash: sha256Hex('# replacement\n'),
        phase: 'quarantine-save-pending',
      }),
    })

    await runRecovery()
    await runRecovery()

    expect(await fs.readFile(path.join(vault, '.note.md.docus-quarantine-save-dddd'), 'utf8')).toBe('# replacement\n')
    expect(await fs.readFile(path.join(vault, '.note.md.docus-journal-cccc'), 'utf8')).toContain('manual-recovery-required')
  })

  it('retains both recoverable generations when an external version owns the target', async () => {
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
    expect(report.actions.some((a) => a.action === 'quarantined')).toBe(true)
    expect((await namesIn()).some((name) => name.startsWith('.note.md.docus-quarantine-save-'))).toBe(true)
    expect(await namesIn()).toContain('.note.md.docus-journal-cccc')
    expect(await namesIn()).toContain('.note.md.docus-staged-aaaa')
    expect(await namesIn()).toContain('note.md')
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

  it('never follows malicious replace journal paths outside the vault', async () => {
    const sentinel = path.join(path.dirname(vault), `${path.basename(vault)}-sentinel.txt`)
    const replacement = path.join(path.dirname(vault), `${path.basename(vault)}-replacement.txt`)
    await fs.writeFile(sentinel, 'keep old', 'utf8')
    await fs.writeFile(replacement, 'keep new', 'utf8')
    try {
      await seed({
        'note.md': '# live\n',
        '.note.md.docus-journal-aaaa': JSON.stringify({
          version: 1,
          op: 'replace',
          staged: `../${path.basename(sentinel)}`,
          replacement: `../${path.basename(replacement)}`,
          expectedHash: 'x',
          replacementHash: 'y',
        }),
      })
      const report = await runRecovery()
      expect(await fs.readFile(sentinel, 'utf8')).toBe('keep old')
      expect(await fs.readFile(replacement, 'utf8')).toBe('keep new')
      expect(report.actions.some((a) => a.action === 'quarantined')).toBe(true)
      expect(await namesIn()).toContain('.note.md.docus-journal-aaaa')
    } finally {
      await fs.rm(sentinel, { force: true })
      await fs.rm(replacement, { force: true })
    }
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
  it('replays a persisted legacy quarantine manifest after a crash before detach', async () => {
    await seed({
      'gone.md.docus-quarantine-reuse-aaaa': '# old\n',
      '.gone.md.docus-quarantine-manifest-bbbb': JSON.stringify({
        version: 1,
        op: 'legacy-delete-quarantine',
        path: 'gone',
        quarantine: 'gone.md.docus-quarantine-reuse-aaaa',
        identities: [{ path: 'gone', id: 'legacy-id' }],
      }),
    })
    saveDocumentMetadata(db, { id: 'legacy-id', path: 'gone', title: 'Gone', updatedAt: 1 })

    await runRecovery()

    expect(getDocumentMetadata(db, 'gone')).toBeNull()
    expect(await namesIn()).toContain('.gone.md.docus-quarantine-manifest-bbbb')
    expect(await namesIn()).toContain('gone.md.docus-quarantine-reuse-aaaa')
  })

  it('replays identity detachment after a crash between quarantine fsync and metadata update', async () => {
    await seed({
      'gone.md': '# external\n',
      'gone.md.docus-quarantine-reuse-aaaa': '# old\n',
      '.gone.md.docus-delete-manifest-bbbb': JSON.stringify({
        version: 1,
        op: 'delete-path-reuse',
        kind: 'file',
        path: 'gone',
        inflight: 'gone.md.docus-delete-inflight-aaaa',
        quarantine: 'gone.md.docus-quarantine-reuse-aaaa',
        identities: [{ path: 'gone', id: 'old-id' }],
      }),
    })
    saveDocumentMetadata(db, { id: 'old-id', path: 'gone', title: 'Old', updatedAt: 1 })

    await runRecovery()

    expect(getDocumentMetadata(db, 'gone')).toBeNull()
    expect(await namesIn()).not.toContain('.gone.md.docus-delete-manifest-bbbb')
    expect(await namesIn()).toContain('gone.md.docus-quarantine-reuse-aaaa')
  })

  it('does not detach a fresh identity when replaying a stale delete manifest', async () => {
    await seed({
      'gone.md': '# external\n',
      'gone.md.docus-quarantine-reuse-aaaa': '# old\n',
      '.gone.md.docus-delete-manifest-bbbb': JSON.stringify({
        version: 1,
        op: 'delete-path-reuse',
        kind: 'file',
        path: 'gone',
        inflight: 'gone.md.docus-delete-inflight-aaaa',
        quarantine: 'gone.md.docus-quarantine-reuse-aaaa',
        identities: [{ path: 'gone', id: 'old-id' }],
      }),
    })
    saveDocumentMetadata(db, { id: 'fresh-id', path: 'gone', title: 'Fresh', updatedAt: 2 })

    await runRecovery()

    expect(getDocumentMetadata(db, 'gone')?.id).toBe('fresh-id')
  })

  it('never auto-deletes an explicit path-reuse quarantine after the public path disappears', async () => {
    await seed({ 'gone.md.docus-quarantine-reuse-aaaa': '# recoverable old generation\n' })
    saveDocumentMetadata(db, { id: 'new-id', path: 'gone', title: 'New', updatedAt: 1 })

    const report = await runRecovery()

    expect(await fs.readFile(path.join(vault, 'gone.md.docus-quarantine-reuse-aaaa'), 'utf8'))
      .toBe('# recoverable old generation\n')
    expect(getDocumentMetadata(db, 'gone')?.id).toBe('new-id')
    expect(report.actions.some((a) => a.action === 'quarantined')).toBe(true)
  })

  it('conservatively promotes a legacy file delete artifact instead of auto-deleting it', async () => {
    await seed({ 'gone.md.docus-delete-123': '# old\n' })
    saveDocumentMetadata(db, { id: 'gone-id', path: 'gone', title: 'Gone', updatedAt: 1 })

    const report = await runRecovery()

    expect((await namesIn()).some((name) => name.startsWith('gone.md.docus-quarantine-reuse-'))).toBe(true)
    expect(getDocumentMetadata(db, 'gone')).toBeNull()
    expect((await namesIn()).some((name) => name.startsWith('.gone.md.docus-quarantine-manifest-'))).toBe(true)
    expect(report.actions.some((a) => a.action === 'quarantined')).toBe(true)
  })

  it('conservatively promotes a legacy folder delete artifact', async () => {
    await seed({ 'gone.docus-delete-123/a.md': '# a\n' })
    saveDocumentMetadata(db, { id: 'gone-a-id', path: 'gone/a', title: 'A', updatedAt: 1 })

    const report = await runRecovery()

    expect((await namesIn()).some((name) => name.startsWith('gone.docus-quarantine-reuse-'))).toBe(true)
    expect(getDocumentMetadata(db, 'gone/a')).toBeNull()
    expect((await namesIn()).some((name) => name.startsWith('.gone.docus-quarantine-manifest-'))).toBe(true)
    expect(report.actions.some((a) => a.action === 'quarantined')).toBe(true)
  })

  it('leaves quarantine in place when the path was re-used', async () => {
    await seed({
      'gone.md': '# new generation\n',
      'gone.md.docus-delete-123': '# old\n',
    })
    saveDocumentMetadata(db, { id: 'fresh-id', path: 'gone', title: 'Fresh', updatedAt: 1 })

    const report = await runRecovery()

    expect(await fs.readFile(path.join(vault, 'gone.md'), 'utf8')).toBe('# new generation\n')
    expect((await namesIn()).some((name) => name.startsWith('gone.md.docus-quarantine-reuse-'))).toBe(true)
    // Recovery drops the ambiguous old binding before migration gives
    // the public target a fresh identity.
    expect(getDocumentMetadata(db, 'gone')).toBeNull()
    expect(report.actions.some((a) => a.action === 'quarantined')).toBe(true)
  })

  it('completes only an explicit in-flight delete when the target is absent', async () => {
    await seed({ 'gone.md.docus-delete-inflight-aaaa': '# old\n' })
    saveDocumentMetadata(db, { id: 'gone-id', path: 'gone', title: 'Gone', updatedAt: 1 })

    const report = await runRecovery()

    expect(await namesIn()).toEqual([])
    expect(getDocumentMetadata(db, 'gone')).toBeNull()
    expect(report.actions.some((a) => a.action === 'completed-delete')).toBe(true)
  })

  it('durably promotes in-flight delete staging when the target was re-used', async () => {
    await seed({
      'gone.md': '# external\n',
      'gone.md.docus-delete-inflight-aaaa': '# old\n',
    })
    saveDocumentMetadata(db, { id: 'old-id', path: 'gone', title: 'Old', updatedAt: 1 })

    await runRecovery()

    expect(await fs.readFile(path.join(vault, 'gone.md'), 'utf8')).toBe('# external\n')
    expect(getDocumentMetadata(db, 'gone')).toBeNull()
    expect((await namesIn()).some((name) => name.startsWith('gone.md.docus-quarantine-reuse-'))).toBe(true)
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

  it('recovers documentId after kill -9 when staging is gone but metadata has not moved', async () => {
    const from = path.join(vault, 'old.md')
    const to = path.join(vault, 'new.md')
    const dbPath = path.join(vault, 'metadata.sqlite')
    await seed({ 'old.md': '# original\n' })

    const child = spawnChild({
      DOCUS_RENAME_FROM: from,
      DOCUS_RENAME_TO: to,
      DOCUS_RENAME_DB: dbPath,
    }, RENAME_METADATA_CRASH_CHILD)
    expectHardKill(await waitExit(child))

    expect(await fs.stat(from).then(() => true, () => false)).toBe(false)
    expect(await fs.readFile(to, 'utf8')).toBe('# original\n')
    expect((await namesIn()).some((name) => name.includes('.docus-rename-'))).toBe(false)
    expect((await namesIn()).some((name) => name.includes('.docus-journal-'))).toBe(true)

    const persistedDb = new Database(dbPath)
    try {
      const report = await recoverInterruptedOperations(vault, persistedDb)
      expect(getDocumentMetadata(persistedDb, 'old')).toBeNull()
      expect(getDocumentMetadata(persistedDb, 'new')?.id).toBe('post-staging-crash-id')
      expect(report.actions.some((a) => a.action === 'completed-rename')).toBe(true)
    } finally { persistedDb.close() }
  })

  it('restores the source after kill -9 between rename takeover and destination link', async () => {
    const from = path.join(vault, 'old.md')
    const to = path.join(vault, 'new.md')
    const dbPath = path.join(vault, 'metadata.sqlite')
    await seed({ 'old.md': '# original\n' })

    const child = spawnChild({
      DOCUS_RENAME_FROM: from,
      DOCUS_RENAME_TO: to,
      DOCUS_RENAME_DB: dbPath,
      DOCUS_RENAME_CRASH_POINT: 'takeover',
    }, RENAME_METADATA_CRASH_CHILD)
    expectHardKill(await waitExit(child))
    expect(await fs.stat(from).then(() => true, () => false)).toBe(false)
    expect(await fs.stat(to).then(() => true, () => false)).toBe(false)

    const persistedDb = new Database(dbPath)
    try {
      const report = await recoverInterruptedOperations(vault, persistedDb)
      expect(await fs.readFile(from, 'utf8')).toBe('# original\n')
      expect(getDocumentMetadata(persistedDb, 'old')?.id).toBe('post-staging-crash-id')
      expect(getDocumentMetadata(persistedDb, 'new')).toBeNull()
      expect(report.actions.some((a) => a.action === 'restored')).toBe(true)
      expect((await namesIn()).some((name) => name.includes('.docus-rename-') || name.includes('.docus-journal-'))).toBe(false)
    } finally { persistedDb.close() }
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

describe('recoverInterruptedOperations (file-rename journal)', () => {
  it('rejects a valid-looking journal that is not stored beside its declared source', async () => {
    await seed({
      'important-note.md': '# important\n',
      '.unrelated.md.docus-journal-aaaa': JSON.stringify({
        version: 1,
        op: 'file-rename',
        srcRel: 'missing-old',
        destRel: 'important-note',
        staging: '.missing-old.md.docus-rename-aaaa',
        documentId: 'missing-id',
        sourceHash: sha256Hex('# important\n'),
      }),
    })
    saveDocumentMetadata(db, { id: 'important-id', path: 'important-note', title: 'Important', updatedAt: 1 })

    const report = await runRecovery()

    expect(getDocumentMetadata(db, 'important-note')?.id).toBe('important-id')
    expect(await namesIn()).toContain('.unrelated.md.docus-journal-aaaa')
    expect(report.actions.some((a) => a.action === 'quarantined')).toBe(true)
  })

  it('does not move a newer source identity recorded after an ambiguous restart', async () => {
    await seed({
      'new.md': '# moved\n',
      '.old.md.docus-journal-aaaa': JSON.stringify({
        version: 1,
        op: 'file-rename',
        srcRel: 'old',
        destRel: 'new',
        staging: '.old.md.docus-rename-aaaa',
        documentId: 'old-generation-id',
        sourceHash: sha256Hex('# moved\n'),
      }),
    })
    saveDocumentMetadata(db, { id: 'external-source-id', path: 'old', title: 'External', updatedAt: 2 })
    saveDocumentMetadata(db, { id: 'old-generation-id', path: 'new', title: 'Moved', updatedAt: 1 })

    const report = await runRecovery()

    expect(getDocumentMetadata(db, 'old')?.id).toBe('external-source-id')
    expect(getDocumentMetadata(db, 'new')?.id).toBe('old-generation-id')
    expect(await namesIn()).not.toContain('.old.md.docus-journal-aaaa')
    expect(report.actions.some((a) => a.detail?.includes('already committed'))).toBe(true)
  })

  it('quarantines rather than moving metadata when the source documentId changed', async () => {
    await seed({
      'new.md': '# moved\n',
      '.old.md.docus-journal-aaaa': JSON.stringify({
        version: 1,
        op: 'file-rename',
        srcRel: 'old',
        destRel: 'new',
        staging: '.old.md.docus-rename-aaaa',
        documentId: 'old-generation-id',
        sourceHash: sha256Hex('# moved\n'),
      }),
    })
    saveDocumentMetadata(db, { id: 'external-source-id', path: 'old', title: 'External', updatedAt: 2 })

    const report = await runRecovery()

    expect(getDocumentMetadata(db, 'old')?.id).toBe('external-source-id')
    expect(getDocumentMetadata(db, 'new')).toBeNull()
    expect(await namesIn()).toContain('.old.md.docus-journal-aaaa')
    expect(report.actions.some((a) => a.detail?.includes('identity no longer matches'))).toBe(true)
  })

  it('moves document identity after a crash with destination landed and staging already removed', async () => {
    await seed({
      'new.md': '# moved\n',
      '.old.md.docus-journal-aaaa': JSON.stringify({
        version: 1,
        op: 'file-rename',
        srcRel: 'old',
        destRel: 'new',
        staging: '.old.md.docus-rename-aaaa',
        documentId: 'stable-id',
        sourceHash: sha256Hex('# moved\n'),
      }),
    })
    saveDocumentMetadata(db, { id: 'stable-id', path: 'old', title: 'Moved', updatedAt: 1 })

    const report = await runRecovery()

    expect(getDocumentMetadata(db, 'old')).toBeNull()
    expect(getDocumentMetadata(db, 'new')?.id).toBe('stable-id')
    expect(await namesIn()).toEqual(['new.md'])
    expect(report.actions.some((a) => a.action === 'completed-rename')).toBe(true)
  })

  it('quarantines a folder journal with traversal paths without touching the sentinel', async () => {
    const sentinel = path.join(path.dirname(vault), `${path.basename(vault)}-folder-sentinel`)
    await fs.mkdir(sentinel)
    try {
      await seed({
        '.notes.docus-journal-aaaa': JSON.stringify({
          version: 1,
          op: 'folder-rename',
          srcRel: `../${path.basename(sentinel)}`,
          destRel: 'safe',
          sourceDev: 0,
          sourceIno: 0,
        }),
      })
      const report = await runRecovery()
      expect((await fs.stat(sentinel)).isDirectory()).toBe(true)
      expect(report.actions.some((a) => a.action === 'quarantined')).toBe(true)
    } finally { await fs.rm(sentinel, { recursive: true, force: true }) }
  })
})

describe('recoverInterruptedOperations (rename reference transaction)', () => {
  it('rejects a document reference journal without a bound document identity', async () => {
    await seed({
      'new.md': '# moved\n',
      'victim.md': 'safe\n',
      '.old.md.docus-ref-before-a': 'safe\n',
      '.old.md.docus-ref-after-a': 'forged\n',
      '.old.md.docus-journal-aaaa': JSON.stringify({
        version: 1, op: 'document-rename-references', phase: 'roll-forward',
        srcRel: 'old', destRel: 'new', sourceHash: sha256Hex('# moved\n'),
        references: [{ path: 'victim', beforeHash: sha256Hex('safe\n'), afterHash: sha256Hex('forged\n'), beforePayload: '.old.md.docus-ref-before-a', afterPayload: '.old.md.docus-ref-after-a' }],
      }),
    })
    await runRecovery()
    expect(await fs.readFile(path.join(vault, 'victim.md'), 'utf8')).toBe('safe\n')
    expect(await namesIn()).toContain('.old.md.docus-journal-aaaa')
  })

  it('does not update backlinks when the destination generation was replaced externally', async () => {
    await seed({ 'old.md': '# owned\n', 'ref.md': '[[old]]\n' })
    saveDocumentMetadata(db, { id: 'rename-id', path: 'old', title: 'Old', updatedAt: 1 })
    await prepareRenameReferenceJournal({
      sourceAbs: path.join(vault, 'old.md'), op: 'document-rename-references',
      srcRel: 'old', destRel: 'new', documentId: 'rename-id',
      references: [{ path: 'ref', beforeRaw: '[[old]]\n', afterRaw: '[[new]]\n' }],
    })
    await fs.rm(path.join(vault, 'old.md'))
    await fs.writeFile(path.join(vault, 'new.md'), '# external\n')
    db.prepare('UPDATE documents SET path = ? WHERE id = ?').run('new', 'rename-id')
    const report = await runRecovery()
    expect(await fs.readFile(path.join(vault, 'ref.md'), 'utf8')).toBe('[[old]]\n')
    expect(report.actions.some((action) => action.detail?.includes('destination generation'))).toBe(true)
  })

  it('cleans declared payloads from an interrupted preparing phase', async () => {
    await seed({
      'old.md': '# old\n',
      '.old.md.docus-ref-before-a': 'before',
      '.old.md.docus-journal-aaaa': JSON.stringify({
        version: 1, op: 'document-rename-references', phase: 'preparing',
        srcRel: 'old', destRel: 'new', documentId: 'id', sourceHash: sha256Hex('# old\n'),
        references: [{ path: 'ref', beforeHash: sha256Hex('before'), afterHash: sha256Hex('after'), beforePayload: '.old.md.docus-ref-before-a', afterPayload: '.old.md.docus-ref-after-a' }],
      }),
    })
    await runRecovery()
    expect((await namesIn()).filter((name) => name.includes('.docus-ref-') || name.includes('.docus-journal-'))).toEqual([])
  })

  it('replays a durable reference rollback before deleting its evidence', async () => {
    await seed({ 'old.md': '# owned\n', 'ref.md': '[[old]]\n' })
    saveDocumentMetadata(db, { id: 'rename-id', path: 'old', title: 'Old', updatedAt: 1 })
    const prepared = await prepareRenameReferenceJournal({
      sourceAbs: path.join(vault, 'old.md'), op: 'document-rename-references',
      srcRel: 'old', destRel: 'new', documentId: 'rename-id',
      references: [{ path: 'ref', beforeRaw: '[[old]]\n', afterRaw: '[[new]]\n' }],
    })
    await prepared!.setDirection('roll-back')
    await fs.writeFile(path.join(vault, 'ref.md'), '[[new]]\n')
    await runRecovery()
    expect(await fs.readFile(path.join(vault, 'ref.md'), 'utf8')).toBe('[[old]]\n')
    expect((await namesIn()).some((name) => name.includes('.docus-ref-') || name.includes('.docus-journal-'))).toBe(false)
  })

  it('settles the main rename before references regardless of journal filename order', async () => {
    await seed({ 'old.md': '# owned\n', 'ref.md': '[[old]]\n' })
    saveDocumentMetadata(db, { id: 'rename-id', path: 'old', title: 'Old', updatedAt: 1 })
    const prepared = await prepareRenameReferenceJournal({
      sourceAbs: path.join(vault, 'old.md'), op: 'document-rename-references',
      srcRel: 'old', destRel: 'new', documentId: 'rename-id',
      references: [{ path: 'ref', beforeRaw: '[[old]]\n', afterRaw: '[[new]]\n' }],
    })
    const earlyReferenceJournal = path.join(vault, '.old.md.docus-journal-0000')
    await fs.rename(prepared!.journalPath, earlyReferenceJournal)
    await fs.writeFile(path.join(vault, '.old.md.docus-journal-ffff'), JSON.stringify({
      version: 1, op: 'file-rename', srcRel: 'old', destRel: 'new',
      documentId: 'rename-id', sourceHash: sha256Hex('# owned\n'),
    }))
    await fs.rename(path.join(vault, 'old.md'), path.join(vault, 'new.md'))

    await runRecovery()

    expect(getDocumentMetadata(db, 'new')?.id).toBe('rename-id')
    expect(await fs.readFile(path.join(vault, 'ref.md'), 'utf8')).toBe('[[new]]\n')
    expect((await namesIn()).some((name) => name.includes('.docus-journal-'))).toBe(false)
  })

  it('rolls forward a partially written backlink batch and cleans durable payloads', async () => {
    await seed({
      'old.md': '# moved\n',
      'ref-a.md': '[[old]]\n',
      'ref-b.md': '[[old]]\n',
    })
    saveDocumentMetadata(db, { id: 'rename-id', path: 'old', title: 'Old', updatedAt: 1 })
    const prepared = await prepareRenameReferenceJournal({
      sourceAbs: path.join(vault, 'old.md'),
      op: 'document-rename-references',
      srcRel: 'old',
      destRel: 'new',
      documentId: 'rename-id',
      references: [
        { path: 'ref-a', beforeRaw: '[[old]]\n', afterRaw: '[[new]]\n' },
        { path: 'ref-b', beforeRaw: '[[old]]\n', afterRaw: '[[new]]\n' },
      ],
    })
    expect(prepared).not.toBeNull()
    await fs.rename(path.join(vault, 'old.md'), path.join(vault, 'new.md'))
    db.prepare('UPDATE documents SET path = ? WHERE id = ?').run('new', 'rename-id')
    await fs.writeFile(path.join(vault, 'ref-a.md'), '[[new]]\n', 'utf8')

    const report = await runRecovery()

    expect(await fs.readFile(path.join(vault, 'ref-a.md'), 'utf8')).toBe('[[new]]\n')
    expect(await fs.readFile(path.join(vault, 'ref-b.md'), 'utf8')).toBe('[[new]]\n')
    expect(report.actions.some((action) => action.detail?.includes('rolled forward'))).toBe(true)
    expect((await namesIn()).some((name) => name.includes('.docus-ref-') || name.includes('.docus-journal-'))).toBe(false)
  })

  it('stops without overwriting a backlink changed by an external editor', async () => {
    await seed({ 'old.md': '# moved\n', 'ref.md': '[[old]]\n' })
    saveDocumentMetadata(db, { id: 'rename-id', path: 'old', title: 'Old', updatedAt: 1 })
    await prepareRenameReferenceJournal({
      sourceAbs: path.join(vault, 'old.md'),
      op: 'document-rename-references',
      srcRel: 'old',
      destRel: 'new',
      documentId: 'rename-id',
      references: [{ path: 'ref', beforeRaw: '[[old]]\n', afterRaw: '[[new]]\n' }],
    })
    await fs.rename(path.join(vault, 'old.md'), path.join(vault, 'new.md'))
    db.prepare('UPDATE documents SET path = ? WHERE id = ?').run('new', 'rename-id')
    await fs.writeFile(path.join(vault, 'ref.md'), '# external\n', 'utf8')

    const report = await runRecovery()

    expect(await fs.readFile(path.join(vault, 'ref.md'), 'utf8')).toBe('# external\n')
    expect(report.actions.some((action) => action.detail?.includes('changed externally'))).toBe(true)
    expect((await namesIn()).some((name) => name.includes('.docus-journal-'))).toBe(true)
  })
})

describe('recoverInterruptedOperations (folder-rename journal)', () => {
  async function folderJournal(srcRel: string, destRel: string, evidenceRel = srcRel): Promise<string> {
    const stat = await fs.stat(path.join(vault, evidenceRel)).catch(() => ({ dev: 0, ino: 0 }))
    return JSON.stringify({ version: 1, op: 'folder-rename', srcRel, destRel, sourceDev: stat.dev, sourceIno: stat.ino })
  }

  it('never removes a real empty directory from a forged no-op journal', async () => {
    await fs.mkdir(path.join(vault, 'notes'))
    await seed({ '.notes.docus-journal-aaaa': await folderJournal('notes', 'notes') })

    const report = await runRecovery()

    expect((await fs.stat(path.join(vault, 'notes'))).isDirectory()).toBe(true)
    expect(await namesIn()).toContain('.notes.docus-journal-aaaa')
    expect(report.actions.some((a) => a.action === 'quarantined')).toBe(true)
  })

  it('completes the metadata prefix move when the directory move landed', async () => {
    await seed({ 'ren/a.md': '# a\n' })
    await fs.writeFile(path.join(vault, '.proj.docus-journal-cccc'), await folderJournal('proj', 'ren', 'ren'), 'utf8')
    saveDocumentMetadata(db, { id: 'ren-a-id', path: 'proj/a', title: 'A', updatedAt: 1 })

    const report = await runRecovery()

    expect(report.actions.some((a) => a.action === 'completed-rename')).toBe(true)
    expect(getDocumentMetadata(db, 'ren/a')?.id).toBe('ren-a-id')
    expect(getDocumentMetadata(db, 'proj/a')).toBeNull()
    expect((await namesIn()).some((n) => n.includes('.docus-journal-'))).toBe(false)
  })

  it('is idempotent when the metadata move already landed before the crash', async () => {
    await seed({ 'ren/a.md': '# a\n' })
    await fs.writeFile(path.join(vault, '.proj.docus-journal-cccc'), await folderJournal('proj', 'ren', 'ren'), 'utf8')
    saveDocumentMetadata(db, { id: 'ren-a-id', path: 'ren/a', title: 'A', updatedAt: 1 })

    const report = await runRecovery()

    expect(report.actions.some((a) => a.action === 'completed-rename')).toBe(true)
    expect(getDocumentMetadata(db, 'ren/a')?.id).toBe('ren-a-id')
    expect((await namesIn()).some((n) => n.includes('.docus-journal-'))).toBe(false)
  })

  it('removes a stale journal when the source tree is still in place', async () => {
    await seed({ 'proj/a.md': '# a\n' })
    await fs.writeFile(path.join(vault, '.proj.docus-journal-cccc'), await folderJournal('proj', 'ren'), 'utf8')
    saveDocumentMetadata(db, { id: 'proj-a-id', path: 'proj/a', title: 'A', updatedAt: 1 })

    const report = await runRecovery()

    expect(report.actions.some((a) => a.action === 'cleaned')).toBe(true)
    expect(getDocumentMetadata(db, 'proj/a')?.id).toBe('proj-a-id')
    expect((await namesIn()).some((n) => n.includes('.docus-journal-'))).toBe(false)
  })

  it('moves metadata back when durable disk state is source but metadata had reached destination', async () => {
    await seed({ 'proj/a.md': '# a\n' })
    await fs.writeFile(path.join(vault, '.proj.docus-journal-cccc'), await folderJournal('proj', 'ren'), 'utf8')
    saveDocumentMetadata(db, { id: 'proj-a-id', path: 'ren/a', title: 'A', updatedAt: 1 })

    await runRecovery()

    expect(getDocumentMetadata(db, 'proj/a')?.id).toBe('proj-a-id')
    expect(getDocumentMetadata(db, 'ren/a')).toBeNull()
    expect(await namesIn()).not.toContain('.proj.docus-journal-cccc')
  })

  it('never treats an empty destination as proof that the gate is ours', async () => {
    await seed({ 'proj/a.md': '# a\n' })
    await fs.mkdir(path.join(vault, 'ren'))
    await fs.writeFile(path.join(vault, '.proj.docus-journal-cccc'), await folderJournal('proj', 'ren'), 'utf8')

    await runRecovery()

    expect(await namesIn()).toContain('proj')
    expect(await namesIn()).toContain('ren')
    expect(await namesIn()).toContain('.proj.docus-journal-cccc')
  })

  it('leaves an externally claimed destination untouched and quarantines the journal', async () => {
    // Both directories exist with the source tree intact: the move
    // never landed; the non-empty destination is external content.
    await seed({ 'proj/a.md': '# a\n', 'ren/external.md': '# external\n' })
    await fs.writeFile(path.join(vault, '.proj.docus-journal-cccc'), await folderJournal('proj', 'ren'), 'utf8')

    await runRecovery()

    expect(await fs.readFile(path.join(vault, 'ren/external.md'), 'utf8')).toBe('# external\n')
    expect(await fs.readFile(path.join(vault, 'proj/a.md'), 'utf8')).toBe('# a\n')
    expect(await namesIn()).toContain('.proj.docus-journal-cccc')
  })

  it('reports and keeps the journal when neither path exists', async () => {
    await fs.writeFile(path.join(vault, '.proj.docus-journal-cccc'), await folderJournal('proj', 'ren'), 'utf8')

    const report = await runRecovery()

    expect(report.actions.some((a) => a.action === 'failed')).toBe(true)
    expect(await namesIn()).toContain('.proj.docus-journal-cccc')
  })
})
