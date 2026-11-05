import { useCallback, useLayoutEffect, useRef } from 'react'

export function usePreservedChatScroll(itemCount: number, conversationId?: string) {
  const containerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const previousHeightRef = useRef(0)
  const previousCountRef = useRef(0)
  const previousConversationIdRef = useRef(conversationId)
  const isNearBottomRef = useRef(true)
  const userScrollIntentRef = useRef(false)

  const rememberBeforePrepend = useCallback(() => {
    previousHeightRef.current = containerRef.current?.scrollHeight ?? 0
    userScrollIntentRef.current = false
  }, [])

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const element = containerRef.current
    if (!element) return
    element.scrollTo({ top: element.scrollHeight, behavior })
    isNearBottomRef.current = true
    userScrollIntentRef.current = false
  }, [])

  const onScroll = useCallback(() => {
    const element = containerRef.current
    if (!element) return
    const isNearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 120
    if (isNearBottom || userScrollIntentRef.current) isNearBottomRef.current = isNearBottom
    userScrollIntentRef.current = false
  }, [])

  const onUserScrollIntent = useCallback(() => {
    userScrollIntentRef.current = true
  }, [])

  const stopFollowingBottom = useCallback(() => {
    isNearBottomRef.current = false
    userScrollIntentRef.current = false
  }, [])

  useLayoutEffect(() => {
    const element = containerRef.current
    if (!element) return
    if (previousConversationIdRef.current !== conversationId) {
      previousConversationIdRef.current = conversationId
      previousHeightRef.current = 0
      isNearBottomRef.current = true
      scrollToBottom('auto')
    } else if (previousHeightRef.current) {
      element.scrollTop += element.scrollHeight - previousHeightRef.current
      previousHeightRef.current = 0
      isNearBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 120
    } else if (previousCountRef.current === 0 || isNearBottomRef.current) {
      scrollToBottom('auto')
    }
    previousCountRef.current = itemCount
  }, [conversationId, itemCount, scrollToBottom])

  useLayoutEffect(() => {
    const element = containerRef.current
    if (!element || typeof ResizeObserver === 'undefined') return
    let previousClientHeight = element.clientHeight
    let previousContentHeight = contentRef.current?.scrollHeight ?? element.scrollHeight
    let previousScrollHeight = element.scrollHeight
    const observer = new ResizeObserver(() => {
      const nextClientHeight = element.clientHeight
      const nextContentHeight = contentRef.current?.scrollHeight ?? element.scrollHeight
      if (nextClientHeight === previousClientHeight && nextContentHeight === previousContentHeight) return
      const wasNearBottomBeforeResize = previousScrollHeight > 0
        && previousScrollHeight - element.scrollTop - previousClientHeight < 120
      previousClientHeight = nextClientHeight
      previousContentHeight = nextContentHeight
      previousScrollHeight = element.scrollHeight
      if (isNearBottomRef.current || wasNearBottomBeforeResize) scrollToBottom('auto')
    })
    observer.observe(element)
    if (contentRef.current) observer.observe(contentRef.current)
    return () => observer.disconnect()
  }, [scrollToBottom])

  return {
    containerRef,
    contentRef,
    isNearBottomRef,
    onScroll,
    onUserScrollIntent,
    rememberBeforePrepend,
    scrollToBottom,
    stopFollowingBottom,
  }
}
