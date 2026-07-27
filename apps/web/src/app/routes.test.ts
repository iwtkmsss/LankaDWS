import { describe, expect, it } from 'vitest'
import { routes, routeTitle } from './routes'

describe('canonical route registry', () => {
  it('contains unique browser-history paths and permission metadata for protected domains', () => {
    expect(new Set(routes.map((route) => route.path)).size).toBe(routes.length)
    expect(routes.find((route) => route.path === '/admin/roles')?.permission).toBe('roles.manage')
    expect(routes.find((route) => route.path === '/requests/:requestId')?.permission).toBe('requests.read')
    expect(routes.find((route) => route.path === '/groups')).toMatchObject({ releaseState: 'released' })
    expect(routes.find((route) => route.path === '/drive')).toMatchObject({ releaseState: 'released' })
    expect(routes.find((route) => route.path === '/employees/org')?.permission).toBe('employees.org.read')
    expect(routes.find((route) => route.path === '/admin/import')).toMatchObject({ permission: 'system.manage', adminChild: true })
  })

  it('resolves stable titles for list and deep-link routes', () => {
    expect(routeTitle('/overview')).toBe('Огляд')
    expect(routeTitle('/requests/req_123')).toBe('Деталі заявки')
    expect(routeTitle('/admin/users/usr_123')).toBe('Користувач')
    expect(routeTitle('/does-not-exist')).toBe('Сторінку не знайдено')
  })

  it('keeps the daily mobile workflow explicit instead of depending on registry order', () => {
    const core = routes
      .filter((route) => route.navGroup === 'core')
      .sort((left, right) => (left.navOrder ?? 0) - (right.navOrder ?? 0))
      .map((route) => route.path)
    expect(core).toEqual(['/overview', '/tasks', '/messages', '/calendar'])
  })
})
