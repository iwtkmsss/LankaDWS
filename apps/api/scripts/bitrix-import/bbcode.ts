// Bitrix BBCode → LankaDWS text.
//
// `markdown` targets the small vocabulary rendered by apps/web/src/shared/text/FormattedText.tsx
// (tasks, task comments, feed posts and comments). Literal text is escaped exactly like the app's
// rich editor does (apps/web/src/shared/text/richTextDom.tsx), so it renders as written.
// `plain` targets surfaces that render raw text (chat messages, calendar, titles); employee mentions
// there become `@Name` with a structured mention range, as the chat composer stores them.

export type TextMode = 'markdown' | 'plain'

export interface MentionTarget {
  id: string
  name: string
}

export interface TextMention {
  userId: string
  start: number
  end: number
  label: string
}

export interface ConvertOptions {
  mode: TextMode
  /** Resolves a Bitrix user id from `[USER=id]` to an imported LankaDWS user. */
  resolveUser?: (bitrixUserId: number) => MentionTarget | undefined
  /** Text returned when nothing is left after conversion. */
  emptyPlaceholder?: string
  /** Rewrites a link target (e.g. Bitrix portal paths to LankaDWS routes). */
  rewriteHref?: (href: string) => string
}

export interface ConvertedText {
  text: string
  mentions: TextMention[]
  /** Number of file / image markers (files are migrated in a later stage). */
  files: number
}

export const FILE_MARKER_TEXT = '[файл]'
const IMAGE_LABEL = 'зображення'
const VIDEO_LABEL = 'відео'

type Node =
  | { kind: 'text'; value: string }
  | { kind: 'tag'; name: string; attr: string; children: Node[] }
  | { kind: 'void'; name: string; attr: string }
  | { kind: 'code'; raw: string }

const CONTAINER_TAGS = new Set([
  'B', 'I', 'U', 'S', 'URL', 'USER', 'QUOTE', 'LIST', 'IMG', 'VIDEO', 'SIZE', 'COLOR', 'FONT', 'BACKGROUND',
  'TABLE', 'TR', 'TD', 'TH', 'LEFT', 'CENTER', 'RIGHT', 'JUSTIFY', 'P', 'SPOILER', 'PROJECT', 'DEPARTMENT',
  'CHAT', 'SEND', 'PUT', 'CALL', 'PCH', 'CONTEXT', 'DIALOG', 'MENTION', 'BOT', 'H1', 'H2', 'H3', 'SUP', 'SUB',
])
const VOID_TAGS = new Set(['BR', 'HR', '*', 'DISK', 'DOCUMENT', 'FILE', 'ICON', 'ATTACH', 'TIMESTAMP'])
const FILE_VOID_TAGS = new Set(['DISK', 'DOCUMENT', 'FILE', 'ATTACH'])
const TAG_PATTERN = /\[(\/?)(\*|[A-Za-z][A-Za-z0-9_]*)((?:[= ][^[\]\n]*)?)\]/g

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', laquo: '«', raquo: '»', ndash: '–', mdash: '—',
  hellip: '…', copy: '©', reg: '®', trade: '™', bull: '•', middot: '·', lsquo: '‘', rsquo: '’', sbquo: '‚',
  ldquo: '“', rdquo: '”', bdquo: '„', euro: '€', deg: '°', times: '×', divide: '÷', plusmn: '±', sect: '§',
  para: '¶', shy: '', larr: '←', rarr: '→', uarr: '↑', darr: '↓', minus: '−', prime: '′',
  numero: '№', infin: '∞', ne: '≠', le: '≤', ge: '≥', frac12: '½', frac14: '¼', frac34: '¾', cent: '¢',
  pound: '£', yen: '¥', iexcl: '¡', iquest: '¿', zwnj: '', zwj: '', lrm: '', rlm: '', ensp: ' ', emsp: ' ', thinsp: ' ',
}

export function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x[0-9a-fA-F]{1,6}|#\d{1,7}|[A-Za-z][A-Za-z0-9]{1,8});/g, (match, entity: string) => {
    if (entity.startsWith('#')) {
      const code = entity[1] === 'x' || entity[1] === 'X' ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10)
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return match
      return String.fromCodePoint(code)
    }
    const named = NAMED_ENTITIES[entity] ?? NAMED_ENTITIES[entity.toLowerCase()]
    return named ?? match
  })
}

