// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  buildTagIndex,
  matchesTagQuery,
  normalizeTag,
  parseTagQuery,
  sortTagsByCountDescThenName,
  updateDocumentTags,
  type SearchableDoc,
} from '../tags'

// -------- normalizeTag --------

describe('normalizeTag', () => {
  it('strips a leading `#`', () => {
    expect(normalizeTag('#java')).toBe('java')
  })

  it('trims leading and trailing whitespace', () => {
    expect(normalizeTag('  java  ')).toBe('java')
    expect(normalizeTag('\t#java\n')).toBe('java')
  })

  it('lowercases for matching', () => {
    expect(normalizeTag('Java')).toBe('java')
    expect(normalizeTag('JAVA')).toBe('java')
    expect(normalizeTag('#JaVa')).toBe('java')
  })

  it('returns empty string for blank input', () => {
    expect(normalizeTag('')).toBe('')
    expect(normalizeTag('   ')).toBe('')
    expect(normalizeTag('#')).toBe('')
    // `-#` as a raw tag string isn't a "blank" — it's a non-empty
    // string that just doesn't start with `#` and so passes through
    // the normalizer unchanged (the `-#` exclude prefix is the
    // parser's job, not the normalizer's).
    expect(normalizeTag('-#')).toBe('-#')
    expect(normalizeTag(null)).toBe('')
    expect(normalizeTag(undefined)).toBe('')
  })

  it('preserves Chinese (Unicode-safe)', () => {
    expect(normalizeTag('#人工智能')).toBe('人工智能')
    expect(normalizeTag('人工智能')).toBe('人工智能')
  })

  it('preserves slashes, dashes, underscores', () => {
    expect(normalizeTag('#a/b/c')).toBe('a/b/c')
    expect(normalizeTag('#spring-boot')).toBe('spring-boot')
    expect(normalizeTag('#spring_boot')).toBe('spring_boot')
  })

  it('only strips ONE leading `#`', () => {
    // A user who actually names a tag `##java` shouldn't have it
    // silently turned into `java`.
    expect(normalizeTag('##java')).toBe('#java')
  })

  it('does not NFKC-normalize Unicode (preserves user content)', () => {
    // ﬁ (U+FB01) does not collapse to "fi". If a future user reports
    // a real duplicate-from-NFKC case, we can revisit; for now the
    // conservative choice is no silent rename.
    expect(normalizeTag('ﬁre')).toBe('ﬁre')
  })
})

// -------- parseTagQuery --------

