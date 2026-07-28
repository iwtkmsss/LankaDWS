import { useCallback, useLayoutEffect, useRef } from 'react'

export function usePreservedChatScroll(itemCount: number) {
  const containerRef = useRef<HTMLDivElement>(null)
  const previousHeightRef = useRef(0)
  const previousCountRef = useRef(0)
  const isNearBottomRef = useRef(true)

  const rememberBeforePrepend = useCallback(() => {
    previousHeightRef.current = containerRef.current?.scrollHeight ?? 0
  }, [])

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const element = containerRef.current
    if (!element) return
    element.scrollTo({ top: element.scrollHeight, behavior })
    isNearBottomRef.current = true
  }, [])

  const onScroll = useCallback(() => {
    const element = containerRef.current
    if (!element) return
    isNearBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 120
  }, [])

  useLayoutEffect(() => {
    const element = containerRef.current
    if (!element) return
    if (previousHeightRef.current) {
      element.scrollTop += element.scrollHeight - previousHeightRef.current
      previousHeightRef.current = 0
    } else if (previousCountRef.current === 0 || isNearBottomRef.current) {
      scrollToBottom('auto')
    }
    previousCountRef.current = itemCount
  }, [itemCount, scrollToBottom])

  return {
    containerRef,
    isNearBottomRef,
    onScroll,
    rememberBeforePrepend,
    scrollToBottom,
  }
}
