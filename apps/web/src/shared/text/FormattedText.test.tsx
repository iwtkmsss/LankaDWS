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
  expect(screen.getByRole('link', { name: '@Олена' }).closest('strong')).not.toBeNull()
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