describe('parseTagQuery', () => {
  it('returns an empty query for empty input', () => {
    expect(parseTagQuery('')).toEqual({
      text: '',
      includeAll: [],
      includeAny: [],
      exclude: [],
    })
  })

  it('returns an empty query for whitespace-only input', () => {
    expect(parseTagQuery('   \t\n  ').text).toBe('')
  })

  it('parses a single #tag into includeAll', () => {
    const q = parseTagQuery('#java')
    expect(q.includeAll).toEqual(['java'])
    expect(q.exclude).toEqual([])
    expect(q.text).toBe('')
  })

  it('parses multiple #tags as AND (all into includeAll)', () => {
    const q = parseTagQuery('#java #spring')
    expect(q.includeAll).toEqual(['java', 'spring'])
    expect(q.text).toBe('')
  })

  it('parses -#exclude tokens', () => {
    const q = parseTagQuery('-#archive')
    expect(q.exclude).toEqual(['archive'])
    expect(q.includeAll).toEqual([])
  })

  it('handles a mix of includeAll, exclude, and plain text', () => {
    const q = parseTagQuery('#java #spring -#archive nacos')
    expect(q.includeAll).toEqual(['java', 'spring'])
    expect(q.exclude).toEqual(['archive'])
    expect(q.text).toBe('nacos')
  })

  it('treats plain text as text query', () => {
    const q = parseTagQuery('hello world')
    expect(q.text).toBe('hello world')
    expect(q.includeAll).toEqual([])
    expect(q.exclude).toEqual([])
  })

  it('dedupes repeated #tags in includeAll', () => {
    const q = parseTagQuery('#java #java #JAVA')
    expect(q.includeAll).toEqual(['java'])
  })

  it('dedupes repeated -#tags in exclude', () => {
    const q = parseTagQuery('-#archive -#archive')
    expect(q.exclude).toEqual(['archive'])
  })

  it('records both includeAll and exclude when same tag is in both', () => {
    // matchesTagQuery is responsible for logical resolution;
    // the parser just records the user's intent.
    const q = parseTagQuery('#java -#java')
    expect(q.includeAll).toEqual(['java'])
    expect(q.exclude).toEqual(['java'])
  })

  it('tolerates a bare `#` (no tag name)', () => {
    // `#` alone is a recognized separator that produces no tag; the
    // surrounding plain text falls into the text channel. The
    // parser deliberately does NOT try to glue `#` to the next
    // token — that's a more complex shape the Phase 4 OR-mode UI
    // might add, not Phase 1.
    const q = parseTagQuery('# java')
    expect(q.includeAll).toEqual([])
    expect(q.text).toBe('java')
  })

  it('tolerates multiple spaces between tokens', () => {
    const q = parseTagQuery('#java    #spring')
    expect(q.includeAll).toEqual(['java', 'spring'])
  })

  it('preserves Chinese tag names', () => {
    const q = parseTagQuery('#人工智能 #机器学习')
    expect(q.includeAll).toEqual(['人工智能', '机器学习'])
  })

  it('preserves slash / dash / underscore in tags', () => {
    const q = parseTagQuery('#a/b/c #spring-boot #spring_boot')
    expect(q.includeAll).toEqual(['a/b/c', 'spring-boot', 'spring_boot'])
  })

  it('handles mixed case tag tokens', () => {
    const q = parseTagQuery('#Java #spring -#Archive')
    expect(q.includeAll).toEqual(['java', 'spring'])
    expect(q.exclude).toEqual(['archive'])
  })

  it('combines tag and text in any order', () => {
    const q1 = parseTagQuery('#java nacos')
    expect(q1.includeAll).toEqual(['java'])
    expect(q1.text).toBe('nacos')

    const q2 = parseTagQuery('nacos #java')
    expect(q2.includeAll).toEqual(['java'])
    expect(q2.text).toBe('nacos')
  })

  it('handles tag tokens adjacent to text without space', () => {
    // While unusual, '#java' followed by text without space is still
    // one token. The parser preserves that as-is (it gets pushed to
    // text). This is the same behavior as the legacy substring
    // search — we don't introduce new edge cases here.
    const q = parseTagQuery('#javanacos')
    expect(q.includeAll).toEqual(['javanacos'])
    expect(q.text).toBe('')
  })
})

// -------- matchesTagQuery --------

function doc(partial: Partial<SearchableDoc> & { path: string; tags: string[] }): SearchableDoc {
  return {
    path: partial.path,
    title: partial.title ?? '',
    tags: partial.tags,
    summary: partial.summary,
  }
}

