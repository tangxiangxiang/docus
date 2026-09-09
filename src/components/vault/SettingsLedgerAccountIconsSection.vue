<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { NButton, NUpload, type UploadFileInfo } from 'naive-ui'
import type { LedgerAccountIcon as AccountIcon } from '../../../shared/ledgerProtocol'
import { useLedgerAccountIconPreferences } from '../../composables/useLedgerAccountIconPreferences'
import { useLedgerStore } from '../../features/ledger/ledgerStore'
import LedgerAccountIcon from '../ledger/LedgerAccountIcon.vue'

const preferences = useLedgerAccountIconPreferences()
const ledgerStore = useLedgerStore()
const options: ReadonlyArray<{ value: AccountIcon; label: string }> = [
  { value: 'wallet', label: '钱包' },
  { value: 'credit_card', label: '信用卡' },
  { value: 'cash', label: '现金' },
  { value: 'building_bank', label: '银行' },
  { value: 'briefcase', label: '其他' },
]
const enabled = (value: AccountIcon) => preferences.availableIcons.value.includes(value)
const hasMultipleIcons = computed(() => preferences.availableIcons.value.length > 1)
const usedIcons = computed(() => new Set(ledgerStore.accounts.value.map((account) => account.icon ?? 'wallet')))
const canDelete = (icon: AccountIcon) => hasMultipleIcons.value && !icon.startsWith('custom_builtin_') && !usedIcons.value.has(icon)
const builtinLabels = Object.fromEntries(options.map(({ value, label }) => [value, label]))
const allOptions = computed(() => preferences.availableIcons.value.map((value, index) => ({
  value,
  label: preferences.customIconNames.value[value] || builtinLabels[value] || `自定义图标 ${index + 1}`,
})))
const managing = ref(false)
const uploadError = ref('')
const editingIcon = ref<AccountIcon | null>(null)
const editingName = ref('')
let holdTimer: ReturnType<typeof setTimeout> | null = null
let lastUploadedSvg = ''

onMounted(() => {
  void ledgerStore.bootstrap()
})

function startHold(): void {
  holdTimer = setTimeout(() => { managing.value = true }, 550)
}

function cancelHold(): void {
  if (holdTimer !== null) clearTimeout(holdTimer)
  holdTimer = null
}

async function addSvgFile(file: UploadFileInfo): Promise<void> {
  uploadError.value = ''
  const rawFile = file.file
  if (!rawFile) {
    uploadError.value = '无法读取所选文件。'
    return
  }
  const source = rawFile.name.toLowerCase().endsWith('.svg') && rawFile.size <= 256 * 1024
    ? await rawFile.text()
    : ''
  const svgStart = source.search(/<svg(?:\s|>)/i)
  const prefix = svgStart >= 0 ? source.slice(0, svgStart) : source
  const validPrefix = /^(?:\uFEFF|\s|<\?xml[\s\S]*?\?>|<!DOCTYPE[\s\S]*?>|<!--[\s\S]*?-->)*$/i.test(prefix)
  if (svgStart < 0 || !validPrefix) {
    uploadError.value = rawFile.size > 256 * 1024 ? 'SVG 文件不能超过 256 KB。' : '请选择有效的 SVG 文件。'
    return
  }
  if (source === lastUploadedSvg) return
  lastUploadedSvg = source
  const name = rawFile.name.replace(/\.svg$/i, '').trim()
  preferences.addCustomIcon(source, name)
  await preferences.persist()
}

function startRename(icon: AccountIcon, currentName: string): void {
  if (!managing.value || !icon.startsWith('custom_') || icon.startsWith('custom_builtin_')) return
  editingIcon.value = icon
  editingName.value = currentName
}

function finishRename(): void {
  if (editingIcon.value !== null) {
    preferences.renameCustomIcon(editingIcon.value, editingName.value)
    void preferences.persist()
  }
  editingIcon.value = null
  editingName.value = ''
}

function stopManaging(): void {
  cancelHold()
  editingIcon.value = null
  editingName.value = ''
  managing.value = false
}

async function onBeforeUpload({ file }: { file: UploadFileInfo }): Promise<boolean> {
  await addSvgFile(file)
  return false
}

async function onFileChange({ file }: { file: UploadFileInfo }): Promise<void> {
  await addSvgFile(file)
}
</script>

