import { resolveWikiTarget } from '../src/lib/linkResolve.js'

export function rewriteDocumentReferences(raw: string, sourcePath: string, oldPath: string, newPath: string, allPaths: string[]): string {
  return raw.split(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/g).map((segment, index) =>
    index % 2 === 1 ? segment : rewriteTextReferences(segment, sourcePath, oldPath, newPath, allPaths),
  ).join('')
}

function rewriteTextReferences(raw: string, sourcePath: string, oldPath: string, newPath: string, allPaths: string[]): string {
  const wikiUpdated = raw.replace(/\[\[([^\]\n]+)\]\]/g, (whole, inner: string) => {
    const pipe = inner.indexOf('|')
    const target = pipe === -1 ? inner : inner.slice(0, pipe)
    const alias = pipe === -1 ? '' : inner.slice(pipe)
    const hash = target.indexOf('#')
    const ref = (hash === -1 ? target : target.slice(0, hash)).trim()
    const anchor = hash === -1 ? '' : target.slice(hash)
    return resolveWikiTarget(ref, sourcePath, allPaths) === oldPath ? `[[${newPath}${anchor}${alias}]]` : whole
  })
  return wikiUpdated.replace(/(\[[^\]\n]*\]\()([^\s)]+)(\))/g, (whole, prefix: string, href: string, suffix: string) => {
    const hash = href.indexOf('#')
    const pathPart = hash === -1 ? href : href.slice(0, hash)
    const anchor = hash === -1 ? '' : href.slice(hash)
    const ref = pathPart.replace(/\.md$/i, '')
    return resolveWikiTarget(ref, sourcePath, allPaths) === oldPath ? `${prefix}${newPath}.md${anchor}${suffix}` : whole
  })
}
