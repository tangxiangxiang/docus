// Active-note tracking. The AI panel reads the current note's path
// + content from this composable when sending a chat message so the
// model has the right context. Singleton (like useAiHistory) because
// the vault view and the AI panel need to agree on what "current"
// means.
//
// Known limitation (see spec §3.7): the content is the SERVER-SAVED
// version, not the editor's live unsaved buffer. Auto-save debounces
// 800ms, so this is usually fine, but a freshly typed sentence can
// be missing for that window. A future spec will route live editor
// state through useEditorTabs.
import { ref, watch, type Ref } from 'vue'
import { useRoute, type RouteLocationNormalizedLoaded } from 'vue-router'
import { getPost } from '../../lib/api'
import { getLiveTabs, __resetLiveTabsForTesting as _resetLiveTabs } from './useEditorTabs.js'

export interface CurrentNote {
  path: Ref<string | null>
  content: Ref<string>
}

let _state: CurrentNote | null = null

// Test-only escape hatch.
export function __resetForTesting(): void {
  _state = null
  _resetLiveTabs()
}

function pathFromRoute(route: RouteLocationNormalizedLoaded): string | null {
  // The production router declares TWO vault routes (see src/router/index.ts):
  //   - 'vault'      for the /vault index (no path)
  //   - 'vault-doc'  for /vault/:pathMatch(.*)* (a path-bearing URL)
  // Either way, when a document is open, the path is in params.pathMatch.
  // Some tests still use a single 'vault' route with a 'path' param — we
  // accept both param names for the same reason.
  if (route.name !== 'vault' && route.name !== 'vault-doc') return null
  const splat = (route.params.path ?? route.params.pathMatch) as
    | string | string[] | undefined
  if (!splat) return null
  return Array.isArray(splat) ? splat.join('/') : splat
}

export function useCurrentNote(): CurrentNote {
  if (_state) return _state
  const route = useRoute()
  const path = ref<string | null>(null)
  const content = ref<string>('')

  const liveTabs = getLiveTabs()

  // Resolve content for a given path. Two-tier fallback:
  //   1. Live editor buffer (tab.raw) if a tab is open for this path
  //      and has finished loading. This is what the user has actually
  //      typed, including unsaved keystrokes.
  //   2. getPost() — the server-saved version. Used for deep links to
  //      notes that haven't been opened in a tab yet, and when
  //      useEditorTabs has never been mounted in this session.
  async function resolveContent(p: string): Promise<string> {
    const tab = liveTabs?.value.find((t) => t.path === p)
    if (tab && !tab.loading) return tab.raw
    try {
      const post = await getPost(p)
      return post.content
    } catch {
      return ''
    }
  }

  watch(
    // fullPath is the safest source: it's a string that vue-router
    // guarantees changes whenever the URL changes, regardless of which
    // route record matched or which splat param name it used. The
    // earlier `() => route.params.path` source was undefined in
    // production (the splat param is named `pathMatch`), so the watch
    // never re-fired on navigation.
    [() => route.fullPath, liveTabs],
    async () => {
      const p = pathFromRoute(route)
      path.value = p
      if (!p) {
        content.value = ''
        return
      }
      content.value = await resolveContent(p)
    },
    { immediate: true, deep: true },
  )

  _state = { path, content }
  return _state
}
