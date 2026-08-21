---
title: PDF Pagination Regression
---

# PDF Paragraph Pagination Regression

H6_PAGINATION_BEGIN

This deterministic paragraph is part of the pagination calibration content. It keeps the document close to a real note while giving the target block a stable position before the printable page boundary.

H6_FILLER_01 — 中文 English 日本語 and a fixed line of text keep the page-boundary regression independent of random content.

H6_FILLER_02 — The same stable content is repeated so the target paragraph approaches the bottom of an A4 printable page.

H6_FILLER_03 — Ordinary paragraphs must remain intact when html2pdf prepares the page slices.

H6_FILLER_04 — This paragraph is intentionally deterministic and contains no generated height or timestamp.

H6_FILLER_05 — The target below must move as one short textual block when the remaining page space is insufficient.

H6_FILLER_06 — This final calibration paragraph brings the target heading close to the next A4 page boundary.

H6_FILLER_07 — The calibration remains ordinary Markdown so it exercises the same renderer as user notes.

H6_FILLER_08 — No fixed height, hidden overflow, or test-only production class is used.

H6_FILLER_09 — The target must begin inside the final line-height window of the printable page.

H6_FILLER_10 — A correct exporter moves that complete paragraph instead of slicing its glyphs.

## H6_TARGET_HEADING

H6_TARGET_PARAGRAPH_BEGIN 这是一个用于验证 PDF 分页的普通段落。This paragraph must remain intact across the page boundary. 这里包含中文 English 日本語，确保字体和 line box 都被覆盖。The final fixed sentence keeps the marker easy to find in the generated PDF. H6_TARGET_PARAGRAPH_END

H6_AFTER_TARGET

This second paragraph proves that heading grouping is limited to the first meaningful content block rather than wrapping the whole section.

## H6_LIST_HEADING

- H6_LIST_ITEM_001 — short list items keep their own line boxes together.
- H6_LIST_ITEM_002 — 中文 English 日本語 remain ordinary rendered list content.
- H6_LIST_ITEM_003 — the list is not protected as one unbounded block.

H6_PAGINATION_END
