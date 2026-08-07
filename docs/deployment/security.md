# Deployment Security

## Default Network Exposure

Bare-metal production listens on `127.0.0.1` unless `HOST` is set. Docker listens on `0.0.0.0` inside the container, but Compose publishes the port at `127.0.0.1:3000` by default.

Docus has no built-in user authentication, authorization, multi-user isolation, rate limiting, or TLS termination. Do not bind it to a LAN or the public Internet without adding an authenticated TLS reverse proxy and appropriate firewall rules. Anyone who can reach the application can read notes, change files and metadata, use stored AI credentials through the server, and operate History.

## Container Hardening

The supplied Compose service runs as UID/GID 1000, sets `no-new-privileges`, makes the image root filesystem read-only, and uses a tmpfs for `/tmp`. The vault bind mount and data volume remain writable because Docus cannot function without them. These controls reduce container privileges; they do not replace application authentication.

## Markdown Rendering

Document Markdown enables semantic raw HTML, then sanitizes the complete rendered result with DOMPurify before `v-html` insertion. The allowlist excludes scripts, styles, event handlers, forms, iframes, objects, embedded content, SVG, and unsafe URL schemes. Inline `style` and unrecognized `data-*` attributes are removed.

Mermaid uses `securityLevel: 'strict'`. Mermaid and Markmap source is URL-encoded into a sanitized placeholder and decoded only by the controlled mount component. AI chat Markdown disables raw HTML.

Sanitization is a browser rendering boundary, not a promise that arbitrary Markdown is harmless in every external application. Review untrusted vault files before opening them in other renderers with different HTML rules.

## AI Secret Storage

- API keys are accepted through Settings and encrypted with AES-256-GCM before storage in SQLite.
- A fresh 12-byte IV is generated for each credential write; the authentication tag detects tampering.
- The master key comes from `DOCUS_MASTER_KEY`, `DOCUS_MASTER_KEY_FILE`, or `data/.docus-master-key` and is never stored in SQLite.
- The browser receives only a masked credential state, not the plaintext key.
- Custom provider base URLs must use HTTP or HTTPS. Prefer HTTPS and a trusted endpoint; a malicious endpoint receives the configured API key and prompt data.

Encryption at rest does not defend against an attacker who can run code as the Docus process or use an exposed, unauthenticated Docus instance.

## Filesystem and AI Tool Boundaries

Logical vault paths are validated and security-sensitive reads reject symbolic-link traversal. Save and lifecycle operations use ownership checks, create-only publication, compare-and-swap behavior, and durable journals to avoid overwriting external writers.

AI file tools use the same server boundaries. Live-workspace mutation policy rejects unsafe edits to dirty, read-only, externally conflicted, stale, or identity-mismatched content. Tool calls still execute automatically once selected by the model; audit their results in the UI and History.

## Backup Confidentiality

Vault files, Git history, SQLite, chat history, and recovery copies may all contain sensitive information. Encrypt backups and restrict access. If the auto-managed master-key file is backed up with the data volume, anyone who obtains both that backup and the database can decrypt stored AI credentials.
