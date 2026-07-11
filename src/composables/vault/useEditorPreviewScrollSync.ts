import { onBeforeUnmount, watch, type Ref } from 'vue'

/* In edit mode the Monaco editor and preview pane (rendered
   markdown) sit side-by-side. The two surfaces have very different
   line heights — Monaco is monospace at ~22px per line, the preview
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
   next animation frame.

   We use **event delegation on the vault root** (capture phase)
   rather than attaching listeners directly to the inner scrollers.
   The inner elements are not stable: Monaco mounts its primary
   .editor-scrollable asynchronously inside EditorPane, and loading
   tabs do not have an editor scroll container yet. By
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
     scrollable element is Monaco's `.editor-scrollable`.

   - **Preview side**: the scrollable element is **`.preview-pane`
     itself**, not `.article` inside it. style.css gives both
     `.preview-pane` owns `overflow:auto`; its `.article` child is
     deliberately `overflow:visible` and grows with the rendered
     document. Keeping one scroll owner avoids nested scroll areas
     and ensures both wheel input and editor sync update the same
     element. Earlier implementations queried `.article` and set
     its `scrollTop`, which was a silent no-op. */

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
  setEditorScrollFraction?: (path: string, fraction: number) => void
}) {
  let syncing = false
  let pendingRelease: number | null = null

  function beginSync() {
    syncing = true
    if (pendingRelease !== null) cancelAnimationFrame(pendingRelease)
    pendingRelease = requestAnimationFrame(() => {
      syncing = false
      pendingRelease = null
    })
  }

  function onScroll(e: Event) {
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
         - .editor-scrollable (editor) — child of .editor-pane
         - .preview-pane itself (preview) — it IS the wrapper when
           the user scrolls the preview, because .preview-pane is
           the actual scroll container (see the long comment at the
           top of this file). closest('.preview-pane') on the
           wrapper element returns itself. */
    const previewPane = target.closest<HTMLElement>('.preview-pane')
    if (!previewPane) return
    const wrapper = previewPane
    const path = wrapper.getAttribute('data-path')
    if (!path || path !== opts.activePath.value) return  // inactive tab
    const root = opts.vaultRoot.value
    if (!root) return
    /* Selector strategy:
       - editor→preview: query the .preview-pane itself (it owns the
         scroll, NOT the .article inside it — see the long comment).
       - preview→editor: query Monaco's .editor-scrollable;
         .editor-pane has no overflow). */
    const fraction = target.scrollTop / Math.max(1, scrollMax(target))
    if (opts.setEditorScrollFraction) {
      beginSync()
      opts.setEditorScrollFraction(path, fraction)
    }
  }

  function syncPreviewFromEditor(path: string, fraction: number) {
    /* Note: we do NOT check `syncing` here. The flag protects
       onScroll from echoing the programmatic scrollTop we just
       assigned; gating THIS entry point on the same flag would
       drop the second of two rapid user scrolls that arrive inside
       the same rAF window (Monaco fires onDidScrollChange →
       scroll-change continuously while the user wheels, each one
       of which must reach the preview). The path check still
       blocks inactive tabs. */
    if (path !== opts.activePath.value) return
    const root = opts.vaultRoot.value
    if (!root) return
    const preview = root.querySelector<HTMLElement>(`.preview-pane[data-path="${attrEscape(path)}"]`)
    if (!preview || scrollMax(preview) <= 0) return
    beginSync()
    preview.scrollTop = Math.max(0, Math.min(1, fraction)) * scrollMax(preview)
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
  return { syncPreviewFromEditor }
}
