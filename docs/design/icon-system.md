# Icon System

This page documents the current and target icon contracts. The target Functional
Icon Foundation is defined by
[Docus Naive UI Icon Foundation Amendment](docus-naive-ui-icon-foundation-amendment.md).

## Functional Icon Foundation

New functional icons use one approved family:

```text
NIcon
  ↓
@vicons/tabler@0.13.0
```

Use the icon component by meaning, not by copying its SVG path:

```vue
<script setup lang="ts">
import { NButton, NIcon } from 'naive-ui'
import { Search } from '@vicons/tabler'
</script>

<template>
  <NButton aria-label="Search notes">
    <template #icon>
      <NIcon aria-hidden="true" :size="18">
        <Search />
      </NIcon>
    </template>
  </NButton>
</template>
```

Rules for new code:

- import functional glyphs only from `@vicons/tabler`;
- render them through `NIcon` when they are used as Naive UI control icons;
- let the consumer provide size, state color, and accessible name;
- mark decorative icons `aria-hidden="true"`;
- do not add hand-written functional `<svg>` or paste SVG paths into a component;
- do not add a second `@vicons/*` family or mix Material, Lucide, Heroicons, or
  Ionicons for functional controls.

Tabler's SVG canvas and stroke details belong to the approved upstream family. Docus
does not re-enforce the legacy 16×16 geometry contract on these components.

## Ownership exceptions

The functional-family rule does not apply to:

- Docus logo, brand constellation, and product illustrations;
- Mermaid / Markmap output and other renderer-owned SVG;
- user-authored or generated content SVG;
- legacy `src/components/vault/icons.ts` exports that still have active consumers
  during incremental migration.

Each exception must have an identifiable owner and must not silently become a new
functional icon vocabulary.

## Legacy Docus icon system (migration only)

`src/components/vault/icons.ts` is currently a legacy source used by existing
surfaces. Its contract remains protected by
`src/components/vault/__tests__/icons.test.ts` and the legacy portions of
`scripts/icon-lint.ts` until the consumers migrate.

Unless an icon is an explicit legacy exception, legacy exports use:

| Attribute | Required value |
| --- | --- |
| `viewBox` | `0 0 16 16` |
| `width`, `height` | `14`, `14` |
| `fill` | `none` |
| `stroke` | `currentColor` |
| `stroke-width` | `1.5` |
| `stroke-linecap`, `stroke-linejoin` | `round`, `round` |
| `aria-hidden` | `true` |
| `focusable` | `false` |

Filled presence/state glyphs and toolbar surface glyphs keep their existing tested
allowlists. Do not add new legacy exports for a new surface unless the matching
surface is not yet migrated and the exception is documented in review.

## Lint and preview transition

Before Phase 8, `npm run lint:icons`, the legacy contract test, and
`src/views/IconPreviewView.vue` continue to protect existing `icons.ts` consumers.
They are migration safety nets, not permission to expand the legacy system.

The long-term lint job is governance-oriented:

```text
new functional SVG in business code  → violation
unapproved icon-family import         → violation
approved @vicons/tabler import       → allowed
brand/generated/user SVG             → documented exception
legacy icons.ts                      → migration-only exception
```

Phase 8 may remove the legacy geometry checks, old preview, and legacy contract test
after `icons.ts` has no consumers. The approved-family rule remains.

## Source references

- [Icon Foundation amendment](docus-naive-ui-icon-foundation-amendment.md)
- [Icon exports](../../src/components/vault/icons.ts)
- [Legacy contract tests](../../src/components/vault/__tests__/icons.test.ts)
- [Repository lint](../../scripts/icon-lint.ts)
- [Development preview](../../src/views/IconPreviewView.vue)
