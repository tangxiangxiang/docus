// Edit-10.3 E2E: the send-time live workspace snapshot travels from the
// browser to /api/ai/chat verbatim, for every context kind.
//
// Hermetic by construction:
//   - /api/ai/* is intercepted at the browser level: no Anthropic key is
//     needed; POST /api/ai/chat is answered with a minimal SSE stream and
//     its request body is captured for assertions.
//   - /api/history/* is intercepted in the History/Diff tests so the
//     pinned revision content is deterministic.
//   - Everything else (posts, files, health) is served by the real
//     embedded server. Test documents live under inbox/ with a per-run
//     slug and are removed in afterAll (untracked files under
//     src/content would fail the git-status gate).
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

const DATABASE_NAME = 'docus-draft-recovery'
const RUN_ID = String(Date.now())
const createdPaths: string[] = []

type AnyRecord = Record<string, any>

let chatBodies: AnyRecord[] = []

const MINIMAL_SSE = [
  'event: user',
  'data: {"id":1}',
  '',
  'event: token',
  'data: {"text":"ok"}',
  '',
  'event: done',
  'data: {"userId":1,"assistantId":2}',
  '',
  '',
].join('\n')

function jsonResponse(body: unknown, status = 200) {
  return { status, contentType: 'application/json', body: JSON.stringify(body) }
}

// The ONE capture point: every chat request body lands in chatBodies.
async function interceptAiChat(page: Page) {
  chatBodies = []
  await page.route('**/api/ai/**', (route) => {
    const url = new URL(route.request().url())
    const method = route.request().method()
    if (url.pathname === '/api/ai/active') {
      if (method === 'PUT') return route.fulfill(jsonResponse({ sessionId: 1 }))
      return route.fulfill(jsonResponse({ activeId: null, configured: true }))
    }
    if (url.pathname === '/api/ai/sessions') {
      if (method === 'POST') {
        return route.fulfill(jsonResponse({ id: 1, title: '', createdAt: 1, updatedAt: 1 }, 201))
      }
      return route.fulfill(jsonResponse([]))
    }
    if (url.pathname === '/api/ai/settings') {
      return route.fulfill(jsonResponse({ hasKey: true, baseURL: '', model: '' }))
    }
    if (url.pathname === '/api/ai/chat') {
      chatBodies.push(JSON.parse(route.request().postData() ?? '{}'))
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: MINIMAL_SSE })
    }
    return route.fulfill(jsonResponse({}))
  })
}

// Deterministic history: one fake commit touching `files`, whose file
// content is `raw`. The History panel is lazily mounted (v-else-if on the
// active panel), so installing this after page load but before opening
// the panel is safe.
async function interceptHistory(
  page: Page,
  opts: { files: string[]; raw: string; sha: string },
) {
  await page.route('**/api/history/**', (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/capability')) {
      return route.fulfill(jsonResponse({ gitAvailable: true, repoInitialized: true }))
    }
    if (url.pathname.endsWith('/status')) {
      return route.fulfill(jsonResponse({ dirty: [], available: true }))
    }
    if (url.pathname.endsWith('/log')) {
      return route.fulfill(jsonResponse({
        commits: [{
          sha: opts.sha,
          author: 'E2E',
          date: '2026-07-21T08:00:00.000Z',
          subject: 'E2E pinned revision',
          body: '',
          files: opts.files,
        }],
      }))
    }
    if (url.pathname.endsWith('/file')) {
      return route.fulfill(jsonResponse({
        path: url.searchParams.get('path') ?? '',
        ref: url.searchParams.get('ref') ?? '',
        content: opts.raw,
      }))
    }
    if (url.pathname.endsWith('/diff')) {
      return route.fulfill(jsonResponse({
        path: url.searchParams.get('path') ?? '',
        oldRef: url.searchParams.get('old') ?? '',
        newRef: url.searchParams.get('new') ?? '',
        diff: { ops: [], stats: { added: 0, removed: 0, equal: 0 } },
      }))
    }
    // Array/object shapes the History panel's commit composer reads on
    // mount — the generic {} fallback would crash its computeds.
    if (url.pathname.endsWith('/repair-status')) {
      return route.fulfill(jsonResponse({ transactions: [] }))
    }
    if (url.pathname.endsWith('/content-hashes')) {
      return route.fulfill(jsonResponse({ hashes: {} }))
    }
    return route.fulfill(jsonResponse({}))
  })
}

