# Docus Documentation

Docus is a self-hosted Markdown knowledge base with a Vue interface, a Hono server, Git-backed versions, SQLite metadata, and optional AI assistance.

## Getting Started

- [Quick Start](getting-started/quick-start.md)
- [Installation](getting-started/installation.md)
- [Configuration](getting-started/configuration.md)

## User Guide

- [Overview](user-guide/overview.md)
- [Vault and Archive Protocol](user-guide/vault.md)
- [Editor and Draft Recovery](user-guide/editor.md)
- [Markdown, Links, and Diagrams](user-guide/markdown.md)
- [AI](user-guide/ai.md)
- [Tags and Search](user-guide/tags-and-search.md)
- [History](user-guide/history.md)
- [Links and Backlinks](user-guide/links.md)

## Deployment

- [Deployment Overview](deployment/overview.md)
- [Docker](deployment/docker.md)
- [Runtime Configuration](deployment/configuration.md)
- [Security](deployment/security.md)
- [Backup and Restore](deployment/backup-and-restore.md)

## Architecture

- [Architecture Overview](architecture/overview.md)
- [Storage](architecture/storage.md)
- [Edit and Save](architecture/edit-and-save.md)
- [Document Lifecycle](architecture/document-lifecycle.md)
- [History](architecture/history.md)
- [AI](architecture/ai.md)
- [Search and Indexing](architecture/search-and-indexing.md)
- [Security Boundaries](architecture/security.md)
- [Crash Recovery](architecture/crash-recovery.md)

## Development

- [Development Setup](development/setup.md)
- [Project Structure](development/project-structure.md)
- [Testing](development/testing.md)
- [Continuous Integration](development/ci.md)

## Design

- [Shiki Syntax Highlighting Migration PRD](design/syntax-highlighting-shiki-migration-prd.md)
- [Shiki Syntax Highlighting Migration Implementation Plan](design/syntax-highlighting-shiki-migration-implementation-plan.md)
- [Shiki H0 Baseline & Contract Audit](design/syntax-highlighting-shiki-h0-audit.md)
- [Shiki H1 Dependency & Runtime Foundation](design/syntax-highlighting-shiki-h1-runtime-foundation.md)
- [Shiki H2 Fence Discovery & Dynamic Language Loading](design/syntax-highlighting-shiki-h2-language-loading.md)
- [Shiki H3 Markdown Renderer Cutover](design/syntax-highlighting-shiki-h3-renderer-cutover.md)
- [Shiki H4 Style-to-Class & Security Closure](design/syntax-highlighting-shiki-h4-security-closure.md)
- [Shiki H5 Theme Integration](design/syntax-highlighting-shiki-h5-theme-integration.md)
- [Shiki H6 PDF Compatibility](design/syntax-highlighting-shiki-h6-pdf-compatibility.md)
- [Shiki H7 highlight.js Cleanup](design/syntax-highlighting-shiki-h7-highlightjs-cleanup.md)
- [Shiki H8 Full Regression, Bundle Audit & Release Gate](design/syntax-highlighting-shiki-h8-release-gate.md)
- [PDF Export V1 PRD](design/pdf-export-prd.md)
- [PDF Export V1 Implementation Plan](design/pdf-export-implementation-plan.md)
- [Logo](design/logo.md)
- [Icon System](design/icon-system.md)
- [Icon Usage](design/icon-usage.md)

## Migrations

- [Document Metadata Migration](migrations/document-metadata.md)

## Historical Documents

[The documentation archive](archive/README.md) preserves completed plans, former specifications, implementation records, closure evidence, and freeze backlogs. It explains how Docus evolved; it is not authoritative for current behavior.

## Documentation Conventions

- Put user-visible behavior in `docs/user-guide/`.
- Put deployment and operational procedures in `docs/deployment/`.
- Put current implementation architecture in `docs/architecture/`.
- Put contributor workflows in `docs/development/`.
- Put reusable visual-system rules in `docs/design/`.
- Put one-time, still-supported upgrade procedures in `docs/migrations/`.
- Put completed plans, superseded specifications, implementation records, closure reports, and freeze notes in `docs/archive/`.

Keep one authoritative document per topic and link to it from shorter summaries. Do not place implementation plans or closure reports directly under `docs/`.
