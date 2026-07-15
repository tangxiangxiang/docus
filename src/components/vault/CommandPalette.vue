<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { PostSummary } from '../../lib/api'
import { createDocumentSearchProvider, createLatestSearchRunner, type DocumentSearchPayload, type SearchResult, type SearchResultSection } from '../../lib/searchResults'
import { useFocusTrap } from '../../composables/useFocusTrap'
import { useI18n } from '../../composables/useI18n'

const props = defineProps<{ posts: PostSummary[]; activePath: string | null }>()
const emit = defineEmits<{ select: [path: string]; new: [title: string] }>()
const open = ref(false)
const query = ref('')
const sections = ref<SearchResultSection[]>([])
const hits = computed(() => sections.value.flatMap((section) => section.results))
const activeIdx = ref(0)
const inputRef = ref<HTMLInputElement | null>(null)
const trap = useFocusTrap()
const { t } = useI18n()
const placeholder = computed(() => t('search.placeholder', { count: props.posts.length }))
function matchLabel(match: DocumentSearchPayload['match']): string {
  return t(`search.match.${match}`)
}
function sectionLabel(section: SearchResultSection): string {
  return section.id === 'files' ? t('search.section.files') : section.label
}
const documentProvider = createDocumentSearchProvider(() => props.posts)
const runLatestSearch = createLatestSearchRunner(
  () => [documentProvider],
  (next) => { sections.value = next; activeIdx.value = 0 },
)

async function refresh() {
  await runLatestSearch(query.value)
}
function show() { trap.activate(); open.value = true; query.value = ''; void refresh(); void nextTick(() => inputRef.value?.focus()) }
function hide() { open.value = false; void trap.deactivate() }
function commit(hit: SearchResult) {
  if (hit.type !== 'file') return
  emit('select', (hit.payload as { path: string }).path)
  hide()
}
function commitNew() { emit('new', query.value.trim()); hide() }
function onKey(e: KeyboardEvent) {
  const meta = e.metaKey || e.ctrlKey
  if (meta && e.key.toLowerCase() === 'p') { e.preventDefault(); show() }
  else if (e.key === 'Escape' && open.value) { e.preventDefault(); hide() }
}
function onInputKey(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') { e.preventDefault(); activeIdx.value = Math.min(activeIdx.value + 1, hits.value.length - 1) }
  else if (e.key === 'ArrowUp') { e.preventDefault(); activeIdx.value = Math.max(activeIdx.value - 1, 0) }
  else if (e.key === 'Enter' && hits.value[activeIdx.value]) { e.preventDefault(); commit(hits.value[activeIdx.value]) }
}
function onGlobalKey(e: KeyboardEvent) { if (open.value) trap.onTab(() => document.querySelector<HTMLElement>('.palette'), e) }
watch(query, refresh)
watch(() => props.posts, () => { if (open.value) void refresh() }, { deep: false })
onMounted(() => { document.addEventListener('keydown', onKey); document.addEventListener('keydown', onGlobalKey) })
onBeforeUnmount(() => { document.removeEventListener('keydown', onKey); document.removeEventListener('keydown', onGlobalKey) })
defineExpose({ show, hide })
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="palette-backdrop" @click.self="hide">
      <div class="palette" role="dialog" aria-modal="true" :aria-label="t('search.dialog_label')">
        <input ref="inputRef" v-model="query" class="palette-input" type="text" :placeholder="placeholder" :aria-label="t('search.input_label')" autocomplete="off" spellcheck="false" @keydown="onInputKey" />
        <div v-if="hits.length" class="palette-list" role="listbox">
          <section v-for="section in sections" :key="section.id" class="palette-section">
            <h3 class="palette-section-title">{{ sectionLabel(section) }}</h3>
            <div v-for="hit in section.results" :key="hit.id" :class="['palette-item', { active: hits.indexOf(hit) === activeIdx }]" role="option" :aria-selected="hits.indexOf(hit) === activeIdx" @mouseenter="activeIdx = hits.indexOf(hit)" @click="commit(hit)">
              <div class="palette-row"><span class="palette-title">{{ hit.title }}</span><span v-if="hit.type === 'file'" class="palette-badge">{{ matchLabel((hit.payload as DocumentSearchPayload).match) }}</span></div>
              <div v-if="hit.type === 'file' && (hit.payload as DocumentSearchPayload).snippet" class="palette-snippet">{{ (hit.payload as DocumentSearchPayload).snippet }}</div>
              <div v-if="hit.subtitle" class="palette-path">{{ hit.subtitle }}</div>
            </div>
          </section>
        </div>
        <div v-else class="palette-empty"><div>{{ t('search.no_results') }}</div><button v-if="query.trim()" type="button" class="btn btn-primary palette-new" @click="commitNew">{{ t('search.create', { query: query.trim() }) }}</button></div>
        <div class="palette-foot"><span>{{ t('search.navigate') }}</span><span>{{ t('search.open') }}</span><span>{{ t('search.close') }}</span></div>
      </div>
    </div>
  </Teleport>
</template>
