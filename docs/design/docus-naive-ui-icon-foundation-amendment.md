# Docus Naive UI Icon Foundation Amendment

**日期：** 2026-09-07
**范围：** Docus Naive UI Foundation PRD / Implementation Plan
**状态：** Product / Implementation Amendment: Accepted; Phase 0 local PASS
**基线：** main @ 9c65f7aa84c45fba33fd7b586ce042f57366d14c

## 1. Amendment purpose

原 Naive UI Foundation 决策把图标留在 Docus 自绘体系中，并在 Phase 1
明确禁止引入 `xicons` 或其他 icon library。这个决定与“Naive UI 负责基础
交互、Docus 负责产品表达”的架构边界不一致，也会继续让 Docus 维护一套
独立的 functional icon library。

本 amendment 只改变 Functional Icon Foundation，不改变 Docus 的品牌、
领域布局、内容渲染或现有图标消费者的业务语义。

## 2. Frozen decision

```text
Docus Functional Icon Foundation
    ↓
Naive UI NIcon
    ↓
@vicons/tabler@0.13.0
```

冻结以下规则：

- Functional icon 只允许从一个 approved family `@vicons/tabler` 引入，并通过
  `NIcon` 承载；`@vicons/ionicons5`、Material、Lucide、Heroicons 或第二个
  `@vicons/*` family 不在本项目批准范围内。
- 业务代码禁止新增手写 functional `<svg>`、复制 SVG path，或为了单个页面
  临时混入另一套 icon family。
- `NIcon` 只负责 icon container；Tabler component 负责 glyph。图标颜色由
  `currentColor` / consuming component 的 CSS 继承，不在页面复制 path。
- 现有 `src/components/vault/icons.ts` 暂时作为 Legacy Icon System 保留，
  直到对应消费者在后续 UI migration 中迁移；本 amendment 不要求一次性替换
  所有现有 `ICON_*` 使用点。

## 3. Ownership boundary

| 内容 | Authority |
| --- | --- |
| Search、Settings、Add、Delete、Calendar、Account、Arrow 等 functional glyph | `@vicons/tabler` via `NIcon` |
| Docus logo、brand constellation、产品插画 | Docus-owned SVG / assets |
| Mermaid / Markmap / 用户内容 SVG | 原有 renderer / content pipeline |
| 尚未迁移的 `ICON_*` glyph | Legacy `icons.ts`，只允许维护迁移所需内容 |

Brand artwork 和 generated / user content 不是 icon primitive，不受 functional
family 约束，但必须保留明确的 documented exception 和可访问性语义。

## 4. Phase 0 spike result and constraint

Phase 0 使用 exact-pinned dependencies：

```text
naive-ui@2.45.3
@vicons/tabler@0.13.0
```

兼容性 fixture 位于
`src/ui/__tests__/fixtures/NaiveUiFoundationSpike.vue`，测试位于
`src/ui/__tests__/naive-ui-foundation-spike.test.ts`，覆盖：

- `NIcon + @vicons/tabler` 的 Button slot、standalone icon、24×24 Tabler glyph；
- `currentColor` 继承、icon-only control 的 accessible label 和 decorative icon；
- Light / Dark runtime switch，且不 remount surface；
- CSS custom property theme mapping 的可消费字段；
- `zh → en → zh` locale / dateLocale bridge，且不 remount surface；
- `NDialogProvider`、`NMessageProvider`、`NNotificationProvider` 和 Teleport；
- Vue 3 `renderToString` SSR smoke test；
- Vitest / Vue 3 / Vite compatibility。

Spike 同时确认一个 Naive UI theme API 限制：部分派生颜色字段会交给
`seemly` 在运行时计算，不能直接接受 `var(--token)`。因此：

```text
raw surface fields      → 可以直接消费 CSS custom property
derived color fields    → 使用最小、受控的 TS color mirror
```

这不是第二套 Docus design system。TS mirror 只能承载 Naive UI 无法从 CSS
custom property 解析的字段；值仍然由 Docus semantic token authority 生成，
不得在组件或页面局部新建颜色。

## 5. Migration and cleanup

迁移顺序保持原 Naive UI Foundation 的增量边界，并把 icon 迁移绑定到对应
surface：

```text
Phase 0  validate NIcon + Tabler
Phase 1  record the icon foundation and import policy
Phase 3  migrate shared primitive icons
Phase 4  migrate NavBar / Settings icons
Phase 5  migrate Diary icons
Phase 6  migrate Ledger icons
Phase 7  migrate Vault / Note icons
Phase 8  delete legacy icons.ts, legacy icon tests and old preview/lint rules
```

Phase 8 之前不得删除 `icons.ts`、旧 preview 或旧 contract test；但也不得把
它们当作新 functional icon 的默认扩展点。迁移中的 legacy exception 必须在
review 中可见。

## 6. Authority changes

本 amendment supersede：

- Naive UI Foundation PRD 中“第一阶段不引入 icon library、继续使用 inline SVG /
  existing icons”的决定；
- Naive UI Foundation Implementation Plan §11 和 §54 中的
  `No Second Icon System` 旧文字；
- 当前 Icon System 文档中把 Docus 自绘 `icons.ts` 作为未来 functional icon
  source of truth 的表述。

本 amendment 不 supersede：

- 现有 `ICON_*` 消费者的迁移顺序；
- Docus brand / generated SVG 例外；
- `icon-lint` 在 legacy migration 期间对既有 glyph 的回归保护。

## 7. Acceptance

本 amendment 的 Phase 0 acceptance 为：

```text
package.json exact pin              PASS
package-lock reproducibility        PASS
NIcon + Tabler render               PASS
Light / Dark runtime switch        PASS
CSS var safe-field mapping          PASS
Derived-color limitation recorded   PASS
Locale / DateLocale                 PASS
Provider / Teleport                 PASS
Accessible icon usage               PASS
Vue SSR renderToString              PASS
Vitest fixture                       PASS
```

Phase 0 build checkpoint（本阶段没有 production Naive UI import）：

```text
entry JS                  259,812 bytes
largest JS chunk        2,629,634 bytes
total JS               20,623,981 bytes
total CSS                  430,347 bytes
production Naive/Vicons references  none
```

因此 dependency + test-only fixture 没有进入 production bundle；真正的
production bundle delta 要等 Phase 1 首次接入 `DocusUiRoot` 和 production
icon imports 后再记录。

后续 Phase 1 不得重新选择 icon family，也不得把本 amendment 扩展成一次性
repo-wide SVG replacement。
