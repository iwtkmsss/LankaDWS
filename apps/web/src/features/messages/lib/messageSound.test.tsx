import type { ChatMessageView, ChatThreadPreview } from '@lankadws/contracts'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const start = vi.fn()
class FakeAudioContext {
  state = 'running'
  currentTime = 0
  destination = {}
  resume = vi.fn().mockResolvedValue(undefined)
  createOscillator() {
    return { type: '', frequency: { value: 0 }, connect: vi.fn(), disconnect: vi.fn(),
      start, stop: vi.fn(), onended: null }
  }
  createGain() {
    return { connect: vi.fn(), disconnect: vi.fn(), gain: {
      setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(),
    } }
  }
}

// Only the fields used by sound eligibility are needed here.
const message = { authorId: 'other', deletedAt: null } as ChatMessageView
const preview = { item: { notificationMode: 'ALL' } } as ChatThreadPreview
let sound: typeof import('./messageSound')

describe('message notification sound', () => {
  beforeEach(async () => {
    vi.resetModules()
    localStorage.clear()
    start.mockClear()
    vi.stubGlobal('AudioContext', FakeAudioContext)
    sound = await import('./messageSound')
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('waits for user activation and plays a short two-note signal', async () => {
    await sound.notifyMessageSound('me', 'thread', message, preview)
    expect(start).not.toHaveBeenCalled()
    function Activate() { sound.useMessageSoundActivation('me'); return null }
    render(<Activate />)
    document.dispatchEvent(new Event('pointerdown'))
    await sound.notifyMessageSound('me', 'thread', message, preview)
    expect(start).toHaveBeenCalledTimes(2)
  })

  it('suppresses own messages, deleted messages, muted chats and a disabled preference', async () => {
    await sound.previewMessageSound()
    start.mockClear()
    await sound.notifyMessageSound('me', 'thread', { ...message, authorId: 'me' }, preview)
    await sound.notifyMessageSound('me', 'thread', { ...message, deletedAt: '2026-10-12T00:00:00Z' }, preview)
    await sound.notifyMessageSound('me', 'thread', message, { item: { notificationMode: 'NONE' } } as ChatThreadPreview)
    localStorage.setItem('lankadws.message-sound.me', 'false')
    await sound.notifyMessageSound('me', 'thread', message, preview)
    expect(start).not.toHaveBeenCalled()
  })

  it('serializes tabs and coalesces a burst using the shared cooldown', async () => {
    await sound.previewMessageSound()
    start.mockClear()
    let queue = Promise.resolve()
    const request = vi.fn((_key: string, callback: () => void) => {
      queue = queue.then(callback)
      return queue
    })
    vi.stubGlobal('navigator', { locks: { request } })
    await Promise.all([
      sound.notifyMessageSound('me', 'thread', message, preview),
      sound.notifyMessageSound('me', 'another', message, preview),
    ])
    expect(request).toHaveBeenCalledTimes(2)
    expect(start).toHaveBeenCalledTimes(2)
    expect(localStorage.getItem('lankadws.message-sound.last.me')).toBeTruthy()
  })

  it('respects a signal recently played by another tab', async () => {
    await sound.previewMessageSound()
    start.mockClear()
    localStorage.setItem('lankadws.message-sound.last.me', String(Date.now()))
    await sound.notifyMessageSound('me', 'thread', message, preview)
    expect(start).not.toHaveBeenCalled()
  })

  it('elects one of two tabs when Web Locks is unavailable', async () => {
    vi.stubGlobal('navigator', {})
    await sound.previewMessageSound()
    vi.resetModules()
    const otherTab = await import('./messageSound')
    await otherTab.previewMessageSound()
    start.mockClear()
    await Promise.all([
      sound.notifyMessageSound('me', 'thread', message, preview),
      otherTab.notifyMessageSound('me', 'thread', message, preview),
    ])
    expect(start).toHaveBeenCalledTimes(2)
  })

  it('suppresses a chat being read here, then rings after the conversation closes', async () => {
    await sound.previewMessageSound()
    start.mockClear()
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    function Reading() { sound.useReadingMessageThread('me', 'thread'); return null }
    const view = render(<Reading />)
    await sound.notifyMessageSound('me', 'thread', message, preview)
    expect(start).not.toHaveBeenCalled()
    view.unmount()
    await sound.notifyMessageSound('me', 'thread', message, preview)
    expect(start).toHaveBeenCalledTimes(2)
  })

  it('suppresses reading in another tab while ignoring expired reading markers', async () => {
    await sound.previewMessageSound()
    start.mockClear()
    const key = 'lankadws.message-sound.reading.me.other-tab.thread'
    localStorage.setItem(key, String(Date.now()))
    await sound.notifyMessageSound('me', 'thread', message, preview)
    expect(start).not.toHaveBeenCalled()
    localStorage.setItem(key, String(Date.now() - 30_000))
    await sound.notifyMessageSound('me', 'thread', message, preview)
    expect(start).toHaveBeenCalledTimes(2)
  })

  it('stores the preference per account and activates audio when enabled', async () => {
    let change: (value: boolean) => void = () => undefined
    function Preference() {
      const [enabled, setEnabled] = sound.useMessageSoundPreference('me')
      change = setEnabled
      return <span>{String(enabled)}</span>
    }
    const view = render(<Preference />)
    act(() => change(false))
    expect(view.container.textContent).toBe('false')
    expect(sound.messageSoundEnabled('me')).toBe(false)
    expect(sound.messageSoundEnabled('other')).toBe(true)
    act(() => change(true))
    expect(view.container.textContent).toBe('true')
    await sound.notifyMessageSound('me', 'thread', message, preview)
    expect(start).toHaveBeenCalledTimes(2)
  })

  it('keeps the toggle functional when browser storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    let change: (value: boolean) => void = () => undefined
    function Preference() {
      const [enabled, setEnabled] = sound.useMessageSoundPreference('me')
      change = setEnabled
      return <span>{String(enabled)}</span>
    }
    const view = render(<Preference />)
    act(() => change(false))
    expect(view.container.textContent).toBe('false')
  })

  it('fails quietly if the browser cannot create audio', async () => {
    vi.stubGlobal('AudioContext', class {
      constructor() { throw new Error('blocked') }
    })
    expect(await sound.previewMessageSound()).toBe(false)
    await expect(sound.notifyMessageSound('me', 'thread', message, preview)).resolves.toBeUndefined()
  })
})
