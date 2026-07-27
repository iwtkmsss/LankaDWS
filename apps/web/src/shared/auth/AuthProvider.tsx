import type { PropsWithChildren } from 'react'
import { createContext, use, useCallback, useEffect, useMemo, useState } from 'react'
import { type AuthNextStep, type LoginInput, type OrganizationCapabilityCode, type PrincipalView } from '@bert-crm/contracts'
import { api, jsonBody, setCsrfToken } from '../api/client'

type AuthState = 'loading' | 'authenticated' | 'anonymous' | 'restricted'

interface AuthContextValue {
  state: AuthState
  user: PrincipalView | null
  login(input: LoginInput): Promise<AuthNextStep>
  refresh(): Promise<void>
  logout(): Promise<void>
  can(permission?: string): boolean
  canUseCapability(capability: OrganizationCapabilityCode): boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<AuthState>('loading')
  const [user, setUser] = useState<PrincipalView | null>(null)

  const refresh = useCallback(async () => {
    try {
      const principal = await api<PrincipalView>('/me')
      setCsrfToken(principal.csrfToken)
      setUser(principal)
      setState(principal.mustEnroll2FA ? 'restricted' : 'authenticated')
    } catch {
      setUser(null)
      setState('anonymous')
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const login = useCallback(async (input: LoginInput) => {
    const result = await api<{ nextStep: AuthNextStep; csrfToken?: string }>('/auth/login', { method: 'POST', body: jsonBody(input) })
    if (result.csrfToken) setCsrfToken(result.csrfToken)
    if (result.nextStep === 'AUTHENTICATED') await refresh()
    else setState('restricted')
    return result.nextStep
  }, [refresh])

  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined)
    setCsrfToken('')
    setUser(null)
    setState('anonymous')
  }, [])

  const value = useMemo<AuthContextValue>(() => ({
    state,
    user,
    login,
    refresh,
    logout,
    can: (permission) => !permission || Boolean(user?.permissions.includes(permission)),
    canUseCapability: (capability) => {
      if (!user) return false
      return user.capabilities.some(
        (item) => item.code === capability && item.enabled,
      )
    },
  }), [state, user, login, refresh, logout])
  return <AuthContext value={value}>{children}</AuthContext>
}

export function useAuth(): AuthContextValue {
  const value = use(AuthContext)
  if (!value) throw new Error('useAuth must be inside AuthProvider')
  return value
}
