// @vitest-environment jsdom
// Tests for the markdown-it pipeline in src/lib/markdown.ts.
// Specifically: the ```markmap``` fence rule, which emits a
// placeholder div with URL-encoded source embedded in `data-content`
// for useMarkmapMount to upgrade into a live
// widget. We exercise the real `render()` exported by the module
// so the test goes through the same path the app uses (including
// async Shiki language preparation).
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { createHighlighter, type Highlighter } from 'shiki'
import { render } from '../markdown'
import type { Resolver as WikiResolver } from '../wikiLinks'
import { __testing__ as shikiTesting, getGeneratedShikiCss } from '../shiki'

type LanguageInput = Parameters<Highlighter['loadLanguage']>[0]

function installFakeShikiRuntime() {
  const loadLanguage = vi.fn(async (_language: LanguageInput) => {})
  const codeToHtml = vi.fn((source: string) =>
    `<pre class="shiki"><code><span class="line">${source}</span></code></pre>`,
  )
  const runtime = {
    dispose: vi.fn(),
    getLoadedLanguages: vi.fn(() => []),
    loadLanguage,
    codeToHtml,
  } as unknown as Highlighter
  const factory = vi.fn<typeof createHighlighter>(() => Promise.resolve(runtime))
  shikiTesting.setHighlighterFactory(factory)
  return { factory, loadLanguage, codeToHtml }
}

