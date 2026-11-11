import { cloneElement, useId, type ReactElement, type ReactNode } from 'react'

/**
 * Field = label + one control + optional hint + optional error, wired for assistive tech.
 *
 * It keeps the app's existing markup (`<label className>Text<control/></label>`), so adopting it
 * with only a label changes no DOM or visuals. The control (single child element) additionally
 * receives `aria-describedby` (hint and/or error ids) and `aria-invalid` (when `error` is set);
 * hint/error render as siblings of the label (outside the accessible name) and inherit its
 * `className` so grid helpers such as `span-2` keep applying. Use it in new or touched forms;
 * there is deliberately no mass migration of existing fields.
 */
export function Field({ label, hint, error, className, children }: {
  label: ReactNode
  hint?: ReactNode
  error?: ReactNode
  className?: string
  children: ReactElement<{ 'aria-describedby'?: string; 'aria-invalid'?: boolean | 'true' | 'false' }>
}) {
  const baseId = useId()
  const hintId = hint ? `${baseId}-hint` : undefined
  const errorId = error ? `${baseId}-error` : undefined
  const describedBy = [children.props['aria-describedby'], hintId, errorId].filter(Boolean).join(' ') || undefined
  const control = (hintId || errorId || error)
    ? cloneElement(children, { 'aria-describedby': describedBy, 'aria-invalid': error ? true : children.props['aria-invalid'] })
    : children
  return (
    <>
      <label className={className}>{label}{control}</label>
      {hint && <small id={hintId} className={className}>{hint}</small>}
      {error && <div id={errorId} className={className ? `${className} form-error` : 'form-error'} role="alert">{error}</div>}
    </>
  )
}
