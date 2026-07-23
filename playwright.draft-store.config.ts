import { defineConfig, devices } from '@playwright/test'
import os from 'node:os'
import path from 'node:path'

process.env.DOCUS_DRAFT_E2E_VAULT ??= path.join(os.tmpdir(), 'docus-draft-e2e-vault')

export default defineConfig({
  testDir: './e2e',
  testMatch: ['draft-store.spec.ts', 'draft-file-transactions.spec.ts'],
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:4175',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node scripts/start-draft-e2e.mjs',
    url: 'http://127.0.0.1:4175/',
    reuseExistingServer: false,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