describe('markdown render()', () => {
  it('emits a markmap-mount placeholder for ```markmap fences', async () => {
    const html = await render([
      '# Title',
      '',
      '```markmap',
      '# Root',
      '## Branch',
      '- leaf',
      '```',
      '',
    ].join('\n'))
    /* Two placeholders must NOT match — only the one inside the
       markmap fence. */
    expect(html).toContain('class="markmap-mount"')
    expect(html).toContain('data-content="')
    /* The source is URL-encoded so angle brackets, quotes, and comment-like
       sequences cannot affect the HTML attribute or sanitizer. */
    expect(html).not.toMatch(/data-content="[^"]*<[^"]+/)
    /* The text body of the source should still be retrievable after
       decoding the attribute. We assert on a snippet that's safe
       to leave un-encoded. */
    expect(html).toContain('Root')
  })

  it('does not treat ```mmap (a similar-looking lang) as markmap', async () => {
    const html = await render([
      '```mmap',
      '# Root',
      '```',
    ].join('\n'))
    expect(html).not.toContain('class="markmap-mount"')
  })

  it('renders non-markmap fences through Shiki', async () => {
    const html = await render([
      '```js',
      'const x = 1',
      '```',
    ].join('\n'))
    expect(html).toContain('class="shiki')
    expect(html).not.toContain('class="hljs"')
    expect(html).not.toContain('class="markmap-mount"')
  })

  it('emits a mermaid-mount placeholder for ```mermaid fences', async () => {
    const html = await render([
      '```mermaid',
      'graph TD',
      '  A --> B',
      '```',
    ].join('\n'))
    expect(html).toContain('class="mermaid-mount"')
    expect(html).toContain('data-content="')
    /* Source is URL-encoded so Mermaid's `-->` syntax cannot be parsed as
       an HTML comment terminator by the sanitizer. */
    expect(html).toContain('data-content="graph%20TD')
    expect(html).not.toContain('-->')
    /* Must not be confused with the markmap fence. */
    expect(html).not.toContain('class="markmap-mount"')
  })

  it('does not treat ```merm (a similar-looking lang) as mermaid', async () => {
    const html = await render([
      '```merm',
      'graph TD',
      '  A --> B',
      '```',
    ].join('\n'))
    expect(html).not.toContain('class="mermaid-mount"')
  })

  /* Footnotes (markdown-it-footnote). Plugin behavior worth pinning:
     - The label inside [^label] is metadata for matching ref ↔ def;
       the rendered anchor id is always a sequence number (fn1, fn2, ...).
       So [^a] and [^1] both produce fn1.
     - Definitions land in a trailing <section class="footnotes"> with
       one <li class="footnote-item" id="fnN"> per note.
     - Each item has a backref <a class="footnote-backref" href="#fnrefN">↩︎</a>.
     - A reference with no matching definition is left as literal text
       (no <sup> emitted) — this is the documented behavior, not a bug. */
  it('renders an inline footnote ref as a <sup class="footnote-ref">', async () => {
    const html = await render([
      'Here is a footnote reference,[^1] and another.[^longnote]',
      '',
      '[^1]: first.',
      '',
      '[^longnote]: second.',
    ].join('\n'))
    /* Two inline refs in the body paragraph. */
    const refs = html.match(/<sup class="footnote-ref">/g) ?? []
    expect(refs.length).toBe(2)
    /* Both refs and items are numbered sequentially regardless of the
       label used in the source — first gets fn1, second gets fn2. */
    expect(html).toContain('href="#fn1"')
    expect(html).toContain('id="fnref1"')
    expect(html).toContain('href="#fn2"')
    expect(html).toContain('id="fnref2"')
    /* The visible caption inside the <sup> is "[1]" / "[2]", not the
       source label — that's what readers click to jump down. */
    expect(html).toContain('>[1]</a>')
    expect(html).toContain('>[2]</a>')
  })

  it('collects definitions into a trailing <section class="footnotes">', async () => {
    const html = await render([
      'body[^a]',
      '',
      '[^a]: definition text.',
    ].join('\n'))
    /* The definitions must NOT leak into the body paragraph as
       plain text. Before the plugin was wired, [^a]: landed as
       a literal <p>[^a]: definition text.</p>. */
    expect(html).not.toMatch(/<p>\[\^a\]:/)
    /* The trailing block must exist, with the item carrying the
       numeric anchor id fn1 (alpha label still maps to fn1 because
       it's the first definition in this document). */
    expect(html).toContain('<section class="footnotes">')
    expect(html).toContain('<ol class="footnotes-list">')
    expect(html).toContain('id="fn1"')
    /* The plugin's default backref points back at the inline ref id. */
    expect(html).toContain('class="footnote-backref"')
    expect(html).toContain('href="#fnref1"')
  })

  it('preserves multi-paragraph footnote bodies (indented continuation)', async () => {
    const html = await render([
      'see[^multi]',
      '',
      '[^multi]: first paragraph.',
      '',
      '    second paragraph in the same note.',
    ].join('\n'))
    /* The whole definition sits between the <li> open and the
       closing </ol> of the footnotes section. */
    const liOpen = html.indexOf('<li id="fn1"')
    const olClose = html.indexOf('</ol>')
    expect(liOpen).toBeGreaterThan(-1)
    expect(olClose).toBeGreaterThan(liOpen)
    const itemHtml = html.slice(liOpen, olClose)
    expect(itemHtml).toContain('first paragraph.')
    expect(itemHtml).toContain('second paragraph in the same note.')
    /* The backref appears only on the last paragraph, not on every
       one — that's the plugin's default and is fine. */
    expect(itemHtml.match(/footnote-backref/g)?.length).toBe(1)
  })

  it('renders the footnote separator <hr class="footnotes-sep">', async () => {
    const html = await render([
      'body[^1]',
      '',
      '[^1]: note.',
    ].join('\n'))
    /* Plugin emits <hr class="footnotes-sep"> before the section.
       Default xhtmlOut=false so it's a bare <hr> (no trailing slash). */
    expect(html).toMatch(/<hr class="footnotes-sep">/)
    /* The separator must appear BEFORE the section, not after. */
    const sepIdx = html.indexOf('footnotes-sep')
    const sectionIdx = html.indexOf('<section class="footnotes">')
    expect(sepIdx).toBeGreaterThan(-1)
    expect(sectionIdx).toBeGreaterThan(sepIdx)
  })

  it('wraps tables in a dedicated horizontal scroll container', async () => {
    const html = await render('| A | B |\n| --- | --- |\n| one | two |')
    expect(html).toContain('<div class="table-scroll"><table>')
    expect(html).toContain('</table></div>')
  })

  it('keeps wiki-link resolvers isolated across concurrent renders', async () => {
    const resolverA: WikiResolver = (ref) => ({ target: `vault-a/${ref}` })
    const resolverB: WikiResolver = (ref) => ({ target: `vault-b/${ref}` })

    const [htmlA, htmlB] = await Promise.all([
      render('[[note]] and [Text](note.md)', { resolver: resolverA }),
      render('[[note]] and [Text](note.md)', { resolver: resolverB }),
    ])

    expect(htmlA).toContain('href="/vault/vault-a/note"')
    expect(htmlA).not.toContain('vault-b/note')
    expect(htmlB).toContain('href="/vault/vault-b/note"')
    expect(htmlB).not.toContain('vault-a/note')
  })

  it('keeps the major extensions intact in one sanitized render', async () => {
    const resolver: WikiResolver = (ref) => ({ target: `notes/${ref}` })
    const html = await render([
      '# Integration',
      '',
      '> [!info] Formula',
      '> [[math-note]] explains **$E = mc^2$**.',
      '>',
      '> - [x] Reviewed',
      '> - [ ] Follow up',
      '',
      '==Important== and a footnote.[^one]',
      '',
      '$$',
      '\\int_0^1 x^2\\,dx',
      '$$',
      '',
      '[^one]: Reference.',
    ].join('\n'), { resolver })
    const doc = new DOMParser().parseFromString(html, 'text/html')

    expect(doc.querySelector('h1')?.textContent).toContain('Integration')
    expect(doc.querySelector('.callout-info')).not.toBeNull()
    expect(doc.querySelector('.callout-info a.wiki-link')?.getAttribute('href')).toBe('/vault/notes/math-note')
    expect(doc.querySelector('.callout-info strong .math-inline')).not.toBeNull()
    expect(doc.querySelector('.callout-info ul.contains-task-list')).not.toBeNull()
    expect(doc.querySelector('.callout-info input[checked]')).not.toBeNull()
    expect(doc.querySelector('mark')?.textContent).toBe('Important')
    expect(doc.querySelector('section.footnotes')).not.toBeNull()
    expect(doc.querySelector('.math-block')).not.toBeNull()
  })

  it('preserves task-list labels and checkbox state after sanitization', async () => {
    const html = await render('- [x] Done\n- [ ] Todo')
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const items = Array.from(doc.querySelectorAll('li.task-list-item'))
    const inputs = Array.from(doc.querySelectorAll<HTMLInputElement>('input.task-list-item-checkbox'))
    const labels = Array.from(doc.querySelectorAll('label'))

    expect(doc.querySelector('ul.contains-task-list')).not.toBeNull()
    expect(items).toHaveLength(2)
    expect(inputs).toHaveLength(2)
    expect(labels).toHaveLength(2)
    expect(inputs[0].type).toBe('checkbox')
    expect(inputs[0].checked).toBe(true)
    expect(inputs[0].hasAttribute('checked')).toBe(true)
    expect(inputs[1].checked).toBe(false)
    expect(inputs[1].hasAttribute('checked')).toBe(false)
    expect(inputs[0].closest('label')).toBe(labels[0])
    expect(inputs[1].closest('label')).toBe(labels[1])
    expect(items.every((item) => item.classList.contains('enabled'))).toBe(true)
  })

  it('leaves [^id] literal when no matching definition exists', async () => {
    const html = await render('A reference with no body[^orphan].')
    /* The plugin refuses to emit a <sup> for an unresolved ref —
       it just leaves the literal [^orphan] text in place. That
       matches CommonMark-style footnote tooling: missing defs are
       a user authoring bug, not a render bug to paper over. */
    expect(html).not.toContain('<sup class="footnote-ref">')
    expect(html).not.toContain('<section class="footnotes">')
    expect(html).toContain('[^orphan]')
  })

  /* Definition lists (markdown-it-deflist). Pandoc-style syntax:
     one term per line, then one or more indented `:   definition`
     lines, blank line separates entries. Plugin emits standard
     <dl>/<dt>/<dd> with multiple dd's as siblings (NOT nested)
     under the same dt — that's the HTML5 spec, and the plugin
     follows it. Before wiring this plugin, the `:` character at
     line start was passed through as literal text. */
  it('renders a basic definition list as <dl>/<dt>/<dd>', async () => {
    const html = await render([
      'Term 1',
      ':   Definition 1',
    ].join('\n'))
    expect(html).toContain('<dl>')
    expect(html).toContain('<dt>Term 1</dt>')
    expect(html).toContain('<dd>Definition 1</dd>')
    expect(html).toContain('</dl>')
    /* The literal `:` must NOT leak through as plain text. */
    expect(html).not.toMatch(/<p>.*:.*Definition.*<\/p>/)
  })

  it('emits multiple <dd> as siblings under one <dt>', async () => {
    const html = await render([
      'Term',
      ':   Definition A',
      ':   Definition B',
    ].join('\n'))
    /* One dt, two dd's as siblings — not nested. */
    expect((html.match(/<dt>/g) ?? []).length).toBe(1)
    expect((html.match(/<dd>/g) ?? []).length).toBe(2)
    /* Both definitions are inside the same <dl>. */
    const dlStart = html.indexOf('<dl>')
    const dlEnd = html.indexOf('</dl>')
    expect(dlStart).toBeGreaterThan(-1)
    expect(dlEnd).toBeGreaterThan(dlStart)
    const dlHtml = html.slice(dlStart, dlEnd)
    expect(dlHtml).toContain('Definition A')
    expect(dlHtml).toContain('Definition B')
  })

  it('keeps surrounding paragraphs outside the <dl>', async () => {
    const html = await render([
      'Prose before.',
      '',
      'Term',
      ':   Definition',
      '',
      'Prose after.',
    ].join('\n'))
    /* Both prose paragraphs must remain in <p> tags, NOT inside
       the <dl>. */
    const dlStart = html.indexOf('<dl>')
    const dlEnd = html.indexOf('</dl>')
    expect(dlStart).toBeGreaterThan(-1)
    expect(dlEnd).toBeGreaterThan(dlStart)
    const dlHtml = html.slice(dlStart, dlEnd + '</dl>'.length)
    expect(dlHtml).not.toContain('<p>Prose before.</p>')
    expect(dlHtml).not.toContain('<p>Prose after.</p>')
    expect(html).toContain('<p>Prose before.</p>')
    expect(html).toContain('<p>Prose after.</p>')
  })

  it('renders inline markup inside dt and dd', async () => {
    const html = await render([
      '`code-term`',
      ':   description with **bold** and a [link](https://example.com)',
    ].join('\n'))
    expect(html).toContain('<dt><code>code-term</code></dt>')
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('<a href="https://example.com">link</a>')
  })

  it('groups multiple term/definition pairs into one <dl>', async () => {
    const html = await render([
      'Term 1',
      ':   Definition 1',
      '',
      'Term 2',
      ':   Definition 2a',
      ':   Definition 2b',
    ].join('\n'))
    /* One <dl> wrapping everything (plugin doesn't emit one
       block per term — that would break the HTML5 model where
       one dl holds the whole list). */
    expect((html.match(/<dl>/g) ?? []).length).toBe(1)
    expect((html.match(/<\/dl>/g) ?? []).length).toBe(1)
    expect((html.match(/<dt>/g) ?? []).length).toBe(2)
    expect((html.match(/<dd>/g) ?? []).length).toBe(3)
  })

  it('preserves safe HTML and sanitizes dangerous raw HTML', async () => {
    const html = await render([
      '<strong>safe HTML</strong><br><a href="https://example.com">safe link</a>',
      '<label onclick="alert(1)">unsafe label</label>',
      '<script>alert(1)</script>',
      '<img src="https://example.com/image.png" onerror="alert(1)">',
      '<iframe src="https://evil.example"></iframe>',
      '<a href="javascript:alert(1)">run</a>',
    ].join('\n'))
    expect(html).toContain('<strong>safe HTML</strong>')
    expect(html).toContain('<br>')
    expect(html).toContain('<a href="https://example.com">safe link</a>')
    expect(html).toContain('<label>unsafe label</label>')
    expect(html).toContain('<img src="https://example.com/image.png">')
    expect(html).not.toMatch(/<script\b/i)
    expect(html).not.toMatch(/<iframe\b/i)
    expect(html).not.toMatch(/\son\w+\s*=/i)
    expect(html).not.toMatch(/javascript:/i)
  })

  it('keeps only Docus data attributes and strips forged internal attributes', async () => {
    const html = await render([
      '<div class="math-mount math-inline" data-content="safe" data-target="note" data-evil="123" data-onclick="alert(1)">safe</div>',
      '<span data-anchor="heading" data-content="also-safe" data-evil="456">text</span>',
    ].join('\n'))
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const div = doc.querySelector('div.math-mount')
    const span = doc.querySelector('span')

    expect(div?.getAttribute('data-content')).toBe('safe')
    expect(div?.getAttribute('data-target')).toBe('note')
    expect(div?.hasAttribute('data-evil')).toBe(false)
    expect(div?.hasAttribute('data-onclick')).toBe(false)
    expect(span?.getAttribute('data-anchor')).toBe('heading')
    expect(span?.getAttribute('data-content')).toBe('also-safe')
    expect(span?.hasAttribute('data-evil')).toBe(false)
  })

  it('preserves raw <br> inside table cells', async () => {
    const html = await render([
      '| col1 | col2 |',
      '| --- | --- |',
      '| a<br>b | c |',
    ].join('\n'))
    /* The cell content must contain a literal <br>, not the escaped
       &lt;br&gt;. */
    expect(html).toMatch(/<td>a<br>b<\/td>/)
    expect(html).not.toContain('&lt;br&gt;')
  })

  /* Highlight (markdown-it-mark). Obsidian / VitePress syntax:
     ==text== → <mark>text</mark>. The plugin is a direct dependency
     because the renderer imports it. Unmatched
     == is left as literal text (no error, no half-formed <mark>). */
  it('renders ==text== as <mark>text</mark>', async () => {
    const html = await render('This is ==highlighted== here.')
    expect(html).toContain('<mark>highlighted</mark>')
    /* The literal == delimiters must NOT leak through. */
    expect(html).not.toContain('==highlighted==')
    expect(html).not.toContain('==')
  })

  it('combines <mark> with other inline markup', async () => {
    const html = await render('mix **bold** with ==highlight== and `code`')
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('<mark>highlight</mark>')
    expect(html).toContain('<code>code</code>')
    /* All three must sit inside the same <p> — confirms the
       plugin integrates with the rest of the inline parser. */
    expect(html).toMatch(/<p>mix <strong>bold<\/strong> with <mark>highlight<\/mark> and <code>code<\/code><\/p>/)
  })

  it('leaves unmatched == as literal text', async () => {
    const html = await render('unmatched == text without closing')
    /* Plugin refuses to emit a half-formed <mark>; the literal
       == stays in place. That's the desired behavior — the user
       just made an authoring mistake, no need to panic the
       renderer. */
    expect(html).not.toContain('<mark>')
    expect(html).toContain('==')
  })

  it('renders full Emoji shortcodes as native Unicode text', async () => {
    const html = await render('完成 :smile: :rocket: :+1: :thumbsup: 😀')
    const doc = new DOMParser().parseFromString(html, 'text/html')

    expect(doc.body.textContent?.trim()).toBe('完成 😄 🚀 👍 👍 😀')
    expect(html).not.toMatch(/<img|<svg|https?:\/\//)
  })

  it('keeps unknown, malformed, and emoticon forms literal', async () => {
    const html = await render(':not_an_emoji: :smile: :) :D :-) :( foo::bar :')
    expect(new DOMParser().parseFromString(html, 'text/html').body.textContent?.trim())
      .toBe(':not_an_emoji: 😄 :) :D :-) :( foo::bar :')
  })

  it('does not rewrite inline or fenced code', async () => {
    const html = await render([
      'Inline `:smile:`.',
      '',
      '```text',
      ':smile:',
      '```',
    ].join('\n'))
    const doc = new DOMParser().parseFromString(html, 'text/html')
    expect(doc.querySelector('code')?.textContent).toBe(':smile:')
    expect(doc.querySelector('pre code')?.textContent).toBe(':smile:\n')
    expect(doc.body.textContent).toContain('Inline :smile:.')
    expect(doc.body.textContent).not.toContain('Inline 😄.')
  })

  it('converts explicit link labels without changing destinations or autolink URLs', async () => {
    const html = await render([
      '[:smile:](https://example.com)',
      '[https://example.com/:smile:](https://example.com/:smile:)',
      '<https://example.com/:smile>',
    ].join('\n'))
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const links = Array.from(doc.querySelectorAll<HTMLAnchorElement>('a'))

    expect(links[0]?.textContent).toBe('😄')
    expect(links[0]?.getAttribute('href')).toBe('https://example.com')
    expect(links[1]?.textContent).toBe('https://example.com/😄')
    expect(links[1]?.getAttribute('href')).toBe('https://example.com/:smile:')
    expect(links[2]?.textContent).toBe('https://example.com/:smile')
    expect(links[2]?.getAttribute('href')).toBe('https://example.com/:smile')
  })

  it('keeps math and Wiki token semantics separate from Emoji', async () => {
    const resolver: WikiResolver = (ref) => ({ target: `notes/${ref}` })
    const html = await render([
      '$:smile:$ and $x$ :rocket:',
      '',
      '[[Target|:smile:]]',
    ].join('\n'), { resolver })
    const doc = new DOMParser().parseFromString(html, 'text/html')

    expect(doc.querySelector('.math-inline')?.getAttribute('data-content')).toBe('%3Asmile%3A')
    expect(doc.querySelector('.math-inline')?.textContent).toBe('')
    expect(doc.body.textContent).toContain('🚀')
    expect(doc.querySelector('a.wiki-link')?.textContent).toBe('😄')
    expect(doc.querySelector('a.wiki-link')?.getAttribute('href')).toBe('/vault/notes/Target')
  })

  it('keeps Emoji working through task, callout, highlight, definition, and footnote output', async () => {
    const html = await render([
      '> [!note] Review',
      '> Body :smile:',
      '',
      '- [ ] :rocket:',
      '',
      '==:heart:==',
      '',
      'Term',
      ': :+1:',
      '',
      'Reference[^one]',
      '',
      '[^one]: :thumbsup:',
    ].join('\n'))
    const doc = new DOMParser().parseFromString(html, 'text/html')

    expect(doc.querySelector('.callout-note')?.textContent).toContain('😄')
    expect(doc.querySelector('input.task-list-item-checkbox')?.closest('li')?.textContent).toContain('🚀')
    expect(doc.querySelector('mark')?.textContent).toBe('❤️')
    expect(doc.querySelector('dd')?.textContent).toBe('👍')
    expect(doc.querySelector('section.footnotes')?.textContent).toContain('👍')
  })

  it('keeps raw HTML sanitizer behavior unchanged while rendering adjacent Emoji', async () => {
    const html = await render('<span onclick="alert(1)">:smile:</span><script>alert(1)</script>')
    expect(html).toContain('<span>😄</span>')
    expect(html).not.toMatch(/<script|onclick=/i)
  })
})

describe('markdown H2 fence preparation', () => {
  beforeEach(() => {
    shikiTesting.reset()
  })

  afterEach(() => {
    shikiTesting.reset()
  })

  it('prepares a known fence and renders the new Shiki contract', async () => {
    const { loadLanguage, codeToHtml } = installFakeShikiRuntime()

    const html = await render([
      '```js title=demo',
      'const value = 1',
      '```',
    ].join('\n'))

    expect(loadLanguage).toHaveBeenCalledTimes(1)
    expect(codeToHtml).toHaveBeenCalledTimes(1)
    expect(html).toContain('class="shiki')
    expect(html).not.toContain('class="hljs"')
  })

  it('rejects Markdown render on runtime initialization failure and retries next render', async () => {
    const healthyLoadLanguage = vi.fn(async (_language: LanguageInput) => {})
    const healthyRuntime = {
      dispose: vi.fn(),
      getLoadedLanguages: vi.fn(() => []),
      loadLanguage: healthyLoadLanguage,
    } as unknown as Highlighter
    const factory = vi.fn<typeof createHighlighter>()
      .mockRejectedValueOnce(new Error('runtime initialization failed'))
      .mockResolvedValueOnce(healthyRuntime)
    shikiTesting.setHighlighterFactory(factory)

    const markdown = '```js\nconst x = 1\n```'
    await expect(render(markdown)).rejects.toThrow('runtime initialization failed')
    expect(factory).toHaveBeenCalledTimes(1)
    expect(healthyLoadLanguage).not.toHaveBeenCalled()

    await expect(render(markdown)).resolves.toContain('class="shiki')
    expect(factory).toHaveBeenCalledTimes(2)
    expect(healthyLoadLanguage).toHaveBeenCalledTimes(1)
  })

  it('does not discover false positives or load an unknown fence', async () => {
    const { factory, loadLanguage } = installFakeShikiRuntime()

    const html = await render([
      'The text says ```js but this is not a valid fence.',
      '',
      '` ```python `',
      '',
      '    indented code',
      '',
      '<div>```java</div>',
      '',
      '```some-random-language',
      '<a onclick="alert(1)">hello</a>',
      '```',
    ].join('\n'))

    expect(factory).not.toHaveBeenCalled()
    expect(loadLanguage).not.toHaveBeenCalled()
    expect(html).toContain('class="shiki docus-shiki-plain"')
    expect(html).not.toContain('class="hljs"')
    expect(html).toContain('&lt;a onclick=')
  })

  it('keeps markmap and mermaid outside Shiki preparation', async () => {
    const { factory, loadLanguage } = installFakeShikiRuntime()

    const html = await render([
      '```markmap',
      '# Root',
      '```',
      '',
      '```mermaid',
      'graph TD',
      'A --> B',
      '```',
      '',
      '```mmap',
      'not a markmap',
      '```',
      '',
      '```merm',
      'not mermaid',
      '```',
    ].join('\n'))

    expect(factory).not.toHaveBeenCalled()
    expect(loadLanguage).not.toHaveBeenCalled()
    expect(html).toContain('class="markmap-mount"')
    expect(html).toContain('class="mermaid-mount"')
    const doc = new DOMParser().parseFromString(html, 'text/html')
    expect(doc.querySelector('.markmap-mount')?.closest('.shiki')).toBeNull()
    expect(doc.querySelector('.mermaid-mount')?.closest('.shiki')).toBeNull()
    expect(doc.querySelectorAll('pre.docus-shiki-plain')).toHaveLength(2)
    expect(html).not.toContain('class="mark-map-mount"')
  })

  it('does not double-call the real resolver during discovery preflight', async () => {
    installFakeShikiRuntime()
    const resolver: WikiResolver = vi.fn((ref) => ({ target: `notes/${ref}` }))

    const html = await render([
      '[[Some Note]]',
      '',
      '[Standard Link](some-note.md)',
      '',
      '```js',
      'const value = 1',
      '```',
    ].join('\n'), { resolver })

    expect(resolver).toHaveBeenCalledTimes(2)
    expect(resolver).toHaveBeenNthCalledWith(1, 'Some Note', undefined)
    expect(resolver).toHaveBeenNthCalledWith(2, 'some-note', undefined)
    expect(html).toContain('href="/vault/notes/Some%20Note"')
    expect(html).toContain('href="/vault/notes/some-note"')
  })

  it('keeps concurrent resolver state isolated when preflight runs', async () => {
    installFakeShikiRuntime()
    const resolverA: WikiResolver = vi.fn((ref) => ({ target: `vault-a/${ref}` }))
    const resolverB: WikiResolver = vi.fn((ref) => ({ target: `vault-b/${ref}` }))
    const markdown = '[[note]]\n\n```javascript\nconst value = 1\n```'

    const [htmlA, htmlB] = await Promise.all([
      render(markdown, { resolver: resolverA }),
      render(markdown, { resolver: resolverB }),
    ])

    expect(resolverA).toHaveBeenCalledTimes(1)
    expect(resolverB).toHaveBeenCalledTimes(1)
    expect(htmlA).toContain('href="/vault/vault-a/note"')
    expect(htmlA).not.toContain('vault-b/note')
    expect(htmlB).toContain('href="/vault/vault-b/note"')
    expect(htmlB).not.toContain('vault-a/note')
  })

  it('does not initialize Shiki for a document without an eligible fence', async () => {
    const { factory, loadLanguage } = installFakeShikiRuntime()

    await render([
      '# Heading',
      '',
      'A paragraph with [[a wiki link]].',
      '',
      '| A | B |',
      '| --- | --- |',
      '| one | two |',
    ].join('\n'))

    expect(factory).not.toHaveBeenCalled()
    expect(loadLanguage).not.toHaveBeenCalled()
  })

  it('does not reload the same grammar across repeated and alias renders', async () => {
    const { loadLanguage } = installFakeShikiRuntime()

    await render('```js\nconst one = 1\n```')
    await render('```javascript\nconst two = 2\n```')

    expect(loadLanguage).toHaveBeenCalledTimes(1)
  })
})

describe('markdown H3 renderer cutover', () => {
  beforeEach(() => {
    shikiTesting.reset()
  })

  afterEach(() => {
    shikiTesting.reset()
  })

  it('renders representative JavaScript, TypeScript, Java, SQL, and Python fences through Shiki', async () => {
    const html = await render([
      '```js',
      'const answer = 42',
      '```',
      '',
      '```typescript',
      'interface User { id: number }',
      '```',
      '',
      '```java',
      'class Demo {}',
      '```',
      '',
      '```sql',
      'SELECT * FROM users;',
      '```',
      '',
      '```py',
      'def hello(name):',
      '    return name',
      '```',
    ].join('\n'))
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const blocks = Array.from(doc.querySelectorAll('pre.shiki'))

    expect(blocks).toHaveLength(5)
    expect(doc.querySelectorAll('pre.hljs')).toHaveLength(0)
    expect(doc.querySelectorAll('span.line').length).toBeGreaterThanOrEqual(5)
    expect(blocks.map((block) => block.textContent)).toEqual([
      'const answer = 42\n',
      'interface User { id: number }\n',
      'class Demo {}\n',
      'SELECT * FROM users;\n',
      'def hello(name):\n    return name\n',
    ])
    expect(html).not.toMatch(/\sstyle=/i)
  })

  it('renders representative aliases through the same canonical Shiki grammars', async () => {
    const { loadLanguage, codeToHtml } = installFakeShikiRuntime()
    const html = await render([
      '```js',
      'const one = 1',
      '```',
      '',
      '```javascript',
      'const two = 2',
      '```',
      '',
      '```ts',
      'type One = string',
      '```',
      '',
      '```typescript',
      'type Two = string',
      '```',
      '',
      '```py',
      'print(1)',
      '```',
      '',
      '```python',
      'print(2)',
      '```',
      '',
      '```yml',
      'answer: one',
      '```',
      '',
      '```yaml',
      'answer: two',
      '```',
    ].join('\n'))
    const doc = new DOMParser().parseFromString(html, 'text/html')

    expect(doc.querySelectorAll('pre.shiki')).toHaveLength(8)
    expect(codeToHtml).toHaveBeenCalledTimes(8)
    expect(loadLanguage).toHaveBeenCalledTimes(4)
  })

  it('keeps HTML-looking source inside a known Shiki fence as code text', async () => {
    const html = await render([
      '```js',
      '<script>alert(1)</script>',
      '```',
    ].join('\n'))
    const doc = new DOMParser().parseFromString(html, 'text/html')

    expect(doc.querySelector('pre.shiki code')?.textContent).toBe('<script>alert(1)</script>\n')
    expect(doc.querySelector('script')).toBeNull()
    expect(html).not.toMatch(/<script\b/i)
  })

  it('renders unknown and empty fences as escaped plain Shiki fallbacks without initializing', async () => {
    const { factory, loadLanguage } = installFakeShikiRuntime()
    const html = await render([
      '```some-random-language',
      'hello <world>',
      '```',
      '',
      '```',
      'plain <b>code</b>',
      '```',
    ].join('\n'))
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const fallbacks = Array.from(doc.querySelectorAll('pre.docus-shiki-plain'))

    expect(fallbacks).toHaveLength(2)
    expect(fallbacks[0]?.querySelector('code')?.textContent).toBe('hello <world>\n')
    expect(fallbacks[1]?.querySelector('code')?.textContent).toBe('plain <b>code</b>\n')
    expect(doc.querySelector('world')).toBeNull()
    expect(doc.querySelector('b')).toBeNull()
    expect(doc.querySelectorAll('pre.hljs')).toHaveLength(0)
    expect(factory).not.toHaveBeenCalled()
    expect(loadLanguage).not.toHaveBeenCalled()
  })

  it('maps a grammar preparation failure to one fence fallback while preserving other Shiki fences', async () => {
    const { factory, loadLanguage, codeToHtml } = installFakeShikiRuntime()
    loadLanguage
      .mockImplementationOnce(async () => {})
      .mockRejectedValueOnce(new Error('python grammar unavailable'))

    const html = await render([
      '```js',
      'const answer = 42',
      '```',
      '',
      '```python',
      'print("hello")',
      '```',
    ].join('\n'))
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const blocks = Array.from(doc.querySelectorAll('pre'))

    expect(blocks).toHaveLength(2)
    expect(blocks[0]?.classList.contains('shiki')).toBe(true)
    expect(blocks[1]?.classList.contains('docus-shiki-plain')).toBe(true)
    expect(codeToHtml).toHaveBeenCalledTimes(1)
    expect(loadLanguage).toHaveBeenCalledTimes(2)
    expect(factory).toHaveBeenCalledTimes(1)
  })

  it('contains a synchronous codeToHtml failure at the fence boundary', async () => {
    const { factory, loadLanguage, codeToHtml } = installFakeShikiRuntime()
    codeToHtml.mockImplementationOnce(() => {
      throw new Error('single fence rendering failed')
    })

    const html = await render([
      '```js',
      'first fence',
      '```',
      '',
      '```js',
      'second fence',
      '```',
    ].join('\n'))
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const blocks = Array.from(doc.querySelectorAll('pre'))

    expect(blocks[0]?.classList.contains('docus-shiki-plain')).toBe(true)
    expect(blocks[1]?.classList.contains('shiki')).toBe(true)
    expect(codeToHtml).toHaveBeenCalledTimes(2)
    expect(loadLanguage).toHaveBeenCalledTimes(1)
    expect(factory).toHaveBeenCalledTimes(1)

    await expect(render('```js\nthird fence\n```')).resolves.toContain('class="shiki')
    expect(codeToHtml).toHaveBeenCalledTimes(3)
    expect(factory).toHaveBeenCalledTimes(1)
  })

  it('keeps case-sensitive special-fence semantics after the cutover', async () => {
    const { factory } = installFakeShikiRuntime()
    const html = await render([
      '```MARKMAP',
      '# Not a mounted markmap',
      '```',
      '',
      '```mermaid',
      'graph TD',
      'A --> B',
      '```',
    ].join('\n'))
    const doc = new DOMParser().parseFromString(html, 'text/html')

    expect(doc.querySelector('.markmap-mount')).toBeNull()
    expect(doc.querySelector('.mermaid-mount')).not.toBeNull()
    expect(doc.querySelector('pre.docus-shiki-plain')).not.toBeNull()
    expect(factory).not.toHaveBeenCalled()
  })
})

describe('markdown H4 style-to-class and security closure', () => {
  beforeEach(() => {
    shikiTesting.reset()
  })

  afterEach(() => {
    shikiTesting.reset()
  })

  it('keeps Shiki classes after sanitization while isolating trusted CSS from user content', async () => {
    const sourceSentinel = 'DOCUS_H4_USER_SOURCE_SENTINEL_7f3a'
    const html = await render([
      `<span style="color:red" onclick="alert(1)">unsafe</span>`,
      '<img src="/x" onerror="alert(1)">',
      '<a href="javascript:alert(1)">unsafe link</a>',
      '',
      '```js',
      `const value = "${sourceSentinel}"`,
      '</style> body { display:none } --evil: red .docus-shiki-hijack {}',
      '<script>alert(1)</script>',
      '<a onclick="alert(1)">hello</a>',
      '<style>body{display:none}</style>',
      '```',
    ].join('\n'))
    const article = document.createElement('article')
    article.innerHTML = html

    const owner = document.head.querySelector('style#docus-shiki-generated-styles')
    const tokenClass = Array.from(article.querySelectorAll<HTMLElement>('[class]'))
      .flatMap((element) => Array.from(element.classList))
      .find((className) => className.startsWith('docus-shiki-'))

    expect(article.querySelector('pre.shiki')).not.toBeNull()
    expect(article.querySelector('span.line')).not.toBeNull()
    expect(tokenClass).toMatch(/^docus-shiki-/)
    expect(article.querySelectorAll('[style]')).toHaveLength(0)
    expect(article.querySelector('[onclick]')).toBeNull()
    expect(article.querySelector('[onerror]')).toBeNull()
    expect(article.querySelector('script')).toBeNull()
    expect(article.querySelector('style')).toBeNull()
    expect(article.querySelector('a[href^="javascript:"]')).toBeNull()
    expect(html).not.toContain('docus-shiki-generated-styles')

    expect(owner).not.toBeNull()
    expect(owner?.parentElement).toBe(document.head)
    expect(document.head.querySelectorAll('style#docus-shiki-generated-styles')).toHaveLength(1)
    expect(owner?.textContent).toContain('.docus-shiki-')
    expect(owner?.textContent).toContain('--shiki-light:')
    expect(owner?.textContent).toContain('--shiki-dark:')
    expect(owner?.textContent).not.toContain(sourceSentinel)
    expect(owner?.textContent).not.toContain('body { display:none }')
  })

  it('reuses one owner across concurrent multi-language renders with full snapshots', async () => {
    const [javascript, python, java] = await Promise.all([
      render('```js\nconst one = 1\n```'),
      render('```python\nprint(1)\n```'),
      render('```java\nclass Demo {}\n```'),
    ])

    expect(javascript).toContain('class="shiki')
    expect(python).toContain('class="shiki')
    expect(java).toContain('class="shiki')
    expect(document.head.querySelectorAll('style#docus-shiki-generated-styles')).toHaveLength(1)
    expect(document.head.querySelector('style#docus-shiki-generated-styles')?.textContent)
      .toBe(getGeneratedShikiCss())
  })

  it('does not create an empty owner for no-fence or unknown-only documents', async () => {
    expect(document.head.querySelector('style#docus-shiki-generated-styles')).toBeNull()

    await render('# No code fences\n\nPlain text.')
    expect(document.head.querySelector('style#docus-shiki-generated-styles')).toBeNull()

    await render('```totally-unknown\nplain code\n```')
    expect(document.head.querySelector('style#docus-shiki-generated-styles')).toBeNull()
  })
})
