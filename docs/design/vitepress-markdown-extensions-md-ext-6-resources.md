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
| Original MD-EXT-6 implementation commit | `0ce35f1b2b838c590e92a435846de5a1ac770b42` |
| MD-EXT-6 range/budget/context/PDF follow-up commit | `7ee123c546f3c137dd455922b76a02b64c29349b` |
| MD-EXT-6 code-span/PDF fail-closed follow-up commit | `5be97ef4ce6fa124009c5d3152a3f6a97b3fe772` |
| MD-EXT-6 inline-block ownership closure commit | `30584cf548f152108849034cbeff77ba47eeedc0` |
| MD-EXT-6 same-content ownership follow-up commit | Recorded in the final handoff after this document is committed |
| Next phase | MD-EXT-7 — NOT STARTED |

This document records the implementation and verification evidence for MD-EXT-6,
including the range, expansion-budget, source-context, and PDF local-image
boundary follow-up plus the code-span ownership follow-ups. The current
same-content ownership follow-up remains review-ready; no MD-EXT-7 work is
included.

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

No dependency, `server/paths.ts`, Shiki transformer, FenceMeta, container, or
code-group change was required. The review follow-up added a narrow
`src/lib/pdfExport.ts` clone/export boundary only after real browser evidence
showed that html2canvas could otherwise request a settled local resource image
again; no server/resource-route change was made.

The code-span/PDF fail-closed review follow-up changed or extended:

```text
src/lib/markdownResources.ts
src/lib/markdownInlineSource.ts
src/lib/wikiLinks.ts
src/lib/pdfExport.ts
src/lib/__tests__/markdownResources.test.ts
e2e/markdown-extensions-md-ext-6.spec.ts
docs/design/vitepress-markdown-extensions-md-ext-6-resources.md
docs/design/vitepress-markdown-extensions-implementation-plan.md
```

This same-content inline-ownership follow-up changes only the following
client/helper/test/evidence surfaces:

```text
src/lib/markdownInlineSource.ts
src/lib/markdownResources.ts
src/lib/wikiLinks.ts
src/lib/__tests__/markdownInlineSource.test.ts
src/lib/__tests__/markdownResources.test.ts
src/lib/__tests__/wikiLinks.test.ts
docs/design/vitepress-markdown-extensions-md-ext-6-resources.md
docs/design/vitepress-markdown-extensions-implementation-plan.md
```

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
ranges such as `3,` are supported. The internal representation distinguishes
single-line, closed, and open-ended ranges:

```text
{2}   → { start: 2, end: 2 }   → line 2 only
{2-4} → { start: 2, end: 4 }   → lines 2..4
{3,}  → { start: 3 }           → line 3..EOF
```

Invalid, reversed, zero, negative, non-numeric, `3-`, or excessive ranges fail
locally without throwing the document render. The same semantics apply to
snippets and Markdown includes.

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
scanner uses MarkdownIt's existing block parse to keep fenced code, indented
code, and multi-line raw HTML opaque. For each actual `inline` token, the same
narrow source-position helper receives that token's `content` and the complete
MarkdownIt child sequence. It advances a monotonic raw-source cursor through
exact-source non-code children, especially `html_inline`, before matching a
later `code_inline`; known non-code ranges also block candidate overlap. Marker
length and normalized content remain only verification, not identity. Therefore
same-content backticks in an HTML attribute cannot impersonate a later real code
span. The helper mirrors the installed backtick delimiter/content-normalization
rule and never pairs backticks across paragraphs or other inline blocks.
Standalone-looking `<<<` slices inside one-line or multi-line real code spans
remain literal, including variable-length backtick spans and malformed resource
syntax; malformed include-comment lookalikes remain literal under the existing
raw-HTML safety path. A valid standalone include HTML comment retains its
approved one-line directive behavior, and an unmatched backtick in another
paragraph cannot suppress a real directive there.

No second Markdown parser, highlighter, or renderer was introduced.

## 7. Per-render state, cache, limits, and cancellation

Each `expandMarkdownResources()` call owns its own:

```text
resource cache: canonical kind/path → pending Promise
include stack: canonical paths for cycle detection
expanded-byte counter (UTF-8 bytes of the exact final flattened Markdown,
including every inserted `\n` separator)
emitted line count for separator accounting
source-path map
AbortSignal
```

