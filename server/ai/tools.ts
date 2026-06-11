// AI tool surface. Seven workspace tools that let Claude read, list,
// create, write, patch, delete, and rename any file under
// `src/content/`. Paths are validated by the same `assertSafePath` /
// `filePathFor` helpers used by the REST CRUD layer in `server/index.ts`,
// so a tool can never escape the workspace.
//
// Every executor returns `ToolResult = { content, isError, changed? }`.
// `changed` is set on write/delete/rename and carries
// `{ path, kind, newMtime?, newRaw?, oldPath? }`; the chat
// orchestrator forwards it as a `file_changed` SSE event so the
// client's editor can refresh any open tab on that path.

import Anthropic from '@anthropic-ai/sdk'
import fs from 'node:fs'
import path from 'node:path'
import matter from 'gray-matter'
import {
  CONTENT_DIR,
  filePathFor,
  folderPathFor,
} from '../paths.js'

export type ToolContext = { signal: AbortSignal }

export type FileChangeKind = 'write' | 'delete' | 'rename'

export type FileChangeDescriptor = {
  path: string
  kind: FileChangeKind
  newMtime?: number
  newRaw?: string
  oldPath?: string
}

export type ToolResult = {
  content: string
  isError: boolean
  changed?: FileChangeDescriptor
}

// ---- helpers (also used by the test file) ----

/**
 * Read a post from disk and return the parsed bundle. Returns `null`
 * for ENOENT (clean error path for `read_file`); throws for any
 * other error (including unsafe paths — `assertSafePath` throws
 * before we touch the filesystem).
 */
export function readPostIfExists(
  relPath: string,
): { raw: string; content: string; frontmatter: Record<string, unknown>; abs: string; stat: fs.Stats } | null {
  const abs = filePathFor(relPath) // throws on unsafe path
  let raw: string
  try {
    raw = fs.readFileSync(abs, 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw e
  }
  const parsed = matter(raw)
  const stat = fs.statSync(abs)
  return {
    raw,
    content: parsed.content,
    frontmatter: parsed.data as Record<string, unknown>,
    abs,
    stat,
  }
}

const MAX_READ_CHARS = 50_000
const MAX_PATCH_ERROR_CHARS = 8_000
const MAX_MATCH_SNIPPET_LINES = 3

function truncate(s: string, max: number, marker: string): string {
  if (s.length <= max) return s
  return s.slice(0, max) + marker
}

// ---- tool definitions (sent to Claude as `tools`) ----

export const TOOL_DEFINITIONS: Anthropic.Tool[] = [
  {
    name: 'read_file',
    description:
      'Read a file from the workspace. Returns the raw text, parsed frontmatter, body, size in bytes, and mtime. Use this before patching a file so your `old_string` matches the actual content.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Workspace-relative path WITHOUT the .md suffix (e.g. "inbox/markdown-syntax").',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'list_files',
    description:
      'List top-level entries in a directory. No recursion. Each entry has path, size, mtime, and isDir. Omit scope to list the workspace root.',
    input_schema: {
      type: 'object',
      properties: {
        scope: {
          type: 'string',
          description:
            'Workspace-relative directory path WITHOUT trailing slash. Omit for the workspace root.',
        },
      },
    },
  },
  {
    name: 'create_file',
    description:
      'Create a new file. Fails if the file already exists — use write_file to overwrite. Creates parent directories as needed.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative path WITHOUT the .md suffix.' },
        content: { type: 'string', description: 'Full file content to write.' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'write_file',
    description:
      'Overwrite an existing file or create a new one with the given content. Same primitive the editor\'s save action uses. Creates parent directories as needed.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative path WITHOUT the .md suffix.' },
        content: { type: 'string', description: 'Full file content to write.' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'patch_file',
    description:
      'Find-and-replace inside a file. The server validates that `old_string` matches exactly once (or exactly N times if `replace_all=true`). If 0 or >1 matches, the call fails with enough context to disambiguate. Use this for small edits; use write_file for full rewrites.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative path WITHOUT the .md suffix.' },
        old_string: {
          type: 'string',
          description:
            'Exact substring to replace. Must appear verbatim, including whitespace and indentation.',
        },
        new_string: { type: 'string', description: 'Replacement text.' },
        replace_all: {
          type: 'boolean',
          default: false,
          description: 'If true, replace every occurrence. If false (default), the call fails when old_string matches more than once.',
        },
      },
      required: ['path', 'old_string', 'new_string'],
    },
  },
  {
    name: 'delete_file',
    description: 'Delete a file from the workspace. Fails if the file does not exist.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative path WITHOUT the .md suffix.' },
      },
      required: ['path'],
    },
  },
  {
    name: 'rename_file',
    description:
      'Move or rename a file. Both paths are workspace-relative. Fails if the source does not exist, the target already exists, or source equals target. Use delete_file + create_file if you need to overwrite a target.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Current workspace-relative path WITHOUT .md.' },
        new_path: { type: 'string', description: 'New workspace-relative path WITHOUT .md.' },
      },
      required: ['path', 'new_path'],
    },
  },
]

