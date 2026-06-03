import { describe, it, expect } from 'vitest'
import { assertSafePath, filePathFor, folderPathFor, isValidPathSyntax } from '../paths.js'

describe('isValidPathSyntax', () => {
  it('accepts top-level post', () => {
    expect(isValidPathSyntax('posts/hello-world')).toBe(true)
  })
  it('accepts nested post', () => {
    expect(isValidPathSyntax('posts/notes/draft')).toBe(true)
  })
  it('accepts folder', () => {
    expect(isValidPathSyntax('posts/notes')).toBe(true)
  })
  it('rejects missing posts prefix', () => {
    expect(isValidPathSyntax('notes/draft')).toBe(false)
  })
  it('rejects empty segment', () => {
    expect(isValidPathSyntax('posts//draft')).toBe(false)
  })
  it('rejects ..', () => {
    expect(isValidPathSyntax('posts/../etc')).toBe(false)
  })
  it('rejects uppercase', () => {
    expect(isValidPathSyntax('posts/Hello')).toBe(false)
  })
  it('rejects leading slash', () => {
    expect(isValidPathSyntax('/posts/draft')).toBe(false)
  })
  it('rejects trailing slash', () => {
    expect(isValidPathSyntax('posts/notes/')).toBe(false)
  })
  it('rejects .md extension', () => {
    expect(isValidPathSyntax('posts/draft.md')).toBe(false)
  })
  it('rejects leading hyphen', () => {
    expect(isValidPathSyntax('posts/-draft')).toBe(false)
  })
  it('rejects trailing hyphen', () => {
    expect(isValidPathSyntax('posts/draft-')).toBe(false)
  })
})

describe('assertSafePath', () => {
  it('resolves a valid path to a disk path inside content/', () => {
    expect(assertSafePath('posts/hello-world')).toMatch(
      /[\\/]src[\\/]content[\\/]posts[\\/]hello-world$/,
    )
  })
  it('throws on ..', () => {
    expect(() => assertSafePath('posts/../etc')).toThrow()
  })
  it('throws on absolute injection', () => {
    // regex would already block, but the resolve check is a second line of defense
    expect(() => assertSafePath('posts/..%2Fetc')).toThrow()
  })
})

describe('filePathFor / folderPathFor', () => {
  it('filePathFor adds .md', () => {
    expect(filePathFor('posts/draft')).toMatch(/src[\\/]content[\\/]posts[\\/]draft\.md$/)
  })
  it('folderPathFor does not add .md', () => {
    expect(folderPathFor('posts/notes')).toMatch(/src[\\/]content[\\/]posts[\\/]notes$/)
  })
})
