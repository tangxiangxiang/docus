// Shared state for the AI panel's split-review surface. VaultView
// provides one instance; TreeRow (via FileTree → VaultView's
// splitCard) and the AI panel's /split slash command both mutate it.
//
// Why a composable: putting the ref in VaultView and passing it
// through defineProps / emit to AiPanel would force AiPanel to grow
// a new prop. The review state is logically the AI panel's, but
// the entry point is the tree (right-click). A small composable is
// the cheapest way to share state between the two entry points
// without coupling.
import { ref, computed, type Ref } from 'vue'
import type { Card, SplitMode } from '../../lib/ai-api'

export type SplitPhase =
  | { kind: 'idle' }
  | { kind: 'loading'; path: string; mode: SplitMode }
  | { kind: 'error'; reason: string }
  | { kind: 'review'; mode: SplitMode; cards: Card[] }

export type SplitReview = ReturnType<typeof useSplitReview>

export function useSplitReview() {
  // Single state machine value. The AI panel's body reads this to
  // decide whether to show the chat surface (idle / loading / error
  // renders the chat with a transient banner) or the review surface
  // (review renders the card list with edit/delete/write actions).
  const phase = ref<SplitPhase>({ kind: 'idle' }) as Ref<SplitPhase>

  // The cards the user is currently editing. When phase.kind ===
  // 'review', this is the same array the phase object holds (we
  // keep a ref so edits to individual fields are reactive). We
  // assign on transition to 'review' and clear on transition away.
  const cards = computed<Card[]>(() =>
    phase.value.kind === 'review' ? phase.value.cards : []
  )

  function setLoading(path: string, mode: SplitMode) {
    phase.value = { kind: 'loading', path, mode }
  }

  function setError(reason: string) {
    phase.value = { kind: 'error', reason }
  }

  function setReview(mode: SplitMode, initialCards: Card[]) {
    phase.value = { kind: 'review', mode, cards: initialCards.map((c) => ({ ...c })) }
  }

  function reset() {
    phase.value = { kind: 'idle' }
  }

  // The phase value is the only state that matters; the rest of
  // these helpers mutate the cards array in place (with .splice for
  // delete, .splice + push for add) so the AI panel can v-model
  // individual fields directly.

  return {
    phase,
    cards,
    setLoading,
    setError,
    setReview,
    reset,
  }
}