import { createHash } from 'node:crypto'
import { Hono } from 'hono'
import { CONTENT_DIR } from '../paths.js'

// Vault identity. Used by the client to scope per-vault persistent
// state (tabs, expanded paths, layout). Hashes the absolute content
// dir, so different vault roots in the same browser do not share
// localStorage keys. The hash is short enough to fit in a key and is
// returned via /api/health so the client can fetch it once at mount.
const VAULT_ID = createHash('sha256').update(CONTENT_DIR).digest('hex').slice(0, 12)

const healthRoutes = new Hono()

healthRoutes.get('/api/health', (c) => c.json({ ok: true, vaultId: VAULT_ID }))

export default healthRoutes
