import { describe, expect, it } from 'vitest'
import MarkdownIt from 'markdown-it'
import { findMarkdownCodeInlineSourceRanges } from '../markdownInlineSource'

function inlineChildren(source: string) {
  const md = new MarkdownIt({ html: true })
  const inline = md.parse(source, {}).find((token) => token.type === 'inline')
  return inline?.children ?? []
}

describe('MarkdownIt-guided code_inline source ranges', () => {
  it('maps single-line, multi-line, and variable-length spans', () => {
    const singleSource = '`one` and `two`'
    const singleChildren = inlineChildren(singleSource)
    const singleRanges = findMarkdownCodeInlineSourceRanges(singleSource, singleChildren)
    expect(singleRanges).toHaveLength(2)
    expect(singleRanges.every(Boolean)).toBe(true)

    const multilineSource = '`one\ntwo`'
    const multilineChildren = inlineChildren(multilineSource)
    const multilineRange = findMarkdownCodeInlineSourceRanges(multilineSource, multilineChildren)[0]
    expect(multilineRange).not.toBeNull()
    expect(multilineSource.slice(multilineRange!.start, multilineRange!.end)).toBe(multilineSource)

    const variableSource = '``literal\n` inside\nvalue``'
    const variableChildren = inlineChildren(variableSource)
    const variableRange = findMarkdownCodeInlineSourceRanges(variableSource, variableChildren)[0]
    expect(variableRange).not.toBeNull()
    expect(variableRange?.markerLength).toBe(2)
  })

  it('matches MarkdownIt code-span normalization for surrounding spaces', () => {
    const source = '` surrounding `'
    const children = inlineChildren(source)
    expect(children).toMatchObject([
      { type: 'code_inline', content: 'surrounding', markup: '`' },
    ])

    const range = findMarkdownCodeInlineSourceRanges(source, children)[0]
    expect(range).not.toBeNull()
    expect(source.slice(range!.start, range!.end)).toBe(source)
  })

  it('maps actual children despite unrelated raw backticks', () => {
    const source = '<span title="`not-code-inline`">x</span> `included\nroot`'
    const children = inlineChildren(source)
    expect(children.filter((child) => child.type === 'html_inline')).not.toHaveLength(0)
    expect(children.filter((child) => child.type === 'code_inline')).toHaveLength(1)

    const ranges = findMarkdownCodeInlineSourceRanges(source, children)
    expect(ranges).toHaveLength(1)
    expect(ranges[0]).not.toBeNull()
    expect(source.slice(ranges[0]!.start, ranges[0]!.end)).toBe('`included\nroot`')
  })

  it('lets html_inline ownership disambiguate identical multiline content', () => {
    const source = '<span title="`same content`">x</span> `same\ncontent`'
    const children = inlineChildren(source)
    expect(children.filter((child) => child.type === 'html_inline')).not.toHaveLength(0)
    expect(children.filter((child) => child.type === 'code_inline')).toHaveLength(1)

    const ranges = findMarkdownCodeInlineSourceRanges(source, children)
    expect(ranges).toHaveLength(1)
    expect(ranges[0]).not.toBeNull()
    expect(source.slice(ranges[0]!.start, ranges[0]!.end)).toBe('`same\ncontent`')
  })

  it('does not let an identical html_inline span impersonate a one-line code span', () => {
    const source = '<span title="`same`">x</span> `same`'
    const children = inlineChildren(source)
    const ranges = findMarkdownCodeInlineSourceRanges(source, children)

    expect(ranges).toHaveLength(1)
    expect(ranges[0]).not.toBeNull()
    expect(source.slice(ranges[0]!.start, ranges[0]!.end)).toBe('`same`')
    expect(ranges[0]!.start).toBe(source.lastIndexOf('`same`'))
  })

  it('maps repeated identical code_inline children in actual order', () => {
    const source = '<span title="`same`">x</span> `same` and `same`'
    const children = inlineChildren(source)
    const ranges = findMarkdownCodeInlineSourceRanges(source, children)

    expect(ranges).toHaveLength(2)
    expect(ranges.every(Boolean)).toBe(true)
    expect(ranges.map((range) => source.slice(range!.start, range!.end)))
      .toEqual(['`same`', '`same`'])
    expect(ranges[0]!.start).toBe(source.indexOf('`same`', source.indexOf('</span>')))
    expect(ranges[1]!.start).toBe(source.lastIndexOf('`same`'))
  })

  it('consumes multiple html_inline anchors before mapping a later code span', () => {
    const source = '<a title="`same`">a</a> <span title="`same`">b</span> `same`'
    const children = inlineChildren(source)
    const ranges = findMarkdownCodeInlineSourceRanges(source, children)

    expect(ranges).toHaveLength(1)
    expect(ranges[0]).not.toBeNull()
    expect(ranges[0]!.start).toBe(source.lastIndexOf('`same`'))
  })

  it('does not manufacture a range for unmatched or unrelated blocks', () => {
    const unmatchedSource = '`unclosed opener'
    expect(findMarkdownCodeInlineSourceRanges(unmatchedSource, inlineChildren(unmatchedSource))).toEqual([])

    const source = '`unclosed opener\n\n`real`'
    const blocks = new MarkdownIt({ html: true }).parse(source, {})
      .filter((token) => token.type === 'inline')
    expect(blocks).toHaveLength(2)
    expect(findMarkdownCodeInlineSourceRanges(blocks[0]!.content, blocks[0]!.children ?? [])).toEqual([])
    const ranges = findMarkdownCodeInlineSourceRanges(blocks[1]!.content, blocks[1]!.children ?? [])
    expect(ranges).toHaveLength(1)
    expect(ranges[0]).not.toBeNull()
  })
})