async function createDoc(
  request: APIRequestContext,
  slug: string,
  body: string,
): Promise<{ raw: string; documentId: string }> {
  const name = slug.split('/').pop()!
  const create = await request.post('/api/posts', { data: { path: slug, title: name } })
  expect([200, 201, 409]).toContain(create.status())
  createdPaths.push(slug)
  const initial = await (await request.get(`/api/posts/${slug}`)).json()
  const put = await request.put(`/api/posts/${slug}`, {
    data: { raw: body, baseRaw: initial.raw },
  })
  expect(put.status()).toBeLessThan(300)
  const detail = await (await request.get(`/api/posts/${slug}`)).json()
  return { raw: detail.raw as string, documentId: detail.metadata.id as string }
}

// The file tree is fetched at mount time; documents created through the
// REST API after page load are invisible to it until the next load.
// Reload before opening freshly created documents.
async function reloadApp(page: Page) {
  await page.goto('/')
  await expect(page.locator('button.ab-btn').first()).toBeVisible()
}

async function openDoc(page: Page, slug: string) {
  // data-tree-key is exact (kind:path) — a hasText match on .tree-row
  // would also match the folder row, whose descendants include the
  // file rows.
  const row = page.locator(`[data-tree-key="file:${slug}"]`)
  if (!(await row.isVisible().catch(() => false))) {
    // Children of a collapsed folder are not rendered: expand first.
    const folder = slug.split('/')[0]
    await page.locator(`[data-tree-key="folder:${folder}"]`).click()
    await expect(row).toBeVisible({ timeout: 5000 })
  }
  await row.click()
  await page.locator(`[data-tab-id="${slug}"]`).waitFor({ state: 'visible' })
  await page.locator('.editor-pane .monaco-editor .view-lines').first().waitFor({ state: 'visible' })
}

async function setEditorContent(page: Page, text: string) {
  const editor = page.locator('.editor-pane .monaco-editor').first()
  await editor.locator('.view-lines').click({ position: { x: 40, y: 12 } })
  await page.keyboard.press('Control+a')
  await page.keyboard.insertText(text)
  await expect(page.locator('.editor-pane .monaco-editor .view-lines').first()).toContainText(text)
}

async function appendEditorText(page: Page, text: string) {
  const editor = page.locator('.editor-pane .monaco-editor').first()
  await editor.locator('.view-lines').click({ position: { x: 40, y: 12 } })
  await page.keyboard.press('Control+End')
  await page.keyboard.press('Enter')
  await page.keyboard.insertText(text)
}

async function openAiRail(page: Page) {
  const toggle = page.locator('button.ai-toggle')
  await expect(toggle).toBeVisible()
  if ((await toggle.getAttribute('aria-pressed')) !== 'true') {
    await toggle.click()
  }
  const aiTab = page.locator('.sidebar-tabs button[role="tab"]', { hasText: 'AI' })
  await expect(aiTab).toBeVisible()
  await aiTab.click()
  await expect(page.locator('textarea.ai-input')).toBeVisible()
}

async function sendAi(page: Page, message: string) {
  const input = page.locator('textarea.ai-input')
  await input.fill(message)
  await input.press('Enter')
}

async function waitForChat(count: number): Promise<AnyRecord> {
  await expect.poll(() => chatBodies.length, { timeout: 15000 }).toBe(count)
  return chatBodies[chatBodies.length - 1]
}

// The Edit-10.3 wire contract: liveContext present, and none of the
// legacy/forbidden transport keys anywhere on the wire.
function expectLiveOnly(body: AnyRecord): AnyRecord {
  expect(body.liveContext, 'chat request must carry liveContext').toBeTruthy()
  expect(body.currentNotePath).toBeUndefined()
  const wire = JSON.stringify(body)
  for (const forbidden of ['currentNotePath', 'currentNoteContent', 'attachments', 'filesystemPath', 'absolutePath']) {
    expect(wire, `wire must not mention ${forbidden}`).not.toContain(forbidden)
  }
  return body.liveContext
}

