// Tests for the AI tool surface in server/ai/tools.ts.
//
// Pattern: a fresh temp dir per test, `setContentDir` to redirect
// the workspace root, exercise the executor (or readPostIfExists
// directly), then restore the original CONTENT_DIR and clean up.
// This mirrors the `fs.mkdtemp` pattern used by `tree.test.ts` and
// keeps the test files completely out of the real `src/content/`.

import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest'
import Database from 'better-sqlite3'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setContentDir, CONTENT_DIR } from '../paths'
import {
  TOOL_DEFINITIONS,
  executeToolCall,
  readPostIfExists,
  type ToolContext,
} from '../ai/tools'
import { applyMigrations } from '../db'
import { getDocumentMetadata } from '../documentMetadata'

const ORIGINAL_CONTENT_DIR = CONTENT_DIR

function makeTempContentDir(): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docus-tools-test-'))
  const content = path.join(tmp, 'content')
  fs.mkdirSync(content, { recursive: true })
  return content
}

function writeFile(relPath: string, content: string): string {
  const abs = path.join(CONTENT_DIR, relPath)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, content, 'utf8')
  return abs
}

const db = new Database(':memory:')
db.pragma('foreign_keys = ON')
applyMigrations(db)
const ctx: ToolContext = { signal: new AbortController().signal, db }

beforeEach(() => {
  db.exec('DELETE FROM documents; DELETE FROM tags;')
})

afterAll(() => db.close())

// --- readPostIfExists -------------------------------------------------------

describe('readPostIfExists', () => {
  let contentDir: string
  beforeEach(() => { contentDir = makeTempContentDir(); setContentDir(contentDir) })
  afterEach(() => { setContentDir(ORIGINAL_CONTENT_DIR); fs.rmSync(path.dirname(contentDir), { recursive: true, force: true }) })

  it('returns null for a non-existent file', () => {
    expect(readPostIfExists('nope/missing')).toBeNull()
  })

  it('returns parsed {raw, content, frontmatter, stat} for a real file', () => {
    writeFile('a/note.md', '---\ntitle: hi\n---\n\nbody text\n')
    const r = readPostIfExists('a/note')
    expect(r).not.toBeNull()
    expect(r!.raw).toContain('body text')
    expect(r!.content.trim()).toBe('body text')
    expect(r!.frontmatter).toEqual({ title: 'hi' })
    expect(r!.stat.size).toBeGreaterThan(0)
  })

  it('throws for an unsafe path (rejects traversal)', () => {
    expect(() => readPostIfExists('../escape')).toThrow(/invalid path/)
  })
})

// --- read_file --------------------------------------------------------------

describe('read_file', () => {
  let contentDir: string
  beforeEach(() => { contentDir = makeTempContentDir(); setContentDir(contentDir) })
  afterEach(() => { setContentDir(ORIGINAL_CONTENT_DIR); fs.rmSync(path.dirname(contentDir), { recursive: true, force: true }) })

  it('returns a JSON payload with raw, content, frontmatter, size, mtime', async () => {
    writeFile('a/note.md', '---\ntitle: hi\n---\n\nbody text\n')
    const r = await executeToolCall('read_file', { path: 'a/note' }, ctx)
    expect(r.isError).toBe(false)
    const payload = JSON.parse(r.content)
    expect(payload.path).toBe('a/note')
    expect(payload.content.trim()).toBe('body text')
    expect(payload.frontmatter).toEqual({ title: 'hi' })
    expect(payload.size).toBeGreaterThan(0)
    expect(typeof payload.mtime).toBe('number')
  })

  it('returns is_error when the file does not exist', async () => {
    const r = await executeToolCall('read_file', { path: 'nope/missing' }, ctx)
    expect(r.isError).toBe(true)
    expect(r.content).toMatch(/does not exist/)
  })

  it('returns is_error when path is missing', async () => {
    const r = await executeToolCall('read_file', {}, ctx)
    expect(r.isError).toBe(true)
  })

  it('returns is_error for an unsafe path', async () => {
    const r = await executeToolCall('read_file', { path: '../escape' }, ctx)
    expect(r.isError).toBe(true)
  })
})

