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

  // Regression: the reference project (参考/Documents/docs/) carries
  // Chinese category names and mixed-case technical names. After the
  // 35-note migration into literature/, every note whose path
  // contains a CJK segment or an uppercase letter started 400-ing
  // /api/posts/*. The new validator widens the segment character
  // class to `[\w一-鿿-]` and gates on `isValidSegment`
  // (which still rejects `..`, leading/trailing `-`, and `.md`).
  // These tests pin the new contract so a future tightening of
  // the regex doesn't silently re-break the migrated corpus.
  it('accepts a CJK segment', () => {
    expect(isValidPathSyntax('literature/007-思维/001-第一性原理')).toBe(true)
  })
  it('accepts a mixed-case technical name', () => {
    expect(isValidPathSyntax('literature/006-MacOS/001-macOS-快捷键')).toBe(true)
  })
  it('accepts a date-style segment', () => {
    expect(isValidPathSyntax('literature/000-待办/001-闪念笔记/2026-05-21')).toBe(true)
  })
  it('accepts the four migrated category roots under literature/', () => {
    for (const root of ['000-待办', '001-英语', '007-思维', '010-模板']) {
      expect(isValidPathSyntax(`literature/${root}`)).toBe(true)
    }
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
  it('filePathFor round-trips a CJK path', () => {
    // The migrated note lives at exactly this absolute path; if
    // the segment character class ever narrows again, this test
    // catches it without going through the HTTP layer.
    expect(filePathFor('literature/007-思维/001-第一性原理')).toMatch(
      /src[\\/]content[\\/]literature[\\/]007-思维[\\/]001-第一性原理\.md$/,
    )
  })
})

describe('isValidSegment', () => {
  // The looser character class plus the segment-level guards
  // (no leading/trailing hyphen, no `..`, no `.md`) is what makes
  // CJK + mixed-case paths work without reopening the
  // path-traversal hole. Pin the contract here.
  it('accepts a kebab segment', () => expect(isValidSegment('init-2026')).toBe(true))
  it('accepts a CJK segment', () => expect(isValidSegment('007-思维')).toBe(true))
  it('accepts a single CJK char', () => expect(isValidSegment('思')).toBe(true))
  it('accepts a mixed-case segment', () => expect(isValidSegment('006-MacOS')).toBe(true))
  it('rejects `.` and `..`', () => {
    expect(isValidSegment('.')).toBe(false)
    expect(isValidSegment('..')).toBe(false)
  })
  it('rejects leading hyphen', () => expect(isValidSegment('-init')).toBe(false))
  it('rejects trailing hyphen', () => expect(isValidSegment('init-')).toBe(false))
  it('rejects `.md` suffix', () => expect(isValidSegment('init.md')).toBe(false))
  it('rejects segment containing `/`', () => expect(isValidSegment('foo/bar')).toBe(false))
  it('rejects empty segment', () => expect(isValidSegment('')).toBe(false))
  it('accepts underscore (part of the new wider class — `\\w` includes `_`)', () => {
    // The OLD regex rejected underscore; the NEW regex inherits
    // `\w` (which does include `_`) so this is a behavior change.
    // We accept it: the OS allows `_` in filenames and there is no
    // security implication. If a future tightening wants to ban
    // `_`, this test will catch it.
    expect(isValidSegment('draft_v2')).toBe(true)
  })
})
