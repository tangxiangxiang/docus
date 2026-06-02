<script setup lang="ts">
import { useConfirm } from '../composables/useConfirm'
const { queue, answer } = useConfirm()
</script>

<template>
  <Teleport to="body">
    <div v-if="queue.length" class="confirm-host" @keydown.esc="answer(queue[0].id, false)">
      <div
        v-for="r in queue"
        :key="r.id"
        class="confirm-backdrop"
        @click.self="answer(r.id, false)"
      >
        <div class="confirm-dialog" role="alertdialog" aria-modal="true">
          <div class="confirm-message">{{ r.message }}</div>
          <div v-if="r.detail" class="confirm-detail">{{ r.detail }}</div>
          <div class="confirm-actions">
            <button type="button" class="btn" @click="answer(r.id, false)">取消</button>
            <button type="button" class="btn btn-primary" @click="answer(r.id, true)">确定</button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
