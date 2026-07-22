// Edit-10.5 Final Closure — real-browser residual race regression.
//
// The accepted residual race from the Edit-10.4 design doc, proven in a
// REAL browser instead of only documented:
//
//   Document clean at Send → clean liveContext captured and sent
//   → the server-side mutation for the same path lands on disk while
//     the user keeps typing (buffer dirty, unsaved)
//   → the AI turn's SSE file_changed reaches the browser through the
//     REAL client chain: sendAndStream SSE parser → useAiHistory →
//     file-change bus → useExternalFileChanges.applyExternalChange
//   → the dirty buffer triggers the in-app overwrite confirm
//   → cancel keeps the local bytes; the debounced autosave's baseRaw
//     now mismatches the AI-written disk → 409 → tab flips 'external'
//   → no silent overwrite, no auto-merge, no auto-save, no lost
//     input, no duplicate conflict, no Recovery record.
//
// Interlocking evidence (§6.3 split, used because the sealed vite
// plugin runs `dotenv.config({ override: true })`, so a host .env
// carrying real ANTHROPIC_* credentials always overrides any
// spawn-env blanking inside the webServer process — the server-side
// provider cannot be pointed at a fake endpoint in this environment
// without a production change, which is forbidden):
//
//   A. SERVER INTEGRATION — server/__tests__/edit10-final-closure.test.ts:
//      the real chain parseAiLiveContext → buildSystemPrompt → runChat
//      → deriveToolSafetyPolicy → executeToolCall (real temp vault,
//      real DB) with the provider mocked at the standard module seam
//      (same vi.mock('../ai/llm') as the existing chat suite) proves
//      the send-time CLEAN policy lets the same-path write execute
//      after documentId+raw re-verification and emits the STANDARD
//      file_changed descriptor {path, kind:'write', newRaw, newMtime};
//      the DIRTY policy blocks the same write as an is_error tool
//      result with zero side effects.
//
//   B. THIS SPEC — the browser half of the chain, end to end: real
//      VaultView/Monaco, real send-time captureAiLiveContext, real
//      sendAndStream SSE parsing, real file-change bus, real
//      confirm dialog, real debounced autosave CAS against the real
//      server. The mutation is REAL: a production REST PUT through
//      the server's compare-and-swap write path (the editor save
//      route), and the file_changed descriptor carries the REAL
//      newRaw/newMtime from that write — never a static fulfilled
//      response standing in for a server mutation. Only the LLM
//      orchestration layer (Anthropic round-trip + runChat loop) is
//      substituted, at the browser layer exactly like the sealed
//      E2E-1..10 harness; that layer is what evidence A covers with
//      the real server code. The two pieces interlock on the
//      descriptor shape A emits and B consumes.
//
// Sequence control (§6.4): no arbitrary sleeps. The intercepted chat
// stream is held open on a test-owned gate while the disk mutation
// and the local typing happen, then released; every assertion is a
// network/DOM condition. Ordering violations cannot pass silently:
// if the local buffer were ever overwritten, the Monaco assertion
// fails; if the confirm never fired, its visibility assertion fails.
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

const DATABASE_NAME = 'docus-draft-recovery'
const RUN_ID = String(Date.now())
const createdPaths: string[] = []

type AnyRecord = Record<string, any>

function jsonResponse(body: unknown, status = 200) {
  return { status, contentType: 'application/json', body: JSON.stringify(body) }
}

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

const MINIMAL_SSE = [
  sse('user', { id: 1 }),
  sse('token', { text: 'ok' }),
  sse('done', { userId: 1, assistantId: 2 }),
].join('')

// The AI turn's SSE stream: one same-path write_file round, then the
// STANDARD file_changed descriptor (the exact shape evidence A proves
// server/ai/routes.ts emits) with the REAL newRaw/newMtime of the
// REST write, then close-out.
function raceSse(slug: string, aiBody: string, newMtime: number): string {
  return [
    sse('user', { id: 1 }),
    sse('tool_use', { id: 'toolu_e2e_fc', name: 'write_file', input: { path: slug, content: aiBody } }),
    sse('tool_result', { tool_use_id: 'toolu_e2e_fc', content: `Wrote ${slug}`, is_error: false }),
    sse('file_changed', { path: slug, kind: 'write', newMtime, newRaw: aiBody }),
    sse('token', { text: 'Done.' }),
    sse('done', { userId: 1, assistantId: 2 }),
  ].join('')
}

