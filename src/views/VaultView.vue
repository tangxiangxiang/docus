<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  listPosts,
  getPost,
  createPost,
  savePost,
  deletePost,
  renamePost,
  type PostSummary,
} from '../lib/api'
import { stringifyDoc, slugify } from '../lib/frontmatter'
import FileTree from '../components/vault/FileTree.vue'
import EditorPane from '../components/vault/EditorPane.vue'
import PreviewPane from '../components/vault/PreviewPane.vue'

const route = useRoute()
const router = useRouter()

const posts = ref<PostSummary[]>([])
const currentSlug = ref<string | null>(null)
const currentRaw = ref<string>('')
const originalRaw = ref<string>('')
const saveStatus = ref<'idle' | 'dirty' | 'saving' | 'saved' | 'error'>('idle')
const error = ref<string | null>(null)
const loadError = ref<string | null>(null)
let saveTimer: number | null = null

const isDirty = computed(() => currentRaw.value !== originalRaw.value)

async function refresh() {
  posts.value = await listPosts()
}

async function openPost(slug: string) {
  if (slug === currentSlug.value) return
  if (isDirty.value) {
    if (!confirm('Unsaved changes will be lost. Continue?')) return
  }
  currentSlug.value = slug
  originalRaw.value = ''
  currentRaw.value = ''
  saveStatus.value = 'idle'
  error.value = null
  loadError.value = null
  try {
    const post = await getPost(slug)
    originalRaw.value = post.raw
    currentRaw.value = post.raw
  } catch (e) {
    loadError.value = (e as Error).message
  }
  router.replace(`/vault/${slug}`)
}

async function doSave(): Promise<void> {
  if (!currentSlug.value) return
  if (!isDirty.value) return
  saveStatus.value = 'saving'
  error.value = null
  try {
    await savePost(currentSlug.value, currentRaw.value)
    originalRaw.value = currentRaw.value
    saveStatus.value = 'saved'
    await refresh()
  } catch (e) {
    saveStatus.value = 'error'
    error.value = (e as Error).message
  }
}

function onEditorChange(val: string) {
  currentRaw.value = val
  saveStatus.value = isDirty.value ? 'dirty' : 'idle'
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    void doSave()
  }, 800)
}

async function doSaveNow() {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  await doSave()
}

function onKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === 's') {
    e.preventDefault()
    void doSaveNow()
  }
}

async function onNew() {
  const title = prompt('New post title?')?.trim()
  if (!title) return
  const slug = slugify(title)
  const today = new Date().toISOString().slice(0, 10)
  const raw = stringifyDoc(
    { title, date: today, tags: [], summary: '' },
    `# ${title}\n\nStart writing...\n`,
  )
  try {
    await createPost(slug, raw)
    await refresh()
    await openPost(slug)
  } catch (e) {
    alert(`Create failed: ${(e as Error).message}`)
  }
}

async function onRename(newSlug: string) {
  if (!currentSlug.value) return
  if (newSlug === currentSlug.value) return
  if (isDirty.value) {
    if (!confirm('Unsaved changes will be lost. Rename anyway?')) return
  }
  try {
    await renamePost(currentSlug.value, newSlug)
    currentSlug.value = newSlug
    originalRaw.value = currentRaw.value
    await refresh()
    router.replace(`/vault/${newSlug}`)
  } catch (e) {
    alert(`Rename failed: ${(e as Error).message}`)
  }
}

async function onDelete(slug: string) {
  if (!confirm(`Delete "${slug}"? This cannot be undone.`)) return
  try {
    await deletePost(slug)
    if (slug === currentSlug.value) {
      currentSlug.value = null
      currentRaw.value = ''
      originalRaw.value = ''
      saveStatus.value = 'idle'
      router.replace('/vault')
    }
    await refresh()
  } catch (e) {
    alert(`Delete failed: ${(e as Error).message}`)
  }
}

onMounted(async () => {
  await refresh()
  const slugFromRoute = route.params.slug
  if (typeof slugFromRoute === 'string' && slugFromRoute) {
    await openPost(slugFromRoute)
  }
})

watch(
  () => route.params.slug,
  (slug) => {
    if (typeof slug === 'string' && slug && slug !== currentSlug.value) {
      void openPost(slug)
    }
  },
)

onBeforeUnmount(() => {
  if (saveTimer) clearTimeout(saveTimer)
})
</script>

<template>
  <div class="vault" tabindex="0" @keydown="onKeydown">
    <FileTree
      :posts="posts"
      :current-slug="currentSlug"
      @select="openPost"
      @new="onNew"
      @rename="onRename"
      @delete="onDelete"
    />

    <section class="pane editor-pane">
      <header class="pane-header">
        <span class="filename">{{ currentSlug ? `${currentSlug}.md` : 'No file open' }}</span>
        <span class="spacer" />
        <span class="status" :data-status="saveStatus">
          <template v-if="saveStatus === 'idle'">·</template>
          <template v-else-if="saveStatus === 'dirty'">● unsaved</template>
          <template v-else-if="saveStatus === 'saving'">… saving</template>
          <template v-else-if="saveStatus === 'saved'">✓ saved</template>
          <template v-else-if="saveStatus === 'error'">! {{ error }}</template>
        </span>
        <button class="save-btn" :disabled="!isDirty || saveStatus === 'saving'" @click="doSaveNow">
          Save
        </button>
      </header>
      <div class="editor-wrap">
        <EditorPane
          v-if="currentSlug"
          :model-value="currentRaw"
          @update:model-value="onEditorChange"
        />
        <div v-else-if="loadError" class="empty error">{{ loadError }}</div>
        <div v-else class="empty">Pick a file or create a new one.</div>
      </div>
    </section>

    <section class="pane preview-pane">
      <header class="pane-header">
        <span>Preview</span>
      </header>
      <div class="preview-wrap">
        <PreviewPane v-if="currentSlug" :raw="currentRaw" />
        <div v-else class="empty">—</div>
      </div>
    </section>
  </div>
</template>
