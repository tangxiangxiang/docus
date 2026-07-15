<script setup lang="ts">
import { computed, ref } from 'vue'
import type { DiffOp, FileDiff } from '../../lib/history-api'

const props = defineProps<{
  diff: FileDiff
  oldLabel: string
  newLabel: string
  oldRef?: string
  newRef?: string
}>()

const rows = computed<Array<{ left: DiffOp | null; right: DiffOp | null }>>(() => {
  const output: Array<{ left: DiffOp | null; right: DiffOp | null }> = []
  let index = 0
  while (index < props.diff.ops.length) {
    const op = props.diff.ops[index]
    if (!op) break
    if (op.op === 'equal') {
      output.push({ left: op, right: op })
      index++
      continue
    }
    if (op.op === 'remove') {
      const removes: DiffOp[] = []
      const adds: DiffOp[] = []
      while (props.diff.ops[index]?.op === 'remove') removes.push(props.diff.ops[index++]!)
      while (props.diff.ops[index]?.op === 'add') adds.push(props.diff.ops[index++]!)
      const count = Math.max(removes.length, adds.length)
      for (let row = 0; row < count; row++) {
        output.push({ left: removes[row] ?? null, right: adds[row] ?? null })
      }
      continue
    }
    output.push({ left: null, right: op })
    index++
  }
  return output
})

const oldPane = ref<HTMLElement | null>(null)
const newPane = ref<HTMLElement | null>(null)
let syncingScroll = false

function syncVerticalScroll(source: 'old' | 'new'): void {
  if (syncingScroll) return
  const from = source === 'old' ? oldPane.value : newPane.value
  const to = source === 'old' ? newPane.value : oldPane.value
  if (!from || !to) return
  syncingScroll = true
  to.scrollTop = from.scrollTop
  requestAnimationFrame(() => { syncingScroll = false })
}
</script>

<template>
  <div class="diff-table" role="group" :aria-label="`${oldLabel} → ${newLabel}`">
    <div
      ref="oldPane"
      class="diff-pane diff-pane-old"
      role="table"
      :aria-label="oldLabel"
      @scroll="syncVerticalScroll('old')"
    >
      <div class="diff-pane-title">
        <span class="diff-pane-label">{{ oldLabel }}</span>
        <span v-if="oldRef" class="diff-pane-ref">{{ oldRef }}</span>
      </div>
      <div
        v-for="(row, index) in rows"
        :key="`old-${index}`"
        class="diff-row"
        :class="{
          'is-del': row.left && !row.right,
          'is-edit': row.left && row.right && row.left.text !== row.right.text,
        }"
        role="row"
      >
        <div class="diff-cell diff-cell-num" role="cell">{{ row.left?.oldLine ?? '' }}</div>
        <div class="diff-cell diff-cell-text" role="cell">
          <template v-if="row.left?.words">
            <span
              v-for="(word, wordIndex) in row.left.words"
              :key="wordIndex"
              :class="['diff-word', `diff-word-${word.op}`]"
            >{{ word.text }}</span>
          </template>
          <template v-else>{{ row.left?.text ?? '' }}</template>
        </div>
      </div>
    </div>

    <div
      ref="newPane"
      class="diff-pane diff-pane-new"
      role="table"
      :aria-label="newLabel"
      @scroll="syncVerticalScroll('new')"
    >
      <div class="diff-pane-title">
        <span class="diff-pane-label">{{ newLabel }}</span>
        <span v-if="newRef" class="diff-pane-ref">{{ newRef }}</span>
      </div>
      <div
        v-for="(row, index) in rows"
        :key="`new-${index}`"
        class="diff-row"
        :class="{
          'is-add': row.right && !row.left,
          'is-edit': row.left && row.right && row.left.text !== row.right.text,
        }"
        role="row"
      >
        <div class="diff-cell diff-cell-num" role="cell">{{ row.right?.newLine ?? '' }}</div>
        <div class="diff-cell diff-cell-text" role="cell">
          <template v-if="row.right?.words">
            <span
              v-for="(word, wordIndex) in row.right.words"
              :key="wordIndex"
              :class="['diff-word', `diff-word-${word.op}`]"
            >{{ word.text }}</span>
          </template>
          <template v-else>{{ row.right?.text ?? '' }}</template>
        </div>
      </div>
    </div>
  </div>
</template>
