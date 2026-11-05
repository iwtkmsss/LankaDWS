import '@testing-library/jest-dom/vitest'
import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { FormattedText } from './FormattedText'
import { FormattedTextarea } from './FormattedTextarea'
import { MentionTextarea } from '../mentions/MentionTextarea'
import { editorMarkup, readEditor } from './richTextDom'

vi.mock('../../features/employees/UserProfileDrawer', () => ({ UserProfileLink: ({ children }: { children: React.ReactNode }) => <a href="/person">{children}</a> }))
afterEach(cleanup)

it('flattens table cells and omits empty rows only in previews', () => {
  const body = '| | | | |\n|Керівник|**Підключити**|\nОпис завдання'
  const { container, rerender } = render(<FormattedText body={body} preview />)
  expect(container.querySelector('table')).toBeNull()
  expect(container.querySelectorAll('p')).toHaveLength(2)
  expect(container.querySelector('p')).toHaveTextContent('Керівник · Підключити')
  expect(container.querySelector('strong')).toHaveTextContent('Підключити')
  rerender(<FormattedText body={body} />)
  expect(container.querySelectorAll('tr')).toHaveLength(2)
  expect(container.querySelectorAll('td')).toHaveLength(6)
})

it('renders supported formatting while leaving HTML and unsafe links inert', () => {
  const { container } = render(<FormattedText body={'## План\n**важливо** і *курсив* та ~~старе~~\n- один\n- два\n> цитата\n`код`\n[сайт](https://example.com)\n[x](javascript:alert)\n<img src=x onerror=alert(1)>'} />)
  expect(screen.getByRole('heading', { name: 'План' })).toBeInTheDocument()
  expect(container.querySelector('strong')).toHaveTextContent('важливо')
  expect(container.querySelector('em')).toHaveTextContent('курсив')
  expect(screen.getAllByRole('listitem')).toHaveLength(2)
  expect(container.querySelector('blockquote')).toHaveTextContent('цитата')
  expect(screen.getByRole('link', { name: 'сайт' })).toHaveAttribute('href', 'https://example.com')
  expect(screen.queryByRole('link', { name: 'x' })).toBeNull()
  expect(container.querySelector('img')).toBeNull()
})

it('visible formatting reaches form data, controlled state and the dirty handler', () => {
  const dirty = vi.fn()
  function Form() {
    const [value, setValue] = useState('Контекст')
    return <form onChange={dirty}><FormattedTextarea label="Опис" name="description" value={value} onChange={(event) => setValue(event.target.value)} /></form>
  }
  const { container } = render(<Form />)
  const input = screen.getByRole('textbox')
  input.innerHTML = '<p><b>Контекст</b></p>'
  fireEvent.input(input)
  expect(input.querySelector('b')).toHaveTextContent('Контекст')
  expect(input.textContent).toBe('Контекст')
  expect(new FormData(container.querySelector('form')!).get('description')).toBe('**Контекст**')
  expect(dirty).toHaveBeenCalled()
  expect(screen.queryByRole('button', { name: 'Перегляд' })).toBeNull()
})

it('preserves mention ranges when formatting the selected mention', () => {
  const changed = vi.fn()
  render(<QueryClientProvider client={new QueryClient()}><MentionTextarea formatting label="Текст" value="@Олена" mentions={[{ userId: 'user', start: 0, end: 6, label: 'Олена' }]} candidateUrl={null} maxLength={100} onChange={changed} /></QueryClientProvider>)
  const input = screen.getByRole('textbox')
  input.innerHTML = '<p><span data-mention-id="user" data-mention-label="Олена"><b>@Олена</b></span></p>'
  fireEvent.input(input)
  expect(changed).toHaveBeenCalledWith('**@Олена**', [{ userId: 'user', start: 2, end: 8, label: 'Олена' }])
  cleanup()
  render(<FormattedText body="**@Олена**" mentions={[{ userId: 'user', start: 2, end: 8, active: true }]} />)
  expect(screen.getByRole('link', { name: 'Олена' }).closest('strong')).not.toBeNull()
})

it('round-trips existing headings, lists, code and safe links without leaking HTML', () => {
  const root = document.createElement('div')
  const value = '## План\n**важливо** і *курсив* та ~~старе~~\n- один\n- два\n> цитата\n`код`\n[сайт](https://example.com)'
  root.innerHTML = editorMarkup(value, [])
  expect(readEditor(root).body).toBe(value)
  expect(root.querySelector('script')).toBeNull()
  root.innerHTML = '<p><a href="javascript:alert(1)">текст</a></p>'
  expect(readEditor(root).body).toBe('текст')
})

it('keeps typed formatting symbols literal and treats an empty list as an empty field', () => {
  const root = document.createElement('div')
  root.textContent = '**звичайний текст**'
  const serialized = readEditor(root).body
  root.innerHTML = editorMarkup(serialized, [])
  expect(root.textContent).toBe('**звичайний текст**')
  expect(root.querySelector('strong')).toBeNull()
  root.innerHTML = '<ul><li><br></li></ul>'
  expect(readEditor(root).body).toBe('')
})

