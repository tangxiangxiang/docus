<script setup lang="ts">
import { computed, ref } from 'vue'
import type { PostSummary } from '../../lib/api'
import {
  buildTagIndex,
  normalizeTag,
  parseTagQuery,
  sortTagsByCountDescThenName,
  type TagRecord,
} from '../../lib/tags'
import { useI18n } from '../../composables/useI18n'
import { useDocumentHoverCard } from '../../composables/useDocumentHoverCard'
import DocumentHoverCard from './DocumentHoverCard.vue'
import { ICON_FILE_MD, ICON_SEARCH } from './icons'

const props = defineProps<{ posts: PostSummary[]; selectedTag: string | null; path: string | null }>()
const emit = defineEmits<{ select: [tag: string]; open: [path: string] }>()

/* The panel contains:
   1. A filterable single-select tag list.
   2. Notes belonging to the selected tag. */
const filter = defineModel<string>('filter', { default: '' })
const { t } = useI18n()

/* Phase 1 of the unified tag plan. The tag list and the
   single-tag post filter used to be hand-rolled in this component;
   both now go through the shared `lib/tags` module so the tag
   query semantics can never drift between TagPanel and FileTree.
   The user-visible behavior is identical:
   - The list is still sorted by count desc then name asc.
   - The filter is still a case-insensitive substring of the tag
     name (plain text only; `#`-prefixed tokens in the filter
     parse to `includeAll` but the list filter only consults the
     `text` channel — see `visibleTags` below).
   - Selecting a tag still shows posts whose `tags` array contains
     that exact tag (case-insensitive on the server side, but we
     also normalize here so a `Java` / `java` mismatch can't sneak
     through). */
const tagIndex = computed(() => buildTagIndex(props.posts))

const allTagsSorted = computed<TagRecord[]>(() =>
  sortTagsByCountDescThenName(Array.from(tagIndex.value.tags.values())),
)

const visibleTags = computed<TagRecord[]>(() => {
  const query = parseTagQuery(filter.value)
  // Phase 1 keeps the historical "filter the tag list by tag-name
  // substring" behavior — only the `text` channel of the parsed
  // query participates. Tag-shaped tokens (`#xxx` / `-#xxx`) are
  // honored by the FileTree's file filter (see
  // FileTree.vue filterByQuery) but not by the list filter itself,
  // because the user-visible UI is "type a few characters, see
  // matching tag names" — not "type a structured query".
  const needle = query.text.toLocaleLowerCase()
  if (!needle) return allTagsSorted.value
  return allTagsSorted.value.filter((tag) =>
    tag.displayName.toLocaleLowerCase().includes(needle),
  )
})

const tagCountLabel = computed(() => filter.value.trim()
  ? t('tags.filtered_count', { visible: visibleTags.value.length, total: allTagsSorted.value.length })
  : t('tags.total', { count: allTagsSorted.value.length }))

const filteredPosts = computed(() => {
  if (!props.selectedTag) return []
  // Use the normalized form as the index key — this is what
  // TagIndex.tagDocuments was built on. A user-selected `#Java`
  // will resolve via the same lookup as the index's `java` entry,
  // so casing mismatches in the selected tag can't cause "no
  // notes" when notes clearly carry the tag.
  const target = normalizeTag(props.selectedTag)
  if (!target) return []
  const paths = tagIndex.value.tagDocuments.get(target)
  if (!paths || paths.size === 0) return []
  // Preserve the input order of `posts` so the result list order
  // is deterministic — building a Set first and then sorting would
  // either shuffle the order or require an extra sort.
  return props.posts.filter((post) => paths.has(post.path))
})

const hoveredPost = ref<PostSummary | null>(null)
const { hoverCardVisible, hoverCardStyle, showHoverCard, hideHoverCard } = useDocumentHoverCard()
function showPostHoverCard(post: PostSummary, event: MouseEvent) {
  hoveredPost.value = post
  showHoverCard(event)
}
function hidePostHoverCard() {
  hideHoverCard()
  hoveredPost.value = null
}

function onFilterKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && filter.value) {
    event.stopPropagation()
    filter.value = ''
  }
}
</script>

<template>
  <aside class="tag-panel" :class="{ 'has-results': selectedTag }" :aria-label="t('tags.panel_label')">
    <header>
      <div class="tag-filter">
        <span class="tag-filter-icon" v-html="ICON_SEARCH" aria-hidden="true" />
        <input v-model="filter" class="tag-filter-input" type="text" :placeholder="t('tags.filter')" :aria-label="t('tags.filter')" @keydown="onFilterKeydown" />
        <button v-if="filter" class="tag-filter-clear-x" :title="t('tags.clear_filter')" :aria-label="t('tags.clear_filter')" @click="filter = ''">×</button>
        <span class="tag-filter-count" :title="tagCountLabel" :aria-label="tagCountLabel">{{ visibleTags.length }}</span>
      </div>
    </header>

    <div class="tag-list-region">
      <ul v-if="visibleTags.length" class="tag-list" role="listbox" :aria-label="t('tags.list_label')">
        <li v-for="tagRecord in visibleTags" :key="tagRecord.normalizedName" role="presentation">
          <button class="tag-entry" role="option" :class="{ active: selectedTag === tagRecord.displayName }" :aria-selected="selectedTag === tagRecord.displayName" :title="selectedTag === tagRecord.displayName ? t('tags.deselect', { tag: tagRecord.displayName }) : t('tags.browse', { tag: tagRecord.displayName })" @click="emit('select', tagRecord.displayName)">
            <span class="tag-name"><span class="tag-hash" aria-hidden="true">#</span><span class="tag-label">{{ tagRecord.displayName }}</span></span>
            <span class="tag-count">{{ tagRecord.count }}</span>
          </button>
        </li>
      </ul>
      <p v-else-if="filter" class="empty">{{ t('tags.no_match') }}</p>
      <p v-else class="empty">{{ t('tags.empty') }}</p>
    </div>

    <div v-if="selectedTag" class="results" aria-live="polite">
      <header class="results-header">
        <span class="results-title"><span class="tag-hash" aria-hidden="true">#</span>{{ selectedTag }}</span>
        <span class="results-count">{{ t('tags.note_count', { count: filteredPosts.length }) }}</span>
      </header>
      <ul v-if="filteredPosts.length" class="results-list">
        <li v-for="post in filteredPosts" :key="post.path">
          <button class="result-entry document-row" :class="{ active: post.path === path }" @click="emit('open', post.path)" @mouseenter="showPostHoverCard(post, $event)" @mouseleave="hidePostHoverCard">
            <span class="result-chevron-spacer" aria-hidden="true" />
            <span class="result-icon" aria-hidden="true" v-html="ICON_FILE_MD" />
            <span class="result-label">
              <span class="result-title">{{ post.title }}</span>
            </span>
          </button>
        </li>
      </ul>
      <p v-else class="empty">{{ t('tags.no_notes') }}</p>
      <DocumentHoverCard
        v-if="hoveredPost"
        :visible="hoverCardVisible"
        :position="hoverCardStyle"
        :title="hoveredPost.title"
        :path="hoveredPost.path"
        :mtime="hoveredPost.mtime"
        :tags="hoveredPost.tags"
      />
    </div>
  </aside>
</template>
