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
