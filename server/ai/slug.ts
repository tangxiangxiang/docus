import Anthropic from '@anthropic-ai/sdk'
import { SLUG_RE } from '../paths.js'
import { resolveApiKey } from './llm.js'
import { ChatError } from './errors.js'

const MAX_TOKENS = 64
const MAX_INPUT_CHARS = 160

function cleanModelSlug(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:text)?\s*/i, '')
    .replace(/```$/i, '')
    .trim()
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
}

export async function generateSlug(opts: {
  input: string
  kind: 'file' | 'folder'
  signal?: AbortSignal
}): Promise<string> {
  const text = opts.input.trim().slice(0, MAX_INPUT_CHARS)
  if (!text) throw new ChatError('parse-failed', 'empty input')
  const apiKey = resolveApiKey()
  if (!apiKey) throw new ChatError('no-api-key')
  const baseURL = process.env.ANTHROPIC_BASE_URL
  const client = new Anthropic(baseURL ? { apiKey, baseURL } : { apiKey })

  let response
  try {
    response = await client.messages.create({
      model: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6',
      max_tokens: MAX_TOKENS,
      temperature: 0,
      system: [
        'Convert the user input into one concise English lowercase-kebab-case filename slug.',
        'Return only the slug, no prose, no quotes, no markdown.',
        'Allowed characters: a-z, 0-9, hyphen.',
        'Length: 3-60 characters. Do not end with .md.',
      ].join('\n'),
      messages: [{
        role: 'user',
        content: `Kind: ${opts.kind}\nInput: ${text}`,
      }],
    }, { signal: opts.signal })
  } catch (err) {
    if (opts.signal?.aborted) throw new ChatError('aborted')
    throw new ChatError('llm-error', (err as Error).message)
  }

  const raw = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
  const slug = cleanModelSlug(raw)
  if (!SLUG_RE.test(slug)) {
    throw new ChatError('parse-failed', 'bad slug from model: ' + raw.slice(0, 120))
  }
  return slug
}
