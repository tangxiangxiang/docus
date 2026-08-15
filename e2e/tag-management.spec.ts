import { execFileSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { expect, test } from './fixtures/auth'
import type { Page } from '@playwright/test'
import {
  cleanupCreatedPaths,
  createDoc,
  waitForVaultReady,
} from './helpers/edit-program'

const E2E_VAULT = process.env.DOCUS_DRAFT_E2E_VAULT ?? path.join('src', 'content')

function gitSnapshot(): { head: string; status: string } {
  const options = { cwd: process.cwd(), encoding: 'utf8' as const }
  return {
    head: execFileSync('git', ['rev-parse', 'HEAD'], options).trim(),
    status: execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=no'], options).trim(),
  }
}

/** Mount the hidden dialog from a test-only Vite module using the app runtime. */
async function mountTagManagementHarness(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const harness = await import('/e2e/tag-management-harness.ts')
    harness.mountTagManagementHarness()
  })
}

async function unmountTagManagementHarness(page: Page): Promise<void> {
  await page.evaluate(() => {
    const harness = window.__t2TagManagementHarness
    harness?.app.unmount()
    harness?.host.remove()
    delete window.__t2TagManagementHarness
  })
}

test('authenticated Rename transport preserves Markdown and Git boundaries', async ({ page, request }) => {
  const slug = `inbox/e2e-tag-management-${Date.now()}`
  const createdPaths: string[] = []
  const filePath = path.join(E2E_VAULT, `${slug}.md`)
  const originalGit = gitSnapshot()

  try {
    await createDoc(request, slug, `# Tag management ${slug}\n\nStable Markdown bytes.\n`, createdPaths)
    const beforeDetail = await (await request.get(`/api/posts/${slug}`)).json() as {
      raw: string
      metadata: { updatedAt: number }
    }
    const metadataPatch = await request.patch(`/api/metadata/documents/${slug}`, {
      data: { tags: ['Java'], expectedUpdatedAt: beforeDetail.metadata.updatedAt },
    })
    expect(metadataPatch.status(), await metadataPatch.text()).toBe(200)

    const markdownBefore = await fs.readFile(filePath)
    const statBefore = await fs.stat(filePath)
    const managedBefore = await request.get('/api/tags')
    expect(managedBefore.status()).toBe(200)
    const java = (await managedBefore.json() as Array<{ id: number; displayName: string }>).find((tag) => tag.displayName === 'Java')
    expect(java?.id).toBeGreaterThan(0)

    // The production Manage Tags trigger is intentionally absent through
    // T2-3. Mount the existing dialog directly in this test-scoped harness;
    // no production entry or feature flag is shipped.
    await page.goto('/vault')
    await waitForVaultReady(page)
    await mountTagManagementHarness(page)
    const dialog = page.getByRole('dialog')
    await expect(dialog).toHaveAttribute('data-state', 'ready')
    await dialog.locator('#tag-management-source').selectOption(String(java!.id))
    await dialog.locator('#tag-management-destination').fill('Backend')
    const previewResponsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url())
      return response.request().method() === 'POST'
        && url.pathname === '/api/tags/operations/preview'
    })
    await dialog.locator('form button[type="submit"]').click()
    const previewResponse = await previewResponsePromise
    expect(previewResponse.status()).toBe(200)
    const preview = await previewResponse.json() as {
      allowedToApply: boolean
      affectedCount: number
      sample: Array<unknown>
      tagCreates: number
      planFingerprint: string
    }
    expect(preview).toMatchObject({ allowedToApply: true, affectedCount: 1, tagCreates: 0 })
    expect(preview.sample).toHaveLength(1)
    expect(preview.planFingerprint).toMatch(/^[0-9a-f]{64}$/)
    await expect(dialog).toHaveAttribute('data-state', 'preview-ready')
    await expect(dialog.locator('.tag-management-summary')).toContainText('1')
    await expect(dialog.locator('.tag-management-sample')).toContainText(slug)
    await expect(dialog.locator('.tag-management-summary')).toContainText('0')
    const applyResponsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url())
      return response.request().method() === 'POST'
        && url.pathname === '/api/tags/operations/apply'
    })
    await dialog.locator('.tag-management-preview .primary').click()
    const applyResponse = await applyResponsePromise
    expect(applyResponse.status()).toBe(200)
    const applied = await applyResponse.json() as {
      sourceTagId: number
      survivorTagId: number
      sourceDeleted: boolean
      tagCreates: number
      appliedFingerprint: string
    }
    expect(applied).toMatchObject({
      sourceTagId: java!.id,
      survivorTagId: java!.id,
      sourceDeleted: false,
      tagCreates: 0,
      appliedFingerprint: preview.planFingerprint,
    })
    await expect(dialog).toHaveAttribute('data-state', 'success')
    await expect(dialog.locator('.tag-management-state-success')).toHaveAttribute('data-selected-tag', 'Backend')

    const managedAfter = await request.get('/api/tags')
    const backend = (await managedAfter.json() as Array<{ id: number; displayName: string }>).find((tag) => tag.displayName === 'Backend')
    expect(backend).toMatchObject({ id: java!.id, displayName: 'Backend' })

    expect(await fs.readFile(filePath)).toEqual(markdownBefore)
    expect((await fs.stat(filePath)).mtimeMs).toBe(statBefore.mtimeMs)
    expect(gitSnapshot()).toEqual(originalGit)

    await unmountTagManagementHarness(page)
    await page.goto('/vault')
    await waitForVaultReady(page)
    await page.locator('.activity-bar .ab-btn').nth(1).click()
    await expect(page.locator('.tag-entry')).toContainText('Backend')
    await expect(page.locator('.tag-entry')).not.toContainText('Java')
    await expect(page.getByRole('button', { name: /manage tags/i })).toHaveCount(0)
  } finally {
    await cleanupCreatedPaths(request, createdPaths)
  }
})
