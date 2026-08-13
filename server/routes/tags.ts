import { Hono } from 'hono'
import { CONTENT_DIR } from '../paths.js'
import { preflightTagIdentityHealth } from '../tagIdentityMigration.js'
import {
  TagManagementError,
  isPlanFingerprint,
  listManagedTags,
  parsePreviewPageRequest,
  parseTagOperation,
  previewTagOperation,
  previewTagOperationPage,
} from '../tagManagement.js'
import { metadataDb } from './shared.js'

const tagRoutes = new Hono()

function managementUnavailable(c: any, code: string | undefined) {
  return c.json({
    error: 'Tag management is temporarily unavailable.',
    code: 'TAG_MANAGEMENT_UNAVAILABLE',
    details: code ? { healthCode: code.slice(0, 128) } : {},
  }, 503)
}

async function requireManagementHealth(c: any): Promise<Response | null> {
  try {
    const health = await preflightTagIdentityHealth(metadataDb(), CONTENT_DIR)
    if (health.state !== 'healthy') return managementUnavailable(c, health.code)
    return null
  } catch {
    return managementUnavailable(c, 'TAG_MANAGEMENT_UNAVAILABLE')
  }
}

function domainError(c: any, error: TagManagementError): Response {
  const status = error.code === 'TAG_NOT_FOUND' ? 404
    : error.code === 'TAG_MANAGEMENT_UNAVAILABLE' || error.code === 'TAG_IDENTITY_CONFLICT' ? 503
      : error.code === 'PREVIEW_STALE'
        || error.code === 'DESTINATION_EXISTS'
        || error.code === 'SOURCE_DESTINATION_SAME' ? 409
          : 400
  return c.json({
    error: error.message,
    code: error.code,
    details: {
      ...error.details,
      ...(error.code === 'DESTINATION_EXISTS' ? {
        destinationTagId: error.details.destinationTagId ?? null,
        destinationDisplayName: error.details.destinationDisplayName ?? null,
      } : {}),
    },
  }, status)
}

function unexpectedError(c: any): Response {
  return c.json({
    error: 'Tag management operation failed.',
    code: 'TRANSACTION_FAILED',
    details: {},
  }, 500)
}

tagRoutes.get('/api/tags', async (c) => {
  const unavailable = await requireManagementHealth(c)
  if (unavailable) return unavailable
  try {
    return c.json(listManagedTags(metadataDb()))
  } catch (error) {
    if (error instanceof TagManagementError) return domainError(c, error)
    return unexpectedError(c)
  }
})

tagRoutes.post('/api/tags/operations/preview', async (c) => {
  const unavailable = await requireManagementHealth(c)
  if (unavailable) return unavailable
  const body = await c.req.json().catch(() => null)
  try {
    const parsed = parseTagOperation(body)
    return c.json(previewTagOperation(metadataDb(), parsed.operation))
  } catch (error) {
    if (error instanceof TagManagementError) return domainError(c, error)
    return unexpectedError(c)
  }
})

tagRoutes.post('/api/tags/operations/preview/page', async (c) => {
  const unavailable = await requireManagementHealth(c)
  if (unavailable) return unavailable
  const body = await c.req.json().catch(() => null)
  try {
    const parsed = parsePreviewPageRequest(body)
    if (!isPlanFingerprint(parsed.planFingerprint)) {
      return domainError(c, new TagManagementError('INVALID_OPERATION', 'planFingerprint is invalid'))
    }
    return c.json(previewTagOperationPage(
      metadataDb(),
      parsed.operation,
      parsed.planFingerprint,
      parsed.afterDocumentId,
      parsed.limit,
    ))
  } catch (error) {
    if (error instanceof TagManagementError) return domainError(c, error)
    return unexpectedError(c)
  }
})

export default tagRoutes
