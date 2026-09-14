import { jsonOrThrow } from '../../lib/api'
import { authFetch } from '../../lib/auth-session'
import {
  BOARD_ASSET_MIME_TYPES,
  isAssetId,
  isBoardAssetMimeType,
  type BoardAssetMimeType,
} from '../../../shared/assetProtocol'
import { boardAssetUrl } from './api'

export const BOARD_ASSET_MAX_BYTES = 20 * 1024 * 1024

export type BoardAssetErrorCode =
  | 'ASSET_UPLOAD_FAILED'
  | 'ASSET_MISSING'
  | 'ASSET_PENDING_INVALID'
  | 'ASSET_ID_CONFLICT'
  | 'ASSET_RESOLVE_FAILED'

export class BoardAssetError extends Error {
  readonly code: BoardAssetErrorCode
  readonly status: number
  readonly uncertain: boolean

  constructor(
    code: BoardAssetErrorCode,
    message: string,
    status = 500,
    options?: { cause?: unknown; uncertain?: boolean },
  ) {
    super(message, options)
    this.name = 'BoardAssetError'
    this.code = code
    this.status = status
    this.uncertain = options?.uncertain ?? status >= 500
  }
}

export interface AssetUploadResult {
  id: string
  mimeType: BoardAssetMimeType
  byteSize: number
  sha256: string
}

function errorDetails(error: unknown): { message: string; status: number; code?: string } {
  const source = error as {
    message?: unknown
    status?: unknown
    code?: unknown
  } | null
  return {
    message: typeof source?.message === 'string' && source.message.trim()
      ? source.message
      : 'Board asset request failed.',
    status: typeof source?.status === 'number' && Number.isFinite(source.status)
      ? source.status
      : 500,
    code: typeof source?.code === 'string' ? source.code : undefined,
  }
}

function validateAssetInput(assetId: string, mimeType: string, blob: Blob): BoardAssetMimeType {
  const normalizedMimeType = mimeType.trim().toLowerCase()
  if (!isAssetId(assetId)) {
    throw new BoardAssetError('ASSET_UPLOAD_FAILED', 'Asset ID must be a UUID.', 400, { uncertain: false })
  }
  if (!isBoardAssetMimeType(normalizedMimeType)) {
    throw new BoardAssetError('ASSET_UPLOAD_FAILED', 'Asset MIME type is not supported by Board V1.', 415, { uncertain: false })
  }
  if (blob.size <= 0) {
    throw new BoardAssetError('ASSET_UPLOAD_FAILED', 'Asset body must not be empty.', 400, { uncertain: false })
  }
  if (blob.size > BOARD_ASSET_MAX_BYTES) {
    throw new BoardAssetError('ASSET_UPLOAD_FAILED', 'Asset body exceeds the Board V1 size limit.', 413, { uncertain: false })
  }
  return normalizedMimeType
}

function validateUploadResult(
  value: unknown,
  expected: { assetId: string; mimeType: BoardAssetMimeType; byteSize: number },
): AssetUploadResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BoardAssetError('ASSET_UPLOAD_FAILED', 'Asset upload returned an invalid response.', 500, { uncertain: false })
  }
  const result = value as Record<string, unknown>
  if (result.id !== expected.assetId || result.mimeType !== expected.mimeType
    || result.byteSize !== expected.byteSize
    || !isAssetId(result.id) || !isBoardAssetMimeType(result.mimeType)
    || typeof result.byteSize !== 'number' || !Number.isSafeInteger(result.byteSize) || result.byteSize < 0
    || typeof result.sha256 !== 'string' || result.sha256.length === 0) {
    throw new BoardAssetError('ASSET_UPLOAD_FAILED', 'Asset upload returned an invalid response.', 500, { uncertain: false })
  }
  return {
    id: result.id,
    mimeType: result.mimeType,
    byteSize: result.byteSize,
    sha256: result.sha256,
  }
}

export async function uploadAsset(
  assetId: string,
  mimeType: string,
  blob: Blob,
): Promise<AssetUploadResult> {
  const supportedMimeType = validateAssetInput(assetId, mimeType, blob)
  try {
    const response = await authFetch(`/api/assets/${encodeURIComponent(assetId)}`, {
      method: 'PUT',
      headers: { 'content-type': supportedMimeType },
      body: blob,
    })
    if (!response.ok) {
      let parsed: unknown
      try {
        parsed = await jsonOrThrow<unknown>(response)
      } catch (error) {
        const details = errorDetails(error)
        const code = response.status === 409 && details.code === 'ASSET_ID_CONFLICT'
          ? 'ASSET_ID_CONFLICT'
          : 'ASSET_UPLOAD_FAILED'
        throw new BoardAssetError(code, details.message, response.status, {
          cause: error,
          uncertain: false,
        })
      }
      const details = errorDetails(parsed)
      const code = response.status === 409 && details.code === 'ASSET_ID_CONFLICT'
        ? 'ASSET_ID_CONFLICT'
        : 'ASSET_UPLOAD_FAILED'
      throw new BoardAssetError(code, details.message, response.status, { uncertain: false })
    }
    return validateUploadResult(await jsonOrThrow<unknown>(response), {
      assetId,
      mimeType: supportedMimeType,
      byteSize: blob.size,
    })
  } catch (error) {
    if (error instanceof BoardAssetError) throw error
    const details = errorDetails(error)
    throw new BoardAssetError('ASSET_UPLOAD_FAILED', details.message, details.status, { cause: error })
  }
}

export async function fetchAssetBlob(assetId: string): Promise<Blob> {
  if (!isAssetId(assetId)) {
    throw new BoardAssetError('ASSET_RESOLVE_FAILED', 'Asset ID must be a UUID.', 400, { uncertain: false })
  }
  try {
    const response = await authFetch(boardAssetUrl(assetId))
    if (response.status === 404) {
      throw new BoardAssetError('ASSET_MISSING', 'Board asset was not found.', 404, { uncertain: false })
    }
    if (!response.ok) {
      let error: unknown
      try {
        await jsonOrThrow<unknown>(response)
      } catch (caught) {
        error = caught
      }
      const details = errorDetails(error)
      throw new BoardAssetError('ASSET_RESOLVE_FAILED', details.message, response.status, {
        cause: error,
        uncertain: false,
      })
    }
    const blob = await response.blob()
    const mimeType = blob.type.trim().toLowerCase()
    if (blob.size <= 0 || !isBoardAssetMimeType(mimeType)) {
      throw new BoardAssetError('ASSET_RESOLVE_FAILED', 'Board asset returned invalid binary data.', 500, { uncertain: false })
    }
    return blob
  } catch (error) {
    if (error instanceof BoardAssetError) throw error
    const details = errorDetails(error)
    throw new BoardAssetError('ASSET_RESOLVE_FAILED', details.message, details.status, { cause: error })
  }
}

export function isSupportedBoardAssetMimeType(value: unknown): value is BoardAssetMimeType {
  return typeof value === 'string' && (BOARD_ASSET_MIME_TYPES as readonly string[]).includes(value.toLowerCase())
}