Repeated requests in one render share the pending resource read. Concurrent
renders do not share cache, source path, include stack, or visible error state.
Cycles, depth overflow, per-resource limits, and final expansion overflow are
caught at the directive boundary and become the safe
`markdown-resource-error` placeholder. The error is local; unrelated Markdown
continues to render. Every expansion insertion is charged even when the
canonical resource content is served from the per-render cache; cache hits
avoid reads but do not make expansion free. Failed local directives restore
both the byte counter and emitted-line count before the placeholder is charged.
Expansion rejects before the tracked total exceeds 2 MiB and performs a final
defensive check that the actual UTF-8 byte length of
`lines.map(({ text }) => text).join('\n')` matches the tracked total and remains
within the limit.

`useMarkdownRender` creates an `AbortController` per reactive render and aborts
the controller on cleanup. Abort errors are propagated as cancellation rather
than converted into content, so stale work cannot replace a newer document.

## 8. Source context and existing Markdown features

The expansion result carries one source identity per flattened Markdown line.
Included lines use the included file's canonical path; root lines retain the
caller context. The final WikiLink/link renderer consumes this map so nested
links resolve relative to the included source rather than the including note.
When MarkdownIt merges root/include/root lines into one inline token, the
renderer walks inline children in source order. Each child receives the path
for its current flattened line; only after assigning metadata to a
`softbreak`/`hardbreak` does the cursor advance, so the break belongs to the
preceding line and the first child after it uses the next source identity. The
shared helper is called with that inline block's complete actual children.
Exact `html_inline` source ranges are consumed before later `code_inline`
matching, so raw backticks in an HTML attribute cannot discard or impersonate a
valid later code span. A multi-line `code_inline` child advances by the exact
number of raw source line endings in its located span, rather than by normalized
rendered content.
There is no module-global source cursor, whole-document backtick scan, or
second full inline parser.

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
second reader tab, records three text resource reads before preparation, and
observes the same resolver read count after preparation/download. Both grouped
panels and included snippet content remain present, while the live article HTML
remains unchanged.

The follow-up also uses an authenticated local `.png` in the controlled test
vault and observes real browser traffic to
`/api/markdown-resources?kind=image`. The settled reader surface makes one
initial image request; the combined `preparePdfArticleHtml()` plus real PDF
download phase makes zero additional image endpoint requests. The narrow
export-only fix avoids cloning the endpoint URL first, materializes an already
settled same-origin local image in the PDF clone, and tells html2canvas to
ignore live reader article roots outside the export root. It does not fetch the
image again, rerender Markdown, reread the filesystem, or mutate the live reader.
If local-image snapshotting fails, the fresh PDF clone deliberately omits the
local `src`, `srcset`, and `sizes` attributes rather than restoring the
authenticated endpoint URL. The live reader retains its original source,
remote/raw images keep their existing clone behavior, and the forced-failure
browser proof also observes zero PDF-phase resource requests.

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

### Review follow-up validation

The focused client regression run after the follow-up was:

```text
./node_modules/.bin/vitest run \
  src/lib/__tests__/markdownResources.test.ts \
  src/lib/__tests__/markdown.test.ts \
  src/lib/__tests__/wikiLinks.test.ts \
  src/lib/__tests__/markdownCodeGroups.test.ts \
  src/lib/__tests__/shiki.test.ts \
  src/composables/vault/__tests__/useMarkdownRender.test.ts \
  src/lib/__tests__/pdfExport.test.ts \
  src/lib/__tests__/pdf-readiness.test.ts
→ PASS: 8 files, 204 tests
```

The focused server safety run was:

```text
./node_modules/.bin/vitest run \
  server/routes/markdownResources.test.ts \
  server/__tests__/paths.test.ts
→ PASS: 2 files, 45 tests
```

The final range/expansion tests prove `{2}` selects line 2 only, `{2-4}` is
inclusive, `{2,4-6}` has no accidental EOF tail, `{3,}` reaches EOF, and `3-`
is rejected. The exact final UTF-8 byte boundary accepts exactly 2 MiB,
rejects one byte over, and counts separator bytes when the same cached include
is inserted repeatedly. The merged-paragraph test records the resolver trace:

```text
root-before → docs/root.md
included    → docs/part.md
included-wiki → docs/part.md
root-after  → docs/root.md
```

The final code-span/source-context follow-up additionally proves one-line,
multi-line, and variable-length-backtick real `code_inline` spans keep valid and
malformed snippet-looking directives literal before resource parsing. Malformed
include-comment lookalikes remain literal under the existing raw-HTML ownership
path, while valid directives in separate MarkdownIt blocks still expand. It
also proves that unrelated raw backticks in an `html_inline` child do not erase
the real later `code_inline` source range. Both include→root and root→include
merged paragraphs assign links, WikiLinks, and images to the source line that
actually follows the multi-line code span. The focused PDF unit regression
proves a settled local image with a forced canvas snapshot failure produces no
endpoint URL in prepared HTML and does not mutate the live image.

