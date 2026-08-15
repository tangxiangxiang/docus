import { createApp, h, ref } from 'vue'
import TagManagementDialog from '../src/components/vault/TagManagementDialog.vue'
import {
  listManagedTags,
  type TagOperationApplyResult,
} from '../src/lib/tag-management-api'
import {
  reconcileTagSelection,
  type TagSelectionSnapshot,
} from '../src/lib/tag-selection-reconciliation'

type TagManagementHarness = {
  app: ReturnType<typeof createApp>
  host: HTMLElement
}

declare global {
  interface Window {
    __t2TagManagementHarness?: TagManagementHarness
  }
}

/** Test-only mount for the still-hidden T2-3 dialog. */
export function mountTagManagementHarness(): void {
  const selectedTag = ref('Java')
  const selectionEpoch = ref(0)
  const open = ref(true)
  const syncAfterCommit = async (
    result: TagOperationApplyResult,
    snapshot: TagSelectionSnapshot,
  ) => {
    const [, managedTags] = await Promise.all([
      fetch('/api/posts'),
      listManagedTags(),
    ])
    const finalSelectedTag = reconcileTagSelection({
      snapshot,
      currentSelectedTag: selectedTag.value,
      currentSelectionEpoch: selectionEpoch.value,
      operation: result.operation,
      result,
      managedTags,
    })
    selectedTag.value = finalSelectedTag
    return { managedTags, selectedTag: finalSelectedTag }
  }
  const host = document.createElement('div')
  host.id = 't2-3-tag-management-harness'
  document.body.append(host)
  const app = createApp({
    setup() {
      return { open, selectedTag, selectionEpoch, syncAfterCommit }
    },
    render() {
      return h(TagManagementDialog, {
        open: this.open,
        selectedTag: this.selectedTag,
        selectionEpoch: this.selectionEpoch,
        syncAfterCommit: this.syncAfterCommit,
        onClose: () => { open.value = false },
      })
    },
  })
  app.mount(host)
  window.__t2TagManagementHarness = { app, host }
}

export function unmountTagManagementHarness(): void {
  window.__t2TagManagementHarness?.app.unmount()
  window.__t2TagManagementHarness?.host.remove()
  delete window.__t2TagManagementHarness
}
