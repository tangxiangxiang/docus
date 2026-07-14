// Active-note tracking. The AI panel reads the current note's path
// + content from this composable when sending a chat message so the
// model has the right context. Singleton (like useAiHistory) because
// the vault view and the AI panel need to agree on what "current"
// means.
//
// Known limitation (see spec §3.7): the content is the SERVER-SAVED
// version, not the editor's live unsaved buffer. Auto-save debounces
// 800ms, so this is usually fine, but a freshly typed sentence can
// be missing for that window. The live-tab mirror in useEditorTabs
// closes most of that window; the file-change bus subscription
// here additionally keeps `content` in sync with the AI's own
// writes (e.g. write_file / patch_file / rename_file) so the next
// AI turn in the same conversation sees the AI's edits without the
// model having to re-read.
import { ref, watch, type Ref } from 'vue'
import { useRoute, type RouteLocationNormalizedLoaded } from 'vue-router'
import { getPost } from '../../lib/api'
import { getFallbackVaultFileChanges } from './context/fileChanges'
import { useOptionalVaultContext } from './context/useVaultContext'
import type { VaultContext } from './context/types'

export interface CurrentNote {
  path: Ref<string | null>
  content: Ref<string>
}

let stateByContext = new WeakMap<VaultContext, CurrentNote>()
let fallbackState: CurrentNote | null = null

// Test-only escape hatch.
export function __resetForTesting(): void {
  stateByContext = new WeakMap()
  fallbackState = null
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
  const vaultContext = useOptionalVaultContext()
  const existing = vaultContext ? stateByContext.get(vaultContext) : fallbackState
  if (existing) return existing
  const route = useRoute()
  const path = ref<string | null>(null)
  const content = ref<string>('')

  const liveTabs = vaultContext?.editor.tabs
  const fileBus = vaultContext?.fileChanges.events ?? getFallbackVaultFileChanges().events

  // Resolve content for a given path. Two-tier fallback:
  //   1. Live editor buffer (tab.raw) if a tab is open for this path
  //      and has finished loading. This is what the user has actually
  //      typed, including unsaved keystrokes.
  //   2. getPost() — the server-saved version. Used for deep links to
  //      notes that haven't been opened in a tab yet, and when
  //      useEditorTabs has never been mounted in this session.
  async function resolveContent(p: string): Promise<string> {
    const contextContent = vaultContext?.editor.getLiveContent(p)
    if (contextContent !== null && contextContent !== undefined) return contextContent
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

  // Mirror AI file-writes into `content` so the next turn in the
  // same conversation sees the AI's edits without the model having
  // to re-read. Only the active note is mirrored — the AI panel
  // already passes currentNote.content to the server, so keeping
  // this ref accurate is enough to make the model see itself.
  let lastSeenSeq = 0
  watch(
    () => fileBus.value,
    (events) => {
      const p = path.value
      if (!p) return
      for (const e of events) {
        if (e.seq <= lastSeenSeq) continue
        if (e.kind === 'write' && e.path === p && e.newRaw != null) {
          content.value = e.newRaw
        } else if (e.kind === 'rename' && e.path === p && e.newRaw != null) {
          // The active path was just renamed; the route is
          // expected to follow, but the content update is the
          // important part for any in-flight reads.
          content.value = e.newRaw
        }
      }
      lastSeenSeq = events.at(-1)?.seq ?? lastSeenSeq
    },
    { flush: 'post' },
  )

  const state = { path, content }
  if (vaultContext) stateByContext.set(vaultContext, state)
  else fallbackState = state
  return state
}