describe('matchesTagQuery', () => {
  it('empty query matches everything', () => {
    const q = parseTagQuery('')
    expect(matchesTagQuery(doc({ path: 'a.md', title: 'A', tags: [] }), q)).toBe(true)
  })

  it('single #tag matches docs with that tag', () => {
    const q = parseTagQuery('#java')
    expect(matchesTagQuery(doc({ path: 'a.md', title: 'A', tags: ['java'] }), q)).toBe(true)
    expect(matchesTagQuery(doc({ path: 'a.md', title: 'A', tags: ['spring'] }), q)).toBe(false)
    expect(matchesTagQuery(doc({ path: 'a.md', title: 'A', tags: [] }), q)).toBe(false)
  })

  it('AND of two #tags requires both', () => {
    const q = parseTagQuery('#java #spring')
    expect(matchesTagQuery(doc({ path: 'a.md', title: 'A', tags: ['java', 'spring'] }), q)).toBe(true)
    expect(matchesTagQuery(doc({ path: 'a.md', title: 'A', tags: ['java'] }), q)).toBe(false)
    expect(matchesTagQuery(doc({ path: 'a.md', title: 'A', tags: ['spring'] }), q)).toBe(false)
  })

  it('-#tag excludes a doc that has the tag', () => {
    const q = parseTagQuery('-#archive')
    expect(matchesTagQuery(doc({ path: 'a.md', title: 'A', tags: ['archive'] }), q)).toBe(false)
    expect(matchesTagQuery(doc({ path: 'a.md', title: 'A', tags: [] }), q)).toBe(true)
    expect(matchesTagQuery(doc({ path: 'a.md', title: 'A', tags: ['java'] }), q)).toBe(true)
  })

  it('exclude takes precedence over includeAll', () => {
    const q = parseTagQuery('#a -#a')
    // Both listed: matches-tag-query must NOT match because the
    // exclude filter runs first. Returning true here would make
    // `#a -#a` mean "everything with a", which contradicts the
    // user's intent.
    expect(matchesTagQuery(doc({ path: 'a.md', title: 'A', tags: ['a'] }), q)).toBe(false)
  })

  it('plain text matches path or title or summary (case-insensitive)', () => {
    const q = parseTagQuery('Redis')
    expect(matchesTagQuery(doc({ path: 'notes/redis.md', title: 'A', tags: [] }), q)).toBe(true)
    expect(matchesTagQuery(doc({ path: 'a.md', title: 'Redis notes', tags: [] }), q)).toBe(true)
    expect(matchesTagQuery(doc({ path: 'a.md', title: 'A', tags: [], summary: 'about redis' }), q)).toBe(true)
    expect(matchesTagQuery(doc({ path: 'other.md', title: 'B', tags: [] }), q)).toBe(false)
  })

  it('text + #tag requires both', () => {
    const q = parseTagQuery('#java nacos')
    expect(matchesTagQuery(doc({ path: 'a.md', title: 'nacos setup', tags: ['java'] }), q)).toBe(true)
    expect(matchesTagQuery(doc({ path: 'a.md', title: 'other', tags: ['java'] }), q)).toBe(false)
    expect(matchesTagQuery(doc({ path: 'a.md', title: 'nacos setup', tags: [] }), q)).toBe(false)
  })

  it('case-insensitive tag matching (Java ≡ java)', () => {
    const q = parseTagQuery('#Java')
    expect(matchesTagQuery(doc({ path: 'a.md', title: 'A', tags: ['java'] }), q)).toBe(true)
    expect(matchesTagQuery(doc({ path: 'a.md', title: 'A', tags: ['JAVA'] }), q)).toBe(true)
  })

  it('case-insensitive text matching', () => {
    const q = parseTagQuery('REDIS')
    expect(matchesTagQuery(doc({ path: 'a.md', title: 'redis notes', tags: [] }), q)).toBe(true)
  })

  it('preserves Chinese tags', () => {
    const q = parseTagQuery('#人工智能')
    expect(matchesTagQuery(doc({ path: 'a.md', title: 'A', tags: ['人工智能'] }), q)).toBe(true)
    expect(matchesTagQuery(doc({ path: 'a.md', title: 'A', tags: ['机器学习'] }), q)).toBe(false)
  })

  it('survives tags containing slashes', () => {
    const q = parseTagQuery('#a/b')
    expect(matchesTagQuery(doc({ path: 'a.md', title: 'A', tags: ['a/b'] }), q)).toBe(true)
    expect(matchesTagQuery(doc({ path: 'a.md', title: 'A', tags: ['a'] }), q)).toBe(false)
  })

  it('treats `undefined` tags as empty without crashing', () => {
    const q = parseTagQuery('#java')
    // Server-side rename / tree-builder paths can theoretically emit
    // tags: undefined; matchesTagQuery must not throw.
    const docWithUndefinedTags = { path: 'a.md', title: 'A', tags: undefined } as unknown as SearchableDoc
    expect(matchesTagQuery(docWithUndefinedTags, q)).toBe(false)
  })

  it('treats `null` entries in tags as missing', () => {
    const q = parseTagQuery('#java')
    const docWithNullEntries = { path: 'a.md', title: 'A', tags: [null, 'java', undefined] } as unknown as SearchableDoc
    expect(matchesTagQuery(docWithNullEntries, q)).toBe(true)
  })
})

// -------- buildTagIndex --------

