import { createContext, useContext, useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'

const TopbarContentValueContext = createContext<ReactNode | null>(null)
const TopbarContentSetterContext = createContext<Dispatch<SetStateAction<ReactNode | null>> | null>(null)

export function TopbarContentProvider({ children }: { children: ReactNode }) {
  const [content, setContent] = useState<ReactNode | null>(null)
  const setter = useMemo(() => setContent, [])

  return (
    <TopbarContentSetterContext.Provider value={setter}>
      <TopbarContentValueContext.Provider value={content}>
        {children}
      </TopbarContentValueContext.Provider>
    </TopbarContentSetterContext.Provider>
  )
}

export function TopbarContent({ fallback }: { fallback: ReactNode }) {
  const content = useContext(TopbarContentValueContext)
  return <>{fallback}{content}</>
}

export function useTopbarContent(content: ReactNode): void {
  const setContent = useContext(TopbarContentSetterContext)
  if (!setContent) throw new Error('useTopbarContent must be used inside TopbarContentProvider')

  useEffect(() => {
    setContent(content)
    return () => setContent(null)
  }, [content, setContent])
}
