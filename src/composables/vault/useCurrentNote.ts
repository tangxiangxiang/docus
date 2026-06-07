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

export interface CurrentNote {
  path: Ref<string | null>
  content: Ref<string>
}

let _state: CurrentNote | null = null

// Test-only escape hatch.
export function __resetForTesting(): void {
  _state = null
}

function pathFromRoute(route: RouteLocationNormalizedLoaded): string | null {
  if (route.name !== 'vault') return null
  const splat = route.params.path
  if (!splat) return null
  return Array.isArray(splat) ? splat.join('/') : (splat as string)
}

export function useCurrentNote(): CurrentNote {
  if (_state) return _state
  const route = useRoute()
  const path = ref<string | null>(null)
  const content = ref<string>('')

  watch(
    () => route.params.path,
    async () => {
      const p = pathFromRoute(route)
      path.value = p
      if (!p) {
        content.value = ''
        return
      }
      try {
        const post = await getPost(p)
        content.value = post.content
      } catch {
        content.value = ''
      }
    },
    { immediate: true },
  )

  _state = { path, content }
  return _state
}
