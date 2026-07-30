# Changelog

All notable changes to Docus are documented in this file.

## Edit Feature Closure — 2026-07-30

- Completed the Edit feature development program.
- Closed the Round-17 folder move and crash-recovery audit.
- Added durable cross-artifact owner handoff.
- Made metadata recovery CAS idempotent.
- Enforced strict durable snapshot graph validation.
- Added source and destination directory ownership proofs.
- Closed inode-reuse ABA with birthtime-based directory identity.
- Quarantined weak legacy recovery journals.
- Stabilized Windows integration tests by waiting for in-flight requests.
- Entered maintenance mode.

Final production code baseline:

`83abbf336785290a667321a8817ff6898176a678`

See [`docs/edit-feature-final-closure.md`](docs/edit-feature-final-closure.md)
for the complete closure record.