// ---- executors ----

function ok(content: string, changed?: FileChangeDescriptor): ToolResult {
  return { content, isError: false, changed }
}

function err(content: string): ToolResult {
  return { content, isError: true }
}

function executeReadFile(input: { path?: string }): ToolResult {
  if (typeof input.path !== 'string' || input.path.length === 0) {
    return err('read_file: `path` is required')
  }
  let bundle: ReturnType<typeof readPostIfExists>
  try {
    bundle = readPostIfExists(input.path)
  } catch (e) {
    return err(`read_file: ${(e as Error).message}`)
  }
  if (bundle === null) {
    return err(`read_file: file does not exist: ${input.path}`)
  }
  const payload = {
    path: input.path,
    raw: truncate(bundle.raw, MAX_READ_CHARS, `\n\n[... file truncated; total ${bundle.stat.size} bytes ...]`),
    content: bundle.content,
    frontmatter: bundle.frontmatter,
    size: bundle.stat.size,
    mtime: bundle.stat.mtimeMs,
  }
  return ok(JSON.stringify(payload, null, 2))
}

function executeListFiles(input: { scope?: string }): ToolResult {
  let targetDir: string
  if (input.scope === undefined || input.scope === '') {
    targetDir = CONTENT_DIR
  } else {
    try {
      targetDir = folderPathFor(input.scope)
    } catch (e) {
      return err(`list_files: ${(e as Error).message}`)
    }
  }
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(targetDir, { withFileTypes: true })
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      return err(`list_files: directory does not exist: ${input.scope ?? ''}`)
    }
    throw e
  }
  const relBase = input.scope && input.scope.length > 0 ? input.scope.replace(/\/+$/, '') : ''
  const out: { path: string; isDir: boolean; size: number; mtime: number }[] = []
  for (const ent of entries) {
    if (ent.name.startsWith('.')) continue
    const abs = path.join(targetDir, ent.name)
    let stat: fs.Stats
    try {
      stat = fs.statSync(abs)
    } catch {
      continue
    }
    const childRel = ent.isDirectory() ? ent.name : ent.name.replace(/\.md$/, '')
    out.push({
      path: relBase ? `${relBase}/${childRel}` : childRel,
      isDir: ent.isDirectory(),
      size: stat.size,
      mtime: stat.mtimeMs,
    })
  }
  out.sort((a, b) => a.path.localeCompare(b.path))
  return ok(JSON.stringify(out, null, 2))
}

function executeCreateFile(input: { path?: string; content?: string }): ToolResult {
  if (typeof input.path !== 'string' || input.path.length === 0) {
    return err('create_file: `path` is required')
  }
  if (typeof input.content !== 'string') {
    return err('create_file: `content` is required')
  }
  let abs: string
  try {
    abs = filePathFor(input.path)
  } catch (e) {
    return err(`create_file: ${(e as Error).message}`)
  }
  if (fs.existsSync(abs)) {
    return err(`create_file: file already exists: ${input.path}. Use write_file to overwrite.`)
  }
  try {
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, input.content, 'utf8')
  } catch (e) {
    return err(`create_file: ${(e as Error).message}`)
  }
  const stat = fs.statSync(abs)
  return ok(`created ${input.path} (${stat.size} bytes)`, {
    path: input.path,
    kind: 'write',
    newMtime: stat.mtimeMs,
    newRaw: input.content,
  })
}

