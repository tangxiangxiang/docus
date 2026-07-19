import { defineConfig, devices } from '@playwright/test'

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
    command: 'mkdir -p /tmp/docus-draft-e2e-vault/inbox /tmp/docus-draft-e2e-vault/archive /tmp/docus-draft-e2e-vault/literature && VAULT_DIR=/tmp/docus-draft-e2e-vault npm exec vite -- --host 127.0.0.1 --port 4175',
    url: 'http://127.0.0.1:4175/',
    reuseExistingServer: false,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
