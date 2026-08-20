import { promises as fs } from 'node:fs'
import type { APIRequestContext, Download, Page } from '@playwright/test'
import { expect, test } from './fixtures/auth'

const slug = 'inbox/pdf-export-read-mode-e2e'

type ReadModePdfSnapshot = {
  surfaceCount: number
  rootCount: number
  hostCount: number
  textContent: string
}

type ReadModePdfWindow = Window & {
  __readModePdfSnapshot: ReadModePdfSnapshot | null
  __readModePdfPrintCalled: boolean
}

const raw = `---
title: Read Mode PDF Export
---

# Read Mode PDF Export

H8_READ_MODE_BEGIN

中文 English 日本語

A short paragraph proves that the Read Mode action uses the shared PDF transaction and captures the rendered document rather than the visible toolbar.

\`\`\`text
H8_READ_MODE_CODE
\`\`\`

H8_READ_MODE_END
`

async function seedDocument(request: APIRequestContext): Promise<void> {
  await request.delete(`/api/posts/${slug}`).catch(() => {})
  const created = await request.post('/api/posts', {
    data: { path: slug, title: 'Read Mode PDF Export' },
  })
  expect(created.status(), await created.text()).toBe(201)
  const initial = await (await request.get(`/api/posts/${slug}`)).json() as { raw: string }
  const updated = await request.put(`/api/posts/${slug}`, {
    data: { baseRaw: initial.raw, raw },
  })
  expect(updated.ok(), await updated.text()).toBe(true)
}

async function installObserver(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const win = window as ReadModePdfWindow
    win.__readModePdfSnapshot = null
    win.__readModePdfPrintCalled = false
    window.print = () => { win.__readModePdfPrintCalled = true }

    function capture(): void {
      if (win.__readModePdfSnapshot) return
      const root = document.querySelector<HTMLElement>('.pdf-download-root')
      const article = root?.querySelector<HTMLElement>('.article')
      if (!root || !article) return
      const textContent = article.textContent ?? ''
      if (!textContent.includes('H8_READ_MODE_BEGIN') || !textContent.includes('H8_READ_MODE_END')) return
      win.__readModePdfSnapshot = {
        surfaceCount: document.querySelectorAll('.pdf-export-surface').length,
        rootCount: document.querySelectorAll('.pdf-download-root').length,
        hostCount: document.querySelectorAll('.pdf-download-host').length,
        textContent,
      }
    }

    const observer = new MutationObserver(capture)
    observer.observe(document, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style'],
    })
    capture()
  })
}

test('exports the active document from the real Read Mode action', async ({ page, request }, testInfo) => {
  try {
    await seedDocument(request)
    await installObserver(page)
    await page.goto('/vault')

    const inbox = page.locator('.tree-row[data-tree-kind="folder"][data-tree-path="inbox"]')
    await inbox.locator('.chevron').click()
    const row = page.locator(`.tree-row[data-tree-kind="file"][data-tree-path="${slug}"]`)
    await expect(row).toBeVisible()
    await row.click()

    const viewToggle = page.getByTestId('view-toggle')
    await expect(viewToggle).toHaveAttribute('aria-label', /Switch to read|切换到阅读模式/)
    await viewToggle.click()
    await expect(viewToggle).toHaveAttribute('aria-label', /Switch to edit|切换到编辑模式/)

    const exportButton = page.getByTestId('reading-export-pdf')
    await expect(exportButton).toBeVisible()
    await expect(exportButton).toHaveAccessibleName(/Export PDF|导出 PDF/)
    await expect(exportButton).toBeEnabled()

    const downloadPromise = page.waitForEvent('download')
    const snapshotPromise = page
      .waitForFunction(() => (
        (window as ReadModePdfWindow).__readModePdfSnapshot !== null
      ))
      .then(() => page.evaluate(() => (
        (window as ReadModePdfWindow).__readModePdfSnapshot
      )))

    await exportButton.click()
    const [download, snapshot] = await Promise.all([
      downloadPromise,
      snapshotPromise,
    ]) as [Download, ReadModePdfSnapshot | null]

    expect(snapshot).not.toBeNull()
    if (!snapshot) throw new Error('Read Mode PDF snapshot was not captured')
    expect(snapshot.surfaceCount).toBe(1)
    expect(snapshot.rootCount).toBe(1)
    expect(snapshot.hostCount).toBe(1)
    expect(snapshot.textContent).toContain('H8_READ_MODE_BEGIN')
    expect(snapshot.textContent).toContain('H8_READ_MODE_CODE')
    expect(snapshot.textContent).toContain('H8_READ_MODE_END')

    const outputPath = testInfo.outputPath('read-mode-export.pdf')
    await download.saveAs(outputPath)
    expect(download.suggestedFilename()).toBe('Read Mode PDF Export.pdf')
    expect((await fs.stat(outputPath)).size).toBeGreaterThan(1_000)
    expect(await page.evaluate(() => (window as ReadModePdfWindow).__readModePdfPrintCalled)).toBe(false)

    await expect(exportButton).toBeEnabled()
    await expect(page.locator('.pdf-export-surface')).toHaveCount(0)
    await expect(page.locator('.pdf-download-root')).toHaveCount(0)
    await expect(page.locator('.pdf-download-host')).toHaveCount(0)
  } finally {
    await request.delete(`/api/posts/${slug}`).catch(() => {})
  }
})
