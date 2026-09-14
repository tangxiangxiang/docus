import { describe, expect, it, vi } from 'vitest'

const authFetch = vi.hoisted(() => vi.fn())
vi.mock('../../../lib/auth-session', () => ({ authFetch }))

import { createBoard, deleteBoard, renameBoard } from '../api'

describe('Board API mutation uncertainty', () => {
  it('marks transport failures as uncertain', async () => {
    authFetch.mockRejectedValueOnce(new TypeError('network failed'))

    await expect(createBoard()).rejects.toMatchObject({
      uncertain: true,
      status: 500,
    })
  })

  it('marks a parseable HTTP error as definite', async () => {
    authFetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'invalid title', code: 'BOARD_VALIDATION_ERROR' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    }))

    await expect(createBoard()).rejects.toMatchObject({
      uncertain: false,
      status: 400,
      code: 'BOARD_VALIDATION_ERROR',
    })
  })

  it('marks an unreadable response as uncertain', async () => {
    authFetch.mockResolvedValueOnce(new Response('not json', { status: 500 }))

    await expect(createBoard()).rejects.toMatchObject({
      uncertain: true,
      status: 500,
    })
  })

  it.each([
    ['rename', () => renameBoard('board-1', 'Renamed')],
    ['delete', () => deleteBoard('board-1')],
  ])('marks %s transport failures as uncertain', async (_operation, mutation) => {
    authFetch.mockRejectedValueOnce(new TypeError('network failed'))

    await expect(mutation()).rejects.toMatchObject({ uncertain: true })
  })
})
