// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ref, effectScope } from 'vue'
import { useEditorPreviewScrollSync } from './useEditorPreviewScrollSync'

/* The composable reads scrollHeight / clientHeight on the target
   elements. jsdom doesn't compute layout, so we have to stub both
   properties to simulate the editor / preview being tall enough
   to scroll. The numbers are picked so editorMax=1600 and
   previewMax=2400 — a 2:3 ratio — which lets us assert the exact
   mapped scrollTop for a given editor scrollTop. */
function stubLayout(el: HTMLElement, scrollHeight: number, clientHeight: number) {
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => scrollHeight })
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => clientHeight })
}

/* Build a minimal vault-like DOM that mirrors the real layout:
   - editor scroll container is .cm-scroller (CodeMirror default)
   - preview scroll container is .preview-pane itself (.vault
     scope gives it overflow:auto, and the .article inside has
     min-height:100% so it never has internal overflow)
     <div class="vault">
       <div class="editor-pane" data-path="x">
         <div class="cm-scroller">…long content…</div>
       </div>
       <div class="preview-pane" data-path="x">
         <div class="article">…long content…</div>
       </div>
     </div> */
function buildVault(): {
  root: HTMLDivElement
  editorScroll: HTMLDivElement
  previewScroll: HTMLDivElement  // ← .preview-pane, NOT .article
} {
  const root = document.createElement('div')
  root.className = 'vault'

  const editorPane = document.createElement('div')
  editorPane.className = 'editor-pane'
  editorPane.setAttribute('data-path', 'x')

  const editorScroll = document.createElement('div')
  editorScroll.className = 'cm-scroller'
  editorPane.appendChild(editorScroll)

  const previewPane = document.createElement('div')
  previewPane.className = 'preview-pane'
  previewPane.setAttribute('data-path', 'x')

  /* Real preview pane has an .article child for layout; the
     scroll happens on the wrapper itself. We still create the
     child for fidelity (the composable only queries the wrapper
     now, but if it ever changed we'd want the same shape). */
  const article = document.createElement('div')
  article.className = 'article'
  previewPane.appendChild(article)

  root.appendChild(editorPane)
  root.appendChild(previewPane)
  document.body.appendChild(root)

  return { root, editorScroll, previewScroll: previewPane }
}

/* jsdom doesn't fire real scroll events when we set scrollTop — it
   doesn't simulate layout, so the property write is a no-op against
   the layout pipeline that would normally dispatch the event. We
   dispatch the event manually so the composable sees it. The
   EventTarget of the scroll event is the scroller itself, matching
   browser behavior. */
function scrollEl(el: HTMLElement, top: number) {
  el.scrollTop = top
  el.dispatchEvent(new Event('scroll', { bubbles: true }))
}

let rafCallbacks: Array<() => void> = []
beforeEach(() => {
  rafCallbacks = []
  /* jsdom has no requestAnimationFrame in the way browsers do; stub
     it so the composable's guard-release path is testable. */
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
    rafCallbacks.push(cb)
    return rafCallbacks.length
  })
  vi.stubGlobal('cancelAnimationFrame', () => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

function flushRaf() {
  const cbs = rafCallbacks
  rafCallbacks = []
  for (const cb of cbs) cb()
}

/* Run the composable inside an effectScope so its setup-time
   watchers and lifecycle hooks fire. effectScope gives us a
   disposable scope without the overhead of mounting a component
   and dealing with the test-utils lifecycle. */
function runWith(opts: { root: HTMLElement; path: string }) {
  const vaultRoot = ref<HTMLElement | null>(opts.root)
  const activePath = ref<string | null>(opts.path)
  const scope = effectScope()
  scope.run(() => {
    useEditorPreviewScrollSync({ vaultRoot, activePath })
  })
  return {
    vaultRoot,
    activePath,
    stop: () => scope.stop(),
  }
}

describe('useEditorPreviewScrollSync', () => {
  it('attaches a delegated scroll listener on the vault root', async () => {
    const { root, editorScroll, previewScroll } = buildVault()
    stubLayout(editorScroll, 2000, 400)  // editorMax = 1600
    stubLayout(previewScroll, 3000, 600) // previewMax = 2400
    runWith({ root, path: 'x' })

    /* flush:'post' watcher + rAF — both must run before the listener
       is attached. */
    flushRaf()
    await Promise.resolve()

    /* editor at 50% → preview should land at 50% too. 0.5 * 2400 = 1200. */
    scrollEl(editorScroll, 800)
    expect(previewScroll.scrollTop).toBe(1200)
  })

  it('syncs in the preview → editor direction', async () => {
    const { root, editorScroll, previewScroll } = buildVault()
    stubLayout(editorScroll, 2000, 400)
    stubLayout(previewScroll, 3000, 600)
    runWith({ root, path: 'x' })
    flushRaf()
    await Promise.resolve()

    /* preview at 25% → editor at 25%. 0.25 * 1600 = 400. */
    scrollEl(previewScroll, 600)
    expect(editorScroll.scrollTop).toBe(400)
  })

  it('suppresses the echo scroll event to avoid feedback loop', async () => {
    const { root, editorScroll, previewScroll } = buildVault()
    stubLayout(editorScroll, 2000, 400)
    stubLayout(previewScroll, 3000, 600)
    runWith({ root, path: 'x' })
    flushRaf()
    await Promise.resolve()

    /* User scrolls the editor → preview scrolls to 1200. */
    scrollEl(editorScroll, 800)
    expect(previewScroll.scrollTop).toBe(1200)

    /* In a real browser setting preview.scrollTop fires a scroll
       event on preview. jsdom doesn't fire it automatically, so we
       dispatch one to simulate the echo. The guard should see
       syncing=true and release it without doing anything. Without
       the guard, the preview→editor direction would fire and reset
       editor.scrollTop to (1200 / 2400) * 1600 = 800 — same as it
       was, which wouldn't actually demonstrate anything. To make
       the assertion meaningful we move the editor's scrollTop out
       of the sync target first; the echo then has a value to reset
       it from. */
    editorScroll.scrollTop = 400
    previewScroll.dispatchEvent(new Event('scroll', { bubbles: true }))
    /* Echo was suppressed → editor is still at 400, not 800. */
    expect(editorScroll.scrollTop).toBe(400)
  })

  it('does not sync inactive tabs', async () => {
    const { root, editorScroll, previewScroll } = buildVault()
    stubLayout(editorScroll, 2000, 400)
    stubLayout(previewScroll, 3000, 600)
    /* Mount with a different active path so the real pane is treated
       as inactive. */
    runWith({ root, path: 'something-else' })
    flushRaf()
    await Promise.resolve()

    scrollEl(editorScroll, 800)
    expect(previewScroll.scrollTop).toBe(0)  // no sync happened
  })

  it('does nothing when either pane has no scroll range', async () => {
    const { root, editorScroll, previewScroll } = buildVault()
    /* preview fits in its viewport — nothing to scroll to. */
    stubLayout(editorScroll, 2000, 400)
    stubLayout(previewScroll, 600, 600)
    runWith({ root, path: 'x' })
    flushRaf()
    await Promise.resolve()

    scrollEl(editorScroll, 800)
    expect(previewScroll.scrollTop).toBe(0)
  })
})
