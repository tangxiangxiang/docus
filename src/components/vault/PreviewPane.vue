<script setup lang="ts">
import { toRef } from 'vue'
import { useMarkdownRender } from '../../composables/vault/useMarkdownRender'

const props = defineProps<{ raw: string }>()
const { html, error: renderError } = useMarkdownRender(toRef(props, 'raw'))
</script>

<template>
  <div v-if="renderError" class="render-error">{{ renderError }}</div>
  <div v-else class="article preview" v-html="html" />
</template>
