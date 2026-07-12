import { useStorage } from '@vueuse/core'
import { watch } from 'vue'

const fontSize = useStorage('docus.editor.font-size', 14)
const lineHeight = useStorage('docus.editor.line-height', 22)
const tabSize = useStorage<2 | 4>('docus.editor.tab-size', 2)
const wrapColumn = useStorage('docus.editor.wrap-column', 100)
const fontFamily = useStorage('docus.editor.font-family', '')
const typography = useStorage('docus.editor.typography', true)

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(value)))
watch(fontSize, (value) => { fontSize.value = clamp(Number(value) || 14, 11, 24) })
watch(lineHeight, (value) => { lineHeight.value = clamp(Number(value) || 22, 16, 40) })
watch(wrapColumn, (value) => { wrapColumn.value = clamp(Number(value) || 100, 60, 160) })
watch(tabSize, (value) => { tabSize.value = Number(value) === 4 ? 4 : 2 })

function reset() {
  fontSize.value = 14
  lineHeight.value = 22
  tabSize.value = 2
  wrapColumn.value = 100
  fontFamily.value = ''
  typography.value = true
}

export function useEditorPreferences() {
  return {
    fontSize, lineHeight, tabSize, wrapColumn, fontFamily, typography, reset,
  }
}
