export type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

export interface Tab {
  slug: string
  title: string
  raw: string
  originalRaw: string
  saveStatus: SaveStatus
  error: string | null
  loadError: string | null
  loading: boolean
}