function executeWriteFile(input: { path?: string; content?: string }): ToolResult {
  if (typeof input.path !== 'string' || input.path.length === 0) {
    return err('write_file: `path` is required')
  }
  if (typeof input.content !== 'string') {
    return err('write_file: `content` is required')
  }
  let abs: string
  try {
    abs = filePathFor(input.path)
  } catch (e) {
    return err(`write_file: ${(e as Error).message}`)
  }
  try {
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, input.content, 'utf8')
  } catch (e) {
    return err(`write_file: ${(e as Error).message}`)
  }
  const stat = fs.statSync(abs)
  return ok(`wrote ${input.path} (${stat.size} bytes)`, {
    path: input.path,
    kind: 'write',
    newMtime: stat.mtimeMs,
    newRaw: input.content,
  })
}

function executePatchFile(input: {
  path?: string
  old_string?: string
  new_string?: string
  replace_all?: boolean
}): ToolResult {
  if (typeof input.path !== 'string' || input.path.length === 0) {
    return err('patch_file: `path` is required')
  }
  if (typeof input.old_string !== 'string') {
    return err('patch_file: `old_string` is required')
  }
  if (typeof input.new_string !== 'string') {
    return err('patch_file: `new_string` is required')
  }
  if (input.old_string.length === 0) {
    return err('patch_file: `old_string` must be non-empty')
  }
  if (input.old_string === input.new_string) {
    return err('patch_file: `old_string` and `new_string` are identical; no change made')
  }
  const replaceAll = input.replace_all === true

  let bundle: ReturnType<typeof readPostIfExists>
  try {
    bundle = readPostIfExists(input.path)
  } catch (e) {
    return err(`patch_file: ${(e as Error).message}`)
  }
  if (bundle === null) {
    return err(`patch_file: file does not exist: ${input.path}`)
  }

  // Count matches. `String.split` returns N+1 parts for N matches.
  const parts = bundle.raw.split(input.old_string)
  const matchCount = parts.length - 1

  if (matchCount === 0) {
    return err(
      `patch_file: old_string not found in ${input.path}.\n` +
        `Current file content:\n\n` +
        truncate(bundle.raw, MAX_PATCH_ERROR_CHARS, `\n\n[... truncated; full file is ${bundle.raw.length} bytes ...]`),
    )
  }

  if (matchCount > 1 && !replaceAll) {
    const lines = bundle.raw.split('\n')
    // Find each match's start line by searching through the original
    // raw for `old_string` positions, mapping char offsets to line
    // numbers.
    const matches: { startLine: number; snippet: string }[] = []
    let cursor = 0
    for (let i = 0; i < lines.length && matches.length < matchCount; i++) {
      // Naive but fine for moderate files: find the offset of each
      // line in the running cursor, then search for old_string from
      // there.
      const lineText = lines[i]
      const searchFrom = cursor
      const idx = bundle.raw.indexOf(input.old_string, searchFrom)
      if (idx === -1) {
        cursor += lineText.length + 1
        continue
      }
      const startLine = bundle.raw.slice(0, idx).split('\n').length
      const snippetStart = Math.max(0, startLine - 1 - 1)
      const snippet = lines
        .slice(snippetStart, startLine - 1 + input.old_string.split('\n').length + 1)
        .slice(0, MAX_MATCH_SNIPPET_LINES * 2 + 1)
        .map((l, j) => `${snippetStart + j + 1}: ${l}`)
        .join('\n')
      matches.push({ startLine, snippet })
      cursor = idx + input.old_string.length
      // Skip past the just-found match
      lines[i] = '' // mark as consumed; cheaper than rebuilding
    }
    const formatted = matches
      .map((m, i) => `match ${i + 1} (line ${m.startLine}):\n${m.snippet}`)
      .join('\n\n')
    return err(
      `patch_file: old_string matches ${matchCount} times in ${input.path}. ` +
        `Pass replace_all=true or narrow the context. Matches:\n\n${formatted}`,
    )
  }

  const updated = replaceAll
    ? bundle.raw.split(input.old_string).join(input.new_string)
    : bundle.raw.replace(input.old_string, input.new_string)
  try {
    fs.writeFileSync(bundle.abs, updated, 'utf8')
  } catch (e) {
    return err(`patch_file: ${(e as Error).message}`)
  }
  const stat = fs.statSync(bundle.abs)
  return ok(
    `patched ${input.path} (${matchCount} replacement${matchCount === 1 ? '' : 's'})`,
    {
      path: input.path,
      kind: 'write',
      newMtime: stat.mtimeMs,
      newRaw: updated,
    },
  )
}

