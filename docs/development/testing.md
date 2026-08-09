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

## Vitest lanes

`npm test` runs the three application test lanes in sequence:

1. `npm run test:unit`
2. `npm run test:history-integration`
3. `npm run test:recovery-integration`

The lanes keep ordinary fast tests on the normal short Vitest failure boundary
while giving real filesystem and process integration their own scheduling and
timeout boundaries. The unit lane contains the usual client/server behavior
tests and excludes the heavy History and Crash Recovery suites.

### Unit lane

`test:unit` is the fast feedback lane for ordinary JavaScript/TypeScript,
server-route, storage, and component tests. It keeps the default unit-test
timeout and does not include the real-Git or crash-recovery stress suites.

### History integration lane

`test:history-integration` runs tests that create real Git repositories and
exercise Git plus filesystem behavior. It has a lane-specific timeout boundary.
On Windows, files are run serially with a constrained worker so concurrent
`git.exe` processes and temporary repositories do not create avoidable timing
or file-handle contention. This does not widen the global unit-test timeout.

### Recovery integration lane

`test:recovery-integration` covers real filesystem operations, SQLite state,
process/fault boundaries, and crash-recovery behavior. It includes the
crash-recovery state-machine/stress coverage. Windows runs this lane with
serialized file execution for filesystem stability; the state-machine tests
have a larger timeout within this lane because they intentionally exercise many
recovery seeds. The larger boundary is local to Recovery integration and does
not change ordinary unit-test timing.

OpenAI-compatible protocol tests use a local fake HTTP server and, where
practical, the real provider SDK path. They never access the public internet.
This real-wire coverage verifies request paths, authorization headers, request
bodies, streaming, Settings connection probes, tool compatibility, and the
`max_tokens`/`max_completion_tokens` compatibility behavior.

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
