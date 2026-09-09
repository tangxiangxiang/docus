<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { NButton, NUpload, type UploadFileInfo } from 'naive-ui'
import type { DiaryMoodId } from '../../../shared/diaryMood'
import { useDiaryMoodIconPreferences } from '../../composables/diary/useDiaryMoodIconPreferences'
import { useI18n } from '../../composables/useI18n'

const preferences = useDiaryMoodIconPreferences()
const { locale } = useI18n()
const allOptions = computed(() => preferences.availableIcons.value.map((value) => ({
  value,
  label: preferences.labelFor(value, locale.value),
  source: preferences.sourceFor(value),
})))
const managing = ref(false)
const uploadError = ref('')
const editingIcon = ref<DiaryMoodId | null>(null)
const editingName = ref('')
let holdTimer: ReturnType<typeof setTimeout> | null = null
let lastUploadedSvg = ''

onMounted(() => {
  void preferences.load().catch(() => undefined)
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
  if (svgStart < 0 || !validPrefix || /<script(?:\s|>)/i.test(source)) {
    uploadError.value = rawFile.size > 256 * 1024 ? 'SVG 文件不能超过 256 KB。' : '请选择有效的 SVG 文件。'
    return
  }
  if (source === lastUploadedSvg) return
  lastUploadedSvg = source
  const name = rawFile.name.replace(/\.svg$/i, '').trim()
  preferences.addCustomIcon(source, name)
  await preferences.persist()
}

function startRename(icon: DiaryMoodId, currentName: string): void {
  if (!managing.value || !icon.startsWith('custom_mood_')) return
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

function removeIcon(icon: DiaryMoodId): void {
  preferences.removeIcon(icon)
  void preferences.persist()
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
  <section class="settings-section" aria-labelledby="settings-diary-mood-icons-title">
    <header class="settings-section-header">
      <div>
        <h3 id="settings-diary-mood-icons-title">表情图标</h3>
        <p>管理日记使用的表情图标；已有日记不会被自动修改。</p>
      </div>
      <div class="settings-section-actions">
        <NUpload accept=".svg,image/svg+xml" :show-file-list="false" :default-upload="false" @before-upload="onBeforeUpload" @change="onFileChange">
          <NButton type="primary" size="small">＋ 添加图标</NButton>
        </NUpload>
        <span v-if="uploadError" class="settings-diary-mood-upload-error" role="alert">{{ uploadError }}</span>
      </div>
    </header>
    <div class="settings-section-body">
      <div class="settings-card settings-diary-mood-card">
        <h4 class="settings-card-title">表情图标</h4>
        <div class="settings-diary-mood-options" aria-label="表情图标" @click.self="stopManaging">
          <button
            v-for="option in allOptions"
            :key="option.value"
            type="button"
            class="settings-diary-mood-option"
            :class="{ managing }"
            :aria-label="option.label"
            @pointerdown="startHold"
            @pointerup="cancelHold"
            @pointerleave="cancelHold"
            @contextmenu.prevent="managing = true"
            @click="cancelHold"
          >
            <img v-if="option.source" :src="option.source" alt="" aria-hidden="true">
            <input
              v-if="managing && editingIcon === option.value && option.value.startsWith('custom_mood_')"
              v-model="editingName"
              class="settings-diary-mood-name-input"
              aria-label="图标名称"
              autofocus
              @click.stop
              @pointerdown.stop
              @keydown.enter.prevent="finishRename"
              @keydown.esc.prevent="editingIcon = null"
              @blur="finishRename"
            >
            <span v-else @dblclick.stop="startRename(option.value, option.label)">{{ option.label }}</span>
            <span
              v-if="managing && option.value.startsWith('custom_mood_')"
              class="settings-diary-mood-delete"
              aria-hidden="true"
              @click.stop="removeIcon(option.value)"
            >×</span>
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.settings-section { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.settings-section-body { flex: 1 1 auto; min-height: 0; }
.settings-diary-mood-card { display: flex; flex-direction: column; height: 100%; box-sizing: border-box; }
.settings-diary-mood-options { display: grid; flex: 1 1 auto; grid-template-columns: repeat(auto-fill, minmax(88px, 1fr)); align-content: start; gap: 8px; height: 70%; min-height: 0; overflow-y: auto; padding: 8px 10px 8px 2px; box-sizing: border-box; }
.settings-diary-mood-option { position: relative; display: flex; min-width: 0; min-height: 74px; flex-direction: column; align-items: center; justify-content: center; gap: 5px; padding: 8px; border: 1px solid var(--border); border-radius: 8px; background: transparent; color: var(--text-muted); cursor: pointer; font: inherit; transform-origin: 50% 55%; }
.settings-diary-mood-option:hover { background: var(--bg-soft); color: var(--text-h); }
.settings-diary-mood-option.managing { animation: settings-diary-mood-wiggle 180ms ease-in-out infinite alternate; }
.settings-diary-mood-option.managing:nth-child(2n) { animation-delay: -90ms; animation-direction: alternate-reverse; }
.settings-diary-mood-option.managing:nth-child(3n) { animation-delay: -45ms; animation-duration: 200ms; }
.settings-diary-mood-option img { width: 32px; height: 32px; object-fit: contain; }
.settings-diary-mood-name-input { width: 100%; min-width: 0; padding: 0; border: 0; outline: 0; background: transparent; color: inherit; font: inherit; text-align: center; }
.settings-diary-mood-delete { position: absolute; top: 0; right: 0; display: inline-flex; width: 16px; height: 16px; align-items: center; justify-content: center; border: 2px solid var(--surface); border-radius: 50%; background: #ef4444; color: #fff; box-shadow: 0 1px 3px rgb(0 0 0 / 18%); font-size: 11px; font-weight: 700; line-height: 1; cursor: pointer; transform: translate(38%, -38%); }
.settings-diary-mood-upload-error { color: #dc4c4c; font-size: .75rem; }

@keyframes settings-diary-mood-wiggle {
  from { transform: rotate(-.7deg) translateY(-.25px); }
  to { transform: rotate(.7deg) translateY(.25px); }
}

@media (prefers-reduced-motion: reduce) {
  .settings-diary-mood-option.managing { animation: none; }
}
</style>
