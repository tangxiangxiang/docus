import MarkdownIt from 'markdown-it'

// AI output is model-generated and may echo text from files or tool results.
// Keep raw HTML disabled here even though the document renderer intentionally
// allows it for the user's own Markdown files.
const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
})

export function renderAiMarkdown(source: string): string {
  return md.render(source)
}
