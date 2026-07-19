export const UNSAVED_DRAFT_VERSION = 1 as const

export interface UnsavedDraft {
  version: typeof UNSAVED_DRAFT_VERSION
  vaultId: string
  documentId: string
  documentPath: string
  content: string
  baseContentHash: string | null
  baseModifiedAt: number | null
  createdAt: number
  updatedAt: number
}

export function isUnsavedDraft(value: unknown): value is UnsavedDraft {
  if (typeof value !== 'object' || value === null) return false

  const candidate = value as Partial<Record<keyof UnsavedDraft, unknown>>
  return candidate.version === UNSAVED_DRAFT_VERSION
    && isNonEmptyString(candidate.vaultId)
    && isNonEmptyString(candidate.documentId)
    && isNonEmptyString(candidate.documentPath)
    && typeof candidate.content === 'string'
    && (candidate.baseContentHash === null
      || typeof candidate.baseContentHash === 'string')
    && (candidate.baseModifiedAt === null
      || isNonNegativeFiniteNumber(candidate.baseModifiedAt))
    && isNonNegativeFiniteNumber(candidate.createdAt)
    && isNonNegativeFiniteNumber(candidate.updatedAt)
    && candidate.createdAt <= candidate.updatedAt
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

export function cloneDraft(draft: UnsavedDraft): UnsavedDraft {
  return { ...draft }
}