<template>
  <section class="settings-section" aria-labelledby="settings-ledger-account-icons-title">
    <header class="settings-section-header">
      <div>
        <h3 id="settings-ledger-account-icons-title">账户图标</h3>
        <p>管理新账户使用的默认图标；已有账户不会被自动修改。</p>
      </div>
      <div class="settings-section-actions">
        <NUpload accept=".svg,image/svg+xml" :show-file-list="false" :default-upload="false" @before-upload="onBeforeUpload" @change="onFileChange">
          <NButton type="primary" size="small">＋ 添加图标</NButton>
        </NUpload>
        <span v-if="uploadError" class="settings-ledger-icon-upload-error" role="alert">{{ uploadError }}</span>
      </div>
    </header>
    <div class="settings-section-body">
      <div class="settings-card settings-ledger-icon-card">
        <h4 class="settings-card-title">账户图标</h4>
        <div class="settings-ledger-icon-options" role="radiogroup" aria-label="默认账户图标" @click.self="stopManaging">
          <button v-for="option in allOptions" v-show="enabled(option.value)" :key="option.value" type="button" class="settings-ledger-icon-option" :class="{ managing }" :aria-label="option.label" role="listitem" @pointerdown="startHold" @pointerup="cancelHold" @pointerleave="cancelHold" @contextmenu.prevent="managing = true" @click="preferences.defaultIcon.value = option.value; void preferences.persist()">
            <LedgerAccountIcon :icon="option.value" :size="20" />
            <input
              v-if="managing && editingIcon === option.value && option.value.startsWith('custom_') && !option.value.startsWith('custom_builtin_')"
              v-model="editingName"
              class="settings-ledger-icon-name-input"
              aria-label="图标名称"
              autofocus
              @click.stop
              @pointerdown.stop
              @keydown.enter.prevent="finishRename"
              @keydown.esc.prevent="editingIcon = null"
              @blur="finishRename"
            >
            <span v-else @dblclick.stop="startRename(option.value, option.label)">{{ option.label }}</span>
            <span v-if="managing && canDelete(option.value)" class="settings-ledger-icon-delete" aria-hidden="true" @click.stop="preferences.removeIcon(option.value); void preferences.persist()">×</span>
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.settings-section { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.settings-section-body { flex: 1 1 auto; min-height: 0; }
.settings-ledger-icon-card { display: flex; flex-direction: column; height: 100%; box-sizing: border-box; }
.settings-ledger-icon-options { display: flex; flex: 1 1 auto; flex-wrap: wrap; align-content: flex-start; gap: 8px 10px; height: 70%; min-height: 0; box-sizing: border-box; overflow-y: auto; padding: 8px 10px 8px 2px; }
.settings-ledger-icon-file { display: none; }
.settings-ledger-icon-option { position: relative; display: inline-flex; align-items: center; gap: 7px; min-height: 36px; padding: 6px 24px 6px 11px; border: 1px solid var(--border); border-radius: 8px; background: transparent; color: var(--text-muted); cursor: pointer; transform-origin: 50% 55%; }
.settings-ledger-icon-option.managing { animation: settings-ledger-icon-wiggle 180ms ease-in-out infinite alternate; }
.settings-ledger-icon-option.managing:nth-child(2n) { animation-delay: -90ms; animation-direction: alternate-reverse; }
.settings-ledger-icon-option.managing:nth-child(3n) { animation-delay: -45ms; animation-duration: 200ms; }
.settings-ledger-icon-name-input { width: 8em; min-width: 0; padding: 0; border: 0; outline: 0; background: transparent; color: inherit; font: inherit; }
.settings-ledger-icon-delete { position: absolute; top: 0; right: 0; display: inline-flex; align-items: center; justify-content: center; width: 15px; height: 15px; border: 2px solid var(--surface); border-radius: 50%; background: #ef4444; color: #fff; box-shadow: 0 1px 3px rgb(0 0 0 / 18%); font-size: 11px; font-weight: 700; line-height: 1; cursor: pointer; transform: translate(38%, -38%); }
.settings-ledger-icon-upload-error { color: #dc4c4c; font-size: .75rem; }

@keyframes settings-ledger-icon-wiggle {
  from { transform: rotate(-.7deg) translateY(-.25px); }
  to { transform: rotate(.7deg) translateY(.25px); }
}

@media (prefers-reduced-motion: reduce) {
  .settings-ledger-icon-option.managing { animation: none; }
}
</style>
