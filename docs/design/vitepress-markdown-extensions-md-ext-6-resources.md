# Docus VitePress-Style Markdown Extensions
# MD-EXT-6 — Safe Snippets & Markdown Includes

## 1. Phase metadata

| Field | Value |
| --- | --- |
| Phase | MD-EXT-6 — Safe Snippets & Markdown Includes |
| Status | COMPLETE / REVIEW-READY |
| Implementation baseline | `582e312a4c5752a4c9a5c6bba7b0e752b0b78078` |
| Previous phase final review closure | `dd4768f67e77f190794cd7d046218705e2ce56e3` |
| MD-EXT-6 base | `dd4768f67e77f190794cd7d046218705e2ce56e3` |
| Approved PRD | `7e05e3bb43f4283a90ead1abd0c81325bc93281c` |
| Approved Implementation Plan | `582e312a4c5752a4c9a5c6bba7b0e752b0b78078` |
| MD-EXT-6 completion commit | Recorded in the final handoff after this document is committed |
| Next phase | MD-EXT-7 — NOT STARTED |

This document records the implementation and verification evidence for MD-EXT-6.
It is review-ready, not review-closed. No MD-EXT-7 work is included.

## 2. Scope and changed files

MD-EXT-6 adds the approved safe local resource core:

- `<<< ...` code snippets with bounded ranges, labels, explicit languages, and
  basic named regions;
- `<!--@include: ...-->` Markdown includes, including nested includes;
- logical `@/`, `./`, and `../` resolution with source-relative context;
- an authenticated server resource boundary for text and approved local images;
- bounded expansion before the final MarkdownIt parse and Shiki discovery;
- source-aware links, images, and WikiLinks in included Markdown;
- stale-render cancellation and settled-HTML PDF behavior.

Production and test files changed for this phase are:

```text
server/index.ts
server/markdownResources.ts
server/routes/markdownResources.ts
server/routes/markdownResources.test.ts
shared/linkResolve.ts
src/lib/markdownResources.ts
src/lib/markdown.ts
src/lib/wikiLinks.ts
src/composables/vault/useMarkdownRender.ts
src/components/vault/RenderedMarkdown.vue
src/components/vault/ReadingPane.vue
src/components/vault/PdfExportSurface.vue
src/views/VaultView.vue
src/lib/__tests__/markdownResources.test.ts
e2e/markdown-extensions-md-ext-6.spec.ts
```

No dependency, `server/paths.ts`, Shiki transformer, FenceMeta, container,
code-group, or PDF implementation change was required.

## 3. Resource boundary

### 3.1 Client/server contract

The client sends only:

```text
GET /api/markdown-resources?kind=<snippet|include|image>&path=<canonical-path>
```

The route is mounted in `server/index.ts` after the existing `/api/*`
`authBoundary`, so unauthenticated requests are rejected before the resource
handler. The route returns UTF-8 text as JSON and approved images as bytes with
their extension-derived MIME type. It sets `Cache-Control: no-store` and
`X-Content-Type-Options: nosniff`. All public failures use the generic message
`Unable to load Markdown resource.` and do not disclose host paths or stacks.

The client uses the existing `authFetch` path and passes the render
`AbortSignal` through to the request.

### 3.2 Logical versus physical paths

Author references are resolved in `src/lib/markdownResources.ts` first:

```text
author reference
    ↓
logical source-relative resolution
    ↓
canonical vault-relative path
    ↓
authenticated server request
    ↓
server canonical validation
    ↓
server/paths.ts physical safe read
```

For example:

```text
source:    guides/java/index.md
reference: ../shared/demo.ts
logical:   guides/shared/demo.ts
physical:  guides/shared/demo.ts
```

`./` and `../` are accepted only by the logical resolver. The canonical result
has no dot segments and must remain inside the configured resource root. The
physical server validator rejects empty segments, `.`, `..`, backslashes,
absolute paths, URI schemes, NUL/control characters, hidden path segments, and
invalid characters before calling the existing strict `readSafeRelativeFile()`
helper. `server/paths.ts` itself was not weakened and never receives raw
traversal syntax.

The following are rejected without a read:

```text
../../../etc/passwd
/Users/name/.ssh/id_rsa
C:\Users\name\secret.txt
file:///etc/passwd
https://example.com/file.ts
```

