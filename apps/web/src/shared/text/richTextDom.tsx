import type { StructuredMentionInput } from '@lankadws/contracts'
import { renderToStaticMarkup } from 'react-dom/server'
import { FormattedContent } from './FormattedText'

export function editorMarkup(body: string, mentions: StructuredMentionInput[]) {
  if (!body) return ''
  return renderToStaticMarkup(<FormattedContent body={body} renderText={(value, offset) => {
    let cursor = 0
    const pieces = []
    for (const mention of mentions.filter((item) => item.start >= offset && item.end <= offset + value.length).toSorted((a, b) => a.start - b.start)) {
      const start = mention.start - offset
      if (start < cursor) continue
      pieces.push(value.slice(cursor, start))
      pieces.push(<span key={start} data-mention-id={mention.userId} data-mention-label={mention.label} className="structured-mention">{value.slice(start, mention.end - offset)}</span>)
      cursor = mention.end - offset
    }
    pieces.push(value.slice(cursor))
    return <>{pieces}</>
  }} />)
}

export function safeEditorLink(href: string) {
  return /^(https?:\/\/|\/(?!\/))/i.test(href) && !href.includes('\\') && ![...href].some((character) => character.charCodeAt(0) <= 32)
}

// The transport remains Markdown. DOM text positions are mapped to transport
// offsets so mentions retain their identity when a formatting command adds tags.
export function readEditor(root: HTMLElement) {
  let body = ''
  const mentions: StructuredMentionInput[] = []
  const points: { node: Node; domOffset: number; offset: number }[] = []
  let quote = ''
  let plainTextDepth = 0
  function boundary(node: Node, domOffset: number) { points.push({ node, domOffset, offset: body.length }) }
  function beginLine(prefix = '') {
    if (body && !body.endsWith('\n')) body += '\n'
    body += quote + prefix
  }
  function children(node: Node) {
    boundary(node, 0)
    node.childNodes.forEach((child, index) => { visit(child); boundary(node, index + 1) })
  }
  function visit(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = (node.textContent ?? '').replaceAll('\u00a0', ' ')
      for (let index = 0; index < value.length; index += 1) {
        points.push({ node, domOffset: index, offset: body.length })
        const character = value[index]!
        body += !plainTextDepth && /[\\*~`[\]#>.-]/.test(character) ? `\\${character}` : character
      }
      points.push({ node, domOffset: value.length, offset: body.length })
      return
    }
    if (!(node instanceof HTMLElement)) return
    const tag = node.tagName
    if (tag === 'BR') { body += '\n'; return }
    if (tag === 'PRE') {
      beginLine('```\n')
      // Code is plain text, including its line breaks.
      plainTextDepth += 1
      children(node)
      plainTextDepth -= 1
      if (!body.endsWith('\n')) body += '\n'
      body += '```\n'
      return
    }
    if (tag === 'UL' || tag === 'OL') {
      if (body && !body.endsWith('\n')) body += '\n'
      let number = 1
      node.childNodes.forEach((child) => {
        if (child instanceof HTMLElement && child.tagName === 'LI') {
          beginLine(tag === 'OL' ? `${number++}. ` : '- ')
          children(child)
          if (!body.endsWith('\n')) body += '\n'
        }
      })
      return
    }
    if (tag === 'BLOCKQUOTE') {
      const previous = quote
      quote += '> '
      if (![...node.children].some((child) => ['P', 'DIV'].includes(child.tagName))) beginLine()
      children(node)
      if (!body.endsWith('\n')) body += '\n'
      quote = previous
      return
    }
    const block = ['P', 'DIV', 'H2', 'H3', 'H4'].includes(tag)
    if (block) {
      if (!node.classList.contains('formatted-text__space')) beginLine(/^H[234]$/.test(tag) ? `${'#'.repeat(Number(tag.slice(1)) - 1)} ` : '')
      children(node)
      // A single BR is the browser's empty paragraph placeholder.
      if (!(node.childNodes.length === 1 && node.firstChild instanceof HTMLElement && node.firstChild.tagName === 'BR')) body += '\n'
      return
    }
    let marker = ''
    if (tag === 'B' || tag === 'STRONG' || node.style.fontWeight === 'bold' || Number(node.style.fontWeight) >= 600) marker = '**'
    else if (tag === 'I' || tag === 'EM' || node.style.fontStyle === 'italic') marker = '*'
    else if (['S', 'STRIKE', 'DEL'].includes(tag) || node.style.textDecoration.includes('line-through')) marker = '~~'
    else if (tag === 'CODE' && node.parentElement?.tagName !== 'PRE') marker = '`'
    if (!node.textContent) marker = ''
    const href = tag === 'A' ? node.getAttribute('href') ?? '' : ''
    const link = href && safeEditorLink(href)
    body += link ? '[' : marker
    const start = body.length
    const plain = tag === 'CODE' || Boolean(node.dataset.mentionId)
    if (plain) plainTextDepth += 1
    children(node)
    if (plain) plainTextDepth -= 1
    const end = body.length
    const label = node.dataset.mentionLabel
    const mentionStart = label ? body.indexOf(`@${label}`, start) : -1
    if (node.dataset.mentionId && label && node.textContent === `@${label}` && mentionStart >= start && mentionStart + label.length + 1 <= end) {
      mentions.push({ userId: node.dataset.mentionId, label, start: mentionStart, end: mentionStart + label.length + 1 })
    }
    body += link ? `](${href})` : marker
  }
  children(root)
  if (body.endsWith('\n')) body = body.slice(0, -1)
  if (!root.textContent) body = ''
  const selection = root.ownerDocument.getSelection()
  const range = selection?.rangeCount ? selection.getRangeAt(0) : null
  const locate = (node: Node, offset: number) => points.find((point) => point.node === node && point.domOffset === offset)?.offset ?? body.length
  const start = range && root.contains(range.startContainer) ? Math.min(locate(range.startContainer, range.startOffset), body.length) : body.length
  const end = range && root.contains(range.endContainer) ? Math.min(locate(range.endContainer, range.endOffset), body.length) : body.length
  return { body, mentions, start, end, points }
}

export function selectEditorRange(root: HTMLElement, start: number, end = start) {
  const points = readEditor(root).points.filter((point) => point.node.nodeType === Node.TEXT_NODE)
  const closest = (offset: number) => points.reduce<typeof points[number] | undefined>((best, point) => !best || Math.abs(point.offset - offset) < Math.abs(best.offset - offset) ? point : best, undefined)
  const from = closest(start)
  const to = closest(end)
  root.focus()
  if (!from || !to) return
  const range = root.ownerDocument.createRange()
  range.setStart(from.node, from.domOffset)
  range.setEnd(to.node, to.domOffset)
  const selection = root.ownerDocument.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}
