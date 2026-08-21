import { Suspense, useEffect } from 'react'
import { createBrowserRouter, Navigate, Outlet, useLocation } from 'react-router-dom'
import { AppShell } from '../layout/AppShell'
import { useAuth } from '../shared/auth/AuthProvider'
import { resolveHomePath } from '../shared/auth/home'
import { OverlayProvider, PageDataLoader, Skeleton } from '../shared/ui'
import { routes, routeTitle, type RouteMeta } from './routes'
import { LoginPage, RestrictedAccessPage } from '../pages/AuthPages'
import ErrorPage from '../pages/ErrorPage'
import { ModuleUnavailablePage } from '../pages/ModuleUnavailablePage'

function DocumentTitle() {
  const location = useLocation()
  useEffect(() => { document.title = `${routeTitle(location.pathname)} — BERT CRM` }, [location.pathname])
  return null
}

function ProtectedRoot() {
  const auth = useAuth()
  const location = useLocation()
  if (auth.state === 'loading') return <main className="center-state"><Skeleton rows={5} /></main>
  if (auth.state === 'anonymous') return <Navigate to="/login" replace />
  if (auth.state === 'restricted') return <Navigate to="/access/setup" replace />
  const search = new URLSearchParams(location.search)
  if (search.has('company')) {
    search.delete('company')
    const nextSearch = search.toString()
    return <Navigate to={`${location.pathname}${nextSearch ? `?${nextSearch}` : ''}${location.hash}`} replace />
  }
  return (
    <>
      <DocumentTitle />
      <OverlayProvider>
        <AppShell><Outlet /></AppShell>
      </OverlayProvider>
    </>
  )
}

function ProtectedPage({ route }: { route: RouteMeta }) {
  const auth = useAuth()
  if (route.adminOnly && auth.user?.accountType !== 'ADMIN') return <ErrorPage status={403} />
  if (route.capability && !auth.canUseCapability(route.capability)) {
    return <ModuleUnavailablePage title={route.title} state="disabled" />
  }
  if (route.releaseState === 'planned') return <ModuleUnavailablePage title={route.title} state="preparing" />
  const Component = route.component
  return <Suspense fallback={<div className="route-loading"><PageDataLoader /></div>}><Component /></Suspense>
}

function HomeRedirect() {
  const auth = useAuth()
  if (auth.state === 'loading') return <main className="center-state"><Skeleton rows={5} /></main>
  if (auth.state === 'anonymous') return <Navigate to="/login" replace />
  if (auth.state === 'restricted') return <Navigate to="/access/setup" replace />
  return <Navigate to={resolveHomePath(auth.user)} replace />
}

export const router = createBrowserRouter([
  { path: '/', element: <HomeRedirect /> },
  { path: '/login', element: <LoginPage /> },
  { path: '/first-login', element: <RestrictedAccessPage mode="first-login" /> },
  { path: '/password-changed', element: <RestrictedAccessPage mode="password-changed" /> },
  { path: '/access-help', element: <RestrictedAccessPage mode="help" /> },
  { path: '/access/setup', element: <RestrictedAccessPage mode="setup" /> },
  { path: '/access/challenge', element: <RestrictedAccessPage mode="challenge" /> },
  { path: '/errors/offline', element: <ErrorPage status="offline" /> },
  { path: '/errors/500', element: <ErrorPage status={500} /> },
  { path: '/errors/conflict', element: <ErrorPage status="conflict" /> },
  { path: '/errors/maintenance', element: <ErrorPage status="maintenance" /> },
  {
    element: <ProtectedRoot />,
    children: routes.map((route) => ({ path: route.path, element: <ProtectedPage route={route} /> })),
  },
  { path: '*', element: <ErrorPage status={404} /> },
])