// --- list_files -------------------------------------------------------------

describe('list_files', () => {
  let contentDir: string
  beforeEach(() => { contentDir = makeTempContentDir(); setContentDir(contentDir) })
  afterEach(() => { setContentDir(ORIGINAL_CONTENT_DIR); fs.rmSync(path.dirname(contentDir), { recursive: true, force: true }) })

  it('lists the root when scope is missing', async () => {
    fs.mkdirSync(path.join(contentDir, 'a'), { recursive: true })
    fs.mkdirSync(path.join(contentDir, 'b'), { recursive: true })
    writeFile('c.md', 'x')
    const r = await executeToolCall('list_files', {}, ctx)
    expect(r.isError).toBe(false)
    const list = JSON.parse(r.content) as { path: string; isDir: boolean }[]
    const names = list.map((e) => e.path).sort()
    expect(names).toEqual(['a', 'b', 'c'])
  })

  it('lists entries in a subdirectory', async () => {
    fs.mkdirSync(path.join(contentDir, 'a'), { recursive: true })
    writeFile('a/x.md', 'x')
    writeFile('a/y.md', 'y')
    const r = await executeToolCall('list_files', { scope: 'a' }, ctx)
    expect(r.isError).toBe(false)
    const list = JSON.parse(r.content) as { path: string; isDir: boolean }[]
    expect(list.map((e) => e.path).sort()).toEqual(['a/x', 'a/y'])
  })

  it('returns is_error for a missing directory', async () => {
    const r = await executeToolCall('list_files', { scope: 'nope' }, ctx)
    expect(r.isError).toBe(true)
    expect(r.content).toMatch(/does not exist/)
  })
})

// --- create_file ------------------------------------------------------------

describe('create_file', () => {
  let contentDir: string
  beforeEach(() => { contentDir = makeTempContentDir(); setContentDir(contentDir) })
  afterEach(() => { setContentDir(ORIGINAL_CONTENT_DIR); fs.rmSync(path.dirname(contentDir), { recursive: true, force: true }) })

  it('creates a new file and reports a write change', async () => {
    const r = await executeToolCall('create_file', { path: 'a/new', content: 'hello' }, ctx)
    expect(r.isError).toBe(false)
    expect(r.changed?.kind).toBe('write')
    expect(r.changed?.path).toBe('a/new')
    expect(fs.readFileSync(path.join(contentDir, 'a/new.md'), 'utf8')).toBe('hello')
    expect(getDocumentMetadata(db, 'a/new')?.title).toBe('new')
  })

  it('fails if the file already exists', async () => {
    writeFile('a/exists.md', 'old')
    const r = await executeToolCall('create_file', { path: 'a/exists', content: 'new' }, ctx)
    expect(r.isError).toBe(true)
    expect(r.content).toMatch(/already exists/)
    expect(fs.readFileSync(path.join(contentDir, 'a/exists.md'), 'utf8')).toBe('old')
  })
})

// --- write_file -------------------------------------------------------------

describe('write_file', () => {
  let contentDir: string
  beforeEach(() => { contentDir = makeTempContentDir(); setContentDir(contentDir) })
  afterEach(() => { setContentDir(ORIGINAL_CONTENT_DIR); fs.rmSync(path.dirname(contentDir), { recursive: true, force: true }) })

  it('overwrites an existing file', async () => {
    writeFile('a/x.md', 'old')
    const r = await executeToolCall('write_file', { path: 'a/x', content: 'new' }, ctx)
    expect(r.isError).toBe(false)
    expect(r.changed?.kind).toBe('write')
    expect(fs.readFileSync(path.join(contentDir, 'a/x.md'), 'utf8')).toBe('new')
    expect(getDocumentMetadata(db, 'a/x')?.updatedAt).toBeGreaterThan(0)
  })

  it('creates a new file in a fresh subdirectory', async () => {
    const r = await executeToolCall('write_file', { path: 'deep/nested/x', content: 'x' }, ctx)
    expect(r.isError).toBe(false)
    expect(fs.readFileSync(path.join(contentDir, 'deep/nested/x.md'), 'utf8')).toBe('x')
  })

  it('returns is_error for an unsafe path', async () => {
    const r = await executeToolCall('write_file', { path: '../escape', content: 'x' }, ctx)
    expect(r.isError).toBe(true)
  })
})

