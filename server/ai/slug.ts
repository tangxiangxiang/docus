import { SLUG_RE } from '../paths.js'
import { generateText, resolveAiRuntimeConfig } from './llm.js'
import { ChatError } from './errors.js'
import { getDb } from '../db.js'

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
  const cfg = resolveAiRuntimeConfig(getDb())
  if (!cfg.apiKey) throw new ChatError('no-api-key')

  let result
  try {
    result = await generateText({
      model: cfg.model,
      maxTokens: MAX_TOKENS,
      temperature: 0,
      signal: opts.signal,
      system: [
        'Convert the user input into one concise English lowercase-kebab-case filename slug.',
        'Return only the slug, no prose, no quotes, no markdown.',
        'Allowed characters: a-z, 0-9, hyphen.',
        'Length: 3-60 characters. Do not end with .md.',
      ].join('\n'),
      user: `Kind: ${opts.kind}\nInput: ${text}`,
    })
  } catch (err) {
    if (err instanceof ChatError) throw err
    if (opts.signal?.aborted) throw new ChatError('aborted')
    throw new ChatError('llm-error', (err as Error).message)
  }

  const slug = cleanModelSlug(result.text)
  if (!SLUG_RE.test(slug)) {
    throw new ChatError('parse-failed', 'bad slug from model: ' + result.text.slice(0, 120))
  }
  return slug
}