import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { applyMigrations } from '../db'
import { sha256Hex } from '../atomicTextWrite'
import { recoverInterruptedOperations } from '../crashRecovery'
import { getDocumentMetadata, saveDocumentMetadata } from '../documentMetadata'

let root: string
let db: InstanceType<typeof Database>

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'docus-recovery-model-'))
  db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  applyMigrations(db)
})

afterAll(async () => {
  db.close()
  await fs.rm(root, { recursive: true, force: true })
})

function rngFor(seed: number): () => number {
  let state = seed || 0x9e3779b9
  return () => {
    state = (Math.imul(state ^ (state >>> 15), 1 | state) + 0x6d2b79f5) | 0
    return ((state ^ (state >>> 14)) >>> 0) / 0x1_0000_0000
  }
}

describe('deterministic rename-reference recovery model', () => {
  it('converges and is idempotent for 1000 reproducible seeds', async () => {
    const replaySeed = Number(process.env.DOCUS_RECOVERY_SEED || 0)
    const seeds = replaySeed > 0 ? [replaySeed] : Array.from({ length: 1000 }, (_, index) => index + 1)
    for (const seed of seeds) {
      const random = rngFor(seed)
      const caseDir = path.join(root, seed.toString(16))
      const prefix = seed.toString(16)
      const srcRel = `${prefix}/old`
      const destRel = `${prefix}/new`
      const sourceRaw = `# owned ${seed}\n`
      const phase = (['preparing', 'roll-forward', 'roll-back', 'cleanup'] as const)[Math.floor(random() * 4)]
      const referenceCount = Math.floor(random() * 11)
      const externalSource = phase === 'roll-back' && random() < 0.2
      const externalDestination = phase === 'roll-forward' && random() < 0.2
      const missingPayload = phase !== 'preparing' && phase !== 'cleanup' && random() < 0.15
      const thirdPartyIndex = phase !== 'preparing' && phase !== 'cleanup' && random() < 0.2 && referenceCount
        ? Math.floor(random() * referenceCount)
        : -1
      const journalName = `.old.md.docus-journal-${seed.toString(16)}`
      let journal: Record<string, unknown> | null = null
      try {
        await fs.mkdir(caseDir, { recursive: true })
        const ownedAtDestination = phase === 'roll-forward' || (phase === 'roll-back' && random() < 0.5)
        const ownedAbs = path.join(caseDir, ownedAtDestination ? 'new.md' : 'old.md')
        await fs.writeFile(ownedAbs, sourceRaw)
        if (externalSource && ownedAtDestination) await fs.writeFile(path.join(caseDir, 'old.md'), `# external source ${seed}\n`)
        if (externalDestination && ownedAtDestination) await fs.writeFile(path.join(caseDir, 'new.md'), `# external destination ${seed}\n`)
        const identityPath = ownedAtDestination ? destRel : srcRel
        saveDocumentMetadata(db, { id: `id-${seed}`, path: identityPath, title: `Seed ${seed}`, updatedAt: seed })

        const references = [] as Array<Record<string, string>>
        for (let index = 0; index < referenceCount; index += 1) {
          const refRel = `${prefix}/ref-${index}`
          const beforeRaw = `[[old]] seed=${seed} ref=${index}\n`
          const afterRaw = `[[new]] seed=${seed} ref=${index}\n`
          const beforePayload = `.old.md.docus-ref-before-${seed.toString(16)}-${index.toString(16)}`
          const afterPayload = `.old.md.docus-ref-after-${seed.toString(16)}-${index.toString(16)}`
          await fs.writeFile(path.join(caseDir, beforePayload), beforeRaw)
          await fs.writeFile(path.join(caseDir, afterPayload), afterRaw)
          const landed = random() < 0.5
          const currentRaw = index === thirdPartyIndex
            ? `external reference ${seed}/${index}\n`
            : phase === 'roll-back'
              ? (landed ? beforeRaw : afterRaw)
              : (landed ? afterRaw : beforeRaw)
          await fs.writeFile(path.join(caseDir, `ref-${index}.md`), currentRaw)
          references.push({
            path: refRel, beforeHash: sha256Hex(beforeRaw), afterHash: sha256Hex(afterRaw),
            beforePayload, afterPayload,
          })
        }
        if (referenceCount === 0) {
          await fs.rm(caseDir, { recursive: true, force: true })
          db.prepare('DELETE FROM documents WHERE id = ?').run(`id-${seed}`)
          continue
        }
        if (missingPayload) await fs.rm(path.join(caseDir, references[0].afterPayload))
        journal = {
          version: 1, op: 'document-rename-references', phase,
          srcRel, destRel, documentId: `id-${seed}`, sourceHash: sha256Hex(sourceRaw), references,
        }
        await fs.writeFile(path.join(caseDir, journalName), JSON.stringify(journal))

        await recoverInterruptedOperations(root, db)
        const onceNames = (await fs.readdir(caseDir)).sort()
        const onceBodies = new Map<string, string>()
        for (const name of onceNames) {
          const abs = path.join(caseDir, name)
          if ((await fs.stat(abs)).isFile()) onceBodies.set(name, await fs.readFile(abs, 'utf8'))
        }
        await recoverInterruptedOperations(root, db)
        await recoverInterruptedOperations(root, db)
        expect((await fs.readdir(caseDir)).sort(), `seed=${seed} journal=${JSON.stringify(journal)}`).toEqual(onceNames)
        for (const [name, body] of onceBodies) {
          expect(await fs.readFile(path.join(caseDir, name), 'utf8'), `seed=${seed} file=${name}`).toBe(body)
        }
        if (externalSource) expect(await fs.readFile(path.join(caseDir, 'old.md'), 'utf8')).toBe(`# external source ${seed}\n`)
        if (externalDestination) {
          expect(await fs.readFile(path.join(caseDir, 'new.md'), 'utf8')).toBe(`# external destination ${seed}\n`)
          expect(getDocumentMetadata(db, destRel)).toBeNull()
        }
        const remainingPayloads = onceNames.filter((name) => name.includes('.docus-ref-'))
        if (remainingPayloads.length) expect(onceNames).toContain(journalName)
      } catch (error) {
        throw new Error(`replay with DOCUS_RECOVERY_SEED=${seed}\ninitial=${JSON.stringify(journal)}\n${(error as Error).stack}`)
      } finally {
        await fs.rm(caseDir, { recursive: true, force: true })
        db.prepare('DELETE FROM documents WHERE id = ?').run(`id-${seed}`)
      }
    }
  }, 120_000)
})
