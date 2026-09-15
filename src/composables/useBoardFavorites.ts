import { useStorage } from '@vueuse/core'

const STORAGE_KEY = 'docus.board.favorites'
const favoriteBoardIds = useStorage<string[]>(STORAGE_KEY, [])

function isFavorite(boardId: string): boolean {
  return favoriteBoardIds.value.includes(boardId)
}

function setFavorite(boardId: string, favorite: boolean): void {
  const next = new Set(favoriteBoardIds.value)
  if (favorite) next.add(boardId)
  else next.delete(boardId)
  favoriteBoardIds.value = [...next]
}

export function useBoardFavorites() {
  return { favoriteBoardIds, isFavorite, setFavorite }
}
