<script setup lang="ts">
import { ref, watchEffect } from 'vue'
import { render } from '../lib/markdown'

const props = defineProps<{ markdown: string }>()
const html = ref<string>('')

watchEffect(async () => {
  html.value = await render(props.markdown)
})
</script>

<template>
  <div class="article" v-html="html" />
</template>
