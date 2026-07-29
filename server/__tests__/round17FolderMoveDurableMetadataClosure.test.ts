import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { sha256HexBuffer, writeDurableJournal } from '../atomicTextWrite'
import { recoverInterruptedOperations } from '../crashRecovery'
import { applyMigrations } from '../db'
import {
  getDocumentMetadata,
  moveDocumentMetadataPrefix,
  saveDocumentMetadata,
  snapshotDocumentMetadataPrefixMutation,
} from '../documentMetadata'
import {
  __setCreateOnlyMoveHooksForTesting,
  __setDirectoryMoveStrategyOverrideForTesting,
} from '../documentFileLifecycle'
import {
  createFolderMoveGateProof,
  FOLDER_MOVE_JOURNAL_VERSION,
  serializeMetadataSnapshot,
  validateSnapshotPhysicalEntries,
  type FolderMoveJournalEntry,
  type FolderMoveJournalV4,
} from '../folderMoveTransaction'
import app, { __setMetadataDbForTesting } from '../index'
import { __resetLinkIndexForTesting } from '../linkIndex'
import { setContentDir } from '../paths'
import { __setFolderRaceHooksForTesting } from '../routes/folders'

let vault: string
let originalContentDir: string
let db: Database.Database

beforeEach(async () => {
  originalContentDir = path.resolve(process.cwd(), 'src/content')
  vault = await fs.mkdtemp(path.join(os.tmpdir(), 'docus-round17-'))
  db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  applyMigrations(db)
  __setMetadataDbForTesting(db)
  setContentDir(vault)
  __resetLinkIndexForTesting()
  __setDirectoryMoveStrategyOverrideForTesting('replayable-move')
})

afterEach(async () => {
  __setCreateOnlyMoveHooksForTesting(null)
  __setDirectoryMoveStrategyOverrideForTesting(null)
  __setFolderRaceHooksForTesting(null)
  __setMetadataDbForTesting(null)
  db.close()
  setContentDir(originalContentDir)
  __resetLinkIndexForTesting()
  await fs.rm(vault, { recursive: true, force: true })
})

function insertMigration(
  migrationPath: string,
  originalPath: string,
  documentId: string | null = null,
): void {
  db.prepare(`
    INSERT INTO metadata_migrations (
      path,
      document_id,
      original_path,
      status,
      source_hash,
      error,
      updated_at
    ) VALUES (?, ?, ?, 'legacy', 'hash', '', 1)
  `).run(migrationPath, documentId, originalPath)
}

async function seedRenameGraph(): Promise<void> {
  await fs.mkdir(path.join(vault, 'proj'))
  await fs.writeFile(path.join(vault, 'proj', 'a.md'), '# hello\n')
  await fs.writeFile(path.join(vault, 'ref.md'), 'see [[proj/a]]\n')
  saveDocumentMetadata(db, {
    id: 'proj-a-id',
    path: 'proj/a',
    title: 'Project A',
    tags: ['round17'],
    updatedAt: 1,
  })
  saveDocumentMetadata(db, {
    id: 'ref-id',
    path: 'ref',
    title: 'Reference',
    summary: 'original reference metadata',
    updatedAt: 2,
  })
  saveDocumentMetadata(db, {
    id: 'destination-orphan-id',
    path: 'ren/orphan',
    title: 'Destination orphan',
    updatedAt: 3,
  })
  db.prepare(`
    INSERT INTO document_embeddings (
      document_id,
      content_hash,
      model,
      embedding,
      indexed_at
    ) VALUES ('proj-a-id', 'embedding-hash', 'test', ?, 4)
  `).run(Buffer.from([1, 2, 3]))
  insertMigration('proj/missing', 'proj/missing')
  await app.fetch(new Request('http://localhost/api/links/index'))
}

async function patchFolder(): Promise<Response> {
  return app.fetch(new Request('http://localhost/api/folders/proj', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ newPath: 'ren', updateReferences: true }),
  }))
}

async function readOnlyV4Journal(): Promise<{
  absolutePath: string
  journal: FolderMoveJournalV4
}> {
  const names = (await fs.readdir(vault))
    .filter((name) => name.includes('.docus-journal-'))
  const journals = (await Promise.all(names.map(async (name) => {
    const absolutePath = path.join(vault, name)
    const parsed = JSON.parse(await fs.readFile(absolutePath, 'utf8')) as {
      version?: number
    }
    return parsed.version === FOLDER_MOVE_JOURNAL_VERSION
      ? { absolutePath, journal: parsed as FolderMoveJournalV4 }
      : null
  }))).filter((item): item is NonNullable<typeof item> => item !== null)
  expect(journals).toHaveLength(1)
  return journals[0]!
}

