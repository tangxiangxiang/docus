import { expect, test } from '@playwright/test'
import { instantFromLocalDateTime } from '../src/features/ledger/time'

const browserTimezones = ['UTC', 'America/Los_Angeles', 'Asia/Shanghai', 'Pacific/Kiritimati']
const ledgerTimezone = 'America/New_York'

async function assertTemporalBridge(page: import('@playwright/test').Page, value: string, roundTrip: string): Promise<void> {
  await expect(page.getByTestId('ledger-temporal-date').locator('input')).toHaveValue(value.slice(0, 10))
  await expect(page.getByTestId('ledger-temporal-time').locator('input')).toHaveValue(value.slice(11))
  await expect(page.getByTestId('ledger-temporal-model')).toHaveText(value)

  await page.getByTestId('ledger-temporal-validate').click()
  await expect(page.getByTestId('ledger-temporal-instant')).toHaveText(String(instantFromLocalDateTime(value, ledgerTimezone)))
  await expect(page.getByTestId('ledger-temporal-roundtrip')).toHaveText(roundTrip)
}

test('Ledger wall-clock controls stay stable across browser timezone contexts', async ({ browser }) => {
  for (const browserTimezone of browserTimezones) {
    const context = await browser.newContext({ timezoneId: browserTimezone, viewport: { width: 900, height: 700 } })
    const page = await context.newPage()
    await page.goto(`/e2e/ledger-temporal/?timezone=${encodeURIComponent(ledgerTimezone)}&value=2026-03-08T02:30`)
    await assertTemporalBridge(page, '2026-03-08T02:30', '2026-03-08T03:30')
    await context.close()
  }
})

test('Ledger browser bridge preserves DST gap and overlap semantics', async ({ browser }) => {
  const context = await browser.newContext({ timezoneId: 'Asia/Shanghai', viewport: { width: 900, height: 700 } })
  const page = await context.newPage()

  await page.goto(`/e2e/ledger-temporal/?timezone=${encodeURIComponent(ledgerTimezone)}&value=2026-03-08T02:30`)
  await assertTemporalBridge(page, '2026-03-08T02:30', '2026-03-08T03:30')

  await page.goto(`/e2e/ledger-temporal/?timezone=${encodeURIComponent(ledgerTimezone)}&value=2026-11-01T01:30`)
  await assertTemporalBridge(page, '2026-11-01T01:30', '2026-11-01T01:30')

  await context.close()
})
