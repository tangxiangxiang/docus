# Continuous Integration

The GitHub Actions workflow in `.github/workflows/ci.yml` runs on every push and pull request.

## Verification matrix

The main job runs on:

- Ubuntu with Node.js 24
- macOS with Node.js 24
- Windows with Node.js 24
- Ubuntu with Node.js 22

Each matrix entry installs with `npm ci`, runs typechecking, builds the client, runs the complete Vitest suite, repeats critical crash-recovery tests, installs Chromium, and runs cross-platform and draft-store Playwright suites.

## Additional jobs

- `docker-smoke` builds the production image, starts it with temporary writable mounts, and probes `/api/health`.
- `visual` runs the Markdown visual baselines on macOS and uploads failure evidence.
- Browser and visual jobs upload `test-results/` artifacts when failures occur.

The workflow grants read-only repository contents permission and cancels an older run for the same workflow and ref when a replacement starts.

## Keeping CI maintainable

When adding a required local verification command, add it to CI or explain why it is intentionally local-only. Keep platform-specific baselines out of the cross-platform suite, and use fault-injection fixtures rather than timing guesses for crash guarantees.

