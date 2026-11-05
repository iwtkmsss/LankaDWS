// Clicking a field's caption must not move focus into the field anywhere in the app.
// Only the field box itself (the control and a wrapper such as `.search-field` with its
// icon) activates it. Checkbox, radio and file inputs keep the native label behaviour:
// their caption is the expected click target, and upload buttons are styled labels.
const nativeLabelInputTypes = new Set(['checkbox', 'radio', 'file'])

export function shouldBlockLabelActivation(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  const label = target.closest('label')
  if (!label) return false
  const control = label.control
  if (!control) return false
  if (control instanceof HTMLInputElement && nativeLabelInputTypes.has(control.type)) return false
  if (control === target || control.contains(target)) return false
  const fieldBox = control.parentElement
  if (fieldBox && fieldBox !== label && label.contains(fieldBox) && fieldBox.contains(target)) return false
  return true
}

export function installLabelClickGuard(root: Document = document): () => void {
  const onClick = (event: MouseEvent) => {
    if (shouldBlockLabelActivation(event.target)) event.preventDefault()
  }
  root.addEventListener('click', onClick, true)
  return () => root.removeEventListener('click', onClick, true)
}
