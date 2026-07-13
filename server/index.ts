import { Hono } from 'hono'
import aiRoutes from './ai/routes.js'
import historyRoutes from './history/routes.js'
import folderRoutes from './routes/folders.js'
import healthRoutes from './routes/health.js'
import linkRoutes from './routes/links.js'
import metadataRoutes from './routes/metadata.js'
import postRoutes from './routes/posts.js'
import { __setMetadataDbForTesting } from './routes/shared.js'
import vaultRoutes from './routes/vault.js'

const app = new Hono()

export { __setMetadataDbForTesting }

app.route('/', healthRoutes)
app.route('/', metadataRoutes)
app.route('/', folderRoutes)
app.route('/', postRoutes)
app.route('/', vaultRoutes)
app.route('/', linkRoutes)
app.route('/api/ai', aiRoutes)
app.route('/api/history', historyRoutes)

export default app
