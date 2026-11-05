import type { PrincipalView } from '@lankadws/contracts'

export function resolveHomePath(user: Pick<PrincipalView, 'capabilities'> | null): '/feed' | '/tasks' {
  return user ? '/feed' : '/tasks'
}
