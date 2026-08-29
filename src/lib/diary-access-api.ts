import { authFetch } from './auth-session'
import { jsonOrThrow } from './api'

export type DiaryAccessState = 'UNINITIALIZED' | 'LOCKED' | 'UNLOCKED'

export interface DiaryAccessStatus {
  state: DiaryAccessState
  epoch?: number
}

export interface DiaryAccessUnlocked extends DiaryAccessStatus {
  state: 'UNLOCKED'
  capability: string
  epoch: number
}

function isState(value: unknown): value is DiaryAccessState {
  return value === 'UNINITIALIZED' || value === 'LOCKED' || value === 'UNLOCKED'
}

function validateStatus(value: unknown): DiaryAccessStatus {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Diary access returned an invalid status.')
  }
  const record = value as Record<string, unknown>
  if (!isState(record.state)) throw new Error('Diary access returned an invalid status.')
  return {
    state: record.state,
    ...(typeof record.epoch === 'number' ? { epoch: record.epoch } : {}),
  }
}

function validateUnlocked(value: unknown): DiaryAccessUnlocked {
  const status = validateStatus(value)
  const record = value as Record<string, unknown>
  if (status.state !== 'UNLOCKED' || typeof record.capability !== 'string' || !record.capability) {
    throw new Error('Diary access returned an invalid unlock response.')
  }
  if (typeof record.epoch !== 'number' || !Number.isSafeInteger(record.epoch)) {
    throw new Error('Diary access returned an invalid unlock response.')
  }
  return { state: 'UNLOCKED', capability: record.capability, epoch: record.epoch }
}

export async function getDiaryAccessStatus(): Promise<DiaryAccessStatus> {
  return validateStatus(await jsonOrThrow(await authFetch('/api/diary/access/status')))
}

async function postPassword(path: string, password: string): Promise<DiaryAccessUnlocked> {
  return validateUnlocked(await jsonOrThrow(await authFetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password }),
  })))
}

export function setupDiaryAccess(password: string): Promise<DiaryAccessUnlocked> {
  return postPassword('/api/diary/access/setup', password)
}

export function unlockDiaryAccess(password: string): Promise<DiaryAccessUnlocked> {
  return postPassword('/api/diary/access/unlock', password)
}

export async function lockDiaryAccess(): Promise<void> {
  await jsonOrThrow(await authFetch('/api/diary/access/lock', { method: 'POST' }))
}