describe('buildTagIndex', () => {
  it('builds a tag record per distinct tag', () => {
    const idx = buildTagIndex([
      { path: 'a.md', tags: ['java', 'spring'] },
      { path: 'b.md', tags: ['java', 'redis'] },
      { path: 'c.md', tags: ['redis'] },
    ])
    expect(idx.tags.size).toBe(3)
    expect(idx.tags.get('java')?.count).toBe(2)
    expect(idx.tags.get('spring')?.count).toBe(1)
    expect(idx.tags.get('redis')?.count).toBe(2)
  })

  it('preserves the first-seen display form', () => {
    const idx = buildTagIndex([
      { path: 'a.md', tags: ['Java'] },
      { path: 'b.md', tags: ['java'] },
      { path: 'c.md', tags: ['JAVA'] },
    ])
    expect(idx.tags.size).toBe(1)
    expect(idx.tags.get('java')?.displayName).toBe('Java')
    expect(idx.tags.get('java')?.count).toBe(3)
  })

  it('records documentTags per path', () => {
    const idx = buildTagIndex([
      { path: 'a.md', tags: ['java', 'spring'] },
      { path: 'b.md', tags: ['java'] },
    ])
    expect(idx.documentTags.get('a.md')).toEqual(new Set(['java', 'spring']))
    expect(idx.documentTags.get('b.md')).toEqual(new Set(['java']))
  })

  it('records tagDocuments as reverse lookup', () => {
    const idx = buildTagIndex([
      { path: 'a.md', tags: ['java'] },
      { path: 'b.md', tags: ['java'] },
      { path: 'c.md', tags: ['redis'] },
    ])
    expect(idx.tagDocuments.get('java')).toEqual(new Set(['a.md', 'b.md']))
    expect(idx.tagDocuments.get('redis')).toEqual(new Set(['c.md']))
  })

  it('treats undefined tags as empty', () => {
    const idx = buildTagIndex([
      { path: 'a.md', tags: undefined },
      { path: 'b.md', tags: ['java'] },
    ] as unknown as Array<{ path: string; tags?: string[] | undefined }>)
    expect(idx.documentTags.get('a.md')?.size ?? 0).toBe(0)
    expect(idx.tags.size).toBe(1)
  })

  it('dedupes repeated tags within one document', () => {
    const idx = buildTagIndex([
      { path: 'a.md', tags: ['java', 'java', 'JAVA'] },
    ])
    expect(idx.tags.size).toBe(1)
    expect(idx.tags.get('java')?.count).toBe(1)
  })

  it('handles an empty posts list', () => {
    const idx = buildTagIndex([])
    expect(idx.tags.size).toBe(0)
    expect(idx.documentTags.size).toBe(0)
    expect(idx.tagDocuments.size).toBe(0)
  })

  it('handles a single tag as both the first-seen display name and the document set', () => {
    const idx = buildTagIndex([{ path: 'a.md', tags: ['人工智能'] }])
    expect(idx.tags.get('人工智能')?.displayName).toBe('人工智能')
    expect(idx.tags.get('人工智能')?.count).toBe(1)
  })
})

// -------- updateDocumentTags --------