describe('Round-17 durable reverse metadata intent', () => {
  it('persists the complete rollback footprint before reverse physical work', async () => {
    await seedRenameGraph()
    __setFolderRaceHooksForTesting({
      afterRenamePlanBuilt: async () => {
        await fs.writeFile(path.join(vault, 'ref.md'), 'external reference save\n')
      },
    })
    __setCreateOnlyMoveHooksForTesting({
      afterReverseGateCreated: () => {
        throw new Error('stop after durable reverse journal')
      },
    })

    await patchFolder()

    const { journal } = await readOnlyV4Journal()
    expect(journal.metadataDisposition.kind).toBe('snapshot-restore')
    if (journal.metadataDisposition.kind !== 'snapshot-restore') return
    const snapshot = journal.metadataDisposition.snapshot
    expect(snapshot.documents.map((row) => row.id)).toEqual(expect.arrayContaining([
      'proj-a-id',
      'ref-id',
      'destination-orphan-id',
    ]))
    expect(snapshot.tags).not.toHaveLength(0)
    expect(snapshot.documentTags).not.toHaveLength(0)
    expect(snapshot.embeddings).not.toHaveLength(0)
    expect(snapshot.migrations).toContainEqual(expect.objectContaining({
      path: 'proj/missing',
      document_id: null,
    }))
    expect(journal.metadataDisposition).toMatchObject({
      expectedCurrentSnapshot: expect.any(Object),
      physicalDocumentIds: ['proj-a-id'],
    })
  })

  it('restores the real committed forward journal when reverse contention lands no entry', async () => {
    await seedRenameGraph()
    __setFolderRaceHooksForTesting({
      afterRenamePlanBuilt: async () => {
        await fs.writeFile(path.join(vault, 'ref.md'), 'external reference save\n')
        await fs.mkdir(path.join(vault, 'proj'))
        await fs.writeFile(path.join(vault, 'proj', 'external.md'), '# external\n')
      },
    })

    await patchFolder()

    const { journal } = await readOnlyV4Journal()
    expect(journal).toMatchObject({
      srcRel: 'proj',
      destRel: 'ren',
      phase: 'metadata-committed',
      metadataDisposition: {
        kind: 'prefix-move',
        committedSnapshot: expect.any(Object),
      },
    })
    expect(await fs.readFile(path.join(vault, 'proj', 'external.md'), 'utf8'))
      .toBe('# external\n')

    const report = await recoverInterruptedOperations(vault, db)
    expect(report.actions).toContainEqual(expect.objectContaining({
      action: 'quarantined',
      detail: 'forward transaction committed but original source path was externally reused',
    }))
    expect(await fs.readFile(path.join(vault, 'proj', 'external.md'), 'utf8'))
      .toBe('# external\n')
    expect(await fs.readFile(path.join(vault, 'ren', 'a.md'), 'utf8'))
      .toBe('# hello\n')
  })

  it('rejects an external metadata mutation through the durable reverse CAS', async () => {
    await seedRenameGraph()
    __setFolderRaceHooksForTesting({
      afterRenamePlanBuilt: async () => {
        await fs.writeFile(path.join(vault, 'ref.md'), 'external reference save\n')
      },
    })
    __setCreateOnlyMoveHooksForTesting({
      beforeReverseMetadataRestore: () => {
        db.prepare(`
          UPDATE documents
          SET summary = 'external metadata transaction'
          WHERE id = 'ref-id'
        `).run()
      },
    })

    await patchFolder()

    const persisted = await readOnlyV4Journal()
    expect(persisted.journal).toMatchObject({
      srcRel: 'ren',
      destRel: 'proj',
      phase: 'files-landed',
      metadataDisposition: {
        kind: 'snapshot-restore',
        expectedCurrentSnapshot: expect.any(Object),
      },
    })
    expect(getDocumentMetadata(db, 'ref')?.summary)
      .toBe('external metadata transaction')
    expect(getDocumentMetadata(db, 'proj/a')).toBeNull()

    __setCreateOnlyMoveHooksForTesting(null)
    const report = await recoverInterruptedOperations(vault, db)
    expect(report.actions).toContainEqual(expect.objectContaining({
      file: path.basename(persisted.absolutePath),
      action: 'quarantined',
      detail: expect.stringMatching(/^snapshot metadata CAS failed:/),
    }))
    expect(getDocumentMetadata(db, 'ref')?.summary)
      .toBe('external metadata transaction')
    expect(await fs.stat(persisted.absolutePath)).toBeDefined()
  })

  it('keeps the reverse journal after partial landing instead of restoring forward direction', async () => {
    await seedRenameGraph()
    await fs.writeFile(path.join(vault, 'proj', 'b.md'), '# second\n')
    saveDocumentMetadata(db, {
      id: 'proj-b-id',
      path: 'proj/b',
      title: 'Project B',
      updatedAt: 5,
    })
    await app.fetch(new Request('http://localhost/api/links/index'))
    __setFolderRaceHooksForTesting({
      afterRenamePlanBuilt: async () => {
        await fs.writeFile(path.join(vault, 'ref.md'), 'external reference save\n')
        let planted = false
        __setCreateOnlyMoveHooksForTesting({
          afterReplayableMovedEntry: async (entryRel) => {
            if (planted || entryRel !== 'a.md') return
            planted = true
            await fs.writeFile(
              path.join(vault, 'proj', 'b.md'),
              '# external claimant\n',
            )
          },
        })
      },
    })

    await patchFolder()

    const { journal } = await readOnlyV4Journal()
    expect(journal).toMatchObject({
      srcRel: 'ren',
      destRel: 'proj',
      phase: 'gate-created',
      metadataDisposition: {
        kind: 'snapshot-restore',
      },
    })
    expect(await fs.readFile(path.join(vault, 'proj', 'a.md'), 'utf8'))
      .toBe('# hello\n')
    expect(await fs.readFile(path.join(vault, 'proj', 'b.md'), 'utf8'))
      .toBe('# external claimant\n')
    expect(await fs.readFile(path.join(vault, 'ren', 'b.md'), 'utf8'))
      .toBe('# second\n')
  })
})

