import type { HiddenContentMarker } from '@lankadws/contracts'
import { formatDateTime } from './format'
import { personName } from './personName'

/** «Видалено 18.11.2026, 10:30 · Ім’я» — who hid a record and when, for the administrator views. */
export function hiddenContentLabel(marker: HiddenContentMarker, verb: string): string {
  const who = marker.hiddenBy ? ` · ${personName(marker.hiddenBy.displayName)}` : ''
  return `${verb} ${formatDateTime(marker.hiddenAt)}${who}`
}
