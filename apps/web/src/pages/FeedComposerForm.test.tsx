import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../shared/api/client'
import { OverlayProvider } from '../shared/ui'
import { FeedComposerForm } from './FeedComposerForm'

vi.mock('../shared/api/client', async (original) => ({
  ...await original<typeof import('../shared/api/client')>(),
  api: vi.fn(),
  idempotencyKey: vi.fn(() => 'feed-test-key'),
}))

const audience = {
  type: 'COMPANY' as const,
  id: 'cmp_lankadws_ua',
  companyId: 'cmp_lankadws_ua',
  label: 'LankaDWS',
  detail: 'Усі активні працівники організації',
}

const secondAudience = {
  type: 'COMPANY' as const,
  id: 'cmp_other',
  companyId: 'cmp_other',
  label: 'Інша компанія',
  detail: 'Усі активні працівники організації',
}

function mount() {
  render(
    <OverlayProvider>
      <QueryClientProvider client={new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })}>
        <FeedComposerForm
          defaultCompanyId="cmp_lankadws_ua"
          onPostCreated={vi.fn()}
          onFeedChanged={vi.fn()}
          onBusyChange={vi.fn()}
          onDirtyChange={vi.fn()}
        />
      </QueryClientProvider>
    </OverlayProvider>,
  )
}

beforeEach(() => {
  vi.mocked(api).mockImplementation(async (path, options) => {
    if (path === '/feed/audiences?company=all') return { items: [audience, secondAudience] }
    if (path === '/feed/attachments?company=cmp_lankadws_ua' && options?.method === 'POST') {
      return {
        id: 'file_new',
        fileName: 'оновлення.txt',
        bytes: 9,
        mimeType: 'text/plain',
        scanStatus: 'QUARANTINED',
      }
    }
    if (path === '/feed' && options?.method === 'POST') return { id: 'feed_new', version: 1 }
    throw new Error(`Unexpected request: ${path}`)
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('FeedComposerForm', () => {
  it('defaults the audience to the author company and publishes the checked companies', async () => {
    mount()

    const audienceTrigger = await screen.findByRole(
      'button',
      { name: 'Бачать: LankaDWS' },
      { timeout: 5_000 },
    )
    expect(screen.queryByRole('checkbox', { name: 'LankaDWS' })).not.toBeInTheDocument()
    fireEvent.click(audienceTrigger)

    const lankadws = screen.getByRole('checkbox', { name: 'LankaDWS' })
    const other = screen.getByRole('checkbox', { name: 'Інша компанія' })
    expect(lankadws).toBeChecked()
    expect(other).not.toBeChecked()
    fireEvent.click(other)

    fireEvent.change(screen.getByRole('textbox', { name: 'Текст публікації' }), {
      target: { value: 'Важливе оновлення' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Опублікувати' }))

    await waitFor(() => expect(api).toHaveBeenCalledWith('/feed', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        companyId: 'cmp_lankadws_ua',
        body: 'Важливе оновлення',
        audience: { type: 'COMPANIES', companyIds: ['cmp_lankadws_ua', 'cmp_other'] },
        requiresAcknowledgement: false,
        attachmentIds: [],
        mentions: [],
      }),
    })))
  })

  it('uploads attachments to the selected organization instead of the all scope', async () => {
    mount()
    await screen.findByRole('button', { name: 'Бачать: LankaDWS' })

    fireEvent.change(screen.getByLabelText('Додати файл'), {
      target: { files: [new File(['оновлення'], 'оновлення.txt', { type: 'text/plain' })] },
    })

    await screen.findByText('1 із 10 прикріплено')
    expect(screen.queryByText('оновлення.txt')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Показати прикріплені файли' }))
    expect(screen.getByText('оновлення.txt')).toBeVisible()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByText('оновлення.txt')).not.toBeInTheDocument()
    expect(api).toHaveBeenCalledWith(
      '/feed/attachments?company=cmp_lankadws_ua',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('requires confirmation before publishing an attachment without text', async () => {
    mount()
    await screen.findByRole('button', { name: 'Бачать: LankaDWS' })
    fireEvent.change(screen.getByLabelText('Додати файл'), {
      target: { files: [new File(['оновлення'], 'оновлення.txt', { type: 'text/plain' })] },
    })
    await screen.findByText('1 із 10 прикріплено')

    fireEvent.click(screen.getByRole('button', { name: 'Опублікувати' }))
    const confirmation = await screen.findByRole('alertdialog', { name: 'Опублікувати лише файл?' })
    expect(api).not.toHaveBeenCalledWith('/feed', expect.anything())
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Опублікувати файл' }))

    await waitFor(() => expect(api).toHaveBeenCalledWith('/feed', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('"body":""'),
    })))
  })

  it('does not render the removed task and calendar actions', async () => {
    mount()
    await screen.findByRole('button', { name: 'Бачать: LankaDWS' })

    expect(screen.getByRole('checkbox', { name: /Пункт «Ознайомився»/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Створити завдання' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Додати подію' })).not.toBeInTheDocument()
  })
})
