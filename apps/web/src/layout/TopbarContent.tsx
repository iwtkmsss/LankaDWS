import { createContext, useContext, useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'

const TopbarContentValueContext = createContext<ReactNode | null>(null)
const TopbarContentSetterContext = createContext<Dispatch<SetStateAction<ReactNode | null>> | null>(null)
const TopbarCenterValueContext = createContext<ReactNode | null>(null)
const TopbarCenterSetterContext = createContext<Dispatch<SetStateAction<ReactNode | null>> | null>(null)

export function TopbarContentProvider({ children }: { children: ReactNode }) {
  const [content, setContent] = useState<ReactNode | null>(null)
  const [centerContent, setCenterContent] = useState<ReactNode | null>(null)
  const setter = useMemo(() => setContent, [])
  const centerSetter = useMemo(() => setCenterContent, [])

  return (
    <TopbarContentSetterContext.Provider value={setter}>
      <TopbarCenterSetterContext.Provider value={centerSetter}>
        <TopbarContentValueContext.Provider value={content}>
          <TopbarCenterValueContext.Provider value={centerContent}>
            {children}
          </TopbarCenterValueContext.Provider>
        </TopbarContentValueContext.Provider>
      </TopbarCenterSetterContext.Provider>
    </TopbarContentSetterContext.Provider>
  )
}

export function TopbarContent() {
  const content = useContext(TopbarContentValueContext)
  return <>{content}</>
}

export function TopbarCenterContent({ fallback }: { fallback: ReactNode }) {
  const content = useContext(TopbarCenterValueContext)
  return <>{content ?? fallback}</>
}

export function useTopbarContent(content: ReactNode): void {
  const setContent = useContext(TopbarContentSetterContext)
  if (!setContent) throw new Error('useTopbarContent must be used inside TopbarContentProvider')

  useEffect(() => {
    setContent(content)
    return () => setContent(null)
  }, [content, setContent])
}

export function useTopbarCenterContent(content: ReactNode): void {
  const setContent = useContext(TopbarCenterSetterContext)
  if (!setContent) throw new Error('useTopbarCenterContent must be used inside TopbarContentProvider')

  useEffect(() => {
    setContent(content)
    return () => setContent(null)
  }, [content, setContent])
}
