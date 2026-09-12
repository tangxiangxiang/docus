<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { NButton, NDropdown, type DropdownOption } from 'naive-ui'
import { LEDGER_BUILTIN_CATEGORY_ICONS, type LedgerAccountIcon } from '../../../shared/ledgerProtocol'
import { isLedgerApiError, ledgerErrorMessage } from '../../features/ledger/ledgerErrors'
import { DEFAULT_CATEGORY_ICON, migrateLegacyCategoryIcons } from '../../features/ledger/categoryIconMigration'
import { useLedgerStore } from '../../features/ledger/ledgerStore'
import { useConfirm } from '../../composables/useConfirm'
import { useToast } from '../../composables/useToast'
import { useLedgerAccountIconPreferences } from '../../composables/useLedgerAccountIconPreferences'
import LedgerAccountIconPicker from '../ledger/LedgerAccountIconPicker.vue'

const store = useLedgerStore()
const { confirm } = useConfirm()
const toast = useToast()
const accountIconPreferences = useLedgerAccountIconPreferences()
const createError = ref('')
const operationError = ref('')
const saving = ref(false)
const uploadInput = ref<HTMLInputElement | null>(null)
const uploadKind = ref<'income' | 'expense'>('expense')
const iconSavingId = ref<string | null>(null)
const managing = ref(false)
const editingId = ref<string | null>(null)
const editingName = ref('')
const categoryActionId = ref<string | null>(null)
let holdTimer: ReturnType<typeof setTimeout> | null = null
let lastUploadedSvg = ''
const categoryCustomIcons = ref<Record<string, string>>({})
const CATEGORY_CUSTOM_ICON_STORAGE_KEY = 'docus.ledger.category-custom-icons'
const categories = computed(() => store.activeCategories.value)

try {
  const stored = JSON.parse(localStorage.getItem(CATEGORY_CUSTOM_ICON_STORAGE_KEY) ?? '{}') as unknown
  if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
    categoryCustomIcons.value = Object.fromEntries(Object.entries(stored).filter(([, source]) => typeof source === 'string'))
  }
} catch {
  categoryCustomIcons.value = {}
}
const categoryGroups = computed(() => [
  { kind: 'income' as const, title: '收入分类', empty: '暂无收入分类' },
  { kind: 'expense' as const, title: '支出分类', empty: '暂无支出分类' },
].map((group) => ({
  ...group,
  categories: categories.value.filter((category) => category.kind === group.kind),
})))
const uploadOptions: DropdownOption[] = [
  { label: '收入图标', key: 'income' },
  { label: '支出图标', key: 'expense' },
]

