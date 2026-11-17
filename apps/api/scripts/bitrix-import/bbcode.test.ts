import { describe, expect, it } from 'vitest'
import { convertBitrixText, decodeHtmlEntities, escapeMarkdown, rewriteBitrixHref, type ConvertOptions } from './bbcode.js'

const users: Record<number, { id: string; name: string }> = {
  5: { id: 'usr_b24_5', name: 'Олена Бондар' },
  7: { id: 'usr_b24_7', name: 'Іван Петренко' },
}
const resolveUser = (id: number) => users[id]
const md = (source: string, options: Partial<ConvertOptions> = {}) =>
  convertBitrixText(source, { mode: 'markdown', resolveUser, ...options }).text
const plain = (source: string, options: Partial<ConvertOptions> = {}) =>
  convertBitrixText(source, { mode: 'plain', resolveUser, ...options })

describe('convertBitrixText (markdown)', () => {
  it('maps inline formatting tags case-insensitively', () => {
    expect(md('[B]жирний[/B] [i]курсив[/i] [U]підкреслений[/U] [s]закреслений[/s]'))
      .toBe('**жирний** *курсив* [u]підкреслений[/u] ~~закреслений~~')
  })

  it('handles nested tags and keeps markers per line', () => {
    expect(md('[B]a [I]b[/I] c[/B]')).toBe('**a *b* c**')
    expect(md('[B]перший\nдругий[/B]')).toBe('**перший**\n**другий**')
    expect(md('[B][U]x[/U][/B]')).toBe('**[u]x[/u]**')
  })

  it('auto-closes unclosed tags and drops stray closing tags', () => {
    expect(md('[B]без кінця')).toBe('**без кінця**')
    expect(md('текст[/B] далі')).toBe('текст далі')
    expect(md('[B]a [I]b[/B] c')).toBe('**a *b*** c')
  })

  it('converts links with and without a label', () => {
    expect(md('[URL=https://example.com/a?b=1]сайт[/URL]')).toBe('[сайт](https://example.com/a?b=1)')
    expect(md('[URL]https://example.com[/URL]')).toBe('[https://example\\.com](https://example.com)')
    expect(md('[URL=www.example.com]тут[/URL]')).toBe('[тут](https://www.example.com)')
    expect(md('[URL=https://x.org/a (b)]x[/URL]')).toBe('[x](https://x.org/a%20%28b%29)')
    expect(md('[URL=ftp://host/file]файл[/URL]')).toBe('файл (ftp://host/file)')
  })

  it('turns known user mentions into employee links and unknown ones into text', () => {
    expect(md('Привіт, [USER=5]Олена Бондар[/USER]!')).toBe('Привіт, [Олена Бондар](/?employeeId=usr_b24_5)!')
    expect(md('[USER=99]Невідомий Користувач[/USER]')).toBe('Невідомий Користувач')
    expect(md('[USER=7][/USER]')).toBe('[Іван Петренко](/?employeeId=usr_b24_7)')
    expect(md('[URL=https://a.b][USER=5]Олена[/USER][/URL]')).toBe('[Олена](https://a.b)')
  })

  it('renders quotes, lists and code', () => {
    expect(md('До[QUOTE]рядок 1\nрядок 2[/QUOTE]Після')).toBe('До\n> рядок 1\n> рядок 2\nПісля')
    expect(md('[LIST][*]один[*]два[/LIST]')).toBe('- один\n- два')
    expect(md('[LIST=1][*]один[*][B]два[/B][/LIST]')).toBe('1. один\n2. **два**')
    expect(md('[CODE]const a = [b] * 2;[/CODE]')).toBe('`const a = [b] * 2;`')
    expect(md('[CODE]line 1\n[B]line 2[/B][/CODE]')).toBe('```\nline 1\n[B]line 2[/B]\n```')
  })

  it('renders tables as pipe rows', () => {
    expect(md('[TABLE][TR][TD]a[/TD][TD]b|c[/TD][/TR][TR][TD]1[/TD][TD]2[/TD][/TR][/TABLE]'))
      .toBe('|a|b\\|c|\n|1|2|')
  })

  it('marks files and images', () => {
    const result = convertBitrixText('Дивись [DISK FILE ID=n123] і [IMG ID=5] та [IMG]https://cdn.example.com/a.png[/IMG]', { mode: 'markdown' })
    expect(result.text).toBe('Дивись \\[файл\\] і \\[файл\\] та [зображення](https://cdn.example.com/a.png)')
    expect(result.files).toBe(3)
  })

  it('decodes HTML entities and escapes markdown characters in literal text', () => {
    expect(md('a &amp; b &lt;tag&gt; &quot;q&quot; &#1031; &#x41; &nbsp;x')).toBe('a & b <tag\\> "q" Ї A  x')
    expect(md('2*3 = 6. Пункт - [важливо] #1')).toBe('2\\*3 = 6\\. Пункт \\- \\[важливо\\] \\#1')
    expect(md('рядок<br />другий')).toBe('рядок\nдругий')
  })

  it('removes known tags without a mapping and keeps their text', () => {
    expect(md('[COLOR=#ff0000]червоний[/COLOR] [FONT=Arial]шрифт[/FONT] [SPOILER]прихований[/SPOILER]'))
      .toBe('червоний шрифт прихований')
    expect(md('[CENTER]по центру[/CENTER]')).toBe('[align=center]по центру[/align]')
    expect(md('[SIZE=14]великий[/SIZE] [SIZE=2]малий[/SIZE]')).toBe('[size=14]великий[/size] малий')
  })

  it('returns the placeholder when nothing is left', () => {
    expect(md('   [B] [/B] ', { emptyPlaceholder: '(без тексту)' })).toBe('(без тексту)')
    expect(md('', { emptyPlaceholder: '(без тексту)' })).toBe('(без тексту)')
    expect(md('[ICON=x]')).toBe('')
  })

  it('collapses excess blank lines', () => {
    expect(md('a\n\n\n\nb[BR][BR][BR]c')).toBe('a\n\nb\n\nc')
  })
})

