import {
  createContext,
  useCallback,
  useContext,
  type ComponentProps,
  type PropsWithChildren,
} from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'

interface UserProfileContextValue {
  requestedUserId: string | null
  openUserProfile: (userId: string) => void
  closeUserProfile: () => void
}

const UserProfileContext = createContext<UserProfileContextValue | null>(null)

export function UserProfileProvider({ children }: PropsWithChildren) {
  const [params, setParams] = useSearchParams()
  const employeeId = params.get('employeeId')
  const openUserProfile = useCallback((userId: string) => {
    setParams((current) => {
      const next = new URLSearchParams(current)
      next.set('employeeId', userId)
      return next
    })
  }, [setParams])
  const closeUserProfile = useCallback(() => {
    setParams((current) => {
      const next = new URLSearchParams(current)
      next.delete('employeeId')
      return next
    }, { replace: true })
  }, [setParams])

  return (
    <UserProfileContext.Provider value={{ requestedUserId: employeeId, openUserProfile, closeUserProfile }}>
      {children}
    </UserProfileContext.Provider>
  )
}

export function useUserProfile() {
  const context = useContext(UserProfileContext)
  if (!context) throw new Error('useUserProfile must be used within UserProfileProvider')
  return context
}

export function UserProfileLink({
  userId,
  ...props
}: Omit<ComponentProps<typeof Link>, 'to'> & { userId: string }) {
  const location = useLocation()
  const params = new URLSearchParams(location.search)
  params.set('employeeId', userId)
  return <Link {...props} to={`${location.pathname}?${params.toString()}${location.hash}`} />
}
