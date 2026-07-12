import { useStorage } from '@vueuse/core'

export function useEditorPreferences() {
  return {
    fontSize: useStorage('docus.editor.font-size', 14),
    lineHeight: useStorage('docus.editor.line-height', 22),
    tabSize: useStorage('docus.editor.tab-size', 2),
    wrapColumn: useStorage('docus.editor.wrap-column', 100),
    typography: useStorage('docus.editor.typography', true),
  }
}