describe('updateDocumentTags', () => {
  const base = buildTagIndex([
    { path: 'a.md', tags: ['java', 'spring'] },
    { path: 'b.md', tags: ['java'] },
  ])

  it('does not mutate the input index', () => {
    const out = updateDocumentTags(base, 'a.md', ['java', 'spring'], ['java', 'redis'])
    expect(out.index).not.toBe(base)
    expect(base.documentTags.get('a.md')).toEqual(new Set(['java', 'spring']))
  })

  it('adds new tags to the index', () => {
    const out = updateDocumentTags(base, 'a.md', ['java', 'spring'], ['java', 'spring', 'redis'])
    expect(out.index.tags.has('redis')).toBe(true)
    expect(out.index.tagDocuments.get('redis')).toEqual(new Set(['a.md']))
    expect(out.delta).toEqual({ added: ['redis'], removed: [] })
  })

  it('removes tags from the index', () => {
    const out = updateDocumentTags(base, 'a.md', ['java', 'spring'], ['java'])
    expect(out.index.tags.has('spring')).toBe(false)
    expect(out.index.tagDocuments.has('spring')).toBe(false)
    expect(out.delta).toEqual({ added: [], removed: ['spring'] })
  })

  it('decrements counts when a tag is removed but other docs still have it', () => {
    const seeded = buildTagIndex([
      { path: 'a.md', tags: ['java'] },
      { path: 'b.md', tags: ['java'] },
    ])
    const out = updateDocumentTags(seeded, 'a.md', ['java'], [])
    expect(out.index.tags.get('java')?.count).toBe(1)
    expect(out.index.tagDocuments.get('java')).toEqual(new Set(['b.md']))
  })

  it('handles a no-op update', () => {
    const out = updateDocumentTags(base, 'a.md', ['java', 'spring'], ['java', 'spring'])
    expect(out.delta).toEqual({ added: [], removed: [] })
    expect(out.index.documentTags.get('a.md')).toEqual(new Set(['java', 'spring']))
  })

  it('handles an unknown document path', () => {
    const out = updateDocumentTags(base, 'new.md', [], ['redis'])
    expect(out.index.documentTags.get('new.md')).toEqual(new Set(['redis']))
    expect(out.index.tags.has('redis')).toBe(true)
    expect(out.delta).toEqual({ added: ['redis'], removed: [] })
  })

  it('treats undefined oldTags and newTags as empty (no-op when caller has no info)', () => {
    const seeded = buildTagIndex([{ path: 'a.md', tags: ['java'] }])
    const out = updateDocumentTags(seeded, 'a.md', undefined, undefined)
    // The diff function is honest: if the caller can't tell us the
    // current tags, both old and new are treated as empty, so
    // nothing is added or removed. Callers that want to clear a
    // document's tags should look up oldTags from
    // `index.documentTags.get(path)` first and pass that explicitly.
    expect(out.delta).toEqual({ added: [], removed: [] })
    expect(out.index.tags.has('java')).toBe(true)
  })

  it('clears a document when the caller passes the old tags explicitly', () => {
    const seeded = buildTagIndex([{ path: 'a.md', tags: ['java'] }])
    const oldTags = Array.from(seeded.documentTags.get('a.md') ?? [])
    const out = updateDocumentTags(seeded, 'a.md', oldTags, [])
    expect(out.delta).toEqual({ added: [], removed: ['java'] })
    expect(out.index.tags.has('java')).toBe(false)
  })
})

// -------- sortTagsByCountDescThenName --------

describe('sortTagsByCountDescThenName', () => {
  it('sorts by count desc, then display name asc (using displayName, not normalizedName)', () => {
    const sorted = sortTagsByCountDescThenName([
      { normalizedName: 'b', displayName: 'b', count: 3 },
      { normalizedName: 'a', displayName: 'a', count: 5 },
      { normalizedName: 'c', displayName: 'c', count: 3 },
      { normalizedName: 'a2', displayName: 'A2', count: 3 },
    ])
    expect(sorted.map((r) => r.displayName)).toEqual(['a', 'A2', 'b', 'c'])
    // normalizedName keys are lowercase: A2 normalizes to a2, but
    // the sort uses the original display form for the tiebreak.
    expect(sorted.map((r) => r.normalizedName)).toEqual(['a', 'a2', 'b', 'c'])
  })

  it('is stable: equal counts fall back to name localeCompare', () => {
    const sorted = sortTagsByCountDescThenName([
      { normalizedName: 'zebra', displayName: 'zebra', count: 1 },
      { normalizedName: 'apple', displayName: 'apple', count: 1 },
      { normalizedName: 'mango', displayName: 'mango', count: 1 },
    ])
    expect(sorted.map((r) => r.displayName)).toEqual(['apple', 'mango', 'zebra'])
  })

  it('does not mutate the input array', () => {
    const input = [
      { normalizedName: 'b', displayName: 'b', count: 1 },
      { normalizedName: 'a', displayName: 'a', count: 1 },
    ]
    const sorted = sortTagsByCountDescThenName(input)
    expect(input[0]?.normalizedName).toBe('b')
    expect(sorted[0]?.normalizedName).toBe('a')
  })
})