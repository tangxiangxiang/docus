import { ref } from 'vue'

/**
 * 极简 confirm:渲染一个原生 <dialog>-free 的居中模态,代替 window.confirm。
 * 用法:
 *   const { confirm } = useConfirm()
 *   if (await confirm('放弃修改?')) { ... }
 */
export interface ConfirmRequest {
  id: number
  message: string
  detail?: string
  resolve: (ok: boolean) => void
}

const queue = ref<ConfirmRequest[]>([])
let nextId = 1

export function useConfirm() {
  function confirm(message: string, detail?: string): Promise<boolean> {
    return new Promise((resolve) => {
      const id = nextId++
      queue.value = [...queue.value, { id, message, detail, resolve }]
    })
  }
  function answer(id: number, ok: boolean) {
    const req = queue.value.find((r) => r.id === id)
    if (!req) return
    queue.value = queue.value.filter((r) => r.id !== id)
    req.resolve(ok)
  }
  return { queue, confirm, answer }
}
