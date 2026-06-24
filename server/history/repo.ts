// Initialize the vault as a git repository the first time the history
// feature is touched. Idempotent: if `.git` already exists, this is a
// no-op. Writes `.gitignore` and `.gitattributes` next to `.git`.
//
// Where the files live:
//   repoRoot = the vault root (the directory the user pointed docus at).
//   For docus this is `process.cwd()` in dev and the cwd at server
//   start in prod. `git.ts` takes this as a parameter; the routes
//   resolve it once and pass it down so the call site can override
//   for tests.
//
// What goes in .gitignore:
//   - data/    : docus's own runtime (sqlite, caches) — must NOT be
//                versioned, otherwise two machines racing on the same
//                vault will get merge conflicts on every save.
//   - node_modules/, dist/, .vite/ : standard build artifacts.
//   - .DS_Store, Thumbs.db, desktop.ini : OS junk.
//   - *.log     : log files leak private paths and tend to churn.
//
// What goes in .gitattributes:
//   `* text=auto eol=lf` — make LF canonical regardless of OS, so
//   diffs aren't 100% `\ No newline at end of file` noise. Paired with
//   the `core.autocrlf=false` git config in initRepo().

import { promises as fs } from 'node:fs'
import path from 'node:path'
import * as git from './git.js'

const GITIGNORE_LINES = [
  '# docus runtime',
  'data/',
  '',
  '# Node / build',
  'node_modules/',
  'dist/',
  '.vite/',
  '.cache/',
  '',
  '# OS',
  '.DS_Store',
  'Thumbs.db',
  'desktop.ini',
  '',
  '# Editor',
  '.vscode/',
  '.idea/',
  '',
  '# Logs',
  '*.log',
  '',
]

const GITATTRIBUTES = ''
// Intentionally empty. We rely on `core.autocrlf=false` (set in
// initRepo) for byte-stable storage. Pinning `* text=auto` in
// .gitattributes overrides autocrlf on Windows machines and
// silently strips \r from CRLF files during checkout, breaking
// the round-trip property tested in history-git.test.ts. If we
// ever need to mark specific files as binary, we add explicit
// lines here.

/**
 * Idempotent repo initialization. Steps:
 *   1. If already a git repo, do nothing.
 *   2. Otherwise: ensure `.gitignore` and `.gitattributes` exist
 *      (create if missing, leave existing content alone — the user
 *      may have customized them), then `git init`.
 *
 * The order matters: write the dotfiles first so the very first
 * commit the user makes doesn't accidentally stage the OS junk we
 * were trying to ignore.
 */
export async function ensureRepo(repoRoot: string): Promise<void> {
  if (await git.isRepo(repoRoot)) return
  await writeIfMissing(path.join(repoRoot, '.gitignore'), GITIGNORE_LINES.join('\n'))
  await writeIfMissing(path.join(repoRoot, '.gitattributes'), GITATTRIBUTES)
  await git.initRepo(repoRoot)
}

async function writeIfMissing(p: string, content: string): Promise<void> {
  try {
    await fs.access(p)
  } catch {
    await fs.writeFile(p, content, 'utf8')
  }
}