// --- patch_file -------------------------------------------------------------

describe('patch_file', () => {
  let contentDir: string
  beforeEach(() => { contentDir = makeTempContentDir(); setContentDir(contentDir) })
  afterEach(() => { setContentDir(ORIGINAL_CONTENT_DIR); fs.rmSync(path.dirname(contentDir), { recursive: true, force: true }) })

  it('replaces a single match', async () => {
    writeFile('a/x.md', 'hello world')
    const r = await executeToolCall('patch_file', { path: 'a/x', old_string: 'world', new_string: 'planet' }, ctx)
    expect(r.isError).toBe(false)
    expect(r.changed?.kind).toBe('write')
    expect(fs.readFileSync(path.join(contentDir, 'a/x.md'), 'utf8')).toBe('hello planet')
  })

  it('replaces all matches when replace_all=true', async () => {
    writeFile('a/x.md', 'foo foo foo')
    const r = await executeToolCall('patch_file', { path: 'a/x', old_string: 'foo', new_string: 'bar', replace_all: true }, ctx)
    expect(r.isError).toBe(false)
    expect(fs.readFileSync(path.join(contentDir, 'a/x.md'), 'utf8')).toBe('bar bar bar')
  })

  it('fails with current body when old_string is missing', async () => {
    writeFile('a/x.md', 'hello')
    const r = await executeToolCall('patch_file', { path: 'a/x', old_string: 'nope', new_string: 'x' }, ctx)
    expect(r.isError).toBe(true)
    expect(r.content).toMatch(/not found/)
    expect(r.content).toMatch(/hello/)
  })

  it('fails with match locations when old_string is ambiguous', async () => {
    writeFile('a/x.md', 'foo\nfoo\nfoo')
    const r = await executeToolCall('patch_file', { path: 'a/x', old_string: 'foo', new_string: 'bar' }, ctx)
    expect(r.isError).toBe(true)
    expect(r.content).toMatch(/matches 3 times/)
    expect(r.content).toMatch(/match 1/)
  })

  it('rejects empty old_string', async () => {
    writeFile('a/x.md', 'hello')
    const r = await executeToolCall('patch_file', { path: 'a/x', old_string: '', new_string: 'x' }, ctx)
    expect(r.isError).toBe(true)
    expect(r.content).toMatch(/non-empty/)
  })

  it('rejects identical old_string and new_string', async () => {
    writeFile('a/x.md', 'hello')
    const r = await executeToolCall('patch_file', { path: 'a/x', old_string: 'hello', new_string: 'hello' }, ctx)
    expect(r.isError).toBe(true)
    expect(r.content).toMatch(/identical/)
  })
})

// --- delete_file ------------------------------------------------------------

describe('delete_file', () => {
  let contentDir: string
  beforeEach(() => { contentDir = makeTempContentDir(); setContentDir(contentDir) })
  afterEach(() => { setContentDir(ORIGINAL_CONTENT_DIR); fs.rmSync(path.dirname(contentDir), { recursive: true, force: true }) })

  it('deletes a file and reports a delete change', async () => {
    writeFile('a/x.md', 'x')
    const r = await executeToolCall('delete_file', { path: 'a/x' }, ctx)
    expect(r.isError).toBe(false)
    expect(r.changed?.kind).toBe('delete')
    expect(r.changed?.path).toBe('a/x')
    expect(fs.existsSync(path.join(contentDir, 'a/x.md'))).toBe(false)
    expect(getDocumentMetadata(db, 'a/x')).toBeNull()
  })

  it('returns is_error when the file does not exist', async () => {
    const r = await executeToolCall('delete_file', { path: 'a/nope' }, ctx)
    expect(r.isError).toBe(true)
    expect(r.content).toMatch(/does not exist/)
  })
})

