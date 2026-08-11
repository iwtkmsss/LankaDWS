import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useDebouncedSearchValue } from './useDebouncedSearchValue'

function SearchInput() {
  const [value, setValue] = useState('')
  const search = useDebouncedSearchValue(value)
  return (
    <>
      <input
        aria-label="Пошук"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onCompositionStart={search.onCompositionStart}
        onCompositionEnd={search.onCompositionEnd}
      />
      <output data-testid="debounced-search">{search.isComposing ? 'composing' : search.debouncedValue}</output>
    </>
  )
}

describe('useDebouncedSearchValue', () => {
  afterEach(() => vi.useRealTimers())

  it('waits for IME composition to finish before it debounces a query', () => {
    vi.useFakeTimers()
    render(<SearchInput />)
    const input = screen.getByRole('textbox', { name: 'Пошук' })

    fireEvent.compositionStart(input)
    fireEvent.change(input, { target: { value: 'あ' } })
    act(() => vi.advanceTimersByTime(250))
    expect(screen.getByTestId('debounced-search')).toHaveTextContent('composing')

    fireEvent.compositionEnd(input)
    act(() => vi.advanceTimersByTime(199))
    expect(screen.getByTestId('debounced-search')).toHaveTextContent('')
    act(() => vi.advanceTimersByTime(1))
    expect(screen.getByTestId('debounced-search')).toHaveTextContent('あ')
  })
})
