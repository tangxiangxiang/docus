import { promises as fs } from 'node:fs'
import { spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

const vault = process.env.DOCUS_DRAFT_E2E_VAULT ?? path.join(os.tmpdir(), 'docus-draft-e2e-vault')
const port = process.argv[2] ?? '4175'
await fs.rm(vault, { recursive: true, force: true })
for (const folder of ['inbox', 'archive', 'literature']) {
  await fs.mkdir(path.join(vault, folder), { recursive: true })
}

const child = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', port], {
  env: { ...process.env, VAULT_DIR: vault },
  stdio: 'inherit',
})
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal))
}
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 1)
})
