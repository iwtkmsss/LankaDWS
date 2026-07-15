import { describe, expect, it } from 'vitest'
import { routes, routeTitle } from './routes'

describe('canonical route registry', () => {
  it('contains unique browser-history paths and permission metadata for protected domains', () => {
    expect(new Set(routes.map((route) => route.path)).size).toBe(routes.length)
    expect(routes.find((route) => route.path === '/admin/roles')?.permission).toBe('roles.manage')
    expect(routes.find((route) => route.path === '/requests/:requestId')?.permission).toBe('requests.read')
  })

  it('resolves stable titles for list and deep-link routes', () => {
    expect(routeTitle('/overview')).toBe('Огляд')
    expect(routeTitle('/requests/req_123')).toBe('Деталі заявки')
    expect(routeTitle('/admin/users/usr_123')).toBe('Користувач')
    expect(routeTitle('/does-not-exist')).toBe('Сторінку не знайдено')
  })
})
