<script setup lang="ts">
import { computed } from 'vue'
import type { DiaryPresentationMode } from '../../composables/diary/useDiaryWorkspacePresentation'

const props = defineProps<{
  eligible: boolean
  mode: DiaryPresentationMode
  visible: boolean
}>()

const isPresentationVisible = computed(() => props.visible)
const isHomeVisible = computed(() => (
  isPresentationVisible.value && props.eligible && props.mode === 'home'
))
</script>

<template>
  <section
    v-show="isPresentationVisible"
    class="diary-workspace-shell"
    data-testid="diary-workspace-shell"
    :data-presentation-mode="props.mode"
    :data-presentation-eligible="props.eligible ? 'true' : 'false'"
    :aria-hidden="props.eligible ? undefined : 'true'"
  >
    <!-- Home remains mounted while a future Reader/Editor slot is shown. This
         is the D3.0 VCalendar keep-mounted boundary. -->
    <div
      v-show="isHomeVisible"
      class="diary-workspace-home"
      data-testid="diary-workspace-home"
    >
      <slot name="home" />
    </div>

    <div
      v-if="props.mode === 'reader'"
      class="diary-workspace-reader"
      data-testid="diary-workspace-reader"
    >
      <slot name="reader" />
    </div>

    <div
      v-if="props.mode === 'editor'"
      class="diary-workspace-editor"
      data-testid="diary-workspace-editor"
    >
      <slot name="editor" />
    </div>
  </section>
</template>

<style scoped>
.diary-workspace-shell,
.diary-workspace-home,
.diary-workspace-reader,
.diary-workspace-editor {
  min-width: 0;
  min-height: 0;
}

.diary-workspace-shell {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  overflow: hidden;
}

.diary-workspace-home,
.diary-workspace-reader,
.diary-workspace-editor {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  overflow: hidden;
}
</style>
