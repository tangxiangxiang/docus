import { useStorage } from '@vueuse/core'

// Device-local presentation preference. New users default to the denser,
// single-line tree; turning it off lets the selected row reveal its path.
const compactFileTree = useStorage('docus.file-tree.compact', true)

export function useFileTreePreferences() {
  return { compactFileTree }
}