// Seed a primary recovery draft through the production store module
// (real schema, real keyPath). baseContentHash: null classifies as
// 'unknown', which offers "Open Recovered Content" + "View Diff".
async function seedRecoveryDraft(
  page: Page,
  draft: { vaultId: string; documentId: string; documentPath: string; content: string },
) {
  await page.evaluate(async (draftRecord) => {
    const { createDraftStore } = await import(
      '/src/composables/vault/draft-recovery/draftStore.ts'
    )
    await createDraftStore().saveDraft({
      version: 1,
      vaultId: draftRecord.vaultId,
      documentId: draftRecord.documentId,
      documentPath: draftRecord.documentPath,
      content: draftRecord.content,
      baseContentHash: null,
      baseModifiedAt: null,
      createdAt: 10,
      updatedAt: 20,
    })
  }, draft)
}

async function openRecoveryDialog(page: Page) {
  const dialog = page.locator('.draft-recovery-dialog')
  await expect(dialog).toBeVisible({ timeout: 15000 })
  // Wait for classification (loading → ready): the action buttons render
  // only when status is 'ready'.
  await expect(dialog.getByRole('button', { name: 'Open Recovered Content' })).toBeVisible({ timeout: 15000 })
  return dialog
}

test.beforeEach(async ({ page }) => {
  chatBodies = []
  await interceptAiChat(page)
  await page.goto('/')
  await page.evaluate(async (databaseName) => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(databaseName)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
      request.onblocked = () => reject(new Error('Draft database deletion blocked'))
    })
  }, DATABASE_NAME)
  await expect(page.locator('button.ab-btn').first()).toBeVisible()
})

test.afterAll(async ({ request }) => {
  for (const slug of createdPaths) {
    await request.delete(`/api/posts/${slug}`).catch(() => {})
    await fs.rm(path.join('src', 'content', `${slug}.md`), { force: true }).catch(() => {})
  }
})

test('E2E-1 dirty buffer: the full send-time snapshot travels verbatim', async ({ page, request }) => {
  const slug = `inbox/e2e-ai-d1-${RUN_ID}`
  const name = slug.split('/').pop()!
  const { documentId } = await createDoc(request, slug, `${name} on disk.\n`)
  await reloadApp(page)
  await openDoc(page, slug)
  // Open the AI rail BEFORE editing so the send happens inside the
  // 800ms autosave window: the snapshot must still be dirty.
  await openAiRail(page)

  const dirtyBody = `E2E1_DIRTY_BODY_${RUN_ID}`
  await setEditorContent(page, dirtyBody)
  await sendAi(page, 'read my dirty buffer')
  const body = await waitForChat(1)

  const ctx = expectLiveOnly(body)
  expect(ctx.v).toBe(1)
  expect(ctx.kind).toBe('document')
  expect(ctx.raw).toBe(dirtyBody) // byte-exact buffer, not the disk version
  expect(ctx.dirty).toBe(true)
  expect(ctx.saveStatus).toBe('dirty')
  expect(ctx.revision).toBeGreaterThan(ctx.savedRevision)
  expect(ctx.identity).toEqual({ documentId, path: slug })
  expect(ctx.workspaceTabId).toBe(slug)
  expect(ctx.title).toBe(name)
  expect(ctx.vaultId).toBeTruthy()
  expect(typeof ctx.capturedAt).toBe('number')
  expect('external' in ctx).toBe(false)
})

test('E2E-2 two open documents: only the active tab is captured', async ({ page, request }) => {
  const slugA = `inbox/e2e-ai-d2a-${RUN_ID}`
  const slugB = `inbox/e2e-ai-d2b-${RUN_ID}`
  const markerA = `E2E2_A_BODY_${RUN_ID}`
  await createDoc(request, slugA, `${markerA}\n`)
  const docB = await createDoc(request, slugB, `${slugB.split('/').pop()} on disk.\n`)
  await reloadApp(page)
  await openDoc(page, slugA)
  await openDoc(page, slugB) // B is the active tab
  await openAiRail(page)

  const markerB = `E2E2_B_BODY_${RUN_ID}`
  await setEditorContent(page, markerB)
  await sendAi(page, 'which document am I?')
  const body = await waitForChat(1)

  const ctx = expectLiveOnly(body)
  expect(ctx.kind).toBe('document')
  expect(ctx.identity).toEqual({ documentId: docB.documentId, path: slugB })
  expect(ctx.raw).toBe(markerB)
  expect(JSON.stringify(body)).not.toContain(markerA) // A never leaked in
})

