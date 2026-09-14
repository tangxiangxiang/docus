import { shallowRef } from 'vue'
import type { PostSummary } from './api'

const posts = shallowRef<PostSummary[]>([])

export function getDocumentSearchPosts(): PostSummary[] {
  return posts.value
}

export function setDocumentSearchPosts(next: readonly PostSummary[]): void {
  posts.value = [...next]
}

export function clearDocumentSearchPosts(): void {
  posts.value = []
}
