// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render } from '../markdown'
import type { Resolver as WikiResolver } from '../wikiLinks'

describe('Markdown callouts', () => {
  it('renders a basic callout with its default title and content wrapper', async () => {
    const html = await render('> [!note]\n> Hello')
    const doc = new DOMParser().parseFromString(html, 'text/html')

    const callout = doc.querySelector('.callout.callout-note')
    expect(callout).not.toBeNull()
    expect(callout?.querySelector('.callout-title')).not.toBeNull()
    expect(callout?.querySelector('.callout-icon')).not.toBeNull()
    expect(callout?.querySelector('.callout-title-text')?.textContent).toBe('Note')
    expect(callout?.querySelector('.callout-content p')?.textContent).toBe('Hello')
    expect(callout?.querySelector('blockquote')).toBeNull()
  })

  it('supports a custom title as escaped plain text', async () => {
    const html = await render('> [!warning] Database migration\n> Backup first.')
    const doc = new DOMParser().parseFromString(html, 'text/html')

    expect(doc.querySelector('.callout-warning')).not.toBeNull()
    expect(doc.querySelector('.callout-title-text')?.textContent).toBe('Database migration')
    expect(doc.querySelector('.callout-content')?.textContent).toContain('Backup first.')
  })

  it('keeps multiple paragraphs and lists inside the content wrapper', async () => {
    const html = await render([
      '> [!info] Details',
      '> First paragraph.',
      '>',
      '> Second paragraph.',
      '>',
      '> - item 1',
      '> - item 2',
    ].join('\n'))
    const content = new DOMParser().parseFromString(html, 'text/html').querySelector('.callout-content')

    expect(content?.querySelectorAll(':scope > p')).toHaveLength(2)
    expect(content?.querySelectorAll(':scope > ul > li')).toHaveLength(2)
    expect(content?.textContent).toContain('First paragraph.')
    expect(content?.textContent).toContain('Second paragraph.')
  })

  it('normalizes Obsidian aliases to canonical callout classes', async () => {
    const html = await render([
      '> [!caution] Be careful',
      '> Warning text',
      '',
      '> [!done]',
      '> Finished',
      '',
      '> [!tldr]',
      '> Summary',
    ].join('\n'))
    const doc = new DOMParser().parseFromString(html, 'text/html')

    expect(doc.querySelectorAll('.callout-warning')).toHaveLength(1)
    expect(doc.querySelectorAll('.callout-success')).toHaveLength(1)
    expect(doc.querySelectorAll('.callout-note')).toHaveLength(1)
    expect(doc.querySelector('.callout-warning .callout-title-text')?.textContent).toBe('Be careful')
    expect(doc.querySelector('.callout-success .callout-title-text')?.textContent).toBe('Success')
  })

  it('keeps an ordinary blockquote unchanged', async () => {
    const html = await render('> Normal quote')
    const doc = new DOMParser().parseFromString(html, 'text/html')

    expect(doc.querySelector('blockquote')?.textContent).toContain('Normal quote')
    expect(doc.querySelector('.callout')).toBeNull()
  })

  it('keeps rich Markdown and the render-scoped Wiki resolver inside a callout', async () => {
    const resolver: WikiResolver = (ref) => ({ target: `notes/${ref}` })
    const html = await render([
      '> [!tip] Rich',
      '> Use **bold**, `code`, ==highlight==, [external](https://example.com) and [[note]].',
      '>',
      '> - item 1',
      '> - item 2',
    ].join('\n'), { resolver })
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const content = doc.querySelector('.callout-content')

    expect(content?.querySelector('strong')?.textContent).toBe('bold')
    expect(content?.querySelector('code')?.textContent).toBe('code')
    expect(content?.querySelector('mark')?.textContent).toBe('highlight')
    expect(content?.querySelector('a[href="https://example.com"]')?.textContent).toBe('external')
    expect(content?.querySelector('a.wiki-link')?.getAttribute('href')).toBe('/vault/notes/note')
    expect(content?.querySelectorAll('ul > li')).toHaveLength(2)
  })

  it('preserves task-list checkbox and label output after sanitization', async () => {
    const html = await render([
      '> [!todo]',
      '> - [x] Done',
      '> - [ ] Todo',
    ].join('\n'))
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const callout = doc.querySelector('.callout-info')
    const inputs = Array.from(callout?.querySelectorAll<HTMLInputElement>('input.task-list-item-checkbox') ?? [])
    const labels = Array.from(callout?.querySelectorAll('label') ?? [])

    expect(inputs).toHaveLength(2)
    expect(labels).toHaveLength(2)
    expect(inputs[0].checked).toBe(true)
    expect(inputs[0].hasAttribute('checked')).toBe(true)
    expect(inputs[1].checked).toBe(false)
    expect(inputs[1].hasAttribute('checked')).toBe(false)
    expect(inputs.every((input) => input.closest('label'))).toBe(true)
    expect(callout?.querySelector('ul.contains-task-list')).not.toBeNull()
  })

  it('keeps fenced code as code inside a callout', async () => {
    const html = await render([
      '> [!example] TypeScript',
      '>',
      '> ```ts',
      '> const x = 1',
      '> ```',
    ].join('\n'))
    const doc = new DOMParser().parseFromString(html, 'text/html')

    expect(doc.querySelector('.callout-example pre code')?.textContent).toContain('const x = 1')
    expect(doc.querySelector('.callout-example .callout-content')).not.toBeNull()
  })

  it('falls back to note for unknown types without copying input into a class', async () => {
    const html = await render('> [!whatever]\n> Content')
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const callout = doc.querySelector('.callout')

    expect(callout?.className).toBe('callout callout-note')
    expect(callout?.querySelector('.callout-title-text')?.textContent).toBe('Note')
    expect(callout?.textContent).toContain('Content')
    expect(callout?.className).not.toContain('whatever')
  })

  it('does not partially implement folded callouts', async () => {
    const html = await render('> [!note]+\n> expanded')
    const doc = new DOMParser().parseFromString(html, 'text/html')

    expect(doc.querySelector('blockquote')?.textContent).toContain('[!note]+')
    expect(doc.querySelector('.callout')).toBeNull()
    expect(doc.querySelector('details, summary')).toBeNull()
  })

  it('keeps nested callouts valid and independently typed', async () => {
    const html = await render([
      '> [!note] Outer',
      '> Outer content',
      '>',
      '> > [!warning] Inner',
      '> > Inner content',
    ].join('\n'))
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const outer = doc.querySelector('.callout-note')
    const inner = outer?.querySelector('.callout-warning')

    expect(outer).not.toBeNull()
    expect(inner).not.toBeNull()
    expect(inner?.textContent).toContain('Inner content')
    expect(doc.querySelectorAll('.callout')).toHaveLength(2)
    expect(doc.querySelectorAll('blockquote')).toHaveLength(0)
  })

  it('sanitizes dangerous title and body HTML without changing callout structure', async () => {
    const html = await render([
      '> [!warning] <img src=x onerror=alert(1)>',
      '> <script>alert(1)</script>',
      '> <a href="javascript:alert(1)">Run</a>',
      '> Safe text',
    ].join('\n'))
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const callout = doc.querySelector('.callout-warning')

    expect(callout).not.toBeNull()
    expect(callout?.querySelector('.callout-title-text')?.textContent).toBe('<img src=x onerror=alert(1)>')
    expect(callout?.querySelector('script, img')).toBeNull()
    expect(callout?.textContent).toContain('Safe text')
    expect(doc.querySelector('[onerror], [onclick], [onload]')).toBeNull()
    expect(html).not.toMatch(/<script\b/i)
    expect(doc.querySelector('a[href^="javascript:"]')).toBeNull()
  })

  it('does not recognize malformed marker text as a callout', async () => {
    const html = await render('> [!note" onclick="alert(1)]\n> Content')
    const doc = new DOMParser().parseFromString(html, 'text/html')

    expect(doc.querySelector('.callout')).toBeNull()
    expect(doc.querySelector('blockquote')?.textContent).toContain('Content')
    expect(doc.querySelector('[onclick]')).toBeNull()
  })
})
