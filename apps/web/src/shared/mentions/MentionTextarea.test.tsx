import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StructuredMentionInput } from '@lankadws/contracts'
import { MemoryRouter } from 'react-router-dom'
import { api } from '../api/client'
import { MentionText } from './MentionRenderer'
import { MentionTextarea } from './MentionTextarea'
import { reconcileMentionChange } from './mentionText'

vi.mock('../api/client', () => ({ api: vi.fn() }))

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  Object.defineProperty(HTMLElement.prototype, 'showPopover', { configurable: true, value: function (this: HTMLElement) { this.removeAttribute('popover') } })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); Reflect.deleteProperty(HTMLElement.prototype, 'showPopover') })

function Harness() {
  const [value, setValue] = useState('')
  const [mentions, setMentions] = useState<StructuredMentionInput[]>([])
  return (
    <>
      <MentionTextarea
        label="Текст"
        value={value}
        mentions={mentions}
        candidateUrl="/feed/mention-candidates?company=cmp&audienceType=COMPANY"
        maxLength={1_000}
        onChange={(nextValue, nextMentions) => {
          setValue(nextValue)
          setMentions(nextMentions)
        }}
      />
      <output>{JSON.stringify(mentions)}</output>
    </>
  )
}

describe('MentionTextarea', () => {
  it.each([
    { top: 50, bottom: 100, placement: 'bottom' },
    { top: 650, bottom: 700, placement: 'top' },
  ])('opens toward the available space at $top', async ({ top, bottom, placement }) => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return (this.classList.contains('mention-field__input')
        ? { top, bottom, left: 20, right: 420, width: 400, height: bottom - top }
        : { top: 0, bottom: 106, left: 0, right: 400, width: 400, height: 106 }) as DOMRect
    })
    vi.mocked(api).mockResolvedValue({ items: [] })
    render(<QueryClientProvider client={new QueryClient()}><Harness /></QueryClientProvider>)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '@м', selectionStart: 2 } })
    const list = screen.getByRole('listbox')
    expect(list).toHaveAttribute('data-placement', placement)
    expect(list).toHaveStyle({ top: `${placement === 'top' ? top - 111 : bottom + 5}px`, maxHeight: '260px' })
  })

  it('creates a structured mention only after selecting a candidate', async () => {
    vi.mocked(api).mockResolvedValue({
      items: [{
        id: 'usr_maria',
        displayName: 'Марія Іваненко Петрівна',
        username: 'maria',
        jobTitle: 'Дизайнерка',
        avatarAsset: null,
      }],
    })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><Harness /></QueryClientProvider>)

    const textbox = screen.getByRole('textbox', { name: 'Текст' })
    fireEvent.change(textbox, { target: { value: '@мар', selectionStart: 4 } })
    expect(screen.getByText('[]')).toBeVisible()
    await screen.findByRole('option', { name: /Марія Іваненко/ })
    fireEvent.click(screen.getByRole('option', { name: /Марія Іваненко/ }))

    expect(textbox).toHaveValue('@Марія Іваненко')
    await waitFor(() => expect(screen.getByText(/"userId":"usr_maria"/)).toBeVisible())
    expect(JSON.parse(screen.getByRole('status').textContent ?? '[]')).toEqual([
      { userId: 'usr_maria', start: 0, end: '@Марія Іваненко'.length, label: 'Марія Іваненко' },
    ])
  })

  it('shifts mentions for edits before them and removes an edited mention', () => {
    const mention = { userId: 'usr_maria', start: 6, end: 13, label: 'Марія' }
    expect(reconcileMentionChange('Привіт@Марія', 'О, Привіт@Марія', [mention]))
      .toEqual([{ ...mention, start: 9, end: 16 }])
    expect(reconcileMentionChange('Привіт@Марія', 'Привіт@Марі', [mention])).toEqual([])
  })

  it('renders only structured active mentions as employee links', () => {
    render(
      <MemoryRouter>
        <MentionText
          body="Raw @Марія, active @Олена and inactive @Андрій"
          mentions={[
            { userId: 'usr_olena', start: 19, end: 25, active: true },
            { userId: 'usr_andrii', start: 39, end: 46, active: false },
          ]}
        />
      </MemoryRouter>,
    )

    expect(screen.queryByRole('link', { name: '@Марія' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '@Олена' })).toHaveAttribute('href', '/?employeeId=usr_olena')
    expect(screen.getByText('@Андрій')).toHaveClass('is-inactive')
  })

  it('shortens stored mention names while retaining their original offsets and surrounding text', () => {
    const name = '@Петренко Олена Іванівна'
    const prefix = 'Привіт, '
    render(<MemoryRouter><div data-testid="stored-mention"><MentionText
      body={`${prefix}${name}, дякую!`}
      mentions={[{ userId: 'usr_olena', start: prefix.length, end: prefix.length + name.length, active: true }]}
    /></div></MemoryRouter>)
    expect(screen.getByRole('link', { name: '@Петренко Олена' })).toHaveAttribute('href', '/?employeeId=usr_olena')
    expect(screen.getByTestId('stored-mention')).toHaveTextContent('Привіт, @Петренко Олена, дякую!')
  })
})