// Browser-level /api/ai/** intercept (the sealed E2E-1..10 harness
// pattern): the FIRST chat stream is held open on `gate` — the AI
// is "thinking" until the test releases the mutation — then answered
// with raceSse(); later chats answer immediately with MINIMAL_SSE.
// Every request body is captured for send-time snapshot assertions.
async function interceptAiChatGated(
  page: Page,
  chatBodies: AnyRecord[],
  gate: Promise<void>,
  raceBody: () => string,
) {
  await page.route('**/api/ai/**', async (route) => {
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
      if (chatBodies.length === 1) {
        await gate // deterministic hold: released by the test
        return route.fulfill({ status: 200, contentType: 'text/event-stream', body: raceBody() })
      }
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: MINIMAL_SSE })
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
    const folder = slug.split('/')[0]
    await page.locator(`[data-tree-key="folder:${folder}"]`).click()
    await expect(row).toBeVisible({ timeout: 5000 })
  }
  await row.click()
  await page.locator(`[data-tab-id="${slug}"]`).waitFor({ state: 'visible' })
  await page.locator('.editor-pane .monaco-editor .view-lines').first().waitFor({ state: 'visible' })
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

test.beforeEach(async ({ page }) => {
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

test('residual race: send clean → type while the AI turn is open → same-path server write → the dirty buffer survives as an external conflict', async ({ page, request }) => {
  const slug = `inbox/e2e-ai-fc-${RUN_ID}`
  const name = slug.split('/').pop()!
  const cleanRaw = `${name} clean send-time body`
  const doc = await createDoc(request, slug, `${cleanRaw}\n`)
  // GET returns the on-disk bytes verbatim — the createDoc PUT seeded
  // `${cleanRaw}\n`, so the clean snapshot raw is exactly that.
  expect(doc.raw).toBe(`${cleanRaw}\n`)
  const aiBody = `EDIT10_FC_AI_WRITTEN_${RUN_ID}\n`

  // The held chat stream + its gated answer.
  const chatBodies: AnyRecord[] = []
  let releaseRace = () => {}
  const raceGate = new Promise<void>((resolve) => { releaseRace = resolve })
  let descriptor: { mtime: number } | null = null
  await interceptAiChatGated(
    page,
    chatBodies,
    raceGate,
    () => raceSse(slug, aiBody, descriptor?.mtime ?? 0),
  )

  await reloadApp(page)
  await openDoc(page, slug)
  await openAiRail(page)

  // ── 1. Send while CLEAN ────────────────────────────────────────────
  await sendAi(page, 'please rewrite my note')
  await expect.poll(() => chatBodies.length, { timeout: 15000 }).toBe(1)
  const body1 = chatBodies[0]
  // The Edit-10.3 wire contract: liveContext only, no legacy keys.
  const wire1 = JSON.stringify(body1)
  for (const forbidden of ['currentNotePath', 'currentNoteContent', 'attachments', 'filesystemPath', 'absolutePath']) {
    expect(wire1, `wire must not mention ${forbidden}`).not.toContain(forbidden)
  }
  const ctx = body1.liveContext
  expect(ctx, 'send-time request must carry liveContext').toBeTruthy()
  expect(ctx.v).toBe(1)
  expect(ctx.kind).toBe('document')
  expect(ctx.dirty).toBe(false)
  expect(ctx.raw).toBe(`${cleanRaw}\n`) // send-time clean: buffer == disk
  expect(ctx.identity).toEqual({ documentId: doc.documentId, path: slug })
  expect(ctx.workspaceTabId).toBe(slug)

  // ── 2. The same-path mutation lands on disk through the REAL
  //    server write path (production REST compare-and-swap) while the
  //    AI turn's stream is still held open. The descriptor carries
  //    the REAL mtime of this write ──────────────────────────────────
  const mutation = await request.put(`/api/posts/${slug}`, {
    data: { raw: aiBody, baseRaw: doc.raw },
  })
  expect(mutation.status()).toBeLessThan(300)
  // The server now holds the AI-written body; the editor still shows
  // the clean send-time bytes. The descriptor's newMtime is the REAL
  // mtime of this write (GET detail exposes stat.mtimeMs).
  const serverMid = await (await request.get(`/api/posts/${slug}`)).json()
  expect(serverMid.raw).toBe(aiBody)
  expect(serverMid.metadata.id).toBe(doc.documentId)
  descriptor = { mtime: serverMid.mtime as number }
  expect(typeof descriptor.mtime).toBe('number')

  // ── 3. The user keeps typing: buffer dirty, unsaved ────────────────
  const localTail = `EDIT10_FC_LOCAL_TAIL_${RUN_ID}`
  await appendEditorText(page, localTail)
  await expect(page.locator(`[data-tab-id="${slug}"][data-save-status="dirty"]`)).toBeVisible({ timeout: 5000 })

  // ── 4. Release the AI turn: the SSE stream delivers the standard
  //    file_changed descriptor into the REAL client chain ────────────
  releaseRace()

  // ── 5. The dirty buffer triggers the overwrite confirm — exactly
  //    once (disk-poll events carry source 'editor-lifecycle' and are
  //    dropped before the conflict logic; the bus delivers this one
  //    SSE event once) ────────────────────────────────────────────────
  const confirmDialog = page.locator('.confirm-dialog')
  await expect(confirmDialog).toBeVisible({ timeout: 15000 })
  const confirmMessage = (await confirmDialog.locator('.confirm-message').textContent()) ?? ''
  expect(confirmMessage).toContain(slug)
  // Cancel is the focused safe action: keep the local changes.
  await confirmDialog.locator('.confirm-actions .btn').first().click()
  await expect(confirmDialog).toBeHidden()

  // ── 6. The debounced autosave's baseRaw now mismatches the
  //    AI-written disk → real-server 409 → the tab flips to external ─
  await expect(page.locator(`[data-tab-id="${slug}"][data-save-status="external"]`)).toBeVisible({ timeout: 20000 })

  // ── 7. Monaco still shows the user's post-Send typing — the buffer
  //    was NOT overwritten; the server still holds the AI write — the
  //    local buffer was NOT auto-saved ───────────────────────────────
  await expect(page.locator('.editor-pane .monaco-editor .view-lines').first()).toContainText(localTail)
  const serverDoc = await (await request.get(`/api/posts/${slug}`)).json()
  expect(serverDoc.raw).toBe(aiBody)
  expect(serverDoc.raw).not.toContain(localTail)
  expect(serverDoc.metadata.id).toBe(doc.documentId) // identity stable
  // No wrong-path tab, no Recovery/duplicate tab was opened.
  await expect(page.locator('[data-tab-id]')).toHaveCount(1)
  await expect(page.locator('.draft-recovery-dialog')).toBeHidden()
  await expect(page.locator('.draft-recovery-pane')).toHaveCount(0)

  // ── 8. The next send-time snapshot carries BOTH sides: the local
  //    buffer as raw (byte-exact — no merge, not the AI body), the AI
  //    write as externalRaw; identity unchanged ──────────────────────
  await sendAi(page, 'what changed?')
  await expect.poll(() => chatBodies.length, { timeout: 15000 }).toBe(2)
  const ctx2 = chatBodies[1].liveContext
  expect(ctx2.kind).toBe('document')
  expect(ctx2.raw).toBe(`${cleanRaw}\n\n${localTail}`) // local buffer, NOT the AI body
  expect(ctx2.raw).not.toContain(aiBody.trim())
  expect(ctx2.dirty).toBe(true)
  expect(ctx2.saveStatus).toBe('external')
  expect(ctx2.external).toEqual({ kind: 'modified', raw: aiBody })
  expect(ctx2.identity).toEqual({ documentId: doc.documentId, path: slug })

  // ── 9. The conflict stays user-owned: no duplicate confirm ever
  //    re-appeared, nothing silently resolved the external state ────
  await expect(page.locator('.confirm-dialog')).toBeHidden()
  await expect(page.locator(`[data-tab-id="${slug}"][data-save-status="external"]`)).toBeVisible()
})
