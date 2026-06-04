<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { buildIndex, rebuildIndex, primeBody, search, type SearchHit } from '../../lib/search'
import type { PostSummary } from '../../lib/api'
import { useFocusTrap } from '../../composables/useFocusTrap'

const props = defineProps<{
  posts: PostSummary[]
  activePath: string | null
}>()
const emit = defineEmits<{
  (e: 'select', path: string): void
  (e: 'new', title: string): void
}>()

const open = ref(false)
const query = ref('')
const hits = ref<SearchHit[]>([])
const activeIdx = ref(0)
const inputRef = ref<HTMLInputElement | null>(null)
let indexed = false
let priming: Promise<void> | null = null

/** "posts/notes/draft" -> "notes / draft" (drops the "posts/" prefix). */
function pathTail(p: string): string {
  return p.replace(/^posts\//, '')
}

async function ensureIndexed() {
  if (props.posts.length === 0) return
  if (!indexed) {
    buildIndex(props.posts)
    indexed = true
  } else {
    rebuildIndex(props.posts)
  }
  if (!priming) priming = primeBody(props.posts)
  await priming
}

async function refresh() {
  await ensureIndexed()
  hits.value = search(query.value, 12)
  activeIdx.value = 0
}

// Focus management is delegated to useFocusTrap. The palette's modal
// nature (teleported, modal, role=dialog) means a keyboard user would
// otherwise walk out into the underlying vault on Tab and lose their
// place on close — the trap captures the trigger on open, focuses
// the input, and restores the trigger on close.
const trap = useFocusTrap()

function show() {
  trap.activate()
  open.value = true
  query.value = ''
  activeIdx.value = 0
  void refresh()
  void nextTick(() => inputRef.value?.focus())
}
function hide() {
  open.value = false
  void trap.deactivate()
}

function commit(hit: SearchHit) {
  emit('select', hit.path)
  hide()
}

function commitNew() {
  emit('new', query.value.trim())
  hide()
}

function onKey(e: KeyboardEvent) {
  const meta = e.metaKey || e.ctrlKey
  // Ctrl/Cmd-P:快速打开
  if (meta && e.key.toLowerCase() === 'p' && !e.shiftKey) {
    e.preventDefault()
    show()
    return
  }
  // Ctrl/Cmd-Shift-P:命令面板(同义,后续可加更多命令)
  if (meta && e.key.toLowerCase() === 'p' && e.shiftKey) {
    e.preventDefault()
    show()
    return
  }
  if (e.key === 'Escape' && open.value) {
    e.preventDefault()
    hide()
  }
}

function onInputKey(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    activeIdx.value = Math.min(activeIdx.value + 1, hits.value.length - 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    activeIdx.value = Math.max(activeIdx.value - 1, 0)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    if (hits.value[activeIdx.value]) commit(hits.value[activeIdx.value])
  }
}

// Tab / Shift+Tab while the palette is open would otherwise walk
// straight out into the underlying vault. The trap composable owns
// the cycling logic; we just hand it a getter so it can find the
// .palette root on each Tab press (the element may not exist when
// the listener is bound and is recreated on every open).
function onGlobalKey(e: KeyboardEvent) {
  if (!open.value) return
  trap.onTab(() => document.querySelector<HTMLElement>('.palette'), e)
}

watch(query, () => {
  activeIdx.value = 0
  void refresh()
})

watch(
  () => props.posts,
  () => {
    if (open.value) void refresh()
  },
  { deep: false },
)

onMounted(() => {
  document.addEventListener('keydown', onKey)
  document.addEventListener('keydown', onGlobalKey)
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKey)
  document.removeEventListener('keydown', onGlobalKey)
})

defineExpose({ show, hide })

const placeholder = computed(() => `搜索 ${props.posts.length} 篇…`)
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="palette-backdrop" @click.self="hide">
      <div class="palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <input
          ref="inputRef"
          v-model="query"
          class="palette-input"
          type="text"
          :placeholder="placeholder"
          autocomplete="off"
          spellcheck="false"
          @keydown="onInputKey"
        />
        <ul v-if="hits.length" class="palette-list" role="listbox">
          <li
            v-for="(h, i) in hits"
            :key="h.path"
            :class="['palette-item', { active: i === activeIdx }]"
            role="option"
            :aria-selected="i === activeIdx"
            @mouseenter="activeIdx = i"
            @click="commit(h)"
          >
            <div class="palette-row">
              <span class="palette-title">{{ h.title }}</span>
              <span :class="['palette-badge', `badge-${h.match}`]">{{ h.match }}</span>
            </div>
            <div v-if="h.snippet" class="palette-snippet">{{ h.snippet }}</div>
            <div class="palette-path">{{ pathTail(h.path) }}</div>
          </li>
        </ul>
        <div v-else class="palette-empty">
          <div>无匹配结果</div>
          <button v-if="query.trim()" type="button" class="btn btn-primary palette-new" @click="commitNew">
            新建 "{{ query.trim() }}"
          </button>
        </div>
        <div class="palette-foot">
          <span>↑↓ 切换</span>
          <span>↵ 打开</span>
          <span>esc 关闭</span>
        </div>
      </div>
    </div>
  </Teleport>
</template>
