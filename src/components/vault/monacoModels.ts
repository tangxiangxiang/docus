import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js'

const models = new Map<string, monaco.editor.ITextModel>()

export function acquireMarkdownModel(path: string, value: string): monaco.editor.ITextModel {
  const existing = models.get(path)
  if (existing && !existing.isDisposed()) return existing
  const model = monaco.editor.createModel(value, 'markdown', monaco.Uri.parse(`docus://vault/${path}`))
  models.set(path, model)
  return model
}

export function disposeMarkdownModel(path: string): void {
  const model = models.get(path)
  if (!model) return
  models.delete(path)
  if (!model.isDisposed()) model.dispose()
}

export function renameMarkdownModel(fromPath: string, toPath: string): void {
  // Monaco model URIs are immutable. Closing the old model is preferable
  // to retaining a model whose URI no longer matches the document path.
  disposeMarkdownModel(fromPath)
  disposeMarkdownModel(toPath)
}

export function resetMarkdownModelsForTesting(): void {
  for (const path of [...models.keys()]) disposeMarkdownModel(path)
}
