import { describe, expect, it } from 'vitest'
import { validateDocumentMutation } from '../documentMutationPolicy'

const allowed = (mutation: Parameters<typeof validateDocumentMutation>[0]) =>
  expect(() => validateDocumentMutation(mutation)).not.toThrow()
const blocked = (mutation: Parameters<typeof validateDocumentMutation>[0], message: RegExp) =>
  expect(() => validateDocumentMutation(mutation)).toThrow(message)

describe('server document mutation policy', () => {
  it('blocks both explicit and write-as-create paths in archive', () => {
    blocked({ operation: 'create', destinationPath: 'archive/new' }, /archive flow/)
    blocked({ operation: 'write', destinationPath: 'Archive/new', destinationExists: false }, /archive flow/)
    allowed({ operation: 'write', destinationPath: 'archive/existing', destinationExists: true })
  })

  it('blocks archive deletion, same-folder rename, and moving out', () => {
    blocked({ operation: 'delete', sourcePath: 'archive/a' }, /cannot be deleted/)
    blocked({ operation: 'rename', sourcePath: 'archive/a', destinationPath: 'archive/b' }, /cannot be renamed/)
    blocked({ operation: 'rename', sourcePath: 'archive/a', destinationPath: 'inbox/a' }, /only be moved within/)
  })

  it('allows archive reclassification and only eligible inbound moves', () => {
    allowed({ operation: 'rename', sourcePath: 'archive/a', destinationPath: 'archive/topic/a' })
    allowed({ operation: 'rename', sourcePath: 'inbox/a', destinationPath: 'archive/a' })
    allowed({ operation: 'rename', sourcePath: 'literature/a', destinationPath: 'archive/a' })
    blocked({ operation: 'rename', sourcePath: 'notes/a', destinationPath: 'archive/a' }, /only inbox/)
  })
})
