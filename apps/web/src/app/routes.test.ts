import { describe, expect, it } from 'vitest'
import { mobileNavigation, mobileNavigationLabels, navigationRoutes, routes, routeTitle } from './routes'

describe('canonical route registry', () => {
  it('contains unique browser-history paths and account-type metadata for protected domains', () => {
    expect(new Set(routes.map((route) => route.path)).size).toBe(routes.length)
    expect(routes.find((route) => route.path === '/requests/:requestId')).toBeUndefined()
    expect(routes.find((route) => route.path === '/groups')).toMatchObject({
      capability: 'GROUPS_UI',
      releaseState: 'released',
    })
    expect(routes.find((route) => route.path === '/drive')).toMatchObject({ releaseState: 'released' })
    expect(routes.find((route) => route.path === '/organization')).toMatchObject({
      title: 'Організація',
      nav: true,
      navGroup: 'company',
      navOrder: 2,
    })
    expect(routes.find((route) => route.path === '/employees/org')?.nav).toBeUndefined()
    expect(routes.find((route) => route.path === '/companies')).toMatchObject({ title: 'Організація' })
    expect(routes.find((route) => route.path === '/companies')?.nav).toBeUndefined()
    expect(routes.find((route) => route.path === '/overview')).toBeUndefined()
    expect(routes.find((route) => route.path === '/analytics')).toBeUndefined()
    expect(routes.find((route) => route.path === '/feed')).toMatchObject({
      title: 'Жива стрічка',
      capability: 'FEED',
      navGroup: 'primary',
    })
    expect(routes.find((route) => route.path === '/notifications')).toMatchObject({ navGroup: 'communication' })
  })

  it('resolves stable titles for list and deep-link routes', () => {
    expect(routeTitle('/overview')).toBe('Сторінку не знайдено')
    expect(routeTitle('/analytics')).toBe('Сторінку не знайдено')
    expect(routeTitle('/feed')).toBe('Жива стрічка')
    expect(routeTitle('/requests/req_123')).toBe('Сторінку не знайдено')
    expect(routeTitle('/admin/users/usr_123')).toBe('Користувач')
    expect(routeTitle('/does-not-exist')).toBe('Сторінку не знайдено')
  })

  it('keeps the approved mobile footer and overflow order explicit', () => {
    expect(mobileNavigation.primary).toEqual(['/feed', '/tasks', '/messages', '/drive'])
    expect(mobileNavigation.more).toEqual(['/calendar', '/organization'])
    expect(mobileNavigationLabels['/organization']).toBe('Організація')
    const configuredRoutes = [...mobileNavigation.primary, ...mobileNavigation.more]
    expect(new Set(configuredRoutes).size).toBe(configuredRoutes.length)
    expect(configuredRoutes.every((path) => routes.some((route) => route.path === path && route.nav))).toBe(true)
  })

  it('exposes preloaders for the primary desktop destinations', () => {
    for (const path of ['/feed', '/tasks', '/messages', '/drive', '/calendar', '/organization']) {
      expect(routes.find((route) => route.path === path)?.preload).toEqual(expect.any(Function))
    }
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
      primary: ['/feed', '/tasks', '/messages', '/drive', '/calendar'],
      communication: ['/notifications'],
      company: ['/groups', '/organization'],
      management: ['/knowledge'],
      administration: [
        '/admin/users',
        '/admin/audit',
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
    expect(visiblePaths).not.toContain('/overview')
    expect(visiblePaths).not.toContain('/analytics')
    expect(visiblePaths).not.toContain('/feed')
    expect(visiblePaths).not.toContain('/groups')
  })
})
