import type { DocumentMetadata, PostSummary } from '../lib/api'

/**
 * Metadata lives in SQLite; it does not rewrite the Markdown document.
 * Keep the file mtime from the existing summary when applying the saved
 * metadata response to the in-memory workspace index.
 */
export function applyMetadataToPostSummary(
  post: PostSummary,
  metadata: DocumentMetadata,
): PostSummary {
  return {
    ...post,
    title: metadata.title,
    summary: metadata.summary,
    tags: [...metadata.tags],
    updated: new Date(metadata.updatedAt).toISOString().slice(0, 10),
  }
}
