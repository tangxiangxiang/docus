import { promises as fs } from 'node:fs'
import { expect, test } from './fixtures/auth'

const slug = 'inbox/pdf-export-e2e'

test('downloads a rendered PDF from the file-tree menu without printing', async ({ page, request }, testInfo) => {
  await request.delete(`/api/posts/${slug}`).catch(() => {})
  const created = await request.post('/api/posts', {
    data: { path: slug, title: 'PDF Export E2E' },
  })
  expect(created.status()).toBe(201)
  const initial = await (await request.get(`/api/posts/${slug}`)).json() as { raw: string }
  const updated = await request.put(`/api/posts/${slug}`, {
    data: {
      baseRaw: initial.raw,
      raw: `# PDF Export E2E

Visible paragraph for the exported document.

\`\`\`mermaid
flowchart LR
  A[Apply] --> B[Review] --> C[Approve]
\`\`\`
`,
    },
  })
  expect(updated.ok()).toBe(true)

  await page.addInitScript(() => {
    Object.defineProperty(window, '__pdfPrintCalled', { value: false, writable: true })
    window.print = () => {
      ;(window as typeof window & { __pdfPrintCalled: boolean }).__pdfPrintCalled = true
    }
  })
  await page.goto('/vault')

  const inbox = page.locator('.tree-row[data-tree-kind="folder"][data-tree-path="inbox"]')
  await inbox.locator('.chevron').click()
  const row = page.locator(`.tree-row[data-tree-kind="file"][data-tree-path="${slug}"]`)
  await expect(row).toBeVisible()
  await row.click({ button: 'right' })

  const downloadPromise = page.waitForEvent('download')
  await page.locator('.tree-context-menu button').filter({ hasText: /Export PDF|导出 PDF/ }).click()
  const download = await downloadPromise
  const outputPath = testInfo.outputPath('file-tree-export.pdf')
  await download.saveAs(outputPath)

  expect(download.suggestedFilename()).toBe('PDF Export E2E.pdf')
  expect((await fs.stat(outputPath)).size).toBeGreaterThan(10_000)
  expect(await page.evaluate(() => (
    window as typeof window & { __pdfPrintCalled?: boolean }
  ).__pdfPrintCalled)).toBe(false)
})
