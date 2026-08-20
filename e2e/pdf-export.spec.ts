import { promises as fs } from 'node:fs'
import { expect, test } from './fixtures/auth'

const slug = 'inbox/pdf-export-e2e'

test('downloads a rendered PDF from the file-tree menu without printing', async ({ page, request }, testInfo) => {
  const kitchenSinkRaw = await fs.readFile(new URL('./fixtures/pdf-export-kitchen-sink.md', import.meta.url), 'utf8')
  await request.delete(`/api/posts/${slug}`).catch(() => {})
  const created = await request.post('/api/posts', {
    data: { path: slug, title: 'PDF Export E2E' },
  })
  expect(created.status()).toBe(201)
  const initial = await (await request.get(`/api/posts/${slug}`)).json() as { raw: string }
  const updated = await request.put(`/api/posts/${slug}`, {
    data: {
      baseRaw: initial.raw,
      raw: kitchenSinkRaw,
    },
  })
  expect(updated.ok()).toBe(true)

  await page.addInitScript(() => {
    Object.defineProperty(window, '__pdfPrintCalled', { value: false, writable: true })
    window.print = () => {
      ;(window as typeof window & { __pdfPrintCalled: boolean }).__pdfPrintCalled = true
    }
  })
  await page.addInitScript(() => {
    const readiness = { mermaid: false, markmap: false }
    Object.defineProperty(window, '__pdfWidgetReadiness', { value: readiness, writable: false })
    const check = () => {
      const surface = document.querySelector('.pdf-export-surface')
      const mermaid = surface?.querySelector<HTMLElement>('.mermaid-widget')
      const markmap = surface?.querySelector<HTMLElement>('.markmap-widget')
      if (mermaid?.dataset.mermaidReady === 'true') readiness.mermaid = true
      if (markmap?.dataset.markmapReady === 'true') readiness.markmap = true
    }
    const observer = new MutationObserver(check)
    observer.observe(document, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-mermaid-ready', 'data-markmap-ready'],
    })
    check()
  })
  await page.goto('/vault')

  const inbox = page.locator('.tree-row[data-tree-kind="folder"][data-tree-path="inbox"]')
  await inbox.locator('.chevron').click()
  const row = page.locator(`.tree-row[data-tree-kind="file"][data-tree-path="${slug}"]`)
  await expect(row).toBeVisible()
  await row.click({ button: 'right' })

  const downloadPromise = page.waitForEvent('download')
  const readyPromise = page.waitForFunction(() => {
    const readiness = (window as typeof window & {
      __pdfWidgetReadiness?: { mermaid: boolean; markmap: boolean }
    }).__pdfWidgetReadiness
    return readiness?.mermaid === true && readiness.markmap === true
  })
  const clickPromise = page.locator('.tree-context-menu button').filter({ hasText: /Export PDF|导出 PDF/ }).click()
  const [, , download] = await Promise.all([
    readyPromise.then(() => undefined),
    clickPromise.then(() => undefined),
    downloadPromise,
  ])
  const outputPath = testInfo.outputPath('file-tree-export.pdf')
  await download.saveAs(outputPath)

  expect(download.suggestedFilename()).toBe('PDF Export Kitchen Sink.pdf')
  expect((await fs.stat(outputPath)).size).toBeGreaterThan(10_000)
  expect(await page.evaluate(() => (
    window as typeof window & { __pdfPrintCalled?: boolean }
  ).__pdfPrintCalled)).toBe(false)
})
