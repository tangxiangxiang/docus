import { expect, test, type APIRequestContext } from './fixtures/auth'
import type { Page } from '@playwright/test'

type LedgerTransaction = {
  id: string
  type: string
  amountMinor: number
  deletedAt: number | null
}

type LedgerTransactionPage = {
  transactions: LedgerTransaction[]
  page: { nextCursor: string | null }
}

type LedgerAccount = {
  id: string
  name: string
  currentBalanceMinor: number
  archivedAt: number | null
}

async function getTransactions(request: APIRequestContext): Promise<LedgerTransactionPage> {
  const response = await request.get('/api/ledger/transactions?limit=100&includeDeleted=true')
  expect(response.status()).toBe(200)
  return await response.json() as LedgerTransactionPage
}

async function getAccounts(request: APIRequestContext): Promise<LedgerAccount[]> {
  const response = await request.get('/api/ledger/accounts?includeArchived=true')
  expect(response.status()).toBe(200)
  return await response.json() as LedgerAccount[]
}

async function selectOptionContaining(page: Page, selector: string, text: string): Promise<string> {
  const option = page.locator(`${selector} option`).filter({ hasText: text }).first()
  await expect(option).toHaveCount(1)
  const value = await option.getAttribute('value')
  expect(value).toBeTruthy()
  await page.locator(selector).selectOption(value as string)
  return value as string
}

test('real Ledger onboarding and expense survive dashboard refresh', async ({ page, request }) => {
  await page.goto('/ledger')

  await expect(page.getByTestId('ledger-settings-form')).toBeVisible()
  await page.locator('#ledger-base-currency').selectOption('CNY')
  await page.locator('#ledger-timezone').fill('Asia/Shanghai')
  await page.getByRole('button', { name: '保存设置并继续' }).click()

  await expect(page.getByTestId('ledger-account-form')).toBeVisible()
  await page.locator('#ledger-account-name').fill('招商银行')
  await page.locator('#ledger-account-opening-balance').fill('10000')
  await expect(page.locator('#ledger-account-currency')).toHaveValue('CNY')
  await page.getByRole('button', { name: '创建账户并继续' }).click()

  await expect(page.getByTestId('ledger-dashboard')).toBeVisible()
  await expect(page.getByTestId('ledger-dashboard-accounts')).toContainText('招商银行')
  await expect(page.getByTestId('ledger-total-assets')).toContainText('¥10,000.00')
  await expect(page.getByTestId('ledger-net-worth')).toContainText('¥10,000.00')

  await page.getByTestId('ledger-record-button').click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.locator('#ledger-transaction-amount').fill('38')
  await selectOptionContaining(page, '#ledger-transaction-account', '招商银行')
  await selectOptionContaining(page, '#ledger-transaction-category', '餐饮')
  await page.getByRole('button', { name: '保存交易' }).click()

  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(page.getByTestId('ledger-recent-transactions')).toContainText('餐饮')
  await expect(page.getByTestId('ledger-recent-transactions')).toContainText('-¥38.00')
  await expect(page.getByTestId('ledger-total-assets')).toContainText('¥9,962.00')
  await expect(page.getByTestId('ledger-net-worth')).toContainText('¥9,962.00')
  for (const period of ['today', 'week', 'month', 'year']) {
    await expect(page.getByTestId(`ledger-period-${period}`)).toContainText('¥38.00')
  }

  const pageAfterCreate = await getTransactions(request)
  expect(pageAfterCreate.transactions).toHaveLength(1)
  expect(pageAfterCreate.transactions[0]).toMatchObject({ type: 'expense', amountMinor: 3800, deletedAt: null })

  await page.reload()
  await expect(page.getByTestId('ledger-dashboard')).toBeVisible()
  await expect(page.getByTestId('ledger-total-assets')).toContainText('¥9,962.00')
  await expect(page.getByTestId('ledger-net-worth')).toContainText('¥9,962.00')
  await expect(page.getByTestId('ledger-recent-transactions')).toContainText('¥38.00')
  await expect(page.locator('body')).not.toContainText('billsMockData')
})

test('response loss recovers one real transaction with the original intent key', async ({ page, request }) => {
  await page.goto('/ledger')
  await expect(page.getByTestId('ledger-dashboard')).toBeVisible()

  const before = await getTransactions(request)
  const accountsBefore = await getAccounts(request)
  const account = accountsBefore.find((candidate) => candidate.archivedAt === null)
  expect(account).toBeTruthy()

  let shouldDropResponse = true
  let droppedKey = ''
  let droppedPayload = ''
  await page.route('**/api/ledger/transactions', async (route) => {
    const intercepted = route.request()
    if (intercepted.method() !== 'POST' || !shouldDropResponse) {
      await route.continue()
      return
    }
    shouldDropResponse = false
    droppedKey = intercepted.headers()['idempotency-key'] ?? ''
    droppedPayload = intercepted.postData() ?? ''
    const response = await route.fetch()
    await response.body()
    await route.abort('connectionreset')
  })

  await page.getByTestId('ledger-record-button').click()
  await page.locator('#ledger-transaction-amount').fill('12')
  await selectOptionContaining(page, '#ledger-transaction-account', account!.name)
  await selectOptionContaining(page, '#ledger-transaction-category', '餐饮')
  await page.getByRole('button', { name: '保存交易' }).click()

  await expect(page.getByTestId('ledger-recovery')).toBeVisible()
  expect(droppedKey).not.toBe('')
  expect(droppedPayload).toContain('"amountMinor":1200')
  const pendingBeforeReload = await page.evaluate(() => sessionStorage.getItem('docus.ledger.pending-create'))
  expect(pendingBeforeReload).toContain(droppedKey)

  await page.reload()
  await expect(page.getByTestId('ledger-recovery')).toBeVisible()
  await expect(page.getByText('上一次交易保存结果未知')).toBeVisible()
  await page.getByRole('button', { name: '用同一内容重试' }).click()

  await expect(page.getByTestId('ledger-dashboard')).toBeVisible()
  await expect(page.getByTestId('ledger-recovery')).toBeHidden()
  await expect.poll(async () => (await getTransactions(request)).transactions.length).toBe(before.transactions.length + 1)

  const after = await getTransactions(request)
  const created = after.transactions.filter((transaction) => transaction.amountMinor === 1200 && transaction.type === 'expense')
  expect(created).toHaveLength(1)
  expect(await page.evaluate(() => sessionStorage.getItem('docus.ledger.pending-create'))).toBeNull()

})

test('Ledger transaction entry remains keyboard-usable in a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 844 })
  await page.goto('/ledger')
  await expect(page.getByTestId('ledger-dashboard')).toBeVisible()

  const recordButton = page.getByTestId('ledger-record-button')
  await recordButton.focus()
  await expect(recordButton).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.locator('#ledger-transaction-amount')).toBeFocused()

  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toBeHidden()
})
