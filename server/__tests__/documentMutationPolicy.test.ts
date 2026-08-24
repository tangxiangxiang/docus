import { describe, expect, it } from 'vitest'
import { validateDocumentMutation } from '../documentMutationPolicy'

const allowed = (mutation: Parameters<typeof validateDocumentMutation>[0]) =>
  expect(() => validateDocumentMutation(mutation)).not.toThrow()
const blocked = (mutation: Parameters<typeof validateDocumentMutation>[0], message: RegExp) =>
  expect(() => validateDocumentMutation(mutation)).toThrow(message)

describe('server document mutation policy', () => {
  it('allows archive descendants through every document mutation path', () => {
    allowed({ operation: 'create', destinationPath: 'archive/new' })
    allowed({ operation: 'write', destinationPath: 'archive/new', destinationExists: false })
    allowed({ operation: 'write', destinationPath: 'archive/existing', destinationExists: true })
    allowed({ operation: 'delete', sourcePath: 'archive/existing' })
    allowed({ operation: 'rename', sourcePath: 'archive/a', destinationPath: 'archive/b' })
    allowed({ operation: 'rename', sourcePath: 'archive/a', destinationPath: 'literature/a' })
    allowed({ operation: 'rename', sourcePath: 'literature/a', destinationPath: 'archive/a' })
  })

  it('reserves the system root names without restricting descendants', () => {
    blocked({ operation: 'create', destinationPath: 'archive' }, /protected root/)
    blocked({ operation: 'write', destinationPath: 'archive', destinationExists: true }, /protected root/)
    blocked({ operation: 'delete', sourcePath: 'archive' }, /protected root/)
    blocked({ operation: 'rename', sourcePath: 'archive', destinationPath: 'archive-renamed' }, /protected root/)
    blocked({ operation: 'rename', sourcePath: 'notes/a', destinationPath: 'archive' }, /protected root/)
  })
})