test('E2E-3 history snapshot: read-only revision raw, not the disk version', async ({ page, request }) => {
  const slug = `inbox/e2e-ai-h3-${RUN_ID}`
  const name = slug.split('/').pop()!
  await createDoc(request, slug, `${name} current disk.\n`)
  const sha = `e2e3sha${RUN_ID}`
  const revisionRaw = `E2E3_HISTORY_RAW_${RUN_ID}`
  // Install the fake history BEFORE the reload: routes survive
  // navigation, and the panel's log fetch happens on open either way.
  await interceptHistory(page, { files: [`${slug}.md`], raw: revisionRaw, sha })
  await reloadApp(page)
  await openDoc(page, slug)

  await page.locator('button.ab-btn[aria-label="History"]').click()
  const docRow = page.locator('.history-document-row', { hasText: name })
  await expect(docRow).toBeVisible({ timeout: 10000 })
  await docRow.click()
  const revRow = page.locator('.history-revision-row').first()
  await expect(revRow).toBeVisible({ timeout: 10000 })
  await revRow.click()
  await expect(page.locator('.history-snapshot-pane')).toBeVisible({ timeout: 10000 })

  await openAiRail(page)
  await sendAi(page, 'summarize this revision')
  const body = await waitForChat(1)

  const ctx = expectLiveOnly(body)
  expect(ctx.kind).toBe('history')
  expect(ctx.readOnly).toBe(true)
  expect(ctx.raw).toBe(revisionRaw)
  expect(ctx.identity).toEqual({ path: slug, revisionId: sha, revisionTime: expect.any(Number) })
  expect(ctx.workspaceTabId).toContain('history:')
  for (const key of ['revision', 'savedRevision', 'dirty', 'saveStatus', 'external', 'before', 'after', 'draft', 'disk']) {
    expect(key in ctx, `history snapshot must not carry ${key}`).toBe(false)
  }
})

test('E2E-4 history diff: before is the revision, after is the live buffer', async ({ page, request }) => {
  const slug = `inbox/e2e-ai-h4-${RUN_ID}`
  const name = slug.split('/').pop()!
  const doc = await createDoc(request, slug, `${name} current disk.\n`)
  const sha = `e2e4sha${RUN_ID}`
  const revisionRaw = `E2E4_HISTORY_RAW_${RUN_ID}`
  await interceptHistory(page, { files: [`${slug}.md`], raw: revisionRaw, sha })
  await reloadApp(page)
  await openDoc(page, slug) // the document editor stays open behind the diff

  await page.locator('button.ab-btn[aria-label="History"]').click()
  const docRow = page.locator('.history-document-row', { hasText: name })
  await expect(docRow).toBeVisible({ timeout: 10000 })
  await docRow.click()
  await page.locator('.history-revision-row').first().click()
  await expect(page.locator('.history-snapshot-pane')).toBeVisible({ timeout: 10000 })
  await page.locator('.history-snapshot-toolbar button', { hasText: 'Open Diff' }).click()
  await expect(page.locator('.history-comparison-pane')).toBeVisible({ timeout: 10000 })

  await openAiRail(page)
  await sendAi(page, 'explain this diff')
  const body = await waitForChat(1)

  const ctx = expectLiveOnly(body)
  expect(ctx.kind).toBe('diff')
  expect(ctx.readOnly).toBe(true)
  expect(ctx.before.source).toBe('history')
  expect(ctx.before.raw).toBe(revisionRaw)
  expect(ctx.after.source).toBe('live-editor')
  expect(ctx.after.raw).toBe(doc.raw) // untouched buffer == canonical disk
  expect(ctx.after.dirty).toBe(false)
  expect(ctx.identity).toEqual({
    path: slug,
    revisionId: sha,
    revisionTime: expect.any(Number),
    currentDocumentId: doc.documentId,
  })
})

