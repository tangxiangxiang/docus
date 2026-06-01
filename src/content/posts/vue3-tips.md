---
title: Vue 3 Composition API tips
date: "2026-04-20"
tags: [vue, frontend]
summary: A few patterns I keep reaching for.
---

## `ref` vs `reactive`

Use `ref` for primitives and `reactive` for objects. They compose well:

```ts
import { ref, reactive } from 'vue'
const count = ref(0)
const state = reactive({ name: 'txx' })
```

## `watchEffect` vs `watch`

`watchEffect` runs immediately and tracks dependencies automatically. Use it for side effects. `watch` is better when you need explicit source and options.
