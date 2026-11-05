import { useEffect, useState } from 'react'

export function useDebouncedSearchValue(value: string, delay = 200) {
  const [debouncedValue, setDebouncedValue] = useState('')
  const [isComposing, setIsComposing] = useState(false)

  useEffect(() => {
    if (isComposing) {
      setDebouncedValue('')
      return
    }
    const timer = window.setTimeout(() => setDebouncedValue(value.trim()), delay)
    return () => window.clearTimeout(timer)
  }, [delay, isComposing, value])

  return {
    debouncedValue,
    isComposing,
    onCompositionStart: () => {
      setIsComposing(true)
      setDebouncedValue('')
    },
    onCompositionEnd: () => setIsComposing(false),
  }
}
