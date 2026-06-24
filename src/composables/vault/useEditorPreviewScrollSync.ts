import { onBeforeUnmount, watch, type Ref } from 'vue'

/* In edit mode the editor pane (CodeMirror) and preview pane (rendered
   markdown) sit side-by-side. The two surfaces have very different
   line heights — CodeMirror is monospace at ~18px per line, the preview
   is proportional with line-height:1.65 and per-element variation for
   headings / code blocks / lists. A line-count or per-element ratio
   would drift over time as the renderer or theme changes, so we sync
   by **scroll fraction** instead: editor.scrollTop / editorMax =
   preview.scrollTop / previewMax. This is invariant to font size, line
   height, and content length — what matters is "the user is N% of the
   way through the editor, put the preview N% of the way through its
   own scroll". When the preview is shorter than the editor (or vice
   versa) the unavailable scroll range just gets clipped — both panes
   sit pinned to the bottom of the shorter one, which matches what
   users expect from a typical markdown editor.

   Direction is bidirectional: scrolling either pane drives the other.
   We guard with a `syncing` flag because setting scrollTop
   programmatically fires its own scroll event; without the guard we'd
   ping-pong between the two listeners. The flag is released in the
   next animation frame, which is well after the synchronous
   "scroll" event dispatched by setting scrollTop.

   We use **event delegation on the vault root** (capture phase)
   rather than attaching listeners directly to the inner scrollers.
   The inner elements are not stable: CodeMirror mounts its
   .cm-scroller asynchronously inside onMounted of EditorPane, and
   tabs that are still loading have no cm-scroller yet at all. By
   delegating, a single listener handles every current and future
   tab without us having to re-attach when DOM children come and go.
   The `data-path` attribute on each pane tells us which tab the
   scroll belongs to; we ignore scrolls from inactive tabs (which
   are display:none but still bubble scroll events through their
   hidden subtree).

   Scroll-container identification (important — getting this wrong
   gives the asymmetric "one direction works, the other doesn't"
   failure mode):

   - **Editor side**: `.editor-pane` itself has no overflow; the
     scrollable element is CodeMirror's `.cm-scroller` (CodeMirror
     sets `overflow:auto` by default and exposes it via
     `view.scrollDOM`).

   - **Preview side**: the scrollable element is **`.preview-pane`
     itself**, not `.article` inside it. style.css gives both
     `.preview-pane` (`overflow:auto` in the .vault scope, line
     1406) and `.preview-pane > .article` (`overflow:auto` on line
     1290) overflow rules. The .vault-scoped rule on `.article`
     sets `min-height:100%`, which forces the article to be at
     least as tall as its parent. Combined with `flex:0 0 auto` (no
     shrink), the article's box always matches or exceeds its
     content height, so .article never has internal overflow. The
     scrollbar — and the scroll event — live on `.preview-pane`.
     Earlier I queried `.preview-pane > .article` here and set
     its `scrollTop`, which was a silent no-op; that is what made
     editor→preview sync fail while preview→editor sync worked. */

/* Proper escape for a value placed inside an attribute selector
   `[attr="…"]`. CSS.escape escapes for *identifiers*, not quoted
   string values: it adds spaces around escaped code points which
   are valid in identifiers but not in string values. We only need
   to escape `"` and `\` (the only characters that can close or
   terminate a CSS string). */
