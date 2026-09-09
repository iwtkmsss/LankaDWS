import type { PrincipalView } from '@bert-crm/contracts'

export function resolveHomePath(user: Pick<PrincipalView, 'capabilities'> | null): '/feed' | '/tasks' {
  return user ? '/feed' : '/tasks'
}