describe('Round-17 snapshot physical footprint', () => {
  it('requires entries only for physicalDocumentIds, not metadata-only documents', () => {
    saveDocumentMetadata(db, { id: 'proj-a-id', path: 'proj/a', title: 'A' })
    saveDocumentMetadata(db, { id: 'ref-id', path: 'ref', title: 'Reference' })
    saveDocumentMetadata(db, { id: 'orphan-id', path: 'ren/orphan', title: 'Orphan' })
    const snapshot = serializeMetadataSnapshot(
      snapshotDocumentMetadataPrefixMutation(db, ['proj', 'ren', 'ref']),
    )
    const entries: FolderMoveJournalEntry[] = [{
      relativeFilePath: 'a.md',
      sourceHash: '0'.repeat(64),
      documentId: 'proj-a-id',
      documentPath: 'proj/a',
    }]

    const validateRound17SnapshotPhysicalEntries =
      validateSnapshotPhysicalEntries as unknown as (
        snapshot: ReturnType<typeof serializeMetadataSnapshot>,
        entries: FolderMoveJournalEntry[],
        destRel: string,
        options: { physicalDocumentIds: string[] },
      ) => string | null
    expect(validateRound17SnapshotPhysicalEntries(
      snapshot,
      entries,
      'proj',
      { physicalDocumentIds: ['proj-a-id'] },
    )).toBeNull()
    expect(validateRound17SnapshotPhysicalEntries(
      snapshot,
      [],
      'proj',
      { physicalDocumentIds: ['proj-a-id'] },
    )).toMatch(/has no physical entry/)
  })
})

describe('Round-17 complete migration prefix mutation', () => {
  it('moves a migration-only row with the folder prefix', () => {
    insertMigration('proj/missing', 'proj/missing')

    moveDocumentMetadataPrefix(db, 'proj', 'ren')

    expect(db.prepare(`
      SELECT path, original_path, document_id
      FROM metadata_migrations
    `).all()).toEqual([{
      path: 'ren/missing',
      original_path: 'ren/missing',
      document_id: null,
    }])
  })

  it('moves a tombstone original_path without changing its tombstone path', () => {
    insertMigration('@deleted/doc-1', 'proj/missing')

    moveDocumentMetadataPrefix(db, 'proj', 'ren')

    expect(db.prepare(`
      SELECT path, original_path
      FROM metadata_migrations
    `).all()).toEqual([{
      path: '@deleted/doc-1',
      original_path: 'ren/missing',
    }])
  })

  it('rolls back documents and migrations when a migration destination collides', () => {
    saveDocumentMetadata(db, { id: 'proj-a-id', path: 'proj/a', title: 'A' })
    insertMigration('proj/missing', 'proj/missing')
    insertMigration('ren/missing', 'ren/missing')

    expect(() => moveDocumentMetadataPrefix(db, 'proj', 'ren'))
      .toThrow(/migration.*collid/i)
    expect(getDocumentMetadata(db, 'proj/a')?.id).toBe('proj-a-id')
    expect(getDocumentMetadata(db, 'ren/a')).toBeNull()
    expect(db.prepare(`
      SELECT path, original_path
      FROM metadata_migrations
      ORDER BY path
    `).all()).toEqual([
      { path: 'proj/missing', original_path: 'proj/missing' },
      { path: 'ren/missing', original_path: 'ren/missing' },
    ])
  })
})

