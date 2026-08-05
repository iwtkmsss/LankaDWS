import { describe, expect, it } from 'vitest'
import { navigationRoutes, routes, routeTitle } from './routes'

describe('canonical route registry', () => {
  it('contains unique browser-history paths and account-type metadata for protected domains', () => {
    expect(new Set(routes.map((route) => route.path)).size).toBe(routes.length)
    expect(routes.find((route) => route.path === '/requests/:requestId')).toBeUndefined()
    expect(routes.find((route) => route.path === '/groups')).toMatchObject({
      capability: 'GROUPS_UI',
      releaseState: 'released',
    })
    expect(routes.find((route) => route.path === '/drive')).toMatchObject({ releaseState: 'released' })
    expect(routes.find((route) => route.path === '/employees/org')).toBeDefined()
    expect(routes.find((route) => route.path === '/admin/import')).toMatchObject({ adminOnly: true, adminChild: true })
    expect(routes.find((route) => route.path === '/overview')).toMatchObject({
      title: 'Огляд',
      navGroup: 'primary',
      navOrder: 1,
    })
    expect(routes.find((route) => route.path === '/feed')).toMatchObject({
      title: 'Жива стрічка',
      capability: 'FEED',
      navGroup: 'communication',
    })
    expect(routes.find((route) => route.path === '/notifications')).toMatchObject({ navGroup: 'communication' })
  })

  it('resolves stable titles for list and deep-link routes', () => {
    expect(routeTitle('/overview')).toBe('Огляд')
    expect(routeTitle('/feed')).toBe('Жива стрічка')
    expect(routeTitle('/requests/req_123')).toBe('Сторінку не знайдено')
    expect(routeTitle('/admin/users/usr_123')).toBe('Користувач')
    expect(routeTitle('/does-not-exist')).toBe('Сторінку не знайдено')
  })

  it('keeps the daily mobile workflow explicit instead of depending on sidebar groups', () => {
    const core = routes
      .filter((route) => route.mobileOrder !== undefined)
      .sort((left, right) => left.mobileOrder! - right.mobileOrder!)
      .map((route) => route.path)
    expect(core).toEqual(['/overview', '/tasks', '/messages', '/calendar'])
  })

  it('groups each sidebar destination once in the requested information architecture', () => {
    const pathsByGroup = Object.fromEntries(
      ['primary', 'communication', 'company', 'management', 'administration'].map((group) => [
        group,
        routes
          .filter((route) => route.navGroup === group)
          .sort((left, right) => (left.navOrder ?? 0) - (right.navOrder ?? 0))
          .map((route) => route.path),
      ]),
    )
    expect(pathsByGroup).toEqual({
      primary: ['/overview'],
      communication: ['/feed', '/messages', '/calendar', '/notifications'],
      company: ['/employees', '/groups', '/drive'],
      management: ['/tasks', '/knowledge', '/analytics'],
      administration: [
        '/admin',
        '/admin/companies',
        '/admin/users',
        '/admin/security',
        '/admin/audit',
        '/admin/import',
        '/admin/system',
      ],
    })
    const sidebarPaths = routes.filter((route) => route.nav).map((route) => route.path)
    expect(new Set(sidebarPaths).size).toBe(sidebarPaths.length)
  })

  it('applies account-type and capability gates to the shared sidebar configuration', () => {
    const visiblePaths = navigationRoutes(
      false,
      (capability) => capability !== 'FEED' && capability !== 'GROUPS_UI',
    ).map((route) => route.path)
    expect(visiblePaths).toContain('/overview')
    expect(visiblePaths).not.toContain('/feed')
    expect(visiblePaths).not.toContain('/groups')
  })
})
