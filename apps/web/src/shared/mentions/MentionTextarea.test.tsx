import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { StructuredMentionInput } from '@bert-crm/contracts'
import { MemoryRouter } from 'react-router-dom'
import { api } from '../api/client'
import { MentionText } from './MentionRenderer'
import { MentionTextarea } from './MentionTextarea'
import { reconcileMentionChange } from './mentionText'

vi.mock('../api/client', () => ({ api: vi.fn() }))

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
  it('creates a structured mention only after selecting a candidate', async () => {
    vi.mocked(api).mockResolvedValue({
      items: [{
        id: 'usr_maria',
        displayName: 'Марія Іваненко',
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
})
