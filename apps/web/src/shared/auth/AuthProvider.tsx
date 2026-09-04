import type { PropsWithChildren } from 'react'
import { createContext, use, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type AuthNextStep, type LoginInput, type OrganizationCapabilityCode, type PrincipalView } from '@bert-crm/contracts'
import { useQueryClient } from '@tanstack/react-query'
import { api, jsonBody, setCsrfToken } from '../api/client'

type AuthState = 'loading' | 'authenticated' | 'anonymous' | 'restricted'

interface AuthContextValue {
  state: AuthState
  user: PrincipalView | null
  login(input: LoginInput): Promise<AuthNextStep>
  refresh(): Promise<void>
  logout(): Promise<void>
  canUseCapability(capability: OrganizationCapabilityCode): boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: PropsWithChildren) {
  const queryClient = useQueryClient()
  const [state, setState] = useState<AuthState>('loading')
  const [user, setUser] = useState<PrincipalView | null>(null)
  const refreshVersion = useRef(0)

  const refresh = useCallback(async () => {
    const version = ++refreshVersion.current
    try {
      const principal = await api<PrincipalView>('/me')
      if (version !== refreshVersion.current) return
      setCsrfToken(principal.csrfToken)
      setUser(principal)
      setState(principal.mustEnroll2FA ? 'restricted' : 'authenticated')
    } catch {
      if (version !== refreshVersion.current) return
      setUser(null)
      setState('anonymous')
    }
  }, [])

  useEffect(() => {
    const endSession = () => {
      ++refreshVersion.current
      queryClient.clear()
      setCsrfToken('')
      setUser(null)
      setState('anonymous')
    }
    window.addEventListener('bert:session-ended', endSession)
    void refresh()
    return () => window.removeEventListener('bert:session-ended', endSession)
  }, [refresh, queryClient])

  useEffect(() => {
    if (state !== 'authenticated' && state !== 'restricted') return
    const heartbeat = () => {
      void api('/me', { headers: { 'x-session-check': '1' } }).catch(() => undefined)
    }
    const interval = window.setInterval(heartbeat, 15_000)
    document.addEventListener('visibilitychange', heartbeat)
    window.addEventListener('focus', heartbeat)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', heartbeat)
      window.removeEventListener('focus', heartbeat)
    }
  }, [refresh, state])

  const login = useCallback(async (input: LoginInput) => {
    const result = await api<{ nextStep: AuthNextStep; csrfToken?: string }>('/auth/login', { method: 'POST', body: jsonBody(input) })
    if (result.csrfToken) setCsrfToken(result.csrfToken)
    if (result.nextStep === 'AUTHENTICATED') await refresh()
    else setState('restricted')
    return result.nextStep
  }, [refresh])

  const logout = useCallback(async () => {
    ++refreshVersion.current
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
