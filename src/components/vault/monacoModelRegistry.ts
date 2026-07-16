interface DisposableModel {
  isDisposed: () => boolean
  dispose: () => void
}

const models = new Map<string, DisposableModel>()

export function getMarkdownModel(path: string): DisposableModel | undefined {
  return models.get(path)
}

export function registerMarkdownModel(path: string, model: DisposableModel): void {
  models.set(path, model)
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