// --- rename_file ------------------------------------------------------------

describe('rename_file', () => {
  let contentDir: string
  beforeEach(() => { contentDir = makeTempContentDir(); setContentDir(contentDir) })
  afterEach(() => { setContentDir(ORIGINAL_CONTENT_DIR); fs.rmSync(path.dirname(contentDir), { recursive: true, force: true }) })

  it('renames a file and reports a rename change with newRaw', async () => {
    writeFile('a/old.md', 'hello')
    const r = await executeToolCall('rename_file', { path: 'a/old', new_path: 'a/new' }, ctx)
    expect(r.isError).toBe(false)
    expect(r.changed?.kind).toBe('rename')
    expect(r.changed?.path).toBe('a/new')
    expect(r.changed?.oldPath).toBe('a/old')
    expect(r.changed?.newRaw).toBe('hello')
    expect(fs.existsSync(path.join(contentDir, 'a/old.md'))).toBe(false)
    expect(fs.readFileSync(path.join(contentDir, 'a/new.md'), 'utf8')).toBe('hello')
    expect(getDocumentMetadata(db, 'a/old')).toBeNull()
    expect(getDocumentMetadata(db, 'a/new')?.title).toBe('old')
  })

  it('rejects when source equals target', async () => {
    writeFile('a/x.md', 'x')
    const r = await executeToolCall('rename_file', { path: 'a/x', new_path: 'a/x' }, ctx)
    expect(r.isError).toBe(true)
    expect(r.content).toMatch(/equals/)
  })

  it('rejects when the source does not exist', async () => {
    const r = await executeToolCall('rename_file', { path: 'a/nope', new_path: 'a/x' }, ctx)
    expect(r.isError).toBe(true)
    expect(r.content).toMatch(/does not exist/)
  })

  it('rejects when the target already exists', async () => {
    writeFile('a/old.md', 'o')
    writeFile('a/new.md', 'n')
    const r = await executeToolCall('rename_file', { path: 'a/old', new_path: 'a/new' }, ctx)
    expect(r.isError).toBe(true)
    expect(r.content).toMatch(/already exists/)
  })
})

// --- dispatcher / shape -----------------------------------------------------

describe('executeToolCall dispatcher', () => {
  let contentDir: string
  beforeEach(() => { contentDir = makeTempContentDir(); setContentDir(contentDir) })
  afterEach(() => { setContentDir(ORIGINAL_CONTENT_DIR); fs.rmSync(path.dirname(contentDir), { recursive: true, force: true }) })

  it('returns is_error for an unknown tool name', async () => {
    const r = await executeToolCall('nope_tool', {}, ctx)
    expect(r.isError).toBe(true)
    expect(r.content).toMatch(/unknown tool/)
  })

  it('returns is_error when the signal is pre-aborted', async () => {
    const ac = new AbortController()
    ac.abort()
    const r = await executeToolCall('read_file', { path: 'a' }, { signal: ac.signal })
    expect(r.isError).toBe(true)
    expect(r.content).toMatch(/aborted/)
  })
})

describe('TOOL_DEFINITIONS', () => {
  it('has 7 tools with names matching the dispatch table', () => {
    expect(TOOL_DEFINITIONS).toHaveLength(7)
    const names = TOOL_DEFINITIONS.map((t) => t.name).sort()
    expect(names).toEqual(['create_file', 'delete_file', 'list_files', 'patch_file', 'read_file', 'rename_file', 'write_file'])
    for (const t of TOOL_DEFINITIONS) {
      expect(t.input_schema.type).toBe('object')
      expect(typeof t.description).toBe('string')
    }
  })
})
