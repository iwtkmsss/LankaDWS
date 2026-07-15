import { Suspense, useEffect } from 'react'
import { createBrowserRouter, Navigate, Outlet, useLocation } from 'react-router-dom'
import { AppShell } from '../layout/AppShell'
import { useAuth } from '../shared/auth/AuthProvider'
import { Skeleton } from '../shared/ui'
import { routes, routeTitle, type RouteMeta } from './routes'
import { LoginPage, RestrictedAccessPage } from '../pages/AuthPages'
import ErrorPage from '../pages/ErrorPage'

function DocumentTitle() {
  const location = useLocation()
  useEffect(() => { document.title = `${routeTitle(location.pathname)} — BERT CRM` }, [location.pathname])
  return null
}

function ProtectedRoot() {
  const auth = useAuth()
  if (auth.state === 'loading') return <main className="center-state"><Skeleton rows={5} /></main>
  if (auth.state === 'anonymous') return <Navigate to="/login" replace />
  if (auth.state === 'restricted') return <Navigate to="/access/setup" replace />
  return <><DocumentTitle /><AppShell><Outlet /></AppShell></>
}

function ProtectedPage({ route }: { route: RouteMeta }) {
  const auth = useAuth()
  if (!auth.can(route.permission)) return <ErrorPage status={403} />
  const Component = route.component
  return <Suspense fallback={<div className="route-loading"><Skeleton rows={5} /></div>}><Component /></Suspense>
}

export const router = createBrowserRouter([
  { path: '/', element: <Navigate to="/overview" replace /> },
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
