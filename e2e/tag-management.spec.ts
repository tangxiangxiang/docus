import { execFileSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { expect, test } from './fixtures/auth'
import type { APIRequestContext, Page } from '@playwright/test'
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

type PostDetailForTags = {
  raw: string
  metadata: {
    id: string
    tags: string[]
    updatedAt: number
  }
}

async function readPostDetail(pageRequest: APIRequestContext, slug: string): Promise<PostDetailForTags> {
  const response = await pageRequest.get(`/api/posts/${slug}`)
  expect(response.status(), await response.text()).toBe(200)
  return await response.json() as PostDetailForTags
}

async function setDocumentTags(
  pageRequest: APIRequestContext,
  slug: string,
  tags: string[],
): Promise<PostDetailForTags> {
  const before = await readPostDetail(pageRequest, slug)
  const response = await pageRequest.patch(`/api/metadata/documents/${slug}`, {
    data: { tags, expectedUpdatedAt: before.metadata.updatedAt },
  })
  expect(response.status(), await response.text()).toBe(200)
  return readPostDetail(pageRequest, slug)
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

test('authenticated Merge preserves the destination identity, deduplicates overlap, and keeps file boundaries', async ({ page, request }) => {
  const stamp = Date.now()
  const sourceName = `rabbit-${stamp}`
  const destinationName = `pets-${stamp}`
  const raceSourceName = `rabbit-race-${stamp}`
  const raceDestinationName = `pets-race-${stamp}`
  const otherName = `work-${stamp}`
  const fixtures = [
    { slug: `inbox/t2-4-merge-source-${stamp}`, tags: [sourceName], body: 'Document A: source only.\n' },
    { slug: `inbox/t2-4-merge-destination-${stamp}`, tags: [destinationName], body: 'Document B: destination only.\n' },
    { slug: `inbox/t2-4-merge-overlap-${stamp}`, tags: [sourceName, destinationName], body: 'Document C: source and destination overlap.\n' },
    { slug: `inbox/t2-4-merge-race-source-${stamp}`, tags: [raceSourceName], body: 'Race source.\n' },
    { slug: `inbox/t2-4-merge-race-destination-${stamp}`, tags: [raceDestinationName], body: 'Race destination.\n' },
    { slug: `inbox/t2-4-merge-other-${stamp}`, tags: [otherName], body: 'User selection target.\n' },
  ]
  const createdPaths: string[] = []
  const originalGit = gitSnapshot()
  const fileSnapshots = new Map<string, { bytes: Buffer; mtimeMs: number }>()
  const versionBefore = new Map<string, number>()

  try {
    for (const fixture of fixtures) {
      await createDoc(request, fixture.slug, `# ${fixture.slug}\n\n${fixture.body}`, createdPaths)
      const saved = await setDocumentTags(request, fixture.slug, fixture.tags)
      versionBefore.set(fixture.slug, saved.metadata.updatedAt)
      const filePath = path.join(E2E_VAULT, `${fixture.slug}.md`)
      fileSnapshots.set(fixture.slug, {
        bytes: await fs.readFile(filePath),
        mtimeMs: (await fs.stat(filePath)).mtimeMs,
      })
    }

    const managedBeforeResponse = await request.get('/api/tags')
    expect(managedBeforeResponse.status()).toBe(200)
    const managedBefore = await managedBeforeResponse.json() as Array<{
      id: number
      normalizedName: string
      displayName: string
    }>
    const source = managedBefore.find((tag) => tag.displayName === sourceName)
    const destination = managedBefore.find((tag) => tag.displayName === destinationName)
    const raceSource = managedBefore.find((tag) => tag.displayName === raceSourceName)
    const raceDestination = managedBefore.find((tag) => tag.displayName === raceDestinationName)
    expect(source?.id).toBeGreaterThan(0)
    expect(destination?.id).toBeGreaterThan(0)
    expect(raceSource?.id).toBeGreaterThan(0)
    expect(raceDestination?.id).toBeGreaterThan(0)

    await page.goto('/vault')
    await waitForVaultReady(page)
    await mountTagManagementHarness(page)
    const dialog = page.getByRole('dialog')
    await expect(dialog).toHaveAttribute('data-state', 'ready')
    await page.evaluate((tag) => window.__t2TagManagementHarness?.setSelectedTag(tag), sourceName)
    await dialog.locator('[data-operation="merge"]').click()
    await dialog.locator('#tag-management-source').selectOption(String(source!.id))

    const destinationValues = await dialog.locator('#tag-management-destination option').evaluateAll((options) => (
      options.map((option) => (option as HTMLOptionElement).value)
    ))
    expect(destinationValues).not.toContain(String(source!.id))
    await dialog.locator('#tag-management-destination-search').fill(destinationName)
    await dialog.locator('#tag-management-destination').selectOption(String(destination!.id))
    await expect(dialog.locator('.tag-management-preview .primary')).toHaveCount(0)

    const previewResponsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url())
      return response.request().method() === 'POST'
        && url.pathname === '/api/tags/operations/preview'
    })
    await dialog.locator('form button[type="submit"]').click()
    const previewResponse = await previewResponsePromise
    expect(previewResponse.status()).toBe(200)
    const preview = await previewResponse.json() as {
      operation: { kind: string; sourceTagId: number; destinationTagId: number }
      destinationTag: { id: number; displayName: string }
      affectedCount: number
      associationAdds: number
      associationRemoves: number
      duplicateCollapses: number
      tagCreates: number
      tagDeletes: number
      sample: Array<unknown>
      planFingerprint: string
    }
    expect(preview).toMatchObject({
      operation: { kind: 'merge', sourceTagId: source!.id, destinationTagId: destination!.id },
      destinationTag: { id: destination!.id, displayName: destinationName },
      affectedCount: 2,
      associationAdds: 1,
      associationRemoves: 2,
      duplicateCollapses: 1,
      tagCreates: 0,
      tagDeletes: 1,
    })
    expect(preview.sample).toHaveLength(2)
    expect(preview.planFingerprint).toMatch(/^[0-9a-f]{64}$/)
    await expect(dialog).toHaveAttribute('data-state', 'preview-ready')
    await expect(dialog).toContainText('The destination tag will survive')
    await expect(dialog).toContainText('will be deleted')
    await expect(dialog).toContainText('Source-only documents receive the destination tag')
    await expect(dialog.locator('.tag-management-summary')).toContainText('1')

    const applyResponsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url())
      return response.request().method() === 'POST'
        && url.pathname === '/api/tags/operations/apply'
    })
    await dialog.locator('.tag-management-preview .primary').click()
    const applyResponse = await applyResponsePromise
    expect(applyResponse.status()).toBe(200)
    const applied = await applyResponse.json() as {
      kind: string
      sourceTagId: number
      destinationTagId: number
      survivorTagId: number
      sourceDeleted: boolean
      tagCreates: number
      tagDeletes: number
      appliedFingerprint: string
    }
    expect(applied).toMatchObject({
      kind: 'merge',
      sourceTagId: source!.id,
      destinationTagId: destination!.id,
      survivorTagId: destination!.id,
      sourceDeleted: true,
      tagCreates: 0,
      tagDeletes: 1,
      appliedFingerprint: preview.planFingerprint,
    })
    await expect(dialog).toHaveAttribute('data-state', 'success')
    await expect(dialog.locator('.tag-management-state-success')).toHaveAttribute('data-selected-tag', destinationName)

    const managedAfterResponse = await request.get('/api/tags')
    expect(managedAfterResponse.status()).toBe(200)
    const managedAfter = await managedAfterResponse.json() as Array<{
      id: number
      displayName: string
    }>
    expect(managedAfter.find((tag) => tag.id === source!.id)).toBeUndefined()
    expect(managedAfter.find((tag) => tag.id === destination!.id)).toMatchObject({
      id: destination!.id,
      displayName: destinationName,
    })

    for (const fixture of fixtures.slice(0, 3)) {
      const beforeVersion = versionBefore.get(fixture.slug)!
      const after = await readPostDetail(request, fixture.slug)
      if (fixture.tags.includes(sourceName)) {
        expect(after.metadata.updatedAt).toBeGreaterThan(beforeVersion)
      } else {
        expect(after.metadata.updatedAt).toBe(beforeVersion)
      }
      expect(after.metadata.tags).not.toContain(sourceName)
      expect(after.metadata.tags.filter((tag) => tag === destinationName)).toHaveLength(1)
      const snapshot = fileSnapshots.get(fixture.slug)!
      expect(await fs.readFile(path.join(E2E_VAULT, `${fixture.slug}.md`))).toEqual(snapshot.bytes)
      expect((await fs.stat(path.join(E2E_VAULT, `${fixture.slug}.md`))).mtimeMs).toBe(snapshot.mtimeMs)
    }
    expect(gitSnapshot()).toEqual(originalGit)

    // Browser-level selection epoch case 2: hold the same authoritative sync
    // seam, change selection while it is pending, and verify the newer user
    // selection wins over the Merge survivor.
    await unmountTagManagementHarness(page)
    await mountTagManagementHarness(page)
    const raceDialog = page.getByRole('dialog')
    await expect(raceDialog).toHaveAttribute('data-state', 'ready')
    await page.evaluate((tag) => window.__t2TagManagementHarness?.setSelectedTag(tag), raceSourceName)
    await raceDialog.locator('[data-operation="merge"]').click()
    await raceDialog.locator('#tag-management-source').selectOption(String(raceSource!.id))
    await raceDialog.locator('#tag-management-destination-search').fill(raceDestinationName)
    await raceDialog.locator('#tag-management-destination').selectOption(String(raceDestination!.id))
    const racePreviewResponse = page.waitForResponse((response) => (
      response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/api/tags/operations/preview'
    ))
    await raceDialog.locator('form button[type="submit"]').click()
    await racePreviewResponse
    await expect(raceDialog).toHaveAttribute('data-state', 'preview-ready')
    await page.evaluate(() => window.__t2TagManagementHarness?.holdSync())
    const raceApplyResponse = page.waitForResponse((response) => (
      response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/api/tags/operations/apply'
    ))
    await raceDialog.locator('.tag-management-preview .primary').click()
    await raceApplyResponse
    await expect(raceDialog).toHaveAttribute('data-state', 'syncing')
    await page.evaluate((tag) => window.__t2TagManagementHarness?.setSelectedTag(tag), otherName)
    await page.evaluate(() => window.__t2TagManagementHarness?.releaseSync())
    await expect(raceDialog).toHaveAttribute('data-state', 'success')
    await expect(raceDialog.locator('.tag-management-state-success')).toHaveAttribute('data-selected-tag', otherName)
  } finally {
    await cleanupCreatedPaths(request, createdPaths)
  }
})