test('E2E-5 recovery content view: browser-local draft with no disk block', async ({ page, request }) => {
  const slug = `inbox/e2e-ai-r5-${RUN_ID}`
  const name = slug.split('/').pop()!
  const { documentId } = await createDoc(request, slug, `${name} on disk.\n`)
  const health = await (await request.get('/api/health')).json()
  const draftBody = `E2E5_DRAFT_${RUN_ID}`
  await seedRecoveryDraft(page, {
    vaultId: health.vaultId,
    documentId,
    documentPath: slug,
    content: draftBody,
  })
  await page.reload()

  const dialog = await openRecoveryDialog(page)
  await dialog.getByRole('button', { name: 'Open Recovered Content' }).click()
  await expect(page.locator('.draft-recovery-pane')).toBeVisible({ timeout: 10000 })

  await openAiRail(page)
  await sendAi(page, 'help me with this recovered draft')
  const body = await waitForChat(1)

  const ctx = expectLiveOnly(body)
  expect(ctx.kind).toBe('recovery')
  expect(ctx.readOnly).toBe(true)
  expect(ctx.view).toBe('content')
  expect(ctx.draft.raw).toBe(draftBody)
  expect('disk' in ctx, 'content view must not carry a disk block').toBe(false)
  expect(ctx.decisionKind).toBe('unknown')
  expect(ctx.identity).toEqual({
    recoveryId: expect.any(String),
    documentId,
    path: slug,
    source: 'primary',
  })
})

test('E2E-6 recovery diff view: draft and disk sides from one snapshot', async ({ page, request }) => {
  const slug = `inbox/e2e-ai-r6-${RUN_ID}`
  const name = slug.split('/').pop()!
  const doc = await createDoc(request, slug, `${name} on disk.\n`)
  const health = await (await request.get('/api/health')).json()
  const draftBody = `E2E6_DRAFT_${RUN_ID}`
  await seedRecoveryDraft(page, {
    vaultId: health.vaultId,
    documentId: doc.documentId,
    documentPath: slug,
    content: draftBody,
  })
  await page.reload()

  const dialog = await openRecoveryDialog(page)
  await dialog.getByRole('button', { name: 'View Diff' }).click()
  await expect(page.locator('.draft-recovery-pane')).toBeVisible({ timeout: 10000 })

  await openAiRail(page)
  await sendAi(page, 'what changed in this draft')
  const body = await waitForChat(1)

  const ctx = expectLiveOnly(body)
  expect(ctx.kind).toBe('recovery')
  expect(ctx.readOnly).toBe(true)
  expect(ctx.view).toBe('diff')
  expect(ctx.draft.raw).toBe(draftBody)
  expect(ctx.disk.raw).toBe(doc.raw)
  expect(ctx.disk.documentId).toBe(doc.documentId)
  expect(ctx.identity).toEqual({
    recoveryId: expect.any(String),
    documentId: doc.documentId,
    path: slug,
    source: 'primary',
  })
})

test('E2E-7 recovery beats the route: deep-linked document does not win', async ({ page, request }) => {
  const slug = `inbox/e2e-ai-r7-${RUN_ID}`
  const name = slug.split('/').pop()!
  const { documentId } = await createDoc(request, slug, `${name} on disk.\n`)
  const health = await (await request.get('/api/health')).json()
  const draftBody = `E2E7_DRAFT_${RUN_ID}`
  await seedRecoveryDraft(page, {
    vaultId: health.vaultId,
    documentId,
    documentPath: slug,
    content: draftBody,
  })

  // Deep link straight to the document: the route opens a document tab,
  // and the recovery prompt appears on top of it. Recovery must win.
  await page.goto(`/vault/${slug}`)
  const dialog = await openRecoveryDialog(page)
  await dialog.getByRole('button', { name: 'Open Recovered Content' }).click()
  await expect(page.locator('.draft-recovery-pane')).toBeVisible({ timeout: 10000 })

  await openAiRail(page)
  await sendAi(page, 'which context is this')
  const body = await waitForChat(1)

  const ctx = expectLiveOnly(body)
  expect(ctx.kind).toBe('recovery') // NOT 'document'
  expect(ctx.view).toBe('content')
  expect(ctx.draft.raw).toBe(draftBody)
  expect(ctx.identity.path).toBe(slug)
  expect(ctx.identity.documentId).toBe(documentId)
})