function executeDeleteFile(input: { path?: string }): ToolResult {
  if (typeof input.path !== 'string' || input.path.length === 0) {
    return err('delete_file: `path` is required')
  }
  let abs: string
  try {
    abs = filePathFor(input.path)
  } catch (e) {
    return err(`delete_file: ${(e as Error).message}`)
  }
  try {
    fs.unlinkSync(abs)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      return err(`delete_file: file does not exist: ${input.path}`)
    }
    return err(`delete_file: ${(e as Error).message}`)
  }
  return ok(`deleted ${input.path}`, {
    path: input.path,
    kind: 'delete',
  })
}

function executeRenameFile(input: { path?: string; new_path?: string }): ToolResult {
  if (typeof input.path !== 'string' || input.path.length === 0) {
    return err('rename_file: `path` is required')
  }
  if (typeof input.new_path !== 'string' || input.new_path.length === 0) {
    return err('rename_file: `new_path` is required')
  }
  if (input.path === input.new_path) {
    return err(`rename_file: source equals target: ${input.path}`)
  }
  let srcAbs: string
  let dstAbs: string
  try {
    srcAbs = filePathFor(input.path)
    dstAbs = filePathFor(input.new_path)
  } catch (e) {
    return err(`rename_file: ${(e as Error).message}`)
  }
  if (!fs.existsSync(srcAbs)) {
    return err(`rename_file: source does not exist: ${input.path}`)
  }
  if (fs.existsSync(dstAbs)) {
    return err(
      `rename_file: target already exists: ${input.new_path}. ` +
        `Use delete_file + create_file (or write_file) to overwrite.`,
    )
  }
  let raw: string
  try {
    fs.mkdirSync(path.dirname(dstAbs), { recursive: true })
    fs.renameSync(srcAbs, dstAbs)
    raw = fs.readFileSync(dstAbs, 'utf8')
  } catch (e) {
    return err(`rename_file: ${(e as Error).message}`)
  }
  const stat = fs.statSync(dstAbs)
  return ok(`renamed ${input.path} → ${input.new_path}`, {
    path: input.new_path,
    oldPath: input.path,
    kind: 'rename',
    newMtime: stat.mtimeMs,
    newRaw: raw,
  })
}

// ---- dispatcher ----

export async function executeToolCall(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (ctx.signal.aborted) {
    return err('aborted')
  }
  switch (name) {
    case 'read_file':
      return executeReadFile(input as { path?: string })
    case 'list_files':
      return executeListFiles(input as { scope?: string })
    case 'create_file':
      return executeCreateFile(input as { path?: string; content?: string })
    case 'write_file':
      return executeWriteFile(input as { path?: string; content?: string })
    case 'patch_file':
      return executePatchFile(
        input as {
          path?: string
          old_string?: string
          new_string?: string
          replace_all?: boolean
        },
      )
    case 'delete_file':
      return executeDeleteFile(input as { path?: string })
    case 'rename_file':
      return executeRenameFile(input as { path?: string; new_path?: string })
    default:
      return err(`unknown tool: ${name}`)
  }
}