function categoryIconSource(icon: LedgerAccountIcon | undefined): string | undefined {
  const source = icon ? categoryCustomIcons.value[icon] : undefined
  return source ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}` : undefined
}

async function bootstrapAndMigrate(): Promise<void> {
  await store.bootstrap()
  await migrateBuiltinCategoryIcons()
  await migrateLegacyCategoryIcons(store.categories.value, async (id, patch) => store.patchCategory(id, patch))
  await migrateLegacyAccountIcons()
}

async function migrateBuiltinCategoryIcons(): Promise<void> {
  for (const category of store.categories.value) {
    if (category.icon) continue
    const builtin = LEDGER_BUILTIN_CATEGORY_ICONS.find((entry) => entry.kind === category.kind && entry.name === category.name)
    if (builtin) await store.patchCategory(category.id, { expectedVersion: category.version, icon: builtin.id })
  }
}

async function migrateLegacyAccountIcons(): Promise<void> {
  try {
    await accountIconPreferences.load()
  } catch {
    return
  }
  const accountIconUsers = new Set((store.accounts?.value ?? []).map((account) => account.icon).filter(Boolean))
  const categoryIconUsers = new Map<string, number>()
  for (const category of store.categories.value) {
    if (category.icon?.startsWith('custom_')) categoryIconUsers.set(category.icon, (categoryIconUsers.get(category.icon) ?? 0) + 1)
  }

  let accountIconsChanged = false
  for (const category of store.categories.value) {
    const oldIcon = category.icon
    if (!oldIcon?.startsWith('custom_') || oldIcon.startsWith('custom_category_')) continue
    const source = accountIconPreferences.getCustomIcon(oldIcon)
    if (!source) continue
    const newIcon = `custom_category_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}` as LedgerAccountIcon
    categoryCustomIcons.value = { ...categoryCustomIcons.value, [newIcon]: source }
    await store.patchCategory(category.id, { expectedVersion: category.version, icon: newIcon })
    if (!accountIconUsers.has(oldIcon) && categoryIconUsers.get(oldIcon) === 1) {
      accountIconPreferences.removeIcon(oldIcon)
      accountIconsChanged = true
    }
  }
  localStorage.setItem(CATEGORY_CUSTOM_ICON_STORAGE_KEY, JSON.stringify(categoryCustomIcons.value))
  if (accountIconsChanged) await accountIconPreferences.persist()
}

onMounted(() => {
  void bootstrapAndMigrate()
})

onBeforeUnmount(() => {
  cancelHold()
})

async function updateIcon(category: { id: string; icon?: LedgerAccountIcon; version: number }, icon: LedgerAccountIcon): Promise<void> {
  if (iconSavingId.value !== null || icon === (category.icon ?? DEFAULT_CATEGORY_ICON)) return
  iconSavingId.value = category.id
  operationError.value = ''
  try {
    await store.patchCategory(category.id, { expectedVersion: category.version, icon })
  } catch (cause) {
    operationError.value = ledgerErrorMessage(cause, '分类图标没有更新，请刷新后重试。')
  } finally {
    iconSavingId.value = null
  }
}

function startHold(): void {
  cancelHold()
  holdTimer = setTimeout(() => {
    managing.value = true
    holdTimer = null
  }, 550)
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

function cancelRename(): void {
  editingId.value = null
  editingName.value = ''
}

async function finishRename(category: { id: string; name: string; kind: 'income' | 'expense'; version: number }): Promise<void> {
  if (editingId.value !== category.id) return
  const nextName = editingName.value.trim()
  if (nextName && nextName !== category.name) {
    operationError.value = ''
    try {
      await store.patchCategory(category.id, { expectedVersion: category.version, name: nextName })
    } catch (cause) {
      operationError.value = ledgerErrorMessage(cause, '分类没有更新，请刷新后重试。')
    }
  }
  cancelRename()
}

function stopManaging(): void {
  cancelHold()
  cancelRename()
  managing.value = false
}

async function removeCategory(category: { id: string; name: string; version: number }): Promise<void> {
  if (categoryActionId.value !== null) return
  categoryActionId.value = category.id
  operationError.value = ''
  try {
    const confirmed = await confirm(
      `删除分类「${category.name}」？`,
      '没有交易历史的分类会被永久删除；如果已有历史记录，只能转为归档。',
      { confirmLabel: '删除分类', cancelLabel: '取消', destructive: true },
    )
    if (!confirmed) return

    try {
      await store.deleteCategory(category.id, category.version)
      toast.success('分类已删除')
      return
    } catch (cause) {
      if (!isLedgerApiError(cause) || cause.code !== 'ledger-category-has-history') {
        operationError.value = ledgerErrorMessage(cause, '分类没有删除，请稍后重试。')
        return
      }

      const archiveConfirmed = await confirm(
        `分类「${category.name}」已有交易记录，无法永久删除。`,
        '可以将它归档。归档后不会用于新交易，但历史记录仍会保留。',
        { confirmLabel: '归档分类', cancelLabel: '取消' },
      )
      if (!archiveConfirmed) return

      try {
        await store.archiveCategory(category.id, category.version)
        toast.success('分类已归档')
      } catch (archiveCause) {
        operationError.value = ledgerErrorMessage(archiveCause, '分类没有归档，请稍后重试。')
      }
    }
  } catch (cause) {
    operationError.value = ledgerErrorMessage(cause, '分类操作没有完成，请稍后重试。')
  } finally {
    categoryActionId.value = null
  }
}

async function addSvgFile(nextKind: 'income' | 'expense', rawFile: File): Promise<void> {
  createError.value = ''
  const source = rawFile.name.toLowerCase().endsWith('.svg') && rawFile.size <= 256 * 1024
    ? await rawFile.text()
    : ''
  const svgStart = source.search(/<svg(?:\s|>)/i)
  const prefix = svgStart >= 0 ? source.slice(0, svgStart) : source
  const validPrefix = /^(?:\uFEFF|\s|<\?xml[\s\S]*?\?>|<!DOCTYPE[\s\S]*?>|<!--[\s\S]*?-->)*$/i.test(prefix)
  if (svgStart < 0 || !validPrefix || /<script(?:\s|>)/i.test(source)) {
    createError.value = rawFile.size > 256 * 1024 ? 'SVG 文件不能超过 256 KB。' : '请选择有效的 SVG 文件。'
    return
  }
  if (source === lastUploadedSvg) return
  lastUploadedSvg = source
  const categoryName = rawFile.name.replace(/\.svg$/i, '').trim() || '未命名分类'
  saving.value = true
  try {
    const uploadedIcon = `custom_category_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}` as LedgerAccountIcon
    categoryCustomIcons.value = { ...categoryCustomIcons.value, [uploadedIcon]: source }
    localStorage.setItem(CATEGORY_CUSTOM_ICON_STORAGE_KEY, JSON.stringify(categoryCustomIcons.value))
    await store.createCategory({ kind: nextKind, name: categoryName, icon: uploadedIcon })
    await nextTick()
    document.querySelector<HTMLElement>(`[data-category-kind="${nextKind}"]`)?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' })
  } catch (cause) {
    createError.value = ledgerErrorMessage(cause, '分类没有创建，请稍后重试。')
  } finally {
    saving.value = false
  }
}

function selectUploadKind(nextKind: 'income' | 'expense'): void {
  if (saving.value || !uploadInput.value) return
  uploadKind.value = nextKind
  uploadInput.value.value = ''
  uploadInput.value.click()
}

async function onFileSelected(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) await addSvgFile(uploadKind.value, file)
}

</script>

<template>
  <section class="settings-section" aria-labelledby="settings-ledger-categories-title">
    <header class="settings-section-header">
      <div>
        <h3 id="settings-ledger-categories-title">交易分类</h3>
        <p>管理记账时使用的分类；已有交易不会受到影响。</p>
      </div>
      <div class="settings-section-actions">
        <NDropdown trigger="click" :options="uploadOptions" :z-index="10000" :disabled="saving" @select="selectUploadKind($event as 'income' | 'expense')">
          <NButton type="primary" size="small" :loading="saving">＋ 添加图标</NButton>
        </NDropdown>
        <input ref="uploadInput" class="settings-ledger-category-file-input" type="file" accept=".svg,image/svg+xml" @change="onFileSelected">
        <p v-if="createError" class="settings-ledger-category-error" role="alert">{{ createError }}</p>
      </div>
    </header>
    <div class="settings-section-body">
      <p v-if="operationError" class="settings-ledger-category-error" role="alert">{{ operationError }}</p>
      <div class="settings-ledger-category-groups">
        <div
          v-for="group in categoryGroups"
          :key="group.kind"
          class="settings-card settings-ledger-category-card"
          :data-category-kind="group.kind"
        >
          <h4 class="settings-card-title">{{ group.title }}</h4>
          <div class="settings-ledger-category-options" role="list" aria-live="polite" @click.self="stopManaging">
            <div
              v-for="category in group.categories"
              :key="category.id"
              class="settings-ledger-category-option"
              :class="{ managing, 'is-system': category.protected }"
              role="listitem"
              @pointerdown="startHold"
              @pointerup="cancelHold"
              @pointerleave="cancelHold"
              @pointercancel="cancelHold"
              @contextmenu.prevent="managing = true"
            >
              <span class="settings-ledger-category-glyph" aria-label="修改分类图标" @pointerdown.stop @pointerup.stop @click.stop @contextmenu.stop>
              <img v-if="category.icon?.startsWith('custom_category_') && categoryIconSource(category.icon)" :src="categoryIconSource(category.icon)" alt="">
              <LedgerAccountIconPicker v-else :model-value="category.icon ?? DEFAULT_CATEGORY_ICON" :disabled="iconSavingId === category.id" @update:model-value="updateIcon(category, $event)" />
              </span>
              <input
                v-if="managing && editingId === category.id"
                v-model="editingName"
                class="settings-ledger-category-name-input"
                aria-label="分类名称"
                autofocus
                @click.stop
                @pointerdown.stop
                @keydown.enter.prevent="finishRename(category)"
                @keydown.esc.prevent="cancelRename"
                @blur="finishRename(category)"
              >
              <span v-else class="settings-ledger-category-label" :title="category.protected ? '系统分类不可重命名或归档' : undefined" @dblclick.stop="!category.protected && startRename(category.id, category.name)">{{ category.name }}</span>
              <button
                v-if="managing && !category.protected"
                type="button"
                class="settings-ledger-category-delete"
                :disabled="categoryActionId === category.id"
                :aria-label="`删除分类：${category.name}`"
                @pointerdown.stop
                @click.stop="removeCategory(category)"
              >×</button>
            </div>
            <span v-if="!group.categories.length" class="settings-ledger-category-empty">{{ group.empty }}</span>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.settings-section { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.settings-section-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; }
.settings-ledger-category-groups { display: grid; gap: 12px; padding-bottom: 4px; }
.settings-ledger-category-card { display: flex; flex-direction: column; min-height: 0; box-sizing: border-box; }
.settings-ledger-category-file-input { display: none; }
.settings-ledger-category-options { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); align-content: start; gap: 10px; min-height: 88px; box-sizing: border-box; padding: 8px 10px 12px 2px; }
.settings-ledger-category-option { position: relative; display: inline-flex; width: 100%; min-width: 0; min-height: 40px; box-sizing: border-box; align-items: center; justify-content: flex-start; gap: 7px; padding: 6px 12px; overflow: visible; border: 1px solid var(--border); border-radius: 8px; background: transparent; color: var(--text-muted); cursor: pointer; font: inherit; text-align: left; transform-origin: 50% 55%; }
.settings-ledger-category-glyph { display: grid; width: 22px; height: 22px; flex: 0 0 22px; place-items: center; }
.settings-ledger-category-glyph > img { width: 20px; height: 20px; object-fit: contain; }
.settings-ledger-category-glyph :deep(.ledger-icon-picker-trigger) { width: 22px; height: 22px; border-radius: 0; }
.settings-ledger-category-glyph :deep(.ledger-icon-picker-trigger:hover) { background: transparent; }
.settings-ledger-category-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.settings-ledger-category-option.managing { animation: settings-ledger-category-wiggle 180ms ease-in-out infinite alternate; }
.settings-ledger-category-option.managing:nth-child(2n) { animation-delay: -90ms; animation-direction: alternate-reverse; }
.settings-ledger-category-option.managing:nth-child(3n) { animation-delay: -45ms; animation-duration: 200ms; }
.settings-ledger-category-option.is-system { border-color: color-mix(in srgb, var(--accent) 24%, var(--border)); }
.settings-ledger-category-name-input { width: 8em; min-width: 0; padding: 0; border: 0; outline: 0; background: transparent; color: inherit; font: inherit; }
.settings-ledger-category-delete { position: absolute; top: 0; right: 0; display: inline-flex; align-items: center; justify-content: center; width: 15px; height: 15px; padding: 0; border: 2px solid var(--surface); border-radius: 50%; background: #ef4444; color: #fff; box-shadow: 0 1px 3px rgb(0 0 0 / 18%); font-size: 11px; font-weight: 700; line-height: 1; cursor: pointer; transform: translate(38%, -38%); }
.settings-ledger-category-delete:disabled { cursor: wait; opacity: .5; }
.settings-ledger-category-empty { color: var(--text-muted); font-size: .75rem; }
.settings-ledger-category-error { margin: 0 0 8px; color: #dc4c4c; font-size: .75rem; }


@media (max-width: 900px) {
  .settings-ledger-category-options { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}

@media (max-width: 560px) {
  .settings-ledger-category-options { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

@keyframes settings-ledger-category-wiggle {
  from { transform: rotate(-.7deg) translateY(-.25px); }
  to { transform: rotate(.7deg) translateY(.25px); }
}

@media (prefers-reduced-motion: reduce) {
  .settings-ledger-category-option.managing { animation: none; }
}
</style>
