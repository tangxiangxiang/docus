import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  __setVaultMutationHooksForTesting,
  pendingVaultMutationsForTesting,
  VaultMutationOrderError,
  withVaultMutation,
} from '../vaultMutation.js'
import {
  acquireVaultWriterOwnership,
  VaultWriterOwnershipError,
} from '../vaultWriterOwnership.js'
import { isValidHistoryPath } from '../history/validation.js'
import { isValidPathSyntax } from '../paths.js'

let vault: string

beforeEach(async () => {
  vault = await fs.mkdtemp(path.join(os.tmpdir(), 'docus-vault-mutation-'))
})

afterEach(async () => {
  __setVaultMutationHooksForTesting(null)
  await fs.rm(vault, { recursive: true, force: true })
})

describe('withVaultMutation lock order and release', () => {
  it('rejects recursive acquisition instead of deterministically deadlocking', async () => {
    await expect(withVaultMutation(vault, () => withVaultMutation(vault, async () => {})))
      .rejects.toBeInstanceOf(VaultMutationOrderError)
    expect(await pendingVaultMutationsForTesting(vault)).toBe(0)
  })

  it('releases the Vault after success and failure', async () => {
    await withVaultMutation(vault, async () => {})
    expect(await pendingVaultMutationsForTesting(vault)).toBe(0)

    await expect(withVaultMutation(vault, async () => {
      throw new Error('injected mutation failure')
    })).rejects.toThrow('injected mutation failure')
    expect(await pendingVaultMutationsForTesting(vault)).toBe(0)

    await expect(withVaultMutation(vault, async () => 'available'))
      .resolves.toBe('available')
  })
})

describe('Vault writer ownership', () => {
  const ownerPath = () => path.join(vault, '.docus', 'vault-writer.json')

  it('allows only one live owner and never removes the incumbent', async () => {
    const first = await acquireVaultWriterOwnership(vault)
    const incumbent = JSON.parse(await fs.readFile(ownerPath(), 'utf8')) as { nonce: string }

    await expect(acquireVaultWriterOwnership(vault)).rejects.toMatchObject({
      name: 'VaultWriterOwnershipError',
      code: 'HISTORY_VAULT_WRITER_ACTIVE',
    })
    expect(JSON.parse(await fs.readFile(ownerPath(), 'utf8'))).toMatchObject({
      nonce: incumbent.nonce,
    })
    expect(await first.release()).toBe(true)
    await expect(fs.stat(ownerPath())).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('safely takes over a complete same-host record whose PID is positively dead', async () => {
    await fs.mkdir(path.dirname(ownerPath()), { recursive: true })
    const child = spawn(process.execPath, ['-e', 'process.exit(0)'])
    const deadPid = child.pid!
    await new Promise<void>((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', () => resolve())
    })
    const staleNonce = randomUUID()
    await fs.writeFile(ownerPath(), JSON.stringify({
      version: 1,
      nonce: staleNonce,
      host: os.hostname(),
      pid: deadPid,
      startedAt: new Date().toISOString(),
    }), 'utf8')

    const ownership = await acquireVaultWriterOwnership(vault)

    expect(ownership.record.nonce).not.toBe(staleNonce)
    expect(JSON.parse(await fs.readFile(ownerPath(), 'utf8'))).toMatchObject({
      nonce: ownership.record.nonce,
      pid: process.pid,
    })
    expect(await ownership.release()).toBe(true)
  })

  it('fails closed for malformed and cross-host ownership records', async () => {
    await fs.mkdir(path.dirname(ownerPath()), { recursive: true })
    await fs.writeFile(ownerPath(), '{partial', 'utf8')
    await expect(acquireVaultWriterOwnership(vault))
      .rejects.toBeInstanceOf(VaultWriterOwnershipError)
    expect(await fs.readFile(ownerPath(), 'utf8')).toBe('{partial')

    await fs.writeFile(ownerPath(), JSON.stringify({
      version: 1,
      nonce: randomUUID(),
      host: `${os.hostname()}-other`,
      pid: 999_999,
      startedAt: new Date().toISOString(),
    }), 'utf8')
    await expect(acquireVaultWriterOwnership(vault))
      .rejects.toThrow(/owned by host/i)
    expect(JSON.parse(await fs.readFile(ownerPath(), 'utf8'))).toMatchObject({
      host: `${os.hostname()}-other`,
    })
  })

  it('release refuses a nonce mismatch and never deletes the replacement record', async () => {
    const ownership = await acquireVaultWriterOwnership(vault)
    const replacementNonce = randomUUID()
    await fs.writeFile(ownerPath(), JSON.stringify({
      ...ownership.record,
      nonce: replacementNonce,
    }), 'utf8')

    expect(await ownership.release()).toBe(false)
    expect(JSON.parse(await fs.readFile(ownerPath(), 'utf8'))).toMatchObject({
      nonce: replacementNonce,
    })
  })

  it('does not treat elapsed time as proof that a live owner is stale', async () => {
    await fs.mkdir(path.dirname(ownerPath()), { recursive: true })
    const liveNonce = randomUUID()
    await fs.writeFile(ownerPath(), JSON.stringify({
      version: 1,
      nonce: liveNonce,
      host: os.hostname(),
      pid: process.pid,
      startedAt: '2000-01-01T00:00:00.000Z',
    }), 'utf8')

    await expect(acquireVaultWriterOwnership(vault)).rejects.toThrow(/active/i)
    expect(JSON.parse(await fs.readFile(ownerPath(), 'utf8'))).toMatchObject({
      nonce: liveNonce,
    })
  })

  it('fails closed on an indeterminate stale-takeover guard', async () => {
    const child = spawn(process.execPath, ['-e', 'process.exit(0)'])
    const deadPid = child.pid!
    await new Promise<void>((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', () => resolve())
    })
    await fs.mkdir(path.join(vault, '.docus', 'vault-writer.takeover'), {
      recursive: true,
    })
    await fs.writeFile(ownerPath(), JSON.stringify({
      version: 1,
      nonce: randomUUID(),
      host: os.hostname(),
      pid: deadPid,
      startedAt: new Date().toISOString(),
    }), 'utf8')
    await expect(acquireVaultWriterOwnership(vault))
      .rejects.toThrow(/takeover is already present/i)
    await expect(fs.stat(path.join(vault, '.docus', 'vault-writer.takeover')))
      .resolves.toBeDefined()
  })

  it('stores ownership under a path reserved from Vault and History content', () => {
    expect(isValidPathSyntax('.docus')).toBe(false)
    expect(isValidHistoryPath('.docus/vault-writer.json')).toBe(false)
  })
})
