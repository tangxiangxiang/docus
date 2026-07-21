/**
 * Per-capture path projections for the AI panel (Edit-10.2).
 *
 * Two deliberately separate helpers — never one ambiguous one:
 *
 * - `legacyTransportPathForCapture` decides which path (if any) may
 *   travel to the path-only server while the full live-context
 *   transport does not exist yet (that is Edit-10.3). Only a live
 *   Document context can honestly claim a current file path. Every
 *   other case fails closed with `undefined`: a History path points at
 *   current disk rather than the historical body; a Diff cannot be
 *   expressed as one current file (before/after); a Recovery draft
 *   lives in the browser and has no server path at all.
 *
 * - `displayPathForCapture` decides what the composer/chat header chip
 *   shows. Any ready context kind has an identity path worth showing;
 *   none / unavailable show nothing.
 */
import type { AiLiveContextCapture } from '../../composables/vault/aiLiveContext'

export function legacyTransportPathForCapture(
  capture: AiLiveContextCapture,
): string | undefined {
  if (capture.status === 'ready' && capture.context.kind === 'document') {
    return capture.context.identity.path
  }
  return undefined
}

export function displayPathForCapture(capture: AiLiveContextCapture): string | null {
  if (capture.status !== 'ready') return null
  return capture.context.identity.path
}
