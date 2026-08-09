# Changelog

All notable changes to Docus are documented in this file.

## AI Provider & Settings Hardening — 2026-08-09

- Added separate Anthropic and OpenAI provider settings with encrypted saved credentials.
- Hardened OpenAI-compatible streaming Chat Completions support, API-root Base URL validation, streamed-response persistence, and the bounded `max_tokens` → `max_completion_tokens` compatibility fallback.
- Added explicit diagnostics for OpenAI-compatible tool/function-calling incompatibility.
- Added a real manual Settings connection probe for the current transient provider configuration. Probes are read-only, bounded, non-persistent, and redact API keys.
- Improved connection failure classification for authentication, explicit model errors, timeouts, tool incompatibility, and generic endpoint failures.
- Tightened the Settings UI controls and simplified Base URL guidance.
- Standardized History and Crash Recovery integration lanes for cross-platform CI, including Windows-specific serialization where needed.

## Tags Query & Index Refactor — Process Closure — 2026-07-30

- Completed retrospective process repair for the Tags Query & Index Refactor.
- Closed Phase 1 (unified tag model, query parsing, matching, TagIndex,
  FileTree integration, TagPanel integration).
- Closed Phase 1.1 review fixes (index consistency, FileTree semantics,
  TagPanel filter, display form).
- Created formal Spec, Plan, Implementation Record, and Closure documents.
- This is a documentation-only change — no production code was modified.
- Tag Management Phase 2 (Rename / Merge / Remove) remains NOT STARTED.

Production code baseline for the Tags Query & Index Refactor:

`8a5b452b9e48c97d52065c30204ff57b898d4a1a`

See [`docs/archive/closures/tags-query-index-refactor-final-closure.md`](docs/archive/closures/tags-query-index-refactor-final-closure.md)
for the complete closure record.

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

See [`docs/archive/closures/edit-feature-final-closure.md`](docs/archive/closures/edit-feature-final-closure.md)
for the complete closure record.
