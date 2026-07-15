<script setup lang="ts">
import { computed, ref } from 'vue'
import type { PostSummary } from '../../lib/api'
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

const tagMap = computed(() => {
  const map = new Map<string, number>()
  for (const post of props.posts) {
    for (const tag of post.tags) map.set(tag, (map.get(tag) ?? 0) + 1)
  }
  return Array.from(map.entries()).sort((a, b) => {
    if (a[1] !== b[1]) return b[1] - a[1]
    return a[0].localeCompare(b[0])
  })
})

const visibleTags = computed(() => {
  const query = filter.value.trim().toLocaleLowerCase()
  if (!query) return tagMap.value
  return tagMap.value.filter(([tag]) => tag.toLocaleLowerCase().includes(query))
})

const tagCountLabel = computed(() => filter.value.trim()
  ? t('tags.filtered_count', { visible: visibleTags.value.length, total: tagMap.value.length })
  : t('tags.total', { count: tagMap.value.length }))

const filteredPosts = computed(() => {
  if (!props.selectedTag) return []
  return props.posts.filter((post) => post.tags.includes(props.selectedTag!))
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
        <li v-for="[tag, count] in visibleTags" :key="tag" role="presentation">
          <button class="tag-entry" role="option" :class="{ active: selectedTag === tag }" :aria-selected="selectedTag === tag" :title="selectedTag === tag ? t('tags.deselect', { tag }) : t('tags.browse', { tag })" @click="emit('select', tag)">
            <span class="tag-name"><span class="tag-hash" aria-hidden="true">#</span><span class="tag-label">{{ tag }}</span></span>
            <span class="tag-count">{{ count }}</span>
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
