<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { NButton, NInput, NSelect, type SelectOption } from 'naive-ui'
import { ledgerErrorMessage } from '../../features/ledger/ledgerErrors'
import { useLedgerStore } from '../../features/ledger/ledgerStore'
import type { LedgerAccountIcon } from '../../../shared/ledgerProtocol'
import LedgerAccountIconPicker from '../ledger/LedgerAccountIconPicker.vue'

const store = useLedgerStore()
const kind = ref<'income' | 'expense'>('expense')
const name = ref('')
const error = ref('')
const saving = ref(false)
const creating = ref(false)
const newIcon = ref<LedgerAccountIcon>('wallet')
const categoryIcons = ref<Record<string, LedgerAccountIcon>>({})
const managing = ref(false)
const editingId = ref<string | null>(null)
const editingName = ref('')
const archiveId = ref<string | null>(null)
let holdTimer: ReturnType<typeof setTimeout> | null = null
const kindOptions: SelectOption[] = [
  { label: '支出分类', value: 'expense' },
  { label: '收入分类', value: 'income' },
]
const categories = computed(() => store.activeCategories.value)

onMounted(() => {
  void store.bootstrap()
  try {
    categoryIcons.value = JSON.parse(localStorage.getItem('docus.ledger.category-icons') ?? '{}') as Record<string, LedgerAccountIcon>
  } catch {
    categoryIcons.value = {}
  }
})

onBeforeUnmount(() => {
  if (holdTimer !== null) clearTimeout(holdTimer)
})

function persistIcons(): void {
  localStorage.setItem('docus.ledger.category-icons', JSON.stringify(categoryIcons.value))
}

function iconFor(id: string): LedgerAccountIcon {
  return categoryIcons.value[id] ?? 'wallet'
}

function startHold(): void {
  holdTimer = setTimeout(() => { managing.value = true }, 550)
}

function cancelHold(): void {
  if (holdTimer !== null) clearTimeout(holdTimer)
  holdTimer = null
}

function startRename(id: string, currentName: string): void {
  if (!managing.value) return
  editingId.value = id
  editingName.value = currentName
}

async function finishRename(category: { id: string; name: string; kind: 'income' | 'expense'; version: number }): Promise<void> {
  const nextName = editingName.value.trim()
  if (nextName && nextName !== category.name) {
    try {
      await store.patchCategory(category.id, { expectedVersion: category.version, name: nextName })
    } catch (cause) {
      error.value = ledgerErrorMessage(cause, '分类没有更新，请刷新后重试。')
    }
  }
  editingId.value = null
  editingName.value = ''
}

async function archive(category: { id: string; version: number }): Promise<void> {
  if (archiveId.value !== null) return
  archiveId.value = category.id
  error.value = ''
  try {
    await store.archiveCategory(category.id, category.version)
  } catch (cause) {
    error.value = ledgerErrorMessage(cause, '分类没有归档，请稍后重试。')
  } finally {
    archiveId.value = null
  }
}