The server retains the existing symlink/no-follow/inode/race protections of
`readSafeRelativeFile()`.

## 4. File type, encoding, and size policy

Includes accept only `.md`. Snippets accept only the approved source/text
extensions:

```text
.ts .tsx .js .jsx .mjs .cjs .vue .css .scss .less .html .xml
.json .yaml .yml .toml .sql .py .java .go .rs .rb .php .sh .bash
.zsh .fish .c .h .cc .cpp .hh .hpp .cs .kt .kts .swift .dart
.lua .r .txt
```

Extensionless and unlisted snippet files are rejected. Images accept only
`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, and `.avif`; SVG and remote images
are not part of this phase. The implementation bounds an image read at 4 MiB.

The exact text limits are:

| Resource | Maximum |
| --- | ---: |
| Snippet bytes after selection | 256 KiB |
| Include bytes before recursive expansion | 512 KiB |
| Expanded Markdown per render | 2 MiB |
| Include depth | 8 |
| Selected line number | 100000 |

Text resources are decoded as fatal UTF-8. NUL/control-containing or invalid
UTF-8 content is rejected rather than decoded lossily. Binary, unsupported, or
oversized resources produce a safe local placeholder in Markdown expansion or
a generic API error at the server boundary.

## 5. Directive and selection contract

Supported examples are:

```markdown
<<< @/examples/demo.ts
<<< @/examples/demo.ts{2,4-6 ts:line-numbers} [demo]
<<< @/examples/demo.ts#region
<!--@include: ./parts/details.md-->
<!--@include: ./parts/basics.md{3,}-->
<!--@include: ./parts/basics.md#basic-usage-->
```

Snippet metadata is converted to an ordinary fenced code block, using an
allowlisted inferred or explicit language and the existing FenceMeta/Shiki
path. Selected ranges are positive, inclusive, bounded integers; open-ended
ranges such as `3,` are supported. Invalid, reversed, zero, negative,
non-numeric, or excessive ranges fail locally without throwing the document
render.

Named regions use the supported `#region`/`#endregion` marker forms for the
common `//`, `#`, `/*`, and `<!--` comment styles. Matching regions are selected
without returning marker lines. Repeated matching regions are concatenated;
malformed or missing regions produce the generic placeholder. Heading/section
extraction is not implemented in this phase.

Snippet source is literal code and does not recursively parse Markdown. Include
content is Markdown and recursively expands nested include directives.

## 6. Expansion order and opaque syntax

The final render flow is:

```text
raw Markdown
    ↓
expandMarkdownResources()
    ↓
expanded Markdown + flattened source-path map
    ↓
MarkdownIt discovery parse
    ↓
prepareShikiLanguages()
    ↓
fresh final render environment
    ↓
MarkdownIt render
    ↓
DOMPurify
    ↓
reader/PDF surface
```

Expansion therefore happens before fence discovery, so snippets introduced by
an include participate in normal Shiki language preparation. The resource
scanner uses MarkdownIt's existing parse information to keep fenced code,
indented code, and multi-line raw HTML opaque. The approved standalone include
HTML comment is expanded only when it is its own one-line Markdown directive;
directives appearing inside code or a larger raw HTML block remain literal.

No second Markdown parser, highlighter, or renderer was introduced.

## 7. Per-render state, cache, limits, and cancellation

Each `expandMarkdownResources()` call owns its own:

```text
resource cache: canonical kind/path → pending Promise
include stack: canonical paths for cycle detection
expanded-byte counter
source-path map
AbortSignal
```

Repeated requests in one render share the pending resource read. Concurrent
renders do not share cache, source path, include stack, or visible error state.
Cycles, depth overflow, per-resource limits, and final expansion overflow are
caught at the directive boundary and become the safe
`markdown-resource-error` placeholder. The error is local; unrelated Markdown
continues to render.

`useMarkdownRender` creates an `AbortController` per reactive render and aborts
the controller on cleanup. Abort errors are propagated as cancellation rather
than converted into content, so stale work cannot replace a newer document.

## 8. Source context and existing Markdown features

The expansion result carries one source identity per flattened Markdown line.
Included lines use the included file's canonical path; root lines retain the
caller context. The final WikiLink/link renderer consumes this map so nested
links resolve relative to the included source rather than the including note.

