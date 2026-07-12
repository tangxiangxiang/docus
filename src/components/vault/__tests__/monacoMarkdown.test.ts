import { describe, expect, it } from 'vitest'
import {
  filterMarkdownSlashCommands, indentMarkdownLine, MARKDOWN_WRAPS, markdownContinuation, markdownDecorationSpecs, markdownHeadingTargets, writingDiagnostics,
  markdownLinkFromPaste, markdownWrapEdit, rankWikiTargets, toggleMarkdownWrap, wikiLinkAtColumn,
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
    expect(indentMarkdownLine('    - item', false)).toBe('        - item')
    expect(indentMarkdownLine('    - item', true)).toBe('- item')
    expect(indentMarkdownLine('\t- item', false)).toBe('\t\t- item')
    expect(indentMarkdownLine('\t- item', true)).toBe('- item')
  })

  it('filters slash commands by English labels and Chinese details', () => {
    expect(filterMarkdownSlashCommands('head').map((item) => item.label)).toEqual([
      'heading 1', 'heading 2', 'heading 3',
    ])
    expect(filterMarkdownSlashCommands('图表').map((item) => item.label)).toEqual(['mermaid'])
    expect(filterMarkdownSlashCommands('')).toHaveLength(11)
  })

  it('extracts preview-compatible heading anchors and ignores fenced code', () => {
    expect(markdownHeadingTargets('# Intro\n## 中文 标题\n## Intro\n```md\n# Hidden\n```')).toEqual([
      { title: 'Intro', anchor: 'intro', level: 1 },
      { title: '中文 标题', anchor: '中文-标题', level: 2 },
      { title: 'Intro', anchor: 'intro-2', level: 2 },
    ])
  })

  it('reports common English typos and spacing outside code fences', () => {
    expect(writingDiagnostics('The teh value , failed.  \n```text\nteh ,\n```')).toEqual([
      expect.objectContaining({ line: 1, message: 'Trailing whitespace' }),
      expect.objectContaining({ line: 1, message: 'Possible typo: teh → the' }),
      expect.objectContaining({ line: 1, message: 'Remove the space before “,”' }),
    ])
  })

  it('toggles Markdown formatting around selected text', () => {
    expect(toggleMarkdownWrap('text', MARKDOWN_WRAPS.bold)).toBe('**text**')
    expect(toggleMarkdownWrap('**text**', MARKDOWN_WRAPS.bold)).toBe('text')
  expect(toggleMarkdownWrap('', MARKDOWN_WRAPS.link)).toBe('[link text](https://)')
  expect(markdownWrapEdit('', MARKDOWN_WRAPS.bold)).toEqual({
    text: '**bold text**', selectionOffset: 2, selectionLength: 9,
  })
  })

  it('ranks Wiki Links by relevance and recent use', () => {
    const targets = [
      { path: 'zettel/second-brain', title: 'Building a Second Brain' },
      { path: 'literature/brain', title: 'Brain Notes' },
      { path: 'zettel/boxes', title: 'Zettelkasten' },
    ]
    expect(rankWikiTargets(targets, 'brain', [], '')[0].path).toBe('literature/brain')
    expect(rankWikiTargets(targets, '', ['zettel/boxes'], '')[0].path).toBe('zettel/boxes')
    expect(rankWikiTargets(targets, 'zbx', [], '')[0].path).toBe('zettel/boxes')
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

  it('decorates URLs with balanced parentheses in full', () => {
    const specs = markdownDecorationSpecs('See [Wikipedia](https://en.wikipedia.org/wiki/Link_(film)) and [plain](https://example.com).')
    const linkSpecs = specs.filter((spec) => spec.inlineClassName === 'monaco-md-link')
    expect(linkSpecs).toHaveLength(2)
    const lengths = linkSpecs.map((spec) => spec.endColumn - spec.startColumn)
    // First link contains 54 chars (label + URL with balanced parens).
    expect(lengths[0]).toBe(54)
    // Second link is the simple one.
    expect(lengths[1]).toBe(28)
  })

  it('marks unresolved Wiki Links separately', () => {
    const specs = markdownDecorationSpecs('[[known]] and [[missing]]', new Set(['known']))
    expect(specs.map((spec) => spec.inlineClassName)).toContain('monaco-md-link-invalid')
  })

  it('offsets decoration line numbers for visible-range scans', () => {
    const specs = markdownDecorationSpecs('## Visible heading', undefined, 99)
    expect(specs[0].startLineNumber).toBe(100)
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