function attrEscape(s: string): string {
  return s.replace(/(["\\])/g, '\\$1')
}

/* Maximum scrollable distance for an element. Returns 0 when the
   content fits in the viewport (nothing to scroll). */
function scrollMax(el: HTMLElement): number {
  return Math.max(0, el.scrollHeight - el.clientHeight)
}

export function useEditorPreviewScrollSync(opts: {
  vaultRoot: Ref<HTMLElement | null>
  activePath: Ref<string | null>
}) {
  /* Set while we are programmatically scrolling the other pane.
     Releasing in rAF ensures the "scroll" event fired by our own
     scrollTop assignment is suppressed before we accept new
     user-driven scrolls. */
  let syncing = false
  let pendingRelease: number | null = null

  function syncTo(src: HTMLElement, dst: HTMLElement) {
    const srcMax = scrollMax(src)
    const dstMax = scrollMax(dst)
    if (srcMax <= 0 || dstMax <= 0) return
    const target = (src.scrollTop / srcMax) * dstMax
    syncing = true
    dst.scrollTop = target
    if (pendingRelease !== null) cancelAnimationFrame(pendingRelease)
    pendingRelease = requestAnimationFrame(() => {
      syncing = false
      pendingRelease = null
    })
  }

  function onScroll(e: Event) {
    /* Belt-and-suspenders guard: in addition to the rAF release we
       also release here on the first echo we observe. The relative
       ordering of "scroll" event and rAF callback differs across
       browsers (Chrome typically dispatches the scroll event before
       rAF; some others fire rAF first). Releasing in either path
       means we never get stuck, and we never drop a real user scroll
       more than once even in the worst-case race. */
    if (syncing) {
      syncing = false
      if (pendingRelease !== null) {
        cancelAnimationFrame(pendingRelease)
        pendingRelease = null
      }
      return
    }
    const target = e.target as HTMLElement | null
    if (!target) return
    /* Walk up to the pane wrapper so we can identify the tab and
       decide direction. target can be:
         - .cm-scroller (editor) — child of .editor-pane
         - .preview-pane itself (preview) — it IS the wrapper when
           the user scrolls the preview, because .preview-pane is
           the actual scroll container (see the long comment at the
           top of this file). closest('.preview-pane') on the
           wrapper element returns itself. */
    const editorPane = target.closest<HTMLElement>('.editor-pane')
    const previewPane = target.closest<HTMLElement>('.preview-pane')
    if (!editorPane && !previewPane) return
    const wrapper = (editorPane ?? previewPane)!
    const path = wrapper.getAttribute('data-path')
    if (!path || path !== opts.activePath.value) return  // inactive tab
    const root = opts.vaultRoot.value
    if (!root) return
    /* Selector strategy:
       - editor→preview: query the .preview-pane itself (it owns the
         scroll, NOT the .article inside it — see the long comment).
       - preview→editor: query the .cm-scroller (it owns the scroll;
         .editor-pane has no overflow). */
    const previewSel = `.preview-pane[data-path="${attrEscape(path)}"]`
    const editorSel = `.editor-pane[data-path="${attrEscape(path)}"] .cm-scroller`
    if (editorPane) {
      const preview = root.querySelector<HTMLElement>(previewSel)
      if (preview) syncTo(target, preview)
    } else if (previewPane) {
      const editor = root.querySelector<HTMLElement>(editorSel)
      if (editor) syncTo(target, editor)
    }
  }

  function attach() {
    const root = opts.vaultRoot.value
    if (!root) return
    /* Capture phase — scroll events are dispatched at the target
       and bubble up, but the bubble path is inconsistently supported
       across browsers (Safari in particular used to fire only at
       the target). Capturing on the vault root guarantees we see
       every scroll on every descendant. Passive because we never
       preventDefault, so the browser doesn't have to wait on us
       before scrolling. */
    root.addEventListener('scroll', onScroll, { passive: true, capture: true })
  }

  function detach() {
    if (pendingRelease !== null) {
      cancelAnimationFrame(pendingRelease)
      pendingRelease = null
    }
    const root = opts.vaultRoot.value
    if (root) root.removeEventListener('scroll', onScroll, true)
  }

  /* The vault root is mounted once for the lifetime of VaultView, so
     we just attach on the first mount. The listener itself reads
     `activePath` per event so it always honors the current tab —
     no need to re-bind when activePath changes. flush:'post' +
     rAF ensures the vault root ref is bound and the first render
     has flushed before we attach. */
  watch(
    () => opts.vaultRoot.value,
    (root) => {
      detach()
      if (!root) return
      requestAnimationFrame(attach)
    },
    { immediate: true, flush: 'post' },
  )

  onBeforeUnmount(detach)
}
