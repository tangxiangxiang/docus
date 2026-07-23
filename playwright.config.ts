import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  // IndexedDB transaction suites use a single dedicated Vite origin/config so
  // they cannot race the visual/view-mode workers over database lifecycle.
  testIgnore: ['draft-store.spec.ts', 'draft-file-transactions.spec.ts'],
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:4174',
    trace: 'retain-on-failure',
  },
  webServer: {
    // `npm exec` resolves vite from the local node_modules/.bin under BOTH
    // npm- and pnpm-managed layouts; `pnpm exec` re-installs per
    // pnpm-lock.yaml on an npm-managed tree, re-laying node_modules out
    // mid-run so the Playwright CLI and the collected specs resolve two
    // distinct physical @playwright/test instances ("did not expect test()
    // to be called here"). Matches the draft-store config's npm exec.
    command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4174',
    url: 'http://127.0.0.1:4174/__markdown-test?mode=reading',
    reuseExistingServer: true,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
