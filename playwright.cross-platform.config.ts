import { defineConfig, devices } from '@playwright/test'
import os from 'node:os'
import path from 'node:path'

process.env.DOCUS_DRAFT_E2E_VAULT ??= path.join(os.tmpdir(), 'docus-draft-e2e-vault')

export default defineConfig({
  testDir: './e2e',
  testIgnore: [
    'draft-store.spec.ts',
    'draft-file-transactions.spec.ts',
    // Pixel baselines are verified in the dedicated macOS visual job.
    'markdown-visual.spec.ts',
  ],
  fullyParallel: false,
  // These integration flows mutate one shared Vault and browser-side
  // persistence. File-level Playwright workers would make otherwise
  // independent specs race through the same server generation.
  workers: 1,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:4174',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `"${process.execPath}" scripts/start-draft-e2e.mjs 4174`,
    url: 'http://127.0.0.1:4174/__markdown-test?mode=reading',
    reuseExistingServer: false,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