/** The same characters the app's rich editor escapes in literal text. */
export function escapeMarkdown(value: string): string {
  return value.replace(/[\\*~`[\]#>.|-]/g, (character) => `\\${character}`)
}

function parse(source: string): Node[] {
  const root: Node & { kind: 'tag' } = { kind: 'tag', name: '#root', attr: '', children: [] }
  const stack: Array<Node & { kind: 'tag' }> = [root]
  const current = () => stack[stack.length - 1]
  const pushText = (value: string) => {
    if (!value) return
    const children = current().children
    const last = children[children.length - 1]
    if (last?.kind === 'text') last.value += value
    else children.push({ kind: 'text', value })
  }
  let cursor = 0
  TAG_PATTERN.lastIndex = 0
  for (let match = TAG_PATTERN.exec(source); match; match = TAG_PATTERN.exec(source)) {
    const [token, slash, rawName, rawAttr] = match as unknown as [string, string, string, string]
    const name = rawName.toUpperCase()
    const closing = slash === '/'
    const known = CONTAINER_TAGS.has(name) || VOID_TAGS.has(name) || name === 'CODE'
    if (!known) continue
    pushText(source.slice(cursor, match.index))
    cursor = match.index + token.length
    const attr = rawAttr.startsWith('=') ? rawAttr.slice(1) : rawAttr
    if (closing) {
      const depth = stack.findLastIndex((node) => node.name === name)
      if (depth > 0) stack.length = depth
      continue
    }
    if (name === 'CODE') {
      const end = /\[\/CODE\]/i
      const rest = source.slice(cursor)
      const close = end.exec(rest)
      const raw = close ? rest.slice(0, close.index) : rest
      current().children.push({ kind: 'code', raw })
      cursor += close ? close.index + close[0].length : rest.length
      TAG_PATTERN.lastIndex = cursor
      continue
    }
    // `[IMG ID=123]` (an uploaded image) has no closing tag; `[IMG]url[/IMG]` does.
    if (VOID_TAGS.has(name) || (name === 'IMG' && /\bID\s*=/i.test(attr))) {
      current().children.push({ kind: 'void', name, attr })
      continue
    }
    const node: Node & { kind: 'tag' } = { kind: 'tag', name, attr, children: [] }
    current().children.push(node)
    stack.push(node)
  }
  pushText(source.slice(cursor))
  return root.children
}

interface RenderContext {
  mode: TextMode
  resolveUser?: (bitrixUserId: number) => MentionTarget | undefined
  rewriteHref?: (href: string) => string
  mentions: Array<{ userId: string; label: string }>
  files: number
  inLink: boolean
}

const MENTION_OPEN = ''
const MENTION_CLOSE = ''

function normalizeText(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/\r\n?/g, '\n')
}

function textNode(value: string, context: RenderContext): string {
  const decoded = decodeHtmlEntities(normalizeText(value))
    .replaceAll(' ', ' ')
    .replaceAll(MENTION_OPEN, '')
    .replaceAll(MENTION_CLOSE, '')
  return context.mode === 'markdown' ? escapeMarkdown(decoded) : decoded
}

/** Plain text of a subtree (for labels, names and URLs). */
function plainOf(nodes: Node[]): string {
  let value = ''
  for (const node of nodes) {
    if (node.kind === 'text') value += decodeHtmlEntities(normalizeText(node.value)).replaceAll(' ', ' ')
    else if (node.kind === 'code') value += node.raw
    else if (node.kind === 'tag') value += plainOf(node.children)
    else if (node.name === 'BR') value += '\n'
  }
  return value.replaceAll(MENTION_OPEN, '').replaceAll(MENTION_CLOSE, '')
}

/** Wraps every non-empty line: the app's inline markers do not span line breaks. */
function wrapLines(value: string, open: string, close: string): string {
  return value.split('\n').map((line) => {
    const match = /^(\s*)(.*?)(\s*)$/.exec(line)!
    const core = match[2]
    return core ? `${match[1]}${open}${core}${close}${match[3]}` : line
  }).join('\n')
}

function block(value: string): string {
  return value ? `\n${value}\n` : ''
}

function normalizeHref(raw: string): string {
  let href = decodeHtmlEntities(raw).trim().replace(/^["']|["']$/g, '').trim()
  if (/^www\./i.test(href)) href = `https://${href}`
  return href.replace(/\s/g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29')
}

function isSafeHref(href: string): boolean {
  return /^(https?:\/\/|\/(?!\/))/i.test(href) && !href.includes('\\') && ![...href].some((character) => character.charCodeAt(0) <= 32)
}

function link(label: string, rawHref: string, context: RenderContext): string {
  const normalized = normalizeHref(rawHref)
  const href = context.rewriteHref ? context.rewriteHref(normalized) : normalized
  const plainLabel = label.replace(/\s+/g, ' ').trim()
  if (context.mode === 'plain') {
    if (!plainLabel) return href
    return plainLabel === href || plainLabel === rawHref.trim() || !href ? plainLabel : `${plainLabel} (${href})`
  }
  if (!href) return escapeMarkdown(plainLabel)
  if (isSafeHref(href) && !context.inLink) return `[${escapeMarkdown(plainLabel || href)}](${href})`
  if (!plainLabel || plainLabel === href) return escapeMarkdown(href)
  return `${escapeMarkdown(plainLabel)} (${escapeMarkdown(href)})`
}

function fileMarker(context: RenderContext): string {
  context.files += 1
  return context.mode === 'markdown' ? escapeMarkdown(FILE_MARKER_TEXT) : FILE_MARKER_TEXT
}

function renderList(node: Node & { kind: 'tag' }, context: RenderContext): string {
  const ordered = /^\s*[1aAiI]/.test(node.attr)
  const items: Node[][] = []
  let currentItem: Node[] | null = null
  for (const child of node.children) {
    if (child.kind === 'void' && child.name === '*') {
      currentItem = []
      items.push(currentItem)
    } else if (currentItem) {
      currentItem.push(child)
    } else if (child.kind !== 'text' || child.value.trim()) {
      currentItem = [child]
      items.push(currentItem)
    }
  }
  const lines: string[] = []
  let number = 0
  for (const item of items) {
    const rendered = render(item, context).trim()
    if (!rendered) continue
    number += 1
    const joiner = context.mode === 'markdown' ? '[br]' : '\n  '
    const content = rendered.split(/\n+/).map((line) => line.trim()).filter(Boolean).join(joiner)
    lines.push(`${ordered ? `${number}. ` : '- '}${content}`)
  }
  return block(lines.join('\n'))
}

function renderTable(node: Node & { kind: 'tag' }, context: RenderContext): string {
  const rows: string[] = []
  const rowNodes = node.children.filter((child): child is Node & { kind: 'tag' } => child.kind === 'tag' && child.name === 'TR')
  for (const row of rowNodes.length ? rowNodes : [node]) {
    const cells = row.children
      .filter((child): child is Node & { kind: 'tag' } => child.kind === 'tag' && (child.name === 'TD' || child.name === 'TH'))
      .map((cell) => render(cell.children, context).trim())
    if (!cells.length) continue
    if (context.mode === 'markdown') rows.push(`|${cells.map((cell) => cell.replace(/\n+/g, '[br]')).join('|')}|`)
    else rows.push(cells.map((cell) => cell.replace(/\n+/g, ' ')).join(' | '))
  }
  return block(rows.join('\n'))
}

function renderTag(node: Node & { kind: 'tag' }, context: RenderContext): string {
  const markdown = context.mode === 'markdown'
  const inner = () => render(node.children, context)
  switch (node.name) {
    case 'B': return markdown ? wrapLines(inner(), '**', '**') : inner()
    case 'I': return markdown ? wrapLines(inner(), '*', '*') : inner()
    case 'S': return markdown ? wrapLines(inner(), '~~', '~~') : inner()
    case 'U': return markdown ? wrapLines(inner(), '[u]', '[/u]') : inner()
    case 'SIZE': {
      const size = Number.parseInt(node.attr, 10)
      return markdown && size >= 10 && size <= 36 ? wrapLines(inner(), `[size=${size}]`, '[/size]') : inner()
    }
    case 'LEFT': case 'CENTER': case 'RIGHT': case 'JUSTIFY':
      return markdown ? block(wrapLines(inner().trim(), `[align=${node.name.toLowerCase()}]`, '[/align]')) : block(inner().trim())
    case 'URL': {
      const href = node.attr.trim() || plainOf(node.children)
      const previous = context.inLink
      context.inLink = true
      const label = node.attr.trim() ? render(node.children, { ...context, mode: 'plain' }) : ''
      context.inLink = previous
      return link(label, href, context)
    }
    case 'USER': {
      const bitrixId = Number.parseInt(node.attr, 10)
      const target = Number.isFinite(bitrixId) ? context.resolveUser?.(bitrixId) : undefined
      const name = plainOf(node.children).replace(/\s+/g, ' ').trim() || target?.name || ''
      if (!target || !name || context.inLink) return markdown ? escapeMarkdown(name) : name
      if (markdown) return `[${escapeMarkdown(name)}](/?employeeId=${target.id})`
      context.mentions.push({ userId: target.id, label: name })
      return `${MENTION_OPEN}${context.mentions.length - 1}${MENTION_CLOSE}`
    }
    case 'QUOTE': {
      const content = inner().trim()
      if (!content) return ''
      return block(content.split('\n').filter((line) => line.trim()).map((line) => `> ${line}`).join('\n'))
    }
    case 'LIST': return renderList(node, context)
    case 'TABLE': return renderTable(node, context)
    case 'TR': return block(render(node.children, context).trim())
    case 'TD': case 'TH': return `${render(node.children, context).trim()} `
    case 'P': return block(inner().trim())
    case 'H1': case 'H2': case 'H3': {
      const content = inner().replace(/\n+/g, ' ').trim()
      return content ? block(markdown ? `${'#'.repeat(Number(node.name[1]))} ${content}` : content) : ''
    }
    case 'IMG': {
      const href = normalizeHref(plainOf(node.children) || node.attr)
      context.files += 1
      if (isSafeHref(href)) return markdown && !context.inLink ? `[${IMAGE_LABEL}](${href})` : href
      return markdown ? escapeMarkdown(FILE_MARKER_TEXT) : FILE_MARKER_TEXT
    }
    case 'VIDEO': {
      const href = normalizeHref(plainOf(node.children) || node.attr)
      if (isSafeHref(href)) return markdown && !context.inLink ? `[${VIDEO_LABEL}](${href})` : href
      return fileMarker(context)
    }
    case 'CALL': case 'SEND': case 'PUT': case 'CHAT': case 'DIALOG': case 'CONTEXT': {
      const content = inner()
      if (content.trim()) return content
      return textNode(node.attr, context)
    }
    default:
      // COLOR, FONT, BACKGROUND, SPOILER, PROJECT, DEPARTMENT, MENTION, BOT, PCH, SUP, SUB: keep the text.
      return inner()
  }
}

function render(nodes: Node[], context: RenderContext): string {
  let value = ''
  for (const node of nodes) {
    if (node.kind === 'text') value += textNode(node.value, context)
    else if (node.kind === 'code') {
      const raw = decodeHtmlEntities(normalizeText(node.raw)).replace(/^\n+|\n+$/g, '')
      if (!raw.trim()) continue
      if (context.mode === 'plain') value += raw
      else if (!raw.includes('\n') && !raw.includes('`')) value += `\`${raw}\``
      else value += block(`\`\`\`\n${raw.split('\n').map((line) => (line === '```' ? '` ``' : line)).join('\n')}\n\`\`\``)
    } else if (node.kind === 'void') {
      if (node.name === 'BR') value += '\n'
      else if (node.name === 'HR') value += '\n\n'
      else if (node.name === '*') value += `\n${context.mode === 'markdown' ? '- ' : '• '}`
      else if (FILE_VOID_TAGS.has(node.name) || node.name === 'IMG') value += fileMarker(context)
      // ICON and TIMESTAMP carry no text.
    } else value += renderTag(node, context)
  }
  return value
}

export function convertBitrixText(source: string | null | undefined, options: ConvertOptions): ConvertedText {
  const context: RenderContext = { mode: options.mode, resolveUser: options.resolveUser, rewriteHref: options.rewriteHref, mentions: [], files: 0, inLink: false }
  const rendered = source ? render(parse(source), context) : ''
  const cleaned = rendered
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  const mentions: TextMention[] = []
  let text = ''
  let cursor = 0
  const sentinel = new RegExp(`${MENTION_OPEN}(\\d+)${MENTION_CLOSE}`, 'g')
  for (const match of cleaned.matchAll(sentinel)) {
    text += cleaned.slice(cursor, match.index)
    const mention = context.mentions[Number(match[1])]
    const start = text.length
    text += `@${mention.label}`
    mentions.push({ userId: mention.userId, start, end: text.length, label: mention.label })
    cursor = match.index + match[0].length
  }
  text += cleaned.slice(cursor)
  if (!text.trim() && options.emptyPlaceholder) return { text: options.emptyPlaceholder, mentions: [], files: context.files }
  return { text, mentions, files: context.files }
}

/**
 * Maps Bitrix portal paths to LankaDWS routes: a task view to /tasks/<id>, a profile to the employee
 * link. Anything else (and anything not imported) is returned unchanged.
 */
export function rewriteBitrixHref(href: string, lookup: { userId: (bitrixId: number) => string | undefined; taskId: (bitrixId: number) => string | undefined }): string {
  const path = href.replace(/^https?:\/\/[^/]+/i, '')
  const task = /^\/(?:company\/personal\/user\/\d+|workgroups\/group\/\d+)\/tasks\/task\/view\/(\d+)\/?(?:[?#].*)?$/i.exec(path)
  if (task) {
    const id = lookup.taskId(Number(task[1]))
    return id ? `/tasks/${id}` : href
  }
  const user = /^\/company\/personal\/user\/(\d+)\/?$/i.exec(path)
  if (user) {
    const id = lookup.userId(Number(user[1]))
    return id ? `/?employeeId=${id}` : href
  }
  return href
}
