# Security Model

Docus is designed as a trusted-user, local or privately networked application. It does not provide authentication, user authorization, tenant isolation, or TLS termination.

## Trust boundaries

- The server is trusted with full read/write access to the configured vault and `data/` directory.
- Browsers that can reach the server can use its document, history, and configured AI capabilities.
- Markdown, AI output, file paths, and model tool requests are treated as untrusted inputs and validated or sanitized.
- The configured AI provider receives prompts and any workspace context sent to it.

## Content rendering

User Markdown is parsed with raw HTML support, then sanitized with a restrictive DOMPurify allowlist. Script-capable elements, event handlers, and inline styles are removed. Mermaid runs with `securityLevel: 'strict'`. AI Markdown disables raw HTML before rendering.

Sanitization reduces document-content risk; it is not a substitute for authenticating access to the application.

## Filesystem safety

Server routes validate vault-relative paths and archive rules. Writes use compare bases, locks, atomic replacement, and durable recovery. These mechanisms protect integrity; they do not stop an authorized host user from editing the files directly.

## Secrets

AI API keys are encrypted at rest in SQLite. The separate master key must be exactly 32 bytes, encoded as 64 hexadecimal characters or canonical base64. File permissions, volume access, logs, process inspection, and host backups remain deployment responsibilities.

## Deployment boundary

Keep the default loopback binding unless a trusted reverse proxy or private network supplies access control and TLS. See [Deployment Security](../deployment/security.md) for the operational checklist.

