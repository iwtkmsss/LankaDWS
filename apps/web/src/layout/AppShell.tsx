import type { PropsWithChildren } from 'react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { FeedSummary } from '@lankadws/contracts'
import {
  ChevronDown,
  Ellipsis,
  Gauge,
  KeyRound,
  LogOut,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Search,
  ShieldCheck,
  Sun,
  Users,
  X,
} from 'lucide-react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import type { RouteMeta } from '../app/routes'
import { mobileNavigation, mobileNavigationLabels, navigationRoutes, routes } from '../app/routes'
import { CommandPalette } from '../features/search/CommandPalette'
import { useUserProfile } from '../features/employees/UserProfileDrawer'
import { api } from '../shared/api/client'
import { useAuth } from '../shared/auth/AuthProvider'
import { resolveHomePath } from '../shared/auth/home'
import { applyTheme, getStoredTheme, storeTheme } from '../shared/theme'
import { Avatar, BrandMark, IconButton } from '../shared/ui'
import { RightCommunicationPanel } from './RightCommunicationPanel'
import { TopbarCenterContent, TopbarContent, TopbarContentProvider } from './TopbarContent'
import { useMessageRealtime } from '../features/messages/hooks/useMessageRealtime'

interface SidebarNavSection {
  key: NonNullable<RouteMeta['navGroup']>
  label: string
  items: RouteMeta[]
}
const sidebarNavGroups = [
  { key: 'primary', label: 'Щоденна робота' },
  { key: 'communication', label: 'Комунікації' },
  { key: 'company', label: 'Співпраця' },
  { key: 'management', label: 'Знання' },
  { key: 'administration', label: 'Адміністрування' },
] as const

const sidebarNavVerticalPadding = 30
const sidebarNavItemHeight = 44
const sidebarNavFirstSectionLabelHeight = 17
const sidebarNavFollowingSectionChrome = 37
const sidebarMoreTriggerHeight = 53

function sidebarSectionsHeight(sections: SidebarNavSection[]) {
  return sections.reduce((height, section, index) =>
    height
    + section.items.length * sidebarNavItemHeight
    + (index === 0 ? sidebarNavFirstSectionLabelHeight : sidebarNavFollowingSectionChrome), 0)
}

