import { authFetch } from '../../lib/auth-session'
import { jsonOrThrow } from '../../lib/api'
import type { BoardMetadata, BoardSceneRecord } from '../../../shared/boardProtocol'

export interface BoardAggregate {
  metadata: BoardMetadata
  sceneRecord: BoardSceneRecord
}

export class BoardApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(message: string, status = 500, code = 'BOARD_API_ERROR') {
    super(message)
    this.name = 'BoardApiError'
    this.status = status
    this.code = code
  }
}

function asBoardApiError(error: unknown): BoardApiError {
  if (error instanceof BoardApiError) return error
  const source = error as { message?: unknown; status?: unknown; code?: unknown } | null
  return new BoardApiError(
    typeof source?.message === 'string' && source.message.trim()
      ? source.message
      : 'Board request failed.',
    typeof source?.status === 'number' && Number.isFinite(source.status) ? source.status : 500,
    typeof source?.code === 'string' && source.code.trim() ? source.code : 'BOARD_API_ERROR',
  )
}

async function readJson<T>(response: Response): Promise<T> {
  try {
    return await jsonOrThrow<T>(response)
  } catch (error) {
    throw asBoardApiError(error)
  }
}

async function requestJson<T>(
  path: string,
  method: 'POST' | 'PATCH',
  body: Record<string, unknown>,
): Promise<T> {
  const response = await authFetch(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return readJson<T>(response)
}

export async function listBoards(): Promise<BoardMetadata[]> {
  return readJson<BoardMetadata[]>(await authFetch('/api/board'))
}

export async function createBoard(title?: string): Promise<BoardAggregate> {
  return requestJson<BoardAggregate>('/api/board', 'POST', title === undefined ? {} : { title })
}

export async function renameBoard(boardId: string, title: string): Promise<BoardMetadata> {
  return requestJson<BoardMetadata>(
    `/api/board/${encodeURIComponent(boardId)}`,
    'PATCH',
    { title },
  )
}

export async function deleteBoard(boardId: string): Promise<void> {
  const response = await authFetch(`/api/board/${encodeURIComponent(boardId)}`, { method: 'DELETE' })
  if (response.ok) return
  await readJson<never>(response)
}

export function boardAssetUrl(assetId: string): string {
  return `/api/assets/${encodeURIComponent(assetId)}`
}
