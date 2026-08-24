# Diary VCalendar Compatibility Report

## Status

- D3.0: `REVIEW-CLOSED`
- Gate result: `PASS`
- Independent D3.0 review: closed (`P0 = 0`, `P1 = 0`, `P2 = 0`)
- D3.1: `NOT STARTED`
- Validation date: 2026-08-24 (Asia/Shanghai)
- Baseline commit: `71e53445e6e6c14d23ec7b58a198450be8a7628f`
- Final validation commit SHA (D3.0): `106e9ac601c4949a692dd4b11401786602d1a33c`
- Exact candidate: `v-calendar@3.1.2`
- Required Popper peer: `@popperjs/core@2.11.8`
- GitHub CI: `NOT VERIFIED` (not queried for this docs-only closure)

This report approves the exact VCalendar candidate for the D3.1 entry gate. It does not implement `DiaryCalendar.vue`, Diary navigation, Vault integration, editor integration, or Diary create/open lifecycle.

## Exact Docus Stack

Resolved from the D3.0 working tree with `npm ls --depth=0`:

| Tool | Declared range | Resolved version |
| --- | --- | --- |
| Node | runtime | `22.21.1` |
| npm | runtime | `10.9.0` |
| Vue | `^3.5.34` | `3.5.35` |
| Vite | `^8.0.12` | `8.0.16` |
| TypeScript | `~6.0.2` | `6.0.3` |
| `@vitejs/plugin-vue` | `^6.0.6` | `6.0.7` |
| `vue-tsc` | `^3.2.8` | `3.3.3` |
| Vitest | `^4.1.8` | `4.1.8` |
| jsdom | `^29.1.1` | `29.1.1` |
| `@vue/test-utils` | `^2.4.10` | `2.4.10` |

## Registry Resolution

The unqualified `latest` tag was not used. Registry metadata was queried before installation:

```text
v-calendar dist-tags:
latest   = 2.4.2
next     = 3.1.2
v2-latest = 2.4.2
```

Candidate selected and pinned:

```text
v-calendar@3.1.2
@popperjs/core@2.11.8
```

`v-calendar@3.1.2` declares:

```json
{
  "peerDependencies": {
    "@popperjs/core": "^2.0.0",
    "vue": "^3.2.0"
  }
}
```

The candidate resolved cleanly with one Vue runtime (`vue@3.5.35`) and no peer dependency error. `@popperjs/core` is a required peer for this candidate and is retained at the exact resolved version `2.11.8`. The official package metadata shows the v3.1.2 release was last modified on 2023-10-13; this is a non-blocking maintenance risk to revisit before future upgrades.

The official installation contract was also checked: Vue 3.2+, Popper 2+, and an explicit `v-calendar/style.css` import. The v3.1.2 release is the latest v3 release exposed by the official release list, while npm `latest` still points to the legacy Vue 2 line.

## Official Documentation Evidence