test('E2E-8 capture-then-switch: the send-time snapshot survives a tab switch', async ({ page, request }) => {
  const slugA = `inbox/e2e-ai-s8a-${RUN_ID}`
  const slugB = `inbox/e2e-ai-s8b-${RUN_ID}`
  await createDoc(request, slugA, `${slugA.split('/').pop()} on disk.\n`)
  await createDoc(request, slugB, `${slugB.split('/').pop()} on disk.\n`)
  await reloadApp(page)
  await openDoc(page, slugA)
  await openDoc(page, slugB)
  await page.locator(`[data-tab-id="${slugA}"]`).click() // A is active again
  await openAiRail(page)

  const bodyA = `E2E8_A_${RUN_ID}`
  await setEditorContent(page, bodyA)
  await sendAi(page, 'hi from A')
  // Immediately switch away: the request must still carry A's snapshot.
  await page.locator(`[data-tab-id="${slugB}"]`).click()
  const body = await waitForChat(1)

  const ctx = expectLiveOnly(body)
  expect(ctx.kind).toBe('document')
  expect(ctx.identity.path).toBe(slugA)
  expect(ctx.raw).toBe(bodyA)
  expect(JSON.stringify(body)).not.toContain(slugB)
})

test('E2E-9 rename: the stable documentId survives a path change', async ({ page, request }) => {
  const slug = `inbox/e2e-ai-n9-${RUN_ID}`
  const name = slug.split('/').pop()!
  const { documentId } = await createDoc(request, slug, `${name} on disk.\n`)
  await reloadApp(page)
  await openDoc(page, slug)

  await page.locator(`[data-tree-key="file:${slug}"]`).click({ button: 'right' })
  await page.locator('.tree-context-menu button', { hasText: 'Rename' }).click()
  const newName = `e2e-ai-ren9-${RUN_ID}`
  const input = page.locator('.prompt-card .prompt-input')
  await expect(input).toBeVisible()
  await input.fill(newName)
  await page.locator('.prompt-card .prompt-actions .btn-primary').click()

  const newSlug = `inbox/${newName}`
  createdPaths.push(newSlug)
  await expect(page.locator(`[data-tab-id="${newSlug}"]`)).toBeVisible({ timeout: 10000 })

  await openAiRail(page)
  await sendAi(page, 'still the same document?')
  const body = await waitForChat(1)

  const ctx = expectLiveOnly(body)
  expect(ctx.kind).toBe('document')
  // New path, same stable identity.
  expect(ctx.identity).toEqual({ documentId, path: newSlug })
})

test('E2E-10 external conflict: buffer and disk version travel together', async ({ page, request }) => {
  const slug = `inbox/e2e-ai-x10-${RUN_ID}`
  const { documentId } = await createDoc(request, slug, `${slug.split('/').pop()} on disk.\n`)
  await reloadApp(page)
  await openDoc(page, slug)
  await openAiRail(page)

  // Baseline: type, let the 800ms-debounced autosave land (disk == buffer,
  // clean). A CLEAN buffer silently adopts disk changes, so the external
  // state only surfaces while the buffer is dirty — append a tail and
  // change the disk before the next autosave fires.
  const buffer = `E2E10_BUFFER_${RUN_ID}`
  await setEditorContent(page, buffer)
  await expect(page.locator(`[data-tab-id="${slug}"][data-save-status="saved"]`)).toBeVisible({ timeout: 10000 })

  const tail = `E2E10_DIRTY_TAIL_${RUN_ID}`
  await appendEditorText(page, tail) // buffer is dirty again
  const diskBody = `E2E10_DISK_${RUN_ID} changed externally\n`
  await fs.writeFile(path.join('src', 'content', `${slug}.md`), diskBody, 'utf8')
  // The debounced autosave's baseRaw now mismatches the disk: the 409
  // conflict path flips the tab to 'external' with the disk side attached.
  await expect(page.locator(`[data-tab-id="${slug}"][data-save-status="external"]`)).toBeVisible({ timeout: 20000 })

  await sendAi(page, 'what changed on disk?')
  const body = await waitForChat(1)

  const ctx = expectLiveOnly(body)
  expect(ctx.kind).toBe('document')
  expect(ctx.raw).toBe(`${buffer}\n${tail}`) // the buffer is preserved, not reloaded
  expect(ctx.saveStatus).toBe('external')
  expect(ctx.external).toEqual({ kind: 'modified', raw: diskBody })
  expect(ctx.identity).toEqual({ documentId, path: slug })
})
