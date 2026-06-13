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
})