- [VCalendar installation](https://vcalendar.io/getting-started/installation.html): Vue/Popper requirements, v3 installation shape, and explicit stylesheet import.
- [VCalendar Calendar API](https://vcalendar.io/calendar/api.html): monthly view, attributes, `is-dark`, `first-day-of-week`, masks, locale, initial page, and `dayclick`.
- [VCalendar attributes](https://vcalendar.io/calendar/attributes): dots and `customData` attribute capabilities.
- [VCalendar navigation](https://vcalendar.io/calendar/navigation): component navigation methods and navigation events.
- [VCalendar releases](https://github.com/nathanreyes/v-calendar/releases): v3.1.2 release and v3 line history.

## Known Compatibility Risks

The upstream [Vue 3.5 `dayIndex` issue #1498](https://github.com/nathanreyes/v-calendar/issues/1498) remains an open, reported risk. The report describes a Vue 3.5.1 runtime error in a `day-content`/DatePicker path. D3.0 exercised the exact Docus Calendar/day-content path without reproducing that failure, so #1498 remains a Known Compatibility Risk rather than an automatic failure.

The upstream [issue #1514](https://github.com/nathanreyes/v-calendar/issues/1514) reports the same class of `dayIndex`/runtime problem in an environment containing `v-calendar@3.1.2` and Vue 3.5.x (the report identifies Vue 3.5.13). The reported path is primarily DatePicker and range-mode behavior. Diary MVP currently uses only the monthly `Calendar` surface; it does not use DatePicker or range product behavior.

Docus's exact D3.0 stack is Vue 3.5.35 with `v-calendar@3.1.2`. The real probe verified `Calendar`, `day-content`, attributes, `customData`, `dayclick`, navigation, reactive update, and unmount/remount, and did not reproduce #1514. Therefore #1514 is a non-blocking Known Compatibility Risk, not `FAIL` and not `CONDITIONAL PASS`; the D3.0 Gate remains `PASS`.

If Diary later introduces DatePicker, range selection, a Vue upgrade, a VCalendar upgrade, or changes the custom day-rendering implementation, re-check #1498, #1514, and the latest relevant upstream issues at that time. The age of the `v-calendar@3.1.2` release remains a separate non-blocking maintenance risk.

## Spike Harness

The harness is isolated from production Diary architecture:

- [`src/components/diary/__tests__/VCalendarCompatibilityProbe.vue`](../../src/components/diary/__tests__/VCalendarCompatibilityProbe.vue) — disposable probe component; not `DiaryCalendar.vue`.
- [`src/components/diary/__tests__/VCalendarCompatibility.test.ts`](../../src/components/diary/__tests__/VCalendarCompatibility.test.ts) — retained Vitest/jsdom compatibility regression.
- [`e2e/vcalendar-compatibility.spec.ts`](../../e2e/vcalendar-compatibility.spec.ts) — focused Chromium smoke.
- [`e2e/vcalendar-compatibility/`](../../e2e/vcalendar-compatibility/) — isolated Vite browser fixture with no user-facing route.
- [`vite.vcalendar.config.ts`](../../vite.vcalendar.config.ts) and [`playwright.vcalendar.config.ts`](../../playwright.vcalendar.config.ts) — dedicated test-only wiring.

The probe imports the candidate's real CSS and real `Calendar` component. It does not mock VCalendar, modify `VaultView`, add a product route, call the Diary API, or create a production adapter.

## Validation Matrix

| Check | Result | Evidence |
| --- | --- | --- |
| Registry resolution | PASS | Exact candidate selected after dist-tag and metadata review; no unqualified install |
| Peer dependencies | PASS | `npm ls v-calendar @popperjs/core vue`; one Vue 3.5.35 runtime, no peer error |
| Calendar mount | PASS | Real `Calendar` mount in Vitest/jsdom and Chromium |
| Monthly render | PASS | Fixed August 2026 page renders day cells and title mask |
| Previous/next | PASS | Component instance navigation; repeated 12-month forward/backward loop in Vitest; browser prev/next |
| Attributes | PASS | Fixed Diary date attribute reaches the target day |
| Dot | PASS | `dot` appears for `2026-08-24` |
| `customData` | PASS | Target day exposes `customData.date = 2026-08-24` through day click/slot seam |
| Reactive attributes | PASS | Dot disappears/reappears without Calendar remount |
| Day click | PASS | Target click emits validated local `DiaryDate` and custom data |
| DiaryDate adapter | PASS | Adapter uses `day.year`, `day.month`, `day.day` and `parseDiaryDate()`; no UTC serialization |
| UTC/DST boundary | PASS | Chromium contexts `Pacific/Kiritimati` (UTC+14), `Etc/GMT+12` (UTC-12), and `America/New_York` all return `2026-08-24` |
| `day-content` custom rendering | PASS | Slot receives day/attributes and renders `mood-probe`; click remains functional |
| Locale | PASS | `en-US` and `zh-CN` render successfully |
| First day of week | PASS | Weekday DOM order changes after runtime prop toggle |
| Masks | PASS | Month title uses configured `MMMM YYYY` mask |
| Light/dark | PASS | Light and explicit dark component render; dark class is present |
| Narrow/mobile | PASS | Chromium smoke at 375×812; calendar, navigation, marker and tap work |
| Unmount/remount | PASS | Conditional removal and remount complete without stale-state/runtime error |
| Vitest/jsdom | PASS | 5 files / 58 tests, including 5 VCalendar probe tests |
| Browser smoke | PASS | 1 focused Chromium test |
| Runtime errors | PASS | Probe console checks and browser `pageerror`/`console.error` capture are empty for candidate interactions |
| Client/server typecheck | PASS | `npm run typecheck` |
| Production build | PASS | Main Docus build PASS; dedicated probe Vite build also PASS (71 modules, candidate CSS and ESM bundle resolved) |

## Validation Commands and Results

```powershell
node --version
# v22.21.1

npm --version
# 10.9.0

npm ls --depth=0 vue vite typescript @vitejs/plugin-vue vue-tsc vitest jsdom @vue/test-utils
# PASS — exact stack listed above

npm ls v-calendar @popperjs/core vue --all
# PASS — v-calendar@3.1.2, @popperjs/core@2.11.8, vue@3.5.35; no peer error

npm run typecheck
# PASS

npm run build
# PASS on elevated rerun; the first unprivileged Vite config load was BASELINE-LIMITED by Windows spawn EPERM

node node_modules/vite/bin/vite.js build --config vite.vcalendar.config.ts
# PASS — dedicated probe production bundle; 71 modules, VCalendar CSS and ESM resolved

npm exec vitest run src/components/diary/__tests__/VCalendarCompatibility.test.ts shared/__tests__/diaryProtocol.test.ts shared/__tests__/archiveProtocol.test.ts server/__tests__/documentMutationPolicy.test.ts server/__tests__/diary-routes.test.ts
# PASS — 5 files / 58 tests

node node_modules/@playwright/test/cli.js test e2e/vcalendar-compatibility.spec.ts --config=playwright.vcalendar.config.ts
# PASS — 1 Chromium test; desktop, narrow, UTC+14, UTC-12, and DST timezone contexts

git diff --check
# PASS
```

The initial unprivileged Vitest, Playwright, and Vite build attempts hit the repository's known Windows `spawn EPERM` baseline during tool startup. Each relevant lane was rerun with elevated process permissions; the final feature results above are not marked as environment failures.

## Dependency and Disposable Files

Retained dependency changes:

- `package.json`: exact runtime dependencies `v-calendar: 3.1.2` and `@popperjs/core: 2.11.8`.
- `package-lock.json`: exact candidate and transitive resolution.

No Vue, Vite, TypeScript, Vitest, jsdom, auth, filesystem, Diary domain, server, or scope contract was downgraded or changed to accommodate VCalendar. No production Diary component or user-facing route was added.

The isolated probe and browser fixture are retained as low-coupling D3.0 regression evidence. No temporary product route, experiment button, Vault modification, or manual console logging remains.

## Result and D3.1 Gate

`PASS` is approved at the D3.0 implementation and review-closed level:

- all required Calendar/MVP capabilities passed;
- the future Mood `day-content` seam passed;
- exact-stack typecheck, production build, Vitest/jsdom, and browser smoke passed;
- no blocker-level runtime exception was reproduced;
- Docus core versions were not downgraded.

D3.0 is `REVIEW-CLOSED`; D3.1 is `NOT STARTED`. This report does not authorize Calendar adapter implementation or any later Diary phase.

## P0 / P1 / P2

Independent D3.0 closure review: `P0 = 0`, `P1 = 0`, `P2 = 0`.

The prior documentation P2 is closed: the baseline commit, D3.0 validation commit, exact candidate, Gate result, and both upstream risk assessments are now self-contained in this report. The upstream Vue 3.5/dayIndex reports and the 2023 candidate maintenance date remain non-blocking Known Compatibility Risks, not silently ignored and not promoted to a failure without reproduction.
