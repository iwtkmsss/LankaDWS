import type { ReactNode } from 'react'
import type { StructuredMentionView } from '@lankadws/contracts'
import { MentionText } from '../mentions/MentionRenderer'
import './formatted-text.css'

// Render a deliberately small Markdown vocabulary as React elements. Raw HTML
// stays text; links accept only web URLs and local paths.
export function FormattedText({ body, mentions = [], hideMentionPrefix = false }: { body: string; mentions?: StructuredMentionView[]; hideMentionPrefix?: boolean }) {
  return <div className="formatted-text"><FormattedContent body={body} mentions={mentions} hideMentionPrefix={hideMentionPrefix} /></div>
}

export function FormattedContent({ body, mentions = [], hideMentionPrefix = false, renderText }: { body: string; mentions?: StructuredMentionView[]; hideMentionPrefix?: boolean; renderText?: (value: string, offset: number) => ReactNode }) {
  function text(value: string, offset: number) {
    if (renderText) return renderText(value, offset)
    return <MentionText body={value} hideMentionPrefix={hideMentionPrefix} mentions={mentions.filter((mention) => mention.start >= offset && mention.end <= offset + value.length).map((mention) => ({ ...mention, start: mention.start - offset, end: mention.end - offset }))} />
  }
  function inline(value: string, offset: number, depth = 0): ReactNode {
    if (depth > 8) return text(value, offset)
    const pattern = /(\\[\\*~`[\]#>.-]|`[^`\n]+`|\*\*\*[^\n]+?\*\*\*|\*\*[^\n]+?\*\*(?!\*)|~~[^\n]+?~~|\*[^*\n]+\*|\[[^\]\n]+\]\([^\s)]+\))/g
    const nodes: ReactNode[] = []
    let cursor = 0
    for (const match of value.matchAll(pattern)) {
      const start = match.index
      if (start > cursor) nodes.push(<span key={`text-${cursor}`}>{text(value.slice(cursor, start), offset + cursor)}</span>)
      const token = match[0]
      const key = `format-${start}`
      if (token.startsWith('\\')) nodes.push(<span key={key}>{text(token.slice(1), offset + start + 1)}</span>)
      else if (token.startsWith('`')) nodes.push(<code key={key}>{token.slice(1, -1)}</code>)
      else if (token.startsWith('***')) nodes.push(<strong key={key}><em>{inline(token.slice(3, -3), offset + start + 3, depth + 1)}</em></strong>)
      else if (token.startsWith('**')) nodes.push(<strong key={key}>{inline(token.slice(2, -2), offset + start + 2, depth + 1)}</strong>)
      else if (token.startsWith('~~')) nodes.push(<s key={key}>{inline(token.slice(2, -2), offset + start + 2, depth + 1)}</s>)
      else if (token.startsWith('*')) nodes.push(<em key={key}>{inline(token.slice(1, -1), offset + start + 1, depth + 1)}</em>)
      else {
        const separator = token.indexOf('](')
        const href = token.slice(separator + 2, -1)
        const safe = /^(https?:\/\/|\/(?!\/))/i.test(href) && !href.includes('\\') && ![...href].some((character) => character.charCodeAt(0) <= 32)
        nodes.push(safe ? <a key={key} href={href} rel="noopener noreferrer">{inline(token.slice(1, separator), offset + start + 1, depth + 1)}</a> : <span key={key}>{text(token, offset + start)}</span>)
      }
      cursor = start + token.length
    }
    if (cursor < value.length) nodes.push(<span key={`text-${cursor}`}>{text(value.slice(cursor), offset + cursor)}</span>)
    return nodes
  }
  const lines = body.split('\n')
  const blocks: ReactNode[] = []
  let offset = 0
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!
    if (line === '```') {
      const code: string[] = []
      offset += line.length + 1
      while (index + 1 < lines.length && lines[index + 1] !== '```') {
        const next = lines[++index]!
        code.push(next)
        offset += next.length + 1
      }
      if (lines[index + 1] === '```') { index += 1; offset += 4 }
      blocks.push(<pre key={index}><code>{code.join('\n')}</code></pre>)
      continue
    }
    const heading = /^(#{1,3}) (.*)$/.exec(line)
    const list = /^(?:- |\d+\. )(.*)$/.exec(line)
    if (heading) {
      const Heading = `h${heading[1]!.length + 1}` as 'h2' | 'h3' | 'h4'
      blocks.push(<Heading key={index}>{inline(heading[2]!, offset + heading[1]!.length + 1)}</Heading>)
    } else if (list) {
      const ordered = /^\d/.test(line)
      const items: ReactNode[] = []
      let next = line
      while (true) {
        const prefix = ordered ? /^\d+\. / : /^- /
        const length = prefix.exec(next)![0].length
        items.push(<li key={index}>{inline(next.slice(length), offset + length)}</li>)
        offset += next.length + 1
        if (!lines[index + 1] || !prefix.test(lines[index + 1]!)) break
        next = lines[++index]!
      }
      blocks.push(ordered ? <ol key={index}>{items}</ol> : <ul key={index}>{items}</ul>)
      continue
    } else if (line.startsWith('> ')) blocks.push(<blockquote key={index}>{inline(line.slice(2), offset + 2)}</blockquote>)
    else if (line.trim()) blocks.push(<p key={index}>{inline(line, offset)}</p>)
    else blocks.push(<div className="formatted-text__space" key={index} />)
    offset += line.length + 1
  }
  return <>{blocks}</>
}
