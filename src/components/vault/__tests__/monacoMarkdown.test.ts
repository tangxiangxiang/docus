import { describe, expect, it } from 'vitest'
import {
  indentMarkdownLine, markdownContinuation, markdownDecorationSpecs,
  markdownLinkFromPaste, wikiLinkAtColumn,
} from '../monacoMarkdown'

describe('Monaco Markdown helpers', () => {
  it('continues bullets, ordered lists, and task lists', () => {
    expect(markdownContinuation('- item')).toEqual({ insert: '\n- ' })
    expect(markdownContinuation('  3. item')).toEqual({ insert: '\n  4. ' })
    expect(markdownContinuation('- [x] done')).toEqual({ insert: '\n- [ ] ' })
  })

  it('exits an empty list item', () => {
    expect(markdownContinuation('  - ')).toEqual({ insert: '\n', removeMarkerFrom: 2 })
  })

  it('turns a URL pasted over selected text into a Markdown link', () => {
    expect(markdownLinkFromPaste('OpenAI', 'https://openai.com')).toBe('[OpenAI](https://openai.com)')
    expect(markdownLinkFromPaste('', 'https://openai.com')).toBeNull()
    expect(markdownLinkFromPaste('OpenAI', 'plain text')).toBeNull()
  })

  it('indents and outdents Markdown list lines', () => {
    expect(indentMarkdownLine('- item', false)).toBe('  - item')
    expect(indentMarkdownLine('  - item', true)).toBe('- item')
  })

  it('finds a Wiki Link target under the pointer', () => {
    expect(wikiLinkAtColumn('See [[notes/idea|Idea]] now', 10)).toBe('notes/idea')
    expect(wikiLinkAtColumn('See [[notes/idea#part]] now', 12)).toBe('notes/idea')
    expect(wikiLinkAtColumn('plain text', 3)).toBeNull()
  })

  it('marks the supported Markdown structures for Monaco', () => {
    const specs = markdownDecorationSpecs('---\ntitle: Note\n---\n# Heading\n> Quote\n**bold** and `code` and [[note]]')
    const classes = specs.flatMap((spec) => [spec.className, spec.inlineClassName]).filter(Boolean)
    expect(classes).toContain('monaco-md-frontmatter-key')
    expect(classes).toContain('monaco-md-frontmatter-value')
    expect(classes).toContain('monaco-md-heading monaco-md-h1')
    expect(classes).toContain('monaco-md-quote')
    expect(classes).toContain('monaco-md-strong')
    expect(classes).toContain('monaco-md-code')
    expect(classes).toContain('monaco-md-link')
  })

  it('handles a long Chinese document without losing line positions', () => {
    const document = Array.from({ length: 2_000 }, (_, index) =>
      index % 10 === 0 ? `## 第 ${index} 节` : `这是第 ${index} 行，包含中文标点（测试）。`,
    ).join('\n')
    const specs = markdownDecorationSpecs(document)
    const headings = specs.filter((spec) => spec.className?.includes('monaco-md-heading'))
    expect(headings).toHaveLength(200)
    expect(headings.at(-1)?.startLineNumber).toBe(1_991)
  })
})
