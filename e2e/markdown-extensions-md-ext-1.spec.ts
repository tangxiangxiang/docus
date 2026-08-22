import { expect, test } from '@playwright/test'

test('MD-EXT-1 keeps final heading IDs shared across TOC and generated links/images', async ({ page }) => {
  await page.goto('/__markdown-test?mode=reading')

  const result = await page.evaluate(async () => {
    const { render } = await import('/src/lib/markdown.ts')
    const html = await render([
      '[[toc]]',
      '',
      '## Java Guide {#java-guide}',
      '## Duplicate',
      '## Duplicate',
      '## Other {#duplicate}',
      '### Formatted **Heading** {#formatted}',
      '',
      '[External](https://example.com)',
      '',
      'https://linkify.example.test/path',
      '',
      '<a href="https://raw.example" target="_self">Raw</a>',
      '',
      '![Example](./example.png)',
    ].join('\n'))
    const article = document.createElement('article')
    article.className = 'article reading md-ext-1-browser-fixture'
    article.innerHTML = html
    document.body.append(article)

    const headings = Array.from(article.querySelectorAll('h2, h3')).map((heading) => ({
      id: heading.id,
      text: heading.textContent,
    }))
    const tocLinks = Array.from(article.querySelectorAll<HTMLAnchorElement>('nav.docus-toc a'))
      .map((link) => link.getAttribute('href'))
    const generatedExternal = article.querySelector<HTMLAnchorElement>('a[href="https://example.com"]')
    const linkifiedExternal = article.querySelector<HTMLAnchorElement>('a[href="https://linkify.example.test/path"]')
    const rawAnchor = article.querySelector<HTMLAnchorElement>('a[href="https://raw.example"]')
    const image = article.querySelector<HTMLImageElement>('img')
    article.remove()

    return {
      headings,
      tocLinks,
      generatedExternal: generatedExternal
        ? { target: generatedExternal.target, rel: generatedExternal.rel }
        : null,
      linkifiedExternal: linkifiedExternal
        ? { target: linkifiedExternal.target, rel: linkifiedExternal.rel }
        : null,
      rawTarget: rawAnchor?.getAttribute('target') ?? null,
      imageLoading: image?.getAttribute('loading') ?? null,
    }
  })

  expect(result.headings).toEqual([
    { id: 'java-guide', text: 'Java Guide' },
    { id: 'duplicate', text: 'Duplicate' },
    { id: 'duplicate-2', text: 'Duplicate' },
    { id: 'duplicate-3', text: 'Other' },
    { id: 'formatted', text: 'Formatted Heading' },
  ])
  expect(result.tocLinks).toEqual([
    '#java-guide',
    '#duplicate',
    '#duplicate-2',
    '#duplicate-3',
    '#formatted',
  ])
  expect(result.generatedExternal).toEqual({ target: '_blank', rel: 'noopener noreferrer' })
  expect(result.linkifiedExternal).toEqual({ target: '_blank', rel: 'noopener noreferrer' })
  expect(result.rawTarget).toBeNull()
  expect(result.imageLoading).toBe('lazy')
})

test('MD-EXT-1 prepared PDF HTML retains TOC targets, anchors, and lazy images', async ({ page }) => {
  await page.goto('/__markdown-test?mode=reading')

  const result = await page.evaluate(async () => {
    const { render } = await import('/src/lib/markdown.ts')
    const { preparePdfArticleHtml } = await import('/src/lib/pdfExport.ts')
    const article = document.createElement('article')
    article.className = 'article reading'
    article.innerHTML = await render([
      '[[toc]]',
      '',
      '## Java Guide {#java-guide}',
      '',
      '![Example](./example.png)',
    ].join('\n'))
    const prepared = document.createElement('div')
    prepared.innerHTML = preparePdfArticleHtml(article)
    return {
      hasToc: prepared.querySelector('nav.docus-toc') !== null,
      tocHref: prepared.querySelector<HTMLAnchorElement>('nav.docus-toc a')?.getAttribute('href') ?? null,
      heading: prepared.querySelector('h2#java-guide') !== null,
      imageLoading: prepared.querySelector('img')?.getAttribute('loading') ?? null,
    }
  })

  expect(result).toEqual({
    hasToc: true,
    tocHref: '#java-guide',
    heading: true,
    imageLoading: 'lazy',
  })
})
