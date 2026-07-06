// Tests for the markdown-it pipeline in src/lib/markdown.ts.
// Specifically: the ```markmap``` fence rule, which emits a
// placeholder div with the source embedded in `data-content`
// (HTML-attr-encoded) for useMarkmapMount to upgrade into a live
// widget. We exercise the real `render()` exported by the module
// so the test goes through the same path the app uses (including
// the async hljs init).
import { describe, it, expect } from 'vitest'
import { render } from '../markdown'

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
    /* The source is HTML-attr-encoded; angle brackets and quotes
       must come back escaped so the attribute is well-formed. */
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

  it('keeps non-markmap fences untouched (hljs still highlights)', async () => {
    const html = await render([
      '```js',
      'const x = 1',
      '```',
    ].join('\n'))
    expect(html).toContain('class="hljs"')
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
    /* Source survives attribute-encoding (sans the leading "graph"
       line, which is plain ASCII and needs no escaping). */
    expect(html).toContain('graph TD')
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
})
