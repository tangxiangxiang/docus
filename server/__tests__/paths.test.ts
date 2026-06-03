import { describe, it, expect } from 'vitest'
import { assertSafePath, filePathFor, folderPathFor, isValidPathSyntax } from '../paths.js'

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
  it('rejects uppercase', () => {
    expect(isValidPathSyntax('notes/Hello')).toBe(false)
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
  it('rejects underscore', () => {
    expect(isValidPathSyntax('notes/draft_v2')).toBe(false)
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
})