export function AppShell({ children }: PropsWithChildren) {
  const { user, canUseCapability, logout } = useAuth()
  const { requestedUserId, closeUserProfile } = useUserProfile()
  const location = useLocation()
  const queryClient = useQueryClient()
  const [mobileNav, setMobileNav] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() =>
    window.localStorage.getItem('lankadws.sidebar.collapsed') === 'true')
  const [rightPanelOpen, setRightPanelOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [theme, setTheme] = useState(getStoredTheme)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false)
  const [desktopNavHeight, setDesktopNavHeight] = useState<number | null>(null)
  const sidebarNavRef = useRef<HTMLElement>(null)
  const sidebarMoreTriggerRef = useRef<HTMLButtonElement>(null)
  const sidebarMoreMenuRef = useRef<HTMLDivElement>(null)
  const profileMenuRef = useRef<HTMLDivElement>(null)
  const mobileMoreTriggerRef = useRef<HTMLButtonElement>(null)
  const mobileMoreMenuRef = useRef<HTMLDivElement>(null)
  const companyId = user?.company?.id ?? 'global-admin'
  const feedCompanyScope = user?.company?.id ?? 'all'
  useMessageRealtime(Boolean(user))
  const prefetchNavigationRoute = (route: RouteMeta) => {
    void route.preload?.()
    if (!user?.company?.id) return

    const company = user.company.id
    if (route.path === '/tasks') {
      void queryClient.prefetchQuery({
        queryKey: ['tasks', 'RESPONSIBLE', 1, null, '', '', '', '', '', false, '', '', '', '', '', '', '', ''],
        queryFn: () => api('/tasks?role=RESPONSIBLE&page=1&company=&search=&status=&priority=&favorite=&important=&overdue=&preset=&dueFrom=&dueTo=&groupId=&assigneeId=&creatorId=&coExecutorId=&observerId='),
      })
    } else if (route.path === '/feed') {
      void queryClient.prefetchQuery({ queryKey: ['dashboard'], queryFn: () => api('/dashboard') })
      void queryClient.prefetchInfiniteQuery({
        queryKey: ['feed', company, 'ALL', 'ALL', null, null, null, null, null, false, false, false],
        initialPageParam: null as string | null,
        queryFn: () => api(`/feed?company=${encodeURIComponent(company)}&filter=ALL&type=ALL&limit=20`),
      })
    } else if (route.path === '/messages') {
      void queryClient.prefetchInfiniteQuery({
        queryKey: ['messages', 'threads', company, false],
        initialPageParam: null as string | null,
        queryFn: () => api(`/messages/threads?company=${encodeURIComponent(company)}&limit=30`),
      })
      void queryClient.prefetchQuery({
        queryKey: ['messages', 'recommended', company],
        queryFn: () => api(`/messages/users/recommended?company=${encodeURIComponent(company)}&limit=6`),
        staleTime: 60_000,
      })
    } else if (route.path === '/drive') {
      const driveQuery = {
        view: 'MY_DRIVE', folderId: undefined, type: 'ALL',
        people: 'ANYONE', modified: 'ANY', sort: 'MODIFIED', direction: 'DESC',
      }
      void queryClient.prefetchQuery({
        queryKey: ['drive', driveQuery],
        queryFn: () => api('/drive?view=MY_DRIVE&type=ALL&people=ANYONE&modified=ANY&sort=MODIFIED&direction=DESC'),
      })
    } else if (route.path === '/organization') {
      void queryClient.prefetchQuery({
        queryKey: ['employees', '', company, '', '', ''],
        queryFn: () => api(`/employees?company=${encodeURIComponent(company)}`),
      })
    }
  }
  const nav = useMemo(
    () => navigationRoutes(user?.accountType === 'ADMIN', canUseCapability),
    [user?.accountType, canUseCapability],
  )
  const navSections = useMemo(
    () => sidebarNavGroups
      .map(({ key, label }) => ({
        key,
        label,
        items: nav.filter((route) => route.navGroup === key),
      }))
      .filter((section) => section.items.length > 0),
    [nav],
  )
  const paletteShortcuts = useMemo(() => nav
    .map((route) => ({
      path: route.path,
      title: route.title,
      safeSnippet: 'Відкрити розділ',
    })), [nav])
  const desktopNavRoutes = navSections.flatMap((section) => section.items)
  let visibleRouteCount = desktopNavRoutes.length
  if (desktopNavHeight !== null) {
    const availableHeight = Math.max(0, desktopNavHeight - sidebarNavVerticalPadding)
    if (sidebarSectionsHeight(navSections) > availableHeight) {
      for (let count = desktopNavRoutes.length - 1; count >= 1; count -= 1) {
        const candidatePaths = new Set(desktopNavRoutes.slice(0, count).map((route) => route.path))
        const candidateSections = navSections
          .map((section) => ({
            ...section,
            items: section.items.filter((route) => candidatePaths.has(route.path)),
          }))
          .filter((section) => section.items.length > 0)
        if (sidebarSectionsHeight(candidateSections) + sidebarMoreTriggerHeight <= availableHeight) {
          visibleRouteCount = count
          break
        }
        visibleRouteCount = 1
      }
    }
  }
  const visibleRoutes = desktopNavRoutes.slice(0, visibleRouteCount)
  const overflowRoutes = desktopNavRoutes.slice(visibleRouteCount)
  const visibleRoutePaths = new Set(visibleRoutes.map((route) => route.path))
  const overflowRoutePaths = new Set(overflowRoutes.map((route) => route.path))
  const visibleNavSections = navSections
    .map((section) => ({
      ...section,
      items: section.items.filter((route) => visibleRoutePaths.has(route.path)),
    }))
    .filter((section) => section.items.length > 0)
  const overflowNavSections = navSections
    .map((section) => ({
      ...section,
      items: section.items.filter((route) => overflowRoutePaths.has(route.path)),
    }))
    .filter((section) => section.items.length > 0)
  const overflowHasActiveRoute = overflowRoutes.some((route) =>
    location.pathname === route.path
    || location.pathname.startsWith(`${route.path}/`))
  const mobilePrimaryRoutes = mobileNavigation.primary.flatMap((path) => {
    const route = nav.find((candidate) => candidate.path === path)
    return route ? [route] : []
  })
  const mobileMoreRoutes = mobileNavigation.more.flatMap((path) => {
    const route = nav.find((candidate) => candidate.path === path)
    return route ? [route] : []
  })
  const mobileMoreHasActiveRoute = mobileMoreRoutes.some((route) =>
    location.pathname === route.path || location.pathname.startsWith(`${route.path}/`))
  const isMessagesRoute = location.pathname === '/messages'
    || location.pathname.startsWith('/messages/')
  const isMessageThreadRoute = location.pathname.startsWith('/messages/')
  // Realtime `summary` SSE events (useMessageRealtime) are the primary refresh
  // path for these badges. This slow fallback poll bounds staleness for
  // notifications created without any realtime signal — job-worker task
  // reminders (jobs.service), task participation/approval changes,
  // admin credential resets — and for SSE connections dropped by a proxy,
  // which EventSource reconnects but does not replay.
  const summaryBadgeFallback = {
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  } as const
  const notificationSummary = useQuery({
    queryKey: ['notifications', 'summary'],
    queryFn: () => api<{ action: number; unread: number }>('/notifications/summary'),
    enabled: Boolean(user),
    ...summaryBadgeFallback,
  })
  const chatSummary = useQuery({
    queryKey: ['threads', 'summary', companyId],
    queryFn: () => api<{ all: number; unread: number }>('/messages/summary'),
    enabled: Boolean(user),
    ...summaryBadgeFallback,
  })
  const feedSummary = useQuery({
    queryKey: ['feed', 'summary', feedCompanyScope],
    queryFn: () => api<FeedSummary>(`/feed/summary?company=${encodeURIComponent(feedCompanyScope)}`),
    enabled: Boolean(user),
    ...summaryBadgeFallback,
  })
  const chatUnread = chatSummary.data?.unread ?? 0
  const feedUnread = feedSummary.data?.unreadCount ?? 0
  useEffect(() => {
    window.localStorage.setItem('lankadws.sidebar.collapsed', String(sidebarCollapsed))
  }, [sidebarCollapsed])

  useEffect(() => {
    applyTheme(theme)
    storeTheme(theme)
  }, [theme])

  useLayoutEffect(() => {
    const navElement = sidebarNavRef.current
    if (!navElement) return
    const desktopQuery = window.matchMedia('(min-width: 1051px)')
    const updateHeight = () => {
      setDesktopNavHeight(desktopQuery.matches ? navElement.clientHeight : null)
    }
    updateHeight()
    const resizeObserver = new ResizeObserver(updateHeight)
    resizeObserver.observe(navElement)
    desktopQuery.addEventListener('change', updateHeight)
    return () => {
      resizeObserver.disconnect()
      desktopQuery.removeEventListener('change', updateHeight)
    }
  }, [])

  useEffect(() => {
    if (overflowRoutes.length === 0) setMoreOpen(false)
  }, [overflowRoutes.length])

  useEffect(() => {
    if (!requestedUserId) return
    setProfileOpen(false)
    setMoreOpen(false)
    setMobileNav(false)
    setRightPanelOpen(true)
    setSidebarCollapsed(true)
  }, [requestedUserId])

  useEffect(() => {
    setMoreOpen(false)
    setMobileMoreOpen(false)
  }, [location.pathname])

  useEffect(() => {
    if (!mobileMoreOpen) return
    const frame = window.requestAnimationFrame(() => {
      mobileMoreMenuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    })
    return () => { window.cancelAnimationFrame(frame) }
  }, [mobileMoreOpen])

  useEffect(() => {
    if (!profileOpen) return
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !profileMenuRef.current?.contains(event.target)) {
        setProfileOpen(false)
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [profileOpen])

  useEffect(() => {
    if (!moreOpen) return
    const handlePointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node
        && !sidebarMoreTriggerRef.current?.contains(event.target)
        && !sidebarMoreMenuRef.current?.contains(event.target)
      ) {
        setMoreOpen(false)
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [moreOpen])

  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setProfileOpen(false)
        setMoreOpen(false)
        setMobileMoreOpen(false)
        setPaletteOpen(true)
      } else if (event.key === 'Escape') {
        setProfileOpen(false)
        setMoreOpen(false)
        setMobileMoreOpen(false)
        setRightPanelOpen(false)
        closeUserProfile()
      }
    }
    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  }, [closeUserProfile])

  if (!user) return null
  const homePath = resolveHomePath(user)
  const scopedPath = (path: string) => path
  function renderNavRoute(route: (typeof routes)[number], menuItem = false) {
    const Icon = route.navIcon ?? Gauge
    const title = route.title
    return (
      <NavLink
        key={route.path}
        to={scopedPath(route.path)}
        end={false}
        role={menuItem ? 'menuitem' : undefined}
        aria-label={sidebarCollapsed ? title : undefined}
        title={sidebarCollapsed ? title : undefined}
        onClick={() => {
          setMobileNav(false)
          setMoreOpen(false)
        }}
        onPointerEnter={() => prefetchNavigationRoute(route)}
        onFocus={() => prefetchNavigationRoute(route)}
      >
        <Icon size={18} />
        <span>{title}</span>
        {route.path === '/messages' && chatUnread > 0 && (
          <b className="nav-unread-badge" aria-label={`${chatUnread} непрочитаних діалогів`}>
            {chatUnread > 99 ? '99+' : chatUnread}
          </b>
        )}
        {route.path === '/feed' && feedUnread > 0 && (
          <b className="nav-unread-badge" aria-label={`${feedUnread} непрочитаних оновлень у стрічці`}>
            {feedUnread > 99 ? '99+' : feedUnread}
          </b>
        )}
        {route.path === '/notifications' && (notificationSummary.data?.unread ?? 0) > 0 && (
          <b className="nav-unread-badge" aria-label={`${notificationSummary.data!.unread} непрочитаних сповіщень`}>
            {notificationSummary.data!.unread > 99 ? '99+' : notificationSummary.data!.unread}
          </b>
        )}
      </NavLink>
    )
  }
  function renderNavSection(
    label: string,
    items: typeof nav,
    className: string,
    menuItems = false,
  ) {
    if (items.length === 0) return null
    return (
      <div key={className} className={`nav-section nav-section--${className}`}>
        <span className="nav-section__label">{label}</span>
        {items.map((route) => renderNavRoute(route, menuItems))}
      </div>
    )
  }
  return (
    <TopbarContentProvider>
      <div className={[
      'app-frame',
      sidebarCollapsed ? 'sidebar-collapsed' : '',
      rightPanelOpen ? 'right-panel-open' : '',
      isMessagesRoute ? 'app-frame--messages' : '',
      isMessageThreadRoute ? 'app-frame--messages-thread' : '',
    ].filter(Boolean).join(' ')}>
      <a className="skip-link" href="#main-content">
        Перейти до вмісту
      </a>
      {mobileNav && <button className="nav-scrim" aria-label="Закрити меню" onClick={() => setMobileNav(false)} />}
      <aside className={`sidebar ${mobileNav ? 'is-open' : ''}`}>
        <div className="sidebar__brand">
          <Link
            className="sidebar__brand-home"
            to={homePath}
            aria-label="На головну сторінку"
            onClick={(event) => {
              if (location.pathname === homePath) {
                event.preventDefault()
                return
              }
              setMobileNav(false)
              setMoreOpen(false)
            }}
          >
            <BrandMark />
            <span className="sidebar__brand-copy">
              <strong>Lanka</strong>
              <small>CORPORATE WORKSPACE</small>
            </span>
          </Link>
          <IconButton
            className="sidebar__collapse"
            label={sidebarCollapsed ? 'Розгорнути бічну панель' : 'Згорнути бічну панель'}
            onClick={() => {
              setMoreOpen(false)
              setSidebarCollapsed((value) => {
                if (value) setRightPanelOpen(false)
                return !value
              })
            }}
          >
            {sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </IconButton>
          <IconButton label="Закрити меню" onClick={() => setMobileNav(false)}>
            <X size={18} />
          </IconButton>
        </div>
        <nav ref={sidebarNavRef} className="sidebar__nav" aria-label="Головна навігація">
          {visibleNavSections.map((section) =>
            renderNavSection(section.label, section.items, section.key))}
          {overflowRoutes.length > 0 && (
            <div className="sidebar-more">
              <button
                ref={sidebarMoreTriggerRef}
                type="button"
                className={`sidebar-more__trigger ${overflowHasActiveRoute ? 'active' : ''}`}
                aria-label="Ще"
                title={sidebarCollapsed ? 'Ще' : undefined}
                aria-haspopup="menu"
                aria-expanded={moreOpen}
                onClick={() => {
                  setProfileOpen(false)
                  setMoreOpen((value) => !value)
                }}
              >
                <Ellipsis size={18} />
                <span>Ще</span>
              </button>
            </div>
          )}
        </nav>
        {moreOpen && overflowRoutes.length > 0 && (
          <div ref={sidebarMoreMenuRef} className="sidebar-more__menu" role="menu" aria-label="Додаткові розділи">
            {overflowNavSections.map((section) =>
              renderNavSection(section.label, section.items, section.key, true))}
          </div>
        )}
        <div ref={profileMenuRef} className="sidebar__profile">
          {profileOpen && (
            <div className="profile-popover">
              <strong>{user.displayName}</strong>
              <small>
                @{user.username}
              </small>
              <Link to={scopedPath('/settings/profile')}>
                <Users size={15} />
                Профіль
              </Link>
              <Link to={scopedPath('/settings/security')}>
                <KeyRound size={15} />
                Безпека
              </Link>
              <Link to={scopedPath('/settings/sessions')}>
                <ShieldCheck size={15} />
                Сесії
              </Link>
              <button
                type="button"
                className="profile-theme-toggle"
                role="switch"
                aria-checked={theme === 'dark'}
                onClick={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')}
              >
                {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
                <span>Темна тема</span>
                <span className="theme-switch" aria-hidden="true"><i /></span>
              </button>
              <button onClick={() => void logout()}>
                <LogOut size={15} />
                Вийти
              </button>
            </div>
          )}
          <button
            className="profile-button"
            aria-label={sidebarCollapsed ? `Профіль: ${user.displayName}` : undefined}
            title={sidebarCollapsed ? user.displayName : undefined}
            onClick={() => {
              setMoreOpen(false)
              setProfileOpen((value) => !value)
            }}
            aria-expanded={profileOpen}
          >
            <Avatar name={user.displayName} src={user.avatarAsset} />
            <span>
              <strong>{user.displayName}</strong>
              <small>{user.accountType === 'ADMIN' ? 'Глобальний адміністратор' : user.company?.name ?? 'Користувач'}</small>
            </span>
            <ChevronDown size={15} />
          </button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <IconButton className="topbar__menu" label="Відкрити меню" onClick={() => {
            setRightPanelOpen(false)
            setMobileNav(true)
          }}>
            <Menu size={21} />
          </IconButton>
          <div className="topbar__route-content" role="group" aria-label="Дії поточного розділу">
            <TopbarContent />
          </div>
          <div className="topbar__center-content">
            <TopbarCenterContent fallback={(
              <button className="search-trigger" aria-label="Пошук у Lanka" onClick={() => {
                setProfileOpen(false)
                setMoreOpen(false)
                setPaletteOpen(true)
              }}>
                <Search size={17} />
                <span>Пошук у Lanka</span>
                <kbd>Ctrl K</kbd>
              </button>
            )} />
          </div>
          <div className="topbar__actions">
            <IconButton
              className={rightPanelOpen ? 'is-active' : ''}
              label={rightPanelOpen ? 'Закрити праву панель' : 'Відкрити чат і сповіщення'}
              aria-expanded={rightPanelOpen}
              aria-controls="right-communication-panel"
              onClick={() => {
                setProfileOpen(false)
                setMoreOpen(false)
                setMobileNav(false)
                setRightPanelOpen((value) => {
                  if (value) closeUserProfile()
                  if (!value) setSidebarCollapsed(true)
                  return !value
                })
              }}
            >
              {rightPanelOpen ? <PanelRightClose size={19} /> : <PanelRightOpen size={19} />}
              {(chatUnread + (notificationSummary.data?.unread ?? 0)) > 0 && (
                <b className="topbar-badge" aria-label={`${chatUnread + (notificationSummary.data?.unread ?? 0)} непрочитаних подій`}>
                  {chatUnread + (notificationSummary.data?.unread ?? 0) > 99
                    ? '99+'
                    : chatUnread + (notificationSummary.data?.unread ?? 0)}
                </b>
              )}
            </IconButton>
          </div>
        </header>
        <main id="main-content" className={`main-content ${isMessagesRoute ? 'main-content--messages' : ''}`}>
          {children}
        </main>
      </div>
      {rightPanelOpen && (
        <div id="right-communication-panel">
          <RightCommunicationPanel
            chatUnread={chatUnread}
            notificationUnread={notificationSummary.data?.unread ?? 0}
            targetUserId={requestedUserId}
            onClearTarget={closeUserProfile}
            onClose={() => {
              setRightPanelOpen(false)
              closeUserProfile()
            }}
          />
        </div>
      )}
      {paletteOpen && <CommandPalette shortcuts={paletteShortcuts} onClose={() => setPaletteOpen(false)} />}
      {mobileMoreOpen && <button className="bottom-nav__scrim" aria-label="Закрити додаткову навігацію" onClick={() => setMobileMoreOpen(false)} />}
      <nav className="bottom-nav" aria-label="Мобільна навігація">
        {mobilePrimaryRoutes.map((route) => {
          const Icon = route.navIcon ?? Gauge
          const title = mobileNavigationLabels[route.path] ?? route.title
          return (
            <NavLink key={route.path} to={scopedPath(route.path)}>
              <Icon size={19} />
              <span>{title}</span>
              {route.path === '/messages' && chatUnread > 0 && (
                <b className="bottom-nav__badge" aria-label={`${chatUnread} непрочитаних`}>
                  {chatUnread > 99 ? '99+' : chatUnread}
                </b>
              )}
              {route.path === '/feed' && feedUnread > 0 && (
                <b className="bottom-nav__badge" aria-label={`${feedUnread} непрочитаних оновлень у стрічці`}>
                  {feedUnread > 99 ? '99+' : feedUnread}
                </b>
              )}
            </NavLink>
          )
        })}
        <button
          ref={mobileMoreTriggerRef}
          type="button"
          className={mobileMoreHasActiveRoute ? 'active' : ''}
          aria-haspopup="menu"
          aria-expanded={mobileMoreOpen}
          aria-controls="mobile-more-menu"
          onClick={() => setMobileMoreOpen((value) => !value)}
        >
          <Menu size={19} />
          <span>Ще</span>
        </button>
        {mobileMoreOpen && (
          <div
            ref={mobileMoreMenuRef}
            id="mobile-more-menu"
            className="bottom-nav__menu"
            role="menu"
            aria-label="Ще"
            onKeyDown={(event) => {
              const items = Array.from(mobileMoreMenuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])
              const index = items.indexOf(document.activeElement as HTMLElement)
              if (event.key === 'Escape') {
                event.preventDefault()
                setMobileMoreOpen(false)
                mobileMoreTriggerRef.current?.focus()
              } else if (items.length > 0 && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                event.preventDefault()
                const nextIndex = event.key === 'Home' ? 0
                  : event.key === 'End' ? items.length - 1
                    : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
                items[nextIndex]?.focus()
              }
            }}
          >
            {mobileMoreRoutes.map((route) => {
              const Icon = route.navIcon ?? Gauge
              return (
                <NavLink key={route.path} to={scopedPath(route.path)} role="menuitem" onClick={() => setMobileMoreOpen(false)}>
                  <Icon size={18} />
                  <span>{mobileNavigationLabels[route.path] ?? route.title}</span>
                </NavLink>
              )
            })}
          </div>
        )}
      </nav>
      </div>
    </TopbarContentProvider>
  )
}
