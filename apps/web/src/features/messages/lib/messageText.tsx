import { Fragment, type ReactNode } from 'react'

const apostrophes = /[\u0060\u00b4\u02bc\u2018\u2019\u201b\u2032\uff07]/gu

export function normalizeMessageSearch(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .replace(/\s+/gu, ' ')
    .toLocaleLowerCase('uk-UA')
    .replace(apostrophes, "'")
}

export function normalizedCodePointLength(value: string): number {
  return [...normalizeMessageSearch(value)].length
}

export function highlightNormalizedText(text: string, query: string): ReactNode {
  const normalizedQuery = normalizeMessageSearch(query)
  if (!normalizedQuery) return text
  const graphemes = [...new Intl.Segmenter('uk-UA', { granularity: 'grapheme' }).segment(text)]
  let normalized = ''
  const positions: number[] = []
  for (const [index, segment] of graphemes.entries()) {
    const value = normalizeMessageSearch(segment.segment)
    for (const _point of value) positions.push(index)
    normalized += value
  }
  const start = normalized.indexOf(normalizedQuery)
  if (start < 0) return text
  const end = start + [...normalizedQuery].length - 1
  const sourceStart = positions[start] ?? 0
  const sourceEnd = (positions[end] ?? sourceStart) + 1
  const before = graphemes.slice(0, sourceStart).map((item) => item.segment).join('')
  const match = graphemes.slice(sourceStart, sourceEnd).map((item) => item.segment).join('')
  const after = graphemes.slice(sourceEnd).map((item) => item.segment).join('')
  return (
    <Fragment>
      {before}
      <mark>{match}</mark>
      {after}
    </Fragment>
  )
}
