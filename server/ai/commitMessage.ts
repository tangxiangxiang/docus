import Anthropic from '@anthropic-ai/sdk'
import { resolveAiRuntimeConfig } from './llm.js'
import { ChatError } from './errors.js'
import { getDb } from '../db.js'

const MAX_TOKENS = 80
const MAX_CONTEXT_CHARS = 20_000
const MAX_MESSAGE_CHARS = 120

export class CommitMessagePromptLimitError extends Error {
  constructor() {
    super(`AI commit-message prompt exceeds the ${MAX_CONTEXT_CHARS}-character limit`)
    this.name = 'CommitMessagePromptLimitError'
  }
}

function cleanCommitMessage(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:text)?\s*/i, '')
    .replace(/```$/i, '')
    .trim()
    .split(/\r?\n/)[0]
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, MAX_MESSAGE_CHARS)
    .trim()
}

export async function generateCommitMessage(opts: {
  paths: string[]
  selectedPath?: string
  diffText?: string
  language?: 'zh' | 'en'
  changes: Array<{
    path: string
    changeKind: 'added' | 'modified' | 'deleted'
    diff: string
  }>
  signal?: AbortSignal
}): Promise<string> {
  const cfg = resolveAiRuntimeConfig(getDb())
  if (!cfg.apiKey) throw new ChatError('no-api-key')
  const client = new Anthropic(cfg.baseURL ? { apiKey: cfg.apiKey, baseURL: cfg.baseURL } : { apiKey: cfg.apiKey })

  const context = [
    `Selected files:\n${opts.paths.map((p) => `- ${p}`).join('\n')}`,
    opts.selectedPath ? `Focused diff file:\n${opts.selectedPath}` : '',
    opts.diffText ? `Focused diff:\n${opts.diffText}` : '',
    opts.changes.length
      ? `Actual working-tree changes:\n${opts.changes.map((change) => (
          `--- ${change.path} (${change.changeKind}) ---\n${change.diff}`
        )).join('\n\n')}`
      : '',
  ].filter(Boolean).join('\n\n')
  if (context.length > MAX_CONTEXT_CHARS) throw new CommitMessagePromptLimitError()

  let response
  try {
    response = await client.messages.create({
      model: cfg.model,
      max_tokens: MAX_TOKENS,
      temperature: 0,
      system: [
        'Generate exactly one git commit message subject line.',
        opts.language === 'zh'
          ? 'Write the subject line in concise Simplified Chinese.'
          : 'Write the subject line in concise English, in imperative mood, like "Update history diff layout".',
        'Do not use quotes, markdown, bullet points, trailing period, or explanations.',
        'Keep it under 72 characters when possible.',
        'Prefer the focused diff when it is available; otherwise summarize the selected files.',
      ].join('\n'),
      messages: [{ role: 'user', content: context }],
    }, { signal: opts.signal })
  } catch (err) {
    if (opts.signal?.aborted) throw new ChatError('aborted')
    throw new ChatError('llm-error', (err as Error).message)
  }

  const raw = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
  const message = cleanCommitMessage(raw)
  if (!message) throw new ChatError('parse-failed', 'empty commit message from model')
  return message
}
