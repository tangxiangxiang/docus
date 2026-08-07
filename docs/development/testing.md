# Testing

Docus uses Vitest for client and server tests and Playwright for browser workflows.

## Local verification

```bash
npm run typecheck
npm run build
npm test
```

For UI work, also run the relevant browser suite:

```bash
npm run test:e2e
npm run test:e2e:draft-store
```

Playwright starts isolated test servers according to the selected config. The general suite uses port 4174 and the draft-store suite uses 4175.

## Test organization

- `src/**/__tests__/`: Vue components, composables, rendering, search, and browser-state units.
- `server/__tests__/` and `server/routes/*.test.ts`: APIs, storage, history, mutation policy, and transaction integration.
- `server/__tests__/fixtures/`: child processes used to terminate operations at controlled fault points.
- `e2e/`: end-to-end editor, AI context, draft, view-mode, and visual behavior.

Crash recovery tests intentionally exercise real process boundaries and should remain deterministic when repeated. Visual baselines are maintained on macOS; the cross-platform suite excludes platform-sensitive visual assertions.

## Icon policy

Run `npm run lint:icons` after changing UI icon usage. `npm run lint:icons:strict` is available when auditing the whole icon system. The current baseline has a documented brand-constellation classification finding; do not treat it as permission for new violations. See [Icon Usage](../design/icon-usage.md) and [Known lint debt](../design/icon-system.md#known-lint-debt).

## Before opening a change

Use `npm ci` when validating lockfile reproducibility. Run the narrowest relevant tests during development, then the full typecheck, build, and unit/integration suite before handoff.
