import { ref } from 'vue'

export function useDocumentHoverCard() {
  const hoverCardVisible = ref(false)
  const hoverCardStyle = ref<Record<string, string>>({})

  function showHoverCard(event: MouseEvent) {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    hoverCardStyle.value = {
      left: `${Math.max(12, Math.min(rect.right + 8, window.innerWidth - 288))}px`,
      top: `${Math.max(12, Math.min(rect.top, window.innerHeight - 180))}px`,
    }
    hoverCardVisible.value = true
  }

  function hideHoverCard() {
    hoverCardVisible.value = false
  }

  return { hoverCardVisible, hoverCardStyle, showHoverCard, hideHoverCard }
}
