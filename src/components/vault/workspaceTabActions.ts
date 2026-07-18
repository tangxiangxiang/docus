export interface ClipboardWriter {
  writeText(text: string): Promise<void>
}

function legacyCopyText(text: string, targetDocument: Document): boolean {
  const textarea = targetDocument.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  targetDocument.body.appendChild(textarea)
  textarea.select()
  try {
    return targetDocument.execCommand('copy')
  } catch {
    return false
  } finally {
    textarea.remove()
  }
}

export async function copyTextToClipboard(
  text: string,
  clipboard: ClipboardWriter | undefined = navigator.clipboard,
  targetDocument: Document = document,
): Promise<boolean> {
  try {
    if (clipboard?.writeText) {
      await clipboard.writeText(text)
      return true
    }
  } catch {
    // Try the dependency-free fallback below.
  }
  return legacyCopyText(text, targetDocument)
}