async function create(): Promise<void> {
  const trimmed = name.value.trim()
  if (!trimmed) {
    error.value = '请输入分类名称。'
    return
  }
  saving.value = true
  error.value = ''
  try {
    const created = await store.createCategory({ kind: kind.value, name: trimmed })
    categoryIcons.value = { ...categoryIcons.value, [created.id]: newIcon.value }
    persistIcons()
    name.value = ''
    newIcon.value = 'wallet'
  } catch (cause) {
    error.value = ledgerErrorMessage(cause, '分类没有创建，请换一个名称后重试。')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <section class="settings-section" aria-labelledby="settings-ledger-categories-title">
    <header class="settings-section-header">
      <div>
        <h3 id="settings-ledger-categories-title">交易分类</h3>
        <p>管理记账时使用的分类；已有交易不会受到影响。</p>
      </div>
      <NButton type="primary" size="small" @click="creating = !creating">{{ creating ? '取消添加' : '＋ 添加分类' }}</NButton>
    </header>
    <div class="settings-section-body">
      <div class="settings-card settings-ledger-category-card">
        <h4 class="settings-card-title">交易分类</h4>
        <div v-if="creating" class="settings-ledger-category-create">
          <NSelect v-model:value="kind" size="medium" :options="kindOptions" aria-label="分类类型" />
          <NInput v-model:value="name" size="medium" placeholder="输入分类名称" aria-label="分类名称" :disabled="saving" @keydown.enter.prevent="create" />
          <LedgerAccountIconPicker v-model="newIcon" :disabled="saving" />
          <NButton type="primary" size="medium" :loading="saving" @click="create">添加</NButton>
        </div>
        <p v-if="error" class="settings-ledger-category-error" role="alert">{{ error }}</p>
        <div class="settings-ledger-category-list" role="list" aria-live="polite">
          <div v-for="category in categories" :key="category.id" class="settings-ledger-category-tag" :class="{ managing }" role="listitem" @pointerdown="startHold" @pointerup="cancelHold" @pointerleave="cancelHold" @contextmenu.prevent="managing = true">
            <LedgerAccountIconPicker :model-value="iconFor(category.id)" @update:model-value="(icon) => { categoryIcons = { ...categoryIcons, [category.id]: icon }; persistIcons() }" />
            <NInput v-if="editingId === category.id" v-model:value="editingName" size="small" class="settings-ledger-category-name-input" autofocus @keydown.enter.prevent="finishRename(category)" @keydown.esc.prevent="editingId = null" @blur="finishRename(category)" />
            <span v-else @dblclick="startRename(category.id, category.name)">{{ category.name }}</span>
            <button v-if="managing" type="button" class="settings-ledger-category-delete" :disabled="archiveId === category.id" aria-label="归档分类" @click.stop="archive(category)">×</button>
          </div>
          <span v-if="!categories.length" class="settings-ledger-category-empty">暂无交易分类</span>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.settings-section { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.settings-section-body { flex: 1 1 auto; min-height: 0; }
.settings-ledger-category-card { height: 100%; box-sizing: border-box; }
.settings-ledger-category-create { display: grid; grid-template-columns: 140px minmax(0, 1fr) 30px auto; gap: 10px; align-items: center; margin-bottom: 18px; }
.settings-ledger-category-error { margin: 10px 0 0; color: #dc4c4c; font-size: .75rem; }
.settings-ledger-category-list { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; margin-top: 18px; }
.settings-ledger-category-tag { display: inline-flex; min-width: 0; min-height: 40px; align-items: center; gap: 8px; padding: 6px 12px; border: 1px solid var(--border); border-radius: 8px; background: transparent; color: var(--text-muted); font-size: .8rem; }
.settings-ledger-category-tag { position: relative; }
.settings-ledger-category-tag:hover { border-color: var(--accent); color: var(--text-h); }
.settings-ledger-category-tag.managing { animation: settings-ledger-category-wiggle 180ms ease-in-out infinite alternate; }
.settings-ledger-category-tag :deep(.ledger-icon-picker-trigger) { width: 24px; height: 24px; flex: 0 0 24px; }
.settings-ledger-category-tag > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.settings-ledger-category-name-input { min-width: 0; flex: 1 1 auto; }
.settings-ledger-category-delete { position: absolute; top: -7px; right: -7px; display: inline-flex; width: 16px; height: 16px; align-items: center; justify-content: center; padding: 0; border: 2px solid var(--surface); border-radius: 50%; background: #ef4444; color: #fff; font-size: 11px; font-weight: 700; line-height: 1; cursor: pointer; }
.settings-ledger-category-delete:disabled { cursor: wait; opacity: .6; }
.settings-ledger-category-empty { color: var(--text-muted); font-size: .78rem; }
@keyframes settings-ledger-category-wiggle {
  from { transform: rotate(-.7deg) translateY(-.25px); }
  to { transform: rotate(.7deg) translateY(.25px); }
}
@media (max-width: 560px) {
  .settings-ledger-category-create { grid-template-columns: 1fr auto; }
  .settings-ledger-category-create :deep(.n-base-selection) { grid-column: 1 / -1; }
  .settings-ledger-category-list { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (prefers-reduced-motion: reduce) {
  .settings-ledger-category-tag.managing { animation: none; }
}
</style>
