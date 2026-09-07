# Icon System

This page documents the current legacy contract and the approved target contract for
functional icons. The product and implementation plans are the record of the Icon
Foundation Design Amendment.

## Approved target architecture

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
- render them through `NIcon` (`<NIcon><TablerIcon /></NIcon>`); Naive UI controls use
  their documented icon slot or integration;
- let the consumer provide size, state color, and accessible name;
- mark decorative icons `aria-hidden="true"`;
- do not add hand-written functional `<svg>` or paste SVG paths into a component;
- do not add a second `@vicons/*` family or mix Material, Lucide, Heroicons, or
  Ionicons for functional controls.

Tabler's SVG canvas and stroke details belong to the approved upstream family. Docus
does not re-enforce the legacy 16×16 geometry contract on these components.

### Target contract

| Concern | Authority |
| --- | --- |
| Product semantic choice | Docus |
| Functional icon presentation | Naive UI `NIcon` |
| Functional glyph family | `@vicons/tabler@0.13.0` only |
| Glyph geometry and drawing | Tabler |
| Theme color | `currentColor` / consuming component theme |
| Size and density | `NIcon` and consuming control / surface |
| Accessible name | Consuming control |

`NButton` 等 Naive UI controls 使用正式的 icon slot；不要为了包一层 `NIcon` 建立
机械 `DIcon.vue` wrapper。Icon-only control 必须由 control 提供 `aria-label` 或等价
accessible name；带可见文字的 control 通常由该文字命名，decorative icon 则标记
`aria-hidden="true"`。具体 Tabler export 名称必须在迁移时以安装版本的真实
TypeScript exports 为准。

Functional family 规则禁止混入 Ionicons、Material、Fluent、Font Awesome、Ant
Design、Carbon、Lucide、Heroicons、`@tabler/icons-vue` 或其他 `@vicons/*` family。

## Ownership exceptions

The functional-family rule does not apply to:

- Docus logo, brand constellation, brand decoration, product illustrations, and
  marketing artwork;
- Mermaid / Markmap output, ECharts output, chart SVG / canvas, and other
  renderer-owned graphics;
- Markdown / user-authored / generated content SVG;
- legacy `src/components/vault/icons.ts` exports that still have active consumers
  during incremental migration.

Each exception must have an identifiable owner and must not silently become a new
functional icon vocabulary.

## Current legacy contract (migration only)

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
surface is not yet migrated and the exception is documented in review. Critical bug
fixes, semantic corrections, and migration-required temporary compatibility are the
only reasons to touch the legacy vocabulary; new generic functional glyphs belong to
Tabler.

## Lint and preview transition

Before Phase 8, `npm run lint:icons`, the legacy contract test, and
`src/views/IconPreviewView.vue` continue to protect existing `icons.ts` consumers.
They are migration safety nets, not permission to expand the legacy system.

The existing brand-constellation geometry finding remains a known classification debt;
this amendment does not modify `scripts/icon-lint.ts`. Future governance should classify
brand, generated, user-content, and third-party renderer SVG explicitly, and should not
inspect Tabler's dependency-owned viewBox, path, or stroke geometry.

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

- [Icon exports](../../src/components/vault/icons.ts)
- [Legacy contract tests](../../src/components/vault/__tests__/icons.test.ts)
- [Repository lint](../../scripts/icon-lint.ts)
- [Development preview](../../src/views/IconPreviewView.vue)
