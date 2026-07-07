import { describe, it, expect } from 'vitest'
import { assertSafePath, filePathFor, folderPathFor, isValidPathSyntax, isValidSegment } from '../paths.js'

describe('isValidPathSyntax', () => {
  it('accepts top-level post', () => {
    expect(isValidPathSyntax('hello-world')).toBe(true)
  })
  it('accepts nested post', () => {
    expect(isValidPathSyntax('notes/draft')).toBe(true)
  })
  it('accepts deeply nested post', () => {
    expect(isValidPathSyntax('notes/archive/old')).toBe(true)
  })
  it('accepts a bare folder under content', () => {
    expect(isValidPathSyntax('archive')).toBe(true)
  })
  it('rejects empty path', () => {
    expect(isValidPathSyntax('')).toBe(false)
  })
  it('rejects empty segment', () => {
    expect(isValidPathSyntax('notes//draft')).toBe(false)
  })
  it('rejects ..', () => {
    expect(isValidPathSyntax('notes/../etc')).toBe(false)
  })
  it('rejects leading slash', () => {
    expect(isValidPathSyntax('/notes/draft')).toBe(false)
  })
  it('rejects trailing slash', () => {
    expect(isValidPathSyntax('notes/')).toBe(false)
  })
  it('rejects .md extension', () => {
    expect(isValidPathSyntax('notes/draft.md')).toBe(false)
  })
  it('rejects leading hyphen', () => {
    expect(isValidPathSyntax('notes/-draft')).toBe(false)
  })
  it('rejects trailing hyphen', () => {
    expect(isValidPathSyntax('notes/draft-')).toBe(false)
  })

  it('rejects CJK segments', () => {
    expect(isValidPathSyntax('literature/007-思维/001-第一性原理')).toBe(false)
  })
  it('rejects uppercase letters', () => {
    expect(isValidPathSyntax('literature/006-MacOS')).toBe(false)
  })
  it('rejects underscores', () => {
    expect(isValidPathSyntax('literature/draft_v2')).toBe(false)
  })
  it('rejects spaces', () => {
    expect(isValidPathSyntax('literature/draft v2')).toBe(false)
  })
  it('still rejects `..` even with CJK in the rest of the path', () => {
    expect(isValidPathSyntax('literature/007-思维/../etc/passwd')).toBe(false)
  })
  it('still rejects `.md` extension in any segment', () => {
    expect(isValidPathSyntax('literature/007-思维/init.md')).toBe(false)
  })
  it('still rejects leading hyphen', () => {
    expect(isValidPathSyntax('literature/007-思维/-init')).toBe(false)
  })
  it('still rejects trailing hyphen', () => {
    expect(isValidPathSyntax('literature/007-思维/init-')).toBe(false)
  })
})

describe('assertSafePath', () => {
  it('resolves a valid path to a disk path inside content/', () => {
    expect(assertSafePath('hello-world')).toMatch(
      /[\\/]src[\\/]content[\\/]hello-world$/,
    )
  })
  it('resolves a nested path to a disk path inside content/', () => {
    expect(assertSafePath('notes/draft')).toMatch(
      /[\\/]src[\\/]content[\\/]notes[\\/]draft$/,
    )
  })
  it('throws on ..', () => {
    expect(() => assertSafePath('notes/../etc')).toThrow()
  })
  it('throws on absolute injection', () => {
    // regex would already block, but the resolve check is a second line of defense
    expect(() => assertSafePath('..%2Fetc')).toThrow()
  })
})

describe('filePathFor / folderPathFor', () => {
  it('filePathFor adds .md', () => {
    expect(filePathFor('notes/draft')).toMatch(/src[\\/]content[\\/]notes[\\/]draft\.md$/)
  })
  it('folderPathFor does not add .md', () => {
    expect(folderPathFor('notes')).toMatch(/src[\\/]content[\\/]notes$/)
  })
  it('filePathFor rejects a CJK path', () => {
    expect(() => filePathFor('literature/007-思维/001-第一性原理')).toThrow()
  })
})

describe('isValidSegment', () => {
  // Keep path names filesystem- and git-friendly: English lowercase
  // kebab segments only. Human-language titles live in frontmatter.
  it('accepts a kebab segment', () => expect(isValidSegment('init-2026')).toBe(true))
  it('rejects a CJK segment', () => expect(isValidSegment('007-思维')).toBe(false))
  it('rejects a single CJK char', () => expect(isValidSegment('思')).toBe(false))
  it('rejects a mixed-case segment', () => expect(isValidSegment('006-MacOS')).toBe(false))
  it('rejects `.` and `..`', () => {
    expect(isValidSegment('.')).toBe(false)
    expect(isValidSegment('..')).toBe(false)
  })
  it('rejects leading hyphen', () => expect(isValidSegment('-init')).toBe(false))
  it('rejects trailing hyphen', () => expect(isValidSegment('init-')).toBe(false))
  it('rejects `.md` suffix', () => expect(isValidSegment('init.md')).toBe(false))
  it('rejects segment containing `/`', () => expect(isValidSegment('foo/bar')).toBe(false))
  it('rejects empty segment', () => expect(isValidSegment('')).toBe(false))
  it('rejects underscore', () => expect(isValidSegment('draft_v2')).toBe(false))
})
