import { fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePreservedChatScroll } from './usePreservedChatScroll'

let resize: ResizeObserverCallback

class ResizeObserverMock {
  constructor(callback: ResizeObserverCallback) {
    resize = callback
  }

  observe() {}
  disconnect() {}
  unobserve() {}
}

function ScrollHarness({ conversationId = 'thread-1' }: { conversationId?: string }) {
  const scroll = usePreservedChatScroll(1, conversationId)
  return (
    <div ref={scroll.containerRef} onScroll={scroll.onScroll} onWheel={scroll.onUserScrollIntent}>
      <div ref={scroll.contentRef} />
    </div>
  )
}

describe('usePreservedChatScroll', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    delete (HTMLElement.prototype as { scrollTo?: typeof HTMLElement.prototype.scrollTo }).scrollTo
  })

  it('keeps the newest messages visible when the chat viewport changes height', () => {
    vi.stubGlobal('ResizeObserver', ResizeObserverMock)
    const scrollTo = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: scrollTo })
    const { container } = render(<ScrollHarness />)
    const element = container.firstElementChild as HTMLDivElement
    let clientHeight = 240
    Object.defineProperties(element, {
      clientHeight: { configurable: true, get: () => clientHeight },
      scrollHeight: { configurable: true, get: () => 800 },
    })
    scrollTo.mockClear()

    clientHeight = 160
    resize([], {} as ResizeObserver)

    expect(scrollTo).toHaveBeenCalledWith({ top: 800, behavior: 'auto' })
  })

  it('keeps the bottom anchored when previews increase the message history height', () => {
    vi.stubGlobal('ResizeObserver', ResizeObserverMock)
    const scrollTo = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: scrollTo })
    const { container } = render(<ScrollHarness />)
    const element = container.firstElementChild as HTMLDivElement
    const content = element.firstElementChild as HTMLDivElement
    let contentHeight = 500
    Object.defineProperties(element, {
      clientHeight: { configurable: true, get: () => 240 },
      scrollHeight: { configurable: true, get: () => contentHeight },
    })
    Object.defineProperty(content, 'scrollHeight', { configurable: true, get: () => contentHeight })
    resize([], {} as ResizeObserver)
    scrollTo.mockClear()

    contentHeight = 900
    resize([], {} as ResizeObserver)

    expect(scrollTo).toHaveBeenCalledWith({ top: 900, behavior: 'auto' })
  })

  it('keeps following the bottom when a preview resize emits a scroll event first', () => {
    vi.stubGlobal('ResizeObserver', ResizeObserverMock)
    const scrollTo = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: scrollTo })
    const { container } = render(<ScrollHarness />)
    const element = container.firstElementChild as HTMLDivElement
    const content = element.firstElementChild as HTMLDivElement
    let contentHeight = 500
    Object.defineProperties(element, {
      clientHeight: { configurable: true, get: () => 240 },
      scrollHeight: { configurable: true, get: () => contentHeight },
      scrollTop: { configurable: true, writable: true, value: 260 },
    })
    Object.defineProperty(content, 'scrollHeight', { configurable: true, get: () => contentHeight })
    resize([], {} as ResizeObserver)
    scrollTo.mockClear()

    contentHeight = 900
    fireEvent.scroll(element)
    resize([], {} as ResizeObserver)

    expect(scrollTo).toHaveBeenCalledWith({ top: 900, behavior: 'auto' })
  })

  it('does not pull the user to the bottom when reading older messages', () => {
    vi.stubGlobal('ResizeObserver', ResizeObserverMock)
    const scrollTo = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: scrollTo })
    const { container } = render(<ScrollHarness />)
    const element = container.firstElementChild as HTMLDivElement
    let clientHeight = 240
    Object.defineProperties(element, {
      clientHeight: { configurable: true, get: () => clientHeight },
      scrollHeight: { configurable: true, get: () => 1_000 },
      scrollTop: { configurable: true, writable: true, value: 100 },
    })
    scrollTo.mockClear()
    fireEvent.wheel(element)
    fireEvent.scroll(element)

    clientHeight = 160
    resize([], {} as ResizeObserver)

    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('opens each selected conversation at its newest messages', () => {
    vi.stubGlobal('ResizeObserver', ResizeObserverMock)
    const scrollTo = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: scrollTo })
    const { container, rerender } = render(<ScrollHarness />)
    const element = container.firstElementChild as HTMLDivElement
    Object.defineProperties(element, {
      clientHeight: { configurable: true, get: () => 240 },
      scrollHeight: { configurable: true, get: () => 1_000 },
      scrollTop: { configurable: true, writable: true, value: 100 },
    })
    scrollTo.mockClear()
    fireEvent.wheel(element)
    fireEvent.scroll(element)

    rerender(<ScrollHarness conversationId="thread-2" />)

    expect(scrollTo).toHaveBeenCalledWith({ top: 1_000, behavior: 'auto' })
  })
})