The previous inline-block ownership closure focused run was:

```text
./node_modules/.bin/vitest run \
  src/lib/__tests__/markdownInlineSource.test.ts \
  src/lib/__tests__/markdownResources.test.ts \
  src/lib/__tests__/markdown.test.ts \
  src/lib/__tests__/wikiLinks.test.ts \
  src/lib/__tests__/pdfExport.test.ts \
  src/lib/__tests__/pdf-readiness.test.ts
→ PASS: 6 files, 162 tests
```

The same-content ownership follow-up adds direct helper, resource, and
source-context regressions for identical raw backticks in `html_inline` and a
later real `code_inline`. It also verifies that the installed MarkdownIt
backtick rule's delimiter scan and normalization are mirrored without a
separate backslash-escape test in the helper; escape handling remains owned by
MarkdownIt's normal inline rule sequence. The package declares `markdown-it`
`^14.1.0`; the current lockfile/node_modules resolve `14.2.0`, whose inspected
`backticks.mjs` rule has the same relevant behavior.

The final same-content ownership focused run was:

```text
./node_modules/.bin/vitest run \
  src/lib/__tests__/markdownInlineSource.test.ts \
  src/lib/__tests__/markdownResources.test.ts \
  src/lib/__tests__/markdown.test.ts \
  src/lib/__tests__/wikiLinks.test.ts \
  src/lib/__tests__/pdfExport.test.ts \
  src/lib/__tests__/pdf-readiness.test.ts
→ PASS: 6 files, 170 tests
```

The final focused MD-EXT-6 Playwright spec covers reader expansion/source context
and settled-HTML PDF/no-reread behavior with four passing tests, including the
forced snapshot-failure proof. The cross-phase MD-EXT-3 through MD-EXT-6 run
passed 11 tests. The PDF Shiki/general/layout/pagination/stress run passed 12
tests. The normal and forced-failure local-image cases each observed one initial
image request and zero additional requests during PDF preparation/download; the
forced-failure case also proved prepared HTML omitted the endpoint URL and the
live reader source remained unchanged.

### Typecheck and build

```text
npm run typecheck
→ PASS: client and server TypeScript checks

npm run build
→ PASS: 3937 modules transformed
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

The final follow-up full-unit rerun reported:

```text
→ BASELINE-LIMITED
→ 214 test files passed, 3 failed
→ 3198 tests passed, 21 failed, 2 skipped
```

The same 19 OpenAI HTTP loopback and Round-15/Round-16 `tsx` IPC `EPERM`
limitations remained; no new Markdown/resource/source-context/PDF regression
appeared.

This inline-ownership closure rerun reported:

```text
→ BASELINE-LIMITED
→ 215 test files passed, 3 failed
→ 3204 tests passed, 21 failed, 2 skipped
```

The additional passing tests are the direct inline-source, malformed-directive,
cross-block, and raw-backtick-mismatch regressions; the same 19 OpenAI HTTP
loopback and Round-15/Round-16 `tsx` IPC `EPERM` limitations remained.

This same-content ownership follow-up full-unit rerun reported:

```text
→ BASELINE-LIMITED
→ 215 test files passed, 3 failed
→ 3212 tests passed, 21 failed, 2 skipped
```

The 21 failures are the same known loopback/`tsx` IPC `EPERM` limitations; no
new Markdown, resource, WikiLink, PDF, or client regression appeared.

### Browser/PDF

The focused MD-EXT-6 Playwright spec covers reader expansion/source context and
settled-HTML PDF/no-reread behavior. It has four passing tests in the available
Chromium environment, including the authenticated local-image request proof and
the forced snapshot-failure proof.
The first sandbox attempt could not start the dev server because of the
environment's loopback `listen EPERM`; the approved rerun with the required
browser-server permission passed.

The historical full-unit evidence above remains unchanged. The final follow-up
rerun is recorded above with `3198` passing tests; the same known environment
limitations remained and no new product failure appeared.

## 12. Rollback and next phase

The phase is independently revertible by removing the resource client/service,
route mount, expansion/source-context forwarding, focused tests, and evidence.
MD-EXT-1 through MD-EXT-5, the existing `posts` API, and the strict physical
path helpers remain independent.

MD-EXT-7 is not started. It is the later full regression, bundle audit, and
release gate; no resource feature is being added there by this phase.