describe('Round-17 exact committed graph verification', () => {
  async function writeCommittedPrefixJournal(): Promise<{
    journalAbs: string
    journalName: string
  }> {
    await fs.mkdir(path.join(vault, 'ren'))
    const fileAbs = path.join(vault, 'ren', 'a.md')
    await fs.writeFile(fileAbs, '# hello\n')
    saveDocumentMetadata(db, {
      id: 'proj-a-id',
      path: 'ren/a',
      title: 'A',
      tags: ['round17'],
    })
    insertMigration('ren/missing', 'ren/missing')
    db.prepare(`
      INSERT INTO document_embeddings (
        document_id,
        content_hash,
        model,
        embedding,
        indexed_at
      ) VALUES ('proj-a-id', 'embedding-hash', 'test', ?, 1)
    `).run(Buffer.from([7, 8, 9]))
    const committedSnapshot = serializeMetadataSnapshot(
      snapshotDocumentMetadataPrefixMutation(db, ['proj', 'ren']),
    )
    const [directoryStat, fileStat, raw] = await Promise.all([
      fs.stat(path.join(vault, 'ren'), { bigint: true }),
      fs.stat(fileAbs, { bigint: true }),
      fs.readFile(fileAbs),
    ])
    const journalName = '.proj.docus-journal-abcdef012345'
    const journalAbs = path.join(vault, journalName)
    const journal: FolderMoveJournalV4 = {
      version: FOLDER_MOVE_JOURNAL_VERSION,
      op: 'folder-rename',
      phase: 'metadata-committed',
      srcRel: 'proj',
      destRel: 'ren',
      strategy: 'atomic-rename',
      sourceDev: directoryStat.dev.toString(),
      sourceIno: directoryStat.ino.toString(),
      sourceBirthtimeNs: directoryStat.birthtimeNs.toString(),
      destDev: directoryStat.dev.toString(),
      destIno: directoryStat.ino.toString(),
      destBirthtimeNs: directoryStat.birthtimeNs.toString(),
      entries: [{
        relativeFilePath: 'a.md',
        sourceHash: sha256HexBuffer(raw),
        sourceDev: fileStat.dev.toString(),
        sourceIno: fileStat.ino.toString(),
        documentId: 'proj-a-id',
        documentPath: 'proj/a',
      }],
      directories: [],
      directoryGenerations: [],
      gateProof: createFolderMoveGateProof(),
      metadataDisposition: {
        kind: 'prefix-move',
        committedSnapshot,
      } as FolderMoveJournalV4['metadataDisposition'],
    }
    await writeDurableJournal(journalAbs, journal)
    return { journalAbs, journalName }
  }

  it('quarantines a legacy committed prefix journal without an exact snapshot', async () => {
    const { journalAbs, journalName } = await writeCommittedPrefixJournal()
    const journal = JSON.parse(await fs.readFile(journalAbs, 'utf8')) as FolderMoveJournalV4
    journal.metadataDisposition = { kind: 'prefix-move' }
    await fs.rm(journalAbs)
    await writeDurableJournal(journalAbs, journal)

    const report = await recoverInterruptedOperations(vault, db)

    expect(report.actions).toContainEqual({
      file: journalName,
      action: 'quarantined',
      detail: 'metadata-committed prefix journal lacks exact committed snapshot',
    })
    expect(await fs.stat(journalAbs)).toBeDefined()
  })

  const driftCases: Array<[string, () => void]> = [
    ['migration residue', () => {
      db.prepare(`
        UPDATE metadata_migrations
        SET path = 'proj/missing', original_path = 'proj/missing'
        WHERE path = 'ren/missing'
      `).run()
    }],
    ['tag drift', () => {
      db.prepare(`UPDATE tags SET name = 'external' WHERE normalized_name = 'round17'`).run()
    }],
    ['document_tag drift', () => {
      db.prepare(`DELETE FROM document_tags WHERE document_id = 'proj-a-id'`).run()
    }],
    ['embedding drift', () => {
      db.prepare(`
        UPDATE document_embeddings
        SET content_hash = 'external'
        WHERE document_id = 'proj-a-id'
      `).run()
    }],
  ]

  it.each(driftCases)('retains the committed journal on %s', async (_label, mutate) => {
    const { journalAbs, journalName } = await writeCommittedPrefixJournal()
    mutate()

    const report = await recoverInterruptedOperations(vault, db)

    expect(report.actions).toContainEqual({
      file: journalName,
      action: 'quarantined',
      detail: 'live prefix metadata graph differs from committed snapshot',
    })
    expect(await fs.stat(journalAbs)).toBeDefined()
  })
})
