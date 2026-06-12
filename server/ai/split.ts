// AI split-to-draft orchestrator. Pure function of (path, mode) → Card[].
// One non-streaming Claude call; the model is told to return JSON only
// (no prose, no code fences), then we hand-parse and validate.
//
// Lives in server/ai/ alongside chat.ts because it shares the LLM
// wrapper (./llm.js → streamClaude). The non-streaming cousin is
// `messages.create` from the SDK; we don't go through streamClaude
// because we want the full result in one shot, not a stream of tokens
// we'd then re-assemble.
//
// The route layer (./routes.ts) maps ChatError / parse errors to HTTP
// status codes. This module only knows about the prompt, the SDK, and
// the output schema.
import Anthropic from '@anthropic-ai/sdk'
import { resolveApiKey } from './llm.js'
import { ChatError } from './errors.js'
import type { Card, SplitMode } from '../../src/lib/ai-api.js'

const MAX_TOKENS = 4096
const MAX_NOTE_CHARS = 8000
const MAX_CARDS = 12
const SEGMENT_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/

const BASE_SYSTEM_PROMPT = `You are a "Zettelkasten assistant" helping a user split a long note into atomic cards.

An "atomic card" is a single self-contained idea. The title is the noun phrase that names the idea. The body is a self-contained restatement that can be read on its own without seeing the original note.

Hard rules:
- Each card = ONE idea, not a chapter, not a section, not a list item.
- 1 to 12 cards per note. Most inbox notes split into 3-7 cards. If a note is short or has only one idea, return 1 card.
- Title: 2-12 words, no punctuation other than hyphens, names the idea as a noun phrase ("Domain events as a decoupling boundary" not "On Domain Events").
- Body: 100-300 words. The body must restate the idea in the voice specified below, not just quote the original.
- Tags: 1-5 lowercase-kebab-case tags (a-z0-9 and hyphens), like "distributed-systems".
- Slug: a-z0-9 and hyphens, 3-50 chars, derived from the title.
- Do NOT include any preamble, code fences, or commentary. Return ONLY the JSON array.

Output schema (return exactly this shape, no prose, no code fences):
[
  { "title": "...", "body": "...", "tags": ["...", "..."], "slug": "..." }
]`

const INBOX_USER_PREFIX = `Mode: inbox — these are the user's own words. Restate each idea in the user's voice (first-person, plain, direct). Treat the source as a thought-dump; pull out the underlying arguments, don't summarize the structure.

Source note path: `

const LITERATURE_USER_PREFIX = `Mode: literature — this is something the user is reading. Each card should capture ONE idea from the source in your own words, with the original phrasing preserved as a quote if it's the most precise way to express the idea. Aim for fidelity to the author's argument, not restatement of structure.

Source note path: `

function buildUserPrompt(mode: SplitMode, path: string, raw: string): string {
  const prefix = mode === 'inbox' ? INBOX_USER_PREFIX : LITERATURE_USER_PREFIX
  // Guard: a very long note would silently bloat the context or get
  // silently truncated by the SDK. We truncate the *body* (not the
  // frontmatter metadata) and prepend a marker so the model knows.
  const body = raw.length > MAX_NOTE_CHARS
    ? '…(note truncated to first ' + MAX_NOTE_CHARS + ' characters)\n\n' + raw.slice(0, MAX_NOTE_CHARS)
    : raw
  return prefix + path + '\n\n' + body
}

/** Raw shape the model is told to produce. The server fills `source`
 *  and `splitMode` so the model cannot claim a different origin. */
type ModelCard = Pick<Card, 'title' | 'body' | 'tags' | 'slug'>

function parseCards(raw: string): ModelCard[] {
  // Strip optional code fences the model sometimes wraps the JSON in
  // despite the system prompt. The fence regex is greedy on the opener
  // and matches any language tag.
  const stripped = raw.replace(/^\s*```(?:json)?\s*\n/, '').replace(/\n```\s*$/, '').trim()
  let parsed: unknown
  try { parsed = JSON.parse(stripped) } catch {
    throw new ChatError('parse-failed', 'model returned non-JSON: ' + raw.slice(0, 200))
  }
  if (!Array.isArray(parsed)) {
    throw new ChatError('parse-failed', 'model output was not an array')
  }
  const out: ModelCard[] = []
  for (const item of parsed) {
    if (
      !item || typeof item !== 'object' ||
      typeof (item as any).title !== 'string' ||
      typeof (item as any).body !== 'string' ||
      !Array.isArray((item as any).tags) ||
      (item as any).tags.some((t: unknown) => typeof t !== 'string') ||
      typeof (item as any).slug !== 'string'
    ) {
      throw new ChatError('parse-failed', 'card failed shape check: ' + JSON.stringify(item).slice(0, 200))
    }
    const slug = (item as any).slug
    if (!SEGMENT_RE.test(slug)) {
      throw new ChatError('parse-failed', 'bad slug from model: ' + slug)
    }
    out.push({
      title: (item as any).title,
      body: (item as any).body,
      tags: (item as any).tags as string[],
      slug,
    })
  }
  return out
}

/** Run the split. Returns 1-12 Card[] (truncated if the model overshoots).
 *  Throws ChatError('no-api-key') | ChatError('parse-failed') | ChatError('aborted') | ChatError('llm-error'). */
export async function runSplit(opts: {
  path: string
  mode: SplitMode
  raw: string
  model?: string
  signal?: AbortSignal
}): Promise<Card[]> {
  if (opts.signal?.aborted) {
    throw new ChatError('aborted')
  }
  const apiKey = resolveApiKey()
  if (!apiKey) throw new ChatError('no-api-key')
  const baseURL = process.env.ANTHROPIC_BASE_URL
  const client = new Anthropic(baseURL ? { apiKey, baseURL } : { apiKey })
  let response
  try {
    response = await client.messages.create({
      model: opts.model ?? process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6',
      max_tokens: MAX_TOKENS,
      system: BASE_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(opts.mode, opts.path, opts.raw) }],
    }, { signal: opts.signal })
  } catch (err) {
    // The SDK's HTTP layer surfaces aborts as a thrown error rather
    // than a structured abort event; the user-provided signal is the
    // most reliable signal that this was a cancel, not an LLM error.
    if (opts.signal?.aborted) throw new ChatError('aborted')
    throw new ChatError('llm-error', (err as Error).message)
  }
  // Extract the first text block. The system prompt forbids non-text blocks,
  // but the model can technically still emit them — we ignore anything
  // that isn't text rather than failing the whole split.
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
  const parsed = parseCards(text)
  const limited = parsed.slice(0, MAX_CARDS)
  return limited.map((m) => ({ ...m, source: opts.path, splitMode: opts.mode }))
}