<script setup lang="ts">
import { ref } from 'vue'
import type { PostSummary } from '../../lib/api'

const props = defineProps<{ posts: PostSummary[]; currentSlug: string | null }>()
const emit = defineEmits<{
  select: [slug: string]
  new: []
  rename: [newSlug: string]
  delete: [slug: string]
}>()

const renamingSlug = ref<string | null>(null)
const renameInput = ref('')

function startRename(slug: string) {
  renamingSlug.value = slug
  renameInput.value = slug
}

function commitRename() {
  const from = renamingSlug.value
  const to = renameInput.value.trim()
  renamingSlug.value = null
  if (!from || !to || to === from) return
  emit('rename', to)
}

function cancelRename() {
  renamingSlug.value = null
}
</script>

<template>
  <aside class="file-tree">
    <header>
      <span class="title">Files</span>
      <button class="new-btn" @click="emit('new')" title="New post">+ New</button>
    </header>
    <ul v-if="posts.length">
      <li v-for="p in posts" :key="p.slug" :class="{ active: p.slug === currentSlug }">
        <template v-if="renamingSlug === p.slug">
          <input
            v-model="renameInput"
            class="rename-input"
            @keydown.enter="commitRename"
            @keydown.escape="cancelRename"
            @blur="commitRename"
          />
        </template>
        <template v-else>
          <a class="entry" href="#" @click.prevent="emit('select', p.slug)">
            <span class="entry-title">{{ p.title || p.slug }}</span>
            <span v-if="p.date" class="entry-date">{{ p.date }}</span>
          </a>
          <div class="actions">
            <button @click="startRename(p.slug)" title="Rename">✎</button>
            <button @click="emit('delete', p.slug)" title="Delete">×</button>
          </div>
        </template>
      </li>
    </ul>
    <p v-else class="empty">No posts yet.</p>
  </aside>
</template>
