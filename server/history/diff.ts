// Compatibility boundary for server callers. The pure algorithm lives in
// src/lib so browser comparisons and HTTP history routes use identical rules.
export { computeFileDiff } from '../../src/lib/file-diff.js'
export type { DiffOp, FileDiff } from '../../src/lib/history-api.js'