describe('convertBitrixText (plain)', () => {
  it('strips formatting and keeps the text', () => {
    expect(plain('[B]жирний[/B] 2*3 [URL=https://a.b]посилання[/URL] [URL]https://c.d[/URL]').text)
      .toBe('жирний 2*3 посилання (https://a.b) https://c.d')
  })

  it('stores known mentions as @Name ranges', () => {
    const result = plain('Привіт [USER=5]Олена Бондар[/USER] і [USER=7]Іван[/USER], [USER=9]Хтось[/USER]')
    expect(result.text).toBe('Привіт @Олена Бондар і @Іван, Хтось')
    expect(result.mentions).toEqual([
      { userId: 'usr_b24_5', start: 7, end: 20, label: 'Олена Бондар' },
      { userId: 'usr_b24_7', start: 23, end: 28, label: 'Іван' },
    ])
    for (const mention of result.mentions) expect(result.text.slice(mention.start, mention.end)).toBe(`@${mention.label}`)
  })

  it('keeps mention offsets right after whitespace cleanup', () => {
    const result = plain('\n\n  [USER=5]Олена[/USER]  \n\n\n\nтекст [USER=7]Іван[/USER]')
    expect(result.text).toBe('@Олена\n\nтекст @Іван')
    for (const mention of result.mentions) expect(result.text.slice(mention.start, mention.end)).toBe(`@${mention.label}`)
  })

  it('marks file-only messages and uses the placeholder for empty ones', () => {
    expect(plain('[DISK=123]').text).toBe('[файл]')
    expect(plain('', { emptyPlaceholder: '(порожнє повідомлення)' }).text).toBe('(порожнє повідомлення)')
  })
})

describe('helpers', () => {
  it('decodes numeric and named entities once', () => {
    expect(decodeHtmlEntities('&amp;quot; &unknown; &#0; &#128512;')).toBe('&quot; &unknown; &#0; \u{1F600}')
  })

  it('escapes the same set as the rich editor', () => {
    expect(escapeMarkdown('\\*~`[]#>.|-a')).toBe('\\\\\\*\\~\\`\\[\\]\\#\\>\\.\\|\\-a')
  })
})

describe('rewriteBitrixHref', () => {
  const lookup = {
    userId: (id: number) => (id === 42 ? 'usr_b24_42' : undefined),
    taskId: (id: number) => (id === 1234 ? 'tsk_b24_1234' : undefined),
  }

  it('maps portal task and profile paths to LankaDWS routes', () => {
    expect(rewriteBitrixHref('/company/personal/user/42/tasks/task/view/1234/?MID=77#com77', lookup)).toBe('/tasks/tsk_b24_1234')
    expect(rewriteBitrixHref('https://portal.example/workgroups/group/5/tasks/task/view/1234/', lookup)).toBe('/tasks/tsk_b24_1234')
    expect(rewriteBitrixHref('/company/personal/user/42/', lookup)).toBe('/?employeeId=usr_b24_42')
  })

  it('keeps unknown targets unchanged', () => {
    expect(rewriteBitrixHref('/company/personal/user/43/', lookup)).toBe('/company/personal/user/43/')
    expect(rewriteBitrixHref('/company/personal/user/42/tasks/task/view/1/', lookup)).toBe('/company/personal/user/42/tasks/task/view/1/')
    expect(rewriteBitrixHref('https://example.com/a', lookup)).toBe('https://example.com/a')
  })

  it('is applied by the converter', () => {
    expect(convertBitrixText('[URL=/company/personal/user/42/]Марія[/URL]', { mode: 'markdown', rewriteHref: (href) => rewriteBitrixHref(href, lookup) }).text)
      .toBe('[Марія](/?employeeId=usr_b24_42)')
  })
})