it('drops a mention identity if the displayed mention label was edited', () => {
  const root = document.createElement('div')
  root.innerHTML = '<p><span data-mention-id="user" data-mention-label="Олена">@Олег</span></p>'
  expect(readEditor(root).mentions).toEqual([])
})

it('reopens combined inline styles and tracks the caret inside them', () => {
  const root = document.createElement('div')
  root.innerHTML = editorMarkup('***важливо***', [])
  expect(root.querySelector('strong em')).toHaveTextContent('важливо')
  expect(readEditor(root).body).toBe('***важливо***')
  document.body.append(root)
  const range = document.createRange()
  range.setStart(root.querySelector('em')!.firstChild!.firstChild ?? root.querySelector('em')!.firstChild!, 2)
  range.collapse(true)
  const selection = document.getSelection()!
  selection.removeAllRanges(); selection.addRange(range)
  expect(readEditor(root).end).toBe(5)
  root.remove()
})

it('round-trips font sizes, underline, alignment and mentions', () => {
  const root = document.createElement('div')
  root.innerHTML = '<p style="text-align:center"><span style="font-size:36pt"><u><span data-mention-id="user" data-mention-label="Олена">@Олена</span></u></span></p>'
  const next = readEditor(root)
  expect(next.body).toBe('[align=center][size=36][u]@Олена[/u][/size][/align]')
  expect(next.body.slice(next.mentions[0]!.start, next.mentions[0]!.end)).toBe('@Олена')
  root.innerHTML = editorMarkup(next.body, next.mentions)
  expect(root.querySelector('u')).toHaveTextContent('@Олена')
  expect(root.querySelector('[style*="font-size"]')).toHaveStyle({ fontSize: '36pt' })
  expect(readEditor(root).body).toBe(next.body)
  expect(readEditor(root).mentions).toEqual(next.mentions)
})

it('round-trips tables with formatted cells and literal pipes', () => {
  const root = document.createElement('div')
  root.innerHTML = '<table><tbody><tr><td><b>План</b></td><td>а|б</td></tr><tr><td> </td><td>Зміст<br>далі</td></tr></tbody></table>'
  const body = readEditor(root).body
  root.innerHTML = editorMarkup(body, [])
  expect(root.querySelectorAll('td')).toHaveLength(4)
  expect(root.querySelector('strong')).toHaveTextContent('План')
  expect(root.querySelectorAll('td')[1]).toHaveTextContent('а|б')
  expect(readEditor(root).body).toBe(body)
})

it('keeps nested sizes and rejects unsupported formatting values', () => {
  const { container } = render(<FormattedText body={'[size=12]один [size=36]два[/size] три[/size]\n[size=99]великий[/size]\n[align=evil]текст[/align]'} />)
  expect(container.querySelector('[style*="12pt"] [style*="36pt"]')).toHaveTextContent('два')
  expect(container.querySelector('[style*="99"]')).toBeNull()
  expect(container.textContent).toContain('[align=evil]текст[/align]')
})

it('lets every formatted editor change its height with the shared handle', () => {
  const { rerender } = render(<FormattedTextarea id="body" label="Опис" />)
  expect(screen.getByRole('separator', { name: 'Змінити висоту редактора', hidden: true })).toHaveAttribute('aria-controls', 'body')
  rerender(<FormattedTextarea id="body" label="Опис" disabled />)
  expect(screen.queryByRole('separator', { name: 'Змінити висоту редактора' })).not.toBeInTheDocument()
})

it('offers sizes 10 through 36 and places undo and redo last', () => {
  render(<FormattedTextarea label="Опис" />)
  expect(screen.getAllByRole('option')).toHaveLength(27)
  expect(screen.getByRole('option', { name: '10 pt' })).toHaveValue('10')
  expect(screen.getByRole('option', { name: '36 pt' })).toHaveValue('36')
  const toolbar = screen.getByRole('group', { name: 'Форматування тексту' })
  expect(toolbar.children[toolbar.children.length - 2]).toHaveAccessibleName('Скасувати дію')
  expect(toolbar.lastElementChild).toHaveAccessibleName('Повторити дію')
})


it('hides mention prefixes and patronymics in the editor while preserving transport offsets', () => {
  const body = 'Привіт @Іваненко Марія Петрівна!'
  const start = body.indexOf('@')
  const mentions = [{ userId: 'maria', label: 'Іваненко Марія Петрівна', start, end: body.length - 1 }]
  const root = document.createElement('div')
  root.innerHTML = editorMarkup(body, mentions)
  const mention = root.querySelector('.structured-mention')!
  expect(mention.querySelector('[hidden]')).toHaveTextContent('@')
  const visible = mention.cloneNode(true) as HTMLElement
  visible.querySelectorAll('[hidden]').forEach((node) => node.remove())
  expect(visible.textContent).toBe('Іваненко Марія')
  expect(readEditor(root)).toMatchObject({ body, mentions })
})

it('renders a saved description person link without a prefix or patronymic', () => {
  render(<FormattedText body="[Іваненко Марія Петрівна](/?employeeId=maria)" />)
  expect(screen.getByRole('link', { name: 'Іваненко Марія' })).toHaveClass('structured-mention')
})