Relative local Markdown images are rewritten to the authenticated image route
using the same source context. Existing external-link policy, lazy image
loading, custom anchors/TOC, callouts, containers, code groups, math, Mermaid,
MarkMap, and Shiki all remain on their existing paths.

The browser evidence covers an included heading in `[[toc]]`, a source-relative
Markdown link, an included Python snippet, and an included code group. The
included source context is observed by the resolver as `docs/parts.md`.

## 9. PDF contract

`PdfExportSurface` receives the source path for the export request, so the
article HTML is fully expanded before PDF preparation. `preparePdfArticleHtml()`
and `downloadPdfDocument()` consume the settled HTML only:

```text
PDF clone/preparation
→ no resource resolver call
→ no Markdown re-expansion
→ no Shiki re-tokenization
→ no filesystem/resource reread
```

The focused PDF browser evidence renders an included code group, selects the
second reader tab, records three resource reads before preparation, and observes
the same read count after preparation/download. Both grouped panels and included
snippet content remain present, while the live article HTML remains unchanged.

## 10. Security evidence

- No remote URL, SSRF, browser filesystem, arbitrary filesystem, or generic file
  download semantics are exposed.
- Logical `../` is normalized only inside the configured logical root; the
  physical safe reader still rejects raw dot segments.
- Server reads remain behind authentication and preserve symlink/race checks.
- Text is allowlisted and fatal UTF-8; binary and invalid encoding are rejected.
- Resource error output is a fixed safe class/message and does not include the
  requested host path or stack.
- Expanded Markdown remains ordinary untrusted Markdown and passes the existing
  DOMPurify configuration. No sanitizer delta, `style` exception, wildcard
  attribute, or resource HTML trust was added.
- Snippet code is fenced/escaped through the existing renderer and cannot become
  raw HTML merely because it came from a file.

The server route tests cover auth, valid UTF-8, traversal, unsupported types,
invalid/binary content, image MIME/bytes, and symlink rejection. Client tests
cover protocol/absolute/path escape rejection, malformed directives, cycles,
generic placeholders, and cancellation.

## 11. Validation evidence

### Focused unit tests

The final focused resource/Markdown/server run was:

```text
./node_modules/.bin/vitest run \
  src/lib/__tests__/markdownResources.test.ts \
  src/lib/__tests__/markdown.test.ts \
  server/routes/markdownResources.test.ts
→ PASS: 3 files, 81 tests
```

The existing Markdown/WikiLink compatibility run was:

```text
./node_modules/.bin/vitest run \
  src/lib/__tests__/markdown.test.ts \
  src/lib/__tests__/wikiLinks.test.ts
→ PASS: 2 files, 91 tests
```

The resource tests prove logical normalization, ranges/open-ended ranges,
opaque fences/indented blocks, nested expansion/cache, named regions, final
Shiki discovery, source-aware links/images/WikiLinks, cycle/malformed fallback,
and AbortSignal propagation.

### Typecheck and build

```text
npm run typecheck
→ PASS: client and server TypeScript checks

npm run build
→ PASS: 3936 modules transformed
```

The build retains the repository's existing Rolldown invalid-annotation and
large-chunk warnings; no new warning class or dependency was introduced.

### Full unit suite

```text
npm run test:unit
→ BASELINE-LIMITED
→ 214 test files passed, 3 failed
→ 3187 tests passed, 21 failed, 2 skipped
```

The 21 failures are the pre-existing environment limitations: 19 OpenAI HTTP
loopback `listen EPERM` failures and the Round-15/Round-16 `tsx` IPC pipe
`listen EPERM` failures. No Markdown, resource, client, Shiki, callout, or PDF
product regression was observed.

### Browser/PDF

The focused MD-EXT-6 Playwright spec covers reader expansion/source context and
settled-HTML PDF/no-reread behavior. It has two passing tests in the available
Chromium environment. The first sandbox attempt could not start the dev server
because of the environment's loopback `listen EPERM`; the approved rerun with
the required browser-server permission passed.

## 12. Rollback and next phase

The phase is independently revertible by removing the resource client/service,
route mount, expansion/source-context forwarding, focused tests, and evidence.
MD-EXT-1 through MD-EXT-5, the existing `posts` API, and the strict physical
path helpers remain independent.

MD-EXT-7 is not started. It is the later full regression, bundle audit, and
release gate; no resource feature is being added there by this phase.
