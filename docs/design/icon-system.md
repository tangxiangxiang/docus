# Icon System

This page documents the current contract enforced by `src/components/vault/__tests__/icons.test.ts` and `scripts/icon-lint.ts`. The exported icon source is `src/components/vault/icons.ts`.

## Visual language

Docus icons should be calm, editorial, minimal, and legible at small sizes. Use one concept per glyph, reuse the existing folder/document/status families, and prefer optical balance over added detail.

## Shared functional grid

Unless an icon is an explicit exception, its root SVG must use:

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

Hard rules apply to every functional icon: no `<text>`, no large imported `1024` canvas, no literal SVG colors, and no root `class` or `style`. The consuming component supplies accessible text and CSS state.

## Tested exceptions

Filled presence/state glyphs use `fill="currentColor"` and `stroke="none"`. The current allowlist is:

- `ICON_AI_MEMORY`
- `ICON_STATUS_SUCCESS`
- `ICON_STATUS_MODIFIED`
- `ICON_STOP`

Toolbar surface glyphs may use a `0 0 24 24` canvas and a larger display size. The current allowlist is:

- `ICON_NAV_THEME_LIGHT`
- `ICON_NAV_THEME_DARK`
- `ICON_AB_SETTINGS`

The allowlists live in the icon test. A new exception requires an explanatory source comment and a deliberate test change. Brand assets and third-party controls in `MarkMap.vue` and `Mermaid.vue` are outside the functional icon grid.

## Naming and ownership

- Export functional icons as `ICON_<CONCEPT>` in screaming snake case.
- Name the concept, not the component or temporary placement: `ICON_SEARCH`, not `ICON_NAVBAR_SEARCH`.
- Reuse an existing semantic icon instead of copying its SVG into a component.
- Keep all product-owned functional glyphs in `src/components/vault/icons.ts` so tests and the development preview discover them automatically.

Current vocabulary families cover general file actions, vault scopes, AI tools and concepts, knowledge links, status, file types, editor actions, context menus, and common utilities. An exported glyph may be reserved for a coherent future surface; documentation must not imply that an unused icon means the feature has shipped.

## Adding or changing an icon

1. Search `icons.ts` and current consumers for an existing concept.
2. Draw on the shared grid and use `currentColor`.
3. Export from `icons.ts`; do not add untrusted SVG markup at runtime.
4. Review `/__icon-preview` in development at 14, 18, and 22 px in both themes.
5. Run:

   ```bash
   npm run lint:icons
   npm test -- src/components/vault/__tests__/icons.test.ts
   ```

6. Update [Icon Usage](icon-usage.md) only when the semantic vocabulary or a major surface mapping changes.

## Known lint debt

`npm run lint:icons` currently reports the 1000×1000 inline brand-constellation SVG in `NavBar.vue` as two hard and one soft functional-icon violations. That SVG is a decorative brand surface, not an `ICON_*` glyph, but the repository scanner does not yet distinguish it. The `icons.ts` contract tests pass. Do not suppress unrelated findings; resolve this debt by giving the brand surface a narrowly scoped lint classification or exception.

## Source references

- [Icon exports](../../src/components/vault/icons.ts)
- [Contract tests](../../src/components/vault/__tests__/icons.test.ts)
- [Repository lint](../../scripts/icon-lint.ts)
- [Development preview](../../src/views/IconPreviewView.vue)
