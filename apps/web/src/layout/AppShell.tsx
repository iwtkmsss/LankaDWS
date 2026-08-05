import type { PropsWithChildren } from 'react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { OrganizationCapability } from '@bert-crm/contracts'
import { useQuery } from '@tanstack/react-query'
import {
  Bell,
  BookOpen,
  Building2,
  CalendarDays,
  CheckSquare2,
  ChevronDown,
  Ellipsis,
  FileText,
  Gauge,
  KeyRound,
  LogOut,
  Megaphone,
  Menu,
  MessageCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import type { RouteMeta } from '../app/routes'
import { navigationRoutes, routes } from '../app/routes'
import { api } from '../shared/api/client'
import { useAuth } from '../shared/auth/AuthProvider'
import { Avatar, BrandMark, DialogBase, IconButton } from '../shared/ui'

interface QuickCreateAction {
  path: string
  title: string
  description: string
  icon: typeof Gauge
}

interface SidebarNavSection {
  key: NonNullable<RouteMeta['navGroup']>
  label: string
  items: RouteMeta[]
}

const sidebarNavGroups = [
  { key: 'primary', label: 'Основне' },
  { key: 'communication', label: 'Комунікації' },
  { key: 'company', label: 'Компанія' },
  { key: 'management', label: 'Управління' },
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
  const location = useLocation()
  const navigate = useNavigate()
  const [mobileNav, setMobileNav] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() =>
    window.localStorage.getItem('bertcrm.sidebar.collapsed') === 'true')
  const [profileOpen, setProfileOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [desktopNavHeight, setDesktopNavHeight] = useState<number | null>(null)
  const sidebarNavRef = useRef<HTMLElement>(null)
  const companyId = user?.company?.id ?? 'global-admin'
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
    || (route.path !== '/admin' && location.pathname.startsWith(`${route.path}/`)))
  const mobileNavRoutes = nav
    .filter((route) => route.mobileOrder !== undefined)
    .sort((left, right) => left.mobileOrder! - right.mobileOrder!)
  const isMessagesRoute = location.pathname === '/messages'
    || location.pathname.startsWith('/messages/')
  const isMessageThreadRoute = location.pathname.startsWith('/messages/')
  const quickCreateActions: QuickCreateAction[] = [
    {
      path: '/tasks/new',
      title: 'Нове завдання',
      description: 'Поставити роботу собі або колезі',
      icon: CheckSquare2,
    },
    {
      path: '/messages?new=1',
      title: 'Новий діалог',
      description: 'Написати людині або команді',
      icon: MessageCircle,
    },
    ...(canUseCapability(OrganizationCapability.CalendarWrite) ? [{
      path: '/calendar?new=1',
      title: 'Нова подія',
      description: 'Додати зустріч або робочу подію',
      icon: CalendarDays,
    }] : []),
    ...(canUseCapability(OrganizationCapability.GroupsUi) ? [{
      path: '/groups?new=1',
      title: 'Нова група',
      description: 'Створити простір команди або проєкту',
      icon: Building2,
    }] : []),
    ...(canUseCapability(OrganizationCapability.Drive) ? [{
      path: '/drive?new=1',
      title: 'Завантажити файл',
      description: 'Додати робочий файл на Диск',
      icon: FileText,
    }] : []),
    {
      path: '/announcements/new',
      title: 'Нове оголошення',
      description: 'Повідомити команді важливе',
      icon: Megaphone,
    },
  ]
  const paletteShortcuts = [
    ...quickCreateActions.map((action) => ({
      path: action.path,
      title: action.title,
      type: 'CREATE',
      safeSnippet: action.description,
    })),
    ...nav
      .filter((route) => route.path !== '/admin')
      .map((route) => ({
        path: route.path,
        title: route.title,
        type: 'QUICK',
        safeSnippet: 'Відкрити розділ',
      })),
  ]
  const notificationSummary = useQuery({
    queryKey: ['notifications', 'summary'],
    queryFn: () => api<{ action: number; unread: number }>('/notifications/summary'),
    enabled: Boolean(user),
    refetchInterval: 60_000,
  })
  const chatSummary = useQuery({
    queryKey: ['threads', 'summary', companyId],
    queryFn: () => api<{ all: number; unread: number }>('/messages/summary'),
    enabled: Boolean(user),
    refetchInterval: location.pathname.startsWith('/messages') ? false : 30_000,
    refetchIntervalInBackground: false,
  })
  const chatUnread = chatSummary.data?.unread ?? 0
  const adminCompanies = useQuery({
    queryKey: ['admin-companies'],
    queryFn: () => api<{ items: Array<{ id: string; name: string; isActive: boolean }> }>('/admin/companies'),
    enabled: user?.accountType === 'ADMIN',
    staleTime: 30_000,
  })
  const selectedAdminCompanyId = useMemo(() => {
    const queryCompanyId = new URLSearchParams(location.search).get('companyId')
    if (queryCompanyId) return queryCompanyId
    const detailMatch = location.pathname.match(/^\/admin\/companies\/([^/]+)$/)
    return detailMatch?.[1] ?? ''
  }, [location.pathname, location.search])

  useEffect(() => {
    window.localStorage.setItem('bertcrm.sidebar.collapsed', String(sidebarCollapsed))
  }, [sidebarCollapsed])

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
    setMoreOpen(false)
  }, [location.pathname])

  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen(true)
      } else if (event.key === 'Escape') {
        setProfileOpen(false)
        setCreateOpen(false)
        setMoreOpen(false)
      }
    }
    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  }, [])

  if (!user) return null
  const scopedPath = (path: string) => path
  function quickCreate(path: string) {
    navigate(path)
    setCreateOpen(false)
  }
  function renderNavRoute(route: (typeof routes)[number], menuItem = false) {
    const Icon = route.navIcon ?? Gauge
    const title = route.title
    return (
      <NavLink
        key={route.path}
        to={scopedPath(route.path)}
        end={route.path === '/admin'}
        role={menuItem ? 'menuitem' : undefined}
        aria-label={sidebarCollapsed ? title : undefined}
        title={sidebarCollapsed ? title : undefined}
        onClick={() => {
          setMobileNav(false)
          setMoreOpen(false)
        }}
      >
        <Icon size={18} />
        <span>{title}</span>
        {route.path === '/messages' && chatUnread > 0 && (
          <b className="nav-unread-badge" aria-label={`${chatUnread} непрочитаних діалогів`}>
            {chatUnread > 99 ? '99+' : chatUnread}
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
    <div className={[
      'app-frame',
      sidebarCollapsed ? 'sidebar-collapsed' : '',
      isMessagesRoute ? 'app-frame--messages' : '',
      isMessageThreadRoute ? 'app-frame--messages-thread' : '',
    ].filter(Boolean).join(' ')}>
      <a className="skip-link" href="#main-content">
        Перейти до вмісту
      </a>
      {mobileNav && <button className="nav-scrim" aria-label="Закрити меню" onClick={() => setMobileNav(false)} />}
      <aside className={`sidebar ${mobileNav ? 'is-open' : ''}`}>
        <div className="sidebar__brand">
          <BrandMark />
          <span className="sidebar__brand-copy">
            <strong>BERT</strong>
            <small>CRM workspace</small>
          </span>
          <IconButton
            className="sidebar__collapse"
            label={sidebarCollapsed ? 'Розгорнути бічну панель' : 'Згорнути бічну панель'}
            onClick={() => {
              setMoreOpen(false)
              setSidebarCollapsed((value) => !value)
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
          <div className="sidebar-more__menu" role="menu" aria-label="Додаткові розділи">
            {overflowNavSections.map((section) =>
              renderNavSection(section.label, section.items, section.key, true))}
          </div>
        )}
        <div className="sidebar__profile">
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
              setCreateOpen(false)
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
          <IconButton label="Відкрити меню" onClick={() => setMobileNav(true)}>
            <Menu size={21} />
          </IconButton>
          <button className="search-trigger" aria-label="Пошук у BERT CRM" onClick={() => {
            setCreateOpen(false)
            setPaletteOpen(true)
          }}>
            <Search size={17} />
            <span>Пошук у BERT CRM</span>
            <kbd>Ctrl K</kbd>
          </button>
          {user.accountType === 'ADMIN' && (
            <label className="admin-company-context">
              <Building2 size={16} aria-hidden="true" />
              <span>Компанія</span>
              <select
                aria-label="Company selector глобального адміністратора"
                value={selectedAdminCompanyId}
                onChange={(event) => {
                  const companyId = event.target.value
                  if (!companyId) {
                    navigate('/admin/companies')
                    return
                  }
                  if (location.pathname.startsWith('/admin/users')) {
                    const params = new URLSearchParams(location.search)
                    params.set('companyId', companyId)
                    navigate(`${location.pathname}?${params.toString()}`)
                    return
                  }
                  navigate(`/admin/companies/${companyId}`)
                }}
              >
                <option value="">Усі компанії</option>
                {adminCompanies.data?.items.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name}{company.isActive ? '' : ' · неактивна'}
                  </option>
                ))}
              </select>
            </label>
          )}
          {!isMessagesRoute && !location.pathname.startsWith('/admin') && quickCreateActions.length > 0 && (
            <div className="quick-create">
              <button
                className="quick-create__trigger"
                aria-label="Швидке створення"
                aria-haspopup="menu"
                aria-expanded={createOpen}
                onClick={() => {
                  setProfileOpen(false)
                  setCreateOpen((value) => !value)
                }}
              >
                <Plus size={17} />
                <span>Створити</span>
                <ChevronDown size={14} />
              </button>
              {createOpen && (
                <div className="quick-create__menu" role="menu" aria-label="Створити">
                  <strong>Що створити?</strong>
                  {quickCreateActions.map((action) => {
                    const Icon = action.icon
                    return (
                      <button key={action.path} role="menuitem" onClick={() => quickCreate(action.path)}>
                        <i><Icon size={18} /></i>
                        <span><b>{action.title}</b><small>{action.description}</small></span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}
          <div className="topbar__actions">
            <IconButton
              label={chatUnread ? `Повідомлення: ${chatUnread} непрочитаних` : 'Повідомлення'}
              onClick={() => navigate(scopedPath('/messages'))}
            >
              <MessageCircle size={19} />
              {chatUnread > 0 && (
                <b className="topbar-badge" aria-hidden="true">
                  {chatUnread > 99 ? '99+' : chatUnread}
                </b>
              )}
            </IconButton>
            <IconButton label="Сповіщення" onClick={() => navigate(scopedPath('/notifications'))}>
              <Bell size={19} />
              {Boolean(notificationSummary.data?.unread) && (
                <b className="topbar-badge" aria-label={`${notificationSummary.data?.unread} непрочитаних`}>
                  {notificationSummary.data!.unread > 99 ? '99+' : notificationSummary.data!.unread}
                </b>
              )}
            </IconButton>
          </div>
        </header>
        <main id="main-content" className={`main-content ${isMessagesRoute ? 'main-content--messages' : ''}`}>
          {children}
        </main>
      </div>
      {paletteOpen && (
        <CommandPalette
          shortcuts={paletteShortcuts}
          onClose={() => setPaletteOpen(false)}
        />
      )}
      <nav className="bottom-nav" aria-label="Мобільна навігація">
        {mobileNavRoutes.map((route) => {
          const Icon = route.navIcon ?? Gauge
          const title = route.title
          return (
            <NavLink key={route.path} to={scopedPath(route.path)}>
              <Icon size={19} />
              <span>{title}</span>
              {route.path === '/messages' && chatUnread > 0 && (
                <b className="bottom-nav__badge" aria-label={`${chatUnread} непрочитаних`}>
                  {chatUnread > 99 ? '99+' : chatUnread}
                </b>
              )}
            </NavLink>
          )
        })}
        <button onClick={() => setMobileNav(true)}>
          <Menu size={19} />
          <span>Ще</span>
        </button>
      </nav>
    </div>
  )
}

interface PaletteItem {
  id: string
  title: string
  safeSnippet: string
  type: string
  route: string
  companyId: string | null
}

const paletteTypeLabels: Record<string, string> = {
  CREATE: 'Створити',
  QUICK: 'Швидкі переходи',
  TASK: 'Завдання',
  GROUP: 'Групи',
  CHAT: 'Чати',
  DOCUMENT: 'Файли',
  EMPLOYEE: 'Працівники',
  EVENT: 'Календар',
  ARTICLE: 'База знань',
}

function paletteSnippet(item: PaletteItem) {
  if (item.type !== 'EVENT' || !item.safeSnippet) return item.safeSnippet
  const date = new Date(item.safeSnippet)
  return Number.isNaN(date.getTime())
    ? item.safeSnippet
    : new Intl.DateTimeFormat('uk-UA', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function CommandPalette({
  onClose,
  shortcuts,
}: {
  onClose: () => void
  shortcuts: Array<{ path: string; title: string; type: string; safeSnippet: string }>
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PaletteItem[]>([])
  const [loading, setLoading] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const paletteRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    const value = query.trim()
    setActiveIndex(0)
    if (value.length < 2) {
      setResults([])
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    const timeout = window.setTimeout(async () => {
      const data = await api<{ items: PaletteItem[] }>(
        `/search?q=${encodeURIComponent(value)}`,
      ).catch(() => ({ items: [] }))
      if (!cancelled) {
        setResults(data.items)
        setLoading(false)
      }
    }, 220)
    return () => {
      cancelled = true
      window.clearTimeout(timeout)
    }
  }, [query])

  useEffect(() => {
    paletteRef.current?.querySelector<HTMLElement>('button.is-active')?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  const shortcutItems: PaletteItem[] = shortcuts.map((shortcut) => ({
        id: shortcut.path,
        title: shortcut.title,
        safeSnippet: shortcut.safeSnippet,
        type: shortcut.type,
        route: shortcut.path,
        companyId: null,
      }))
  const normalizedQuery = query.trim().toLocaleLowerCase('uk')
  const createItems = shortcutItems.filter((item) => item.type === 'CREATE' && (
    item.title.toLocaleLowerCase('uk').includes(normalizedQuery)
    || item.safeSnippet.toLocaleLowerCase('uk').includes(normalizedQuery)
  ))
  const items: PaletteItem[] = query.trim().length < 2 ? shortcutItems : [...createItems, ...results]

  function open(item: PaletteItem) {
    navigate(item.route)
    onClose()
  }

  function itemIcon(type: string, route: string) {
    const baseRoute = route.split('?')[0]
    if (type === 'TASK' || baseRoute.startsWith('/tasks')) return <CheckSquare2 size={18} />
    if (type === 'GROUP' || baseRoute.startsWith('/groups')) return <Building2 size={18} />
    if (type === 'CHAT' || baseRoute.startsWith('/messages')) return <MessageCircle size={18} />
    if (type === 'DOCUMENT' || baseRoute === '/drive' || baseRoute.startsWith('/documents')) return <FileText size={18} />
    if (type === 'EMPLOYEE' || baseRoute.startsWith('/employees')) return <Users size={18} />
    if (type === 'EVENT' || baseRoute.startsWith('/calendar')) return <CalendarDays size={18} />
    if (type === 'ARTICLE' || baseRoute.startsWith('/knowledge')) return <BookOpen size={18} />
    if (baseRoute.startsWith('/announcements')) return <Megaphone size={18} />
    const RouteIcon = routes.find((candidate) => candidate.path === baseRoute)?.navIcon
    if (RouteIcon) return <RouteIcon size={18} />
    return <Gauge size={18} />
  }

  return (
    <DialogBase
      title="Глобальний пошук"
      variant="palette"
      size="lg"
      titleVisibility="sr-only"
      showClose={false}
      initialFocusRef={searchInputRef}
      onRequestClose={() => onClose()}
      bodyClassName="palette__body"
      headerClassName="palette__header"
      footerClassName="palette__footer"
      header={(
        <>
          <Search size={20} />
          <input
            ref={searchInputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' && items.length) {
                event.preventDefault()
                setActiveIndex((index) => (index + 1) % items.length)
              } else if (event.key === 'ArrowUp' && items.length) {
                event.preventDefault()
                setActiveIndex((index) => (index - 1 + items.length) % items.length)
              } else if (event.key === 'Enter' && items[activeIndex]) {
                event.preventDefault()
                open(items[activeIndex])
              }
            }}
            placeholder="Завдання, люди, групи, чати, файли…"
            aria-label="Знайти або перейти"
          />
          <IconButton label="Закрити пошук" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </>
      )}
      footer={(
        <>
          <span><kbd>↑</kbd><kbd>↓</kbd> вибір · <kbd>Enter</kbd> відкрити</span>
          <span><kbd>Esc</kbd> закрити</span>
        </>
      )}
    >
      <div className="palette__results" ref={paletteRef}>
        {loading ? (
          <p>Шукаємо у доступних розділах…</p>
        ) : items.length ? (
          <ul role="listbox" aria-label={query.trim().length < 2 ? 'Швидкі переходи' : 'Результати пошуку'}>
            {items.map((item, index) => {
              const previous = items[index - 1]
              return (
                <li key={`${item.type}:${item.id}`} role="presentation">
                  {(!previous || previous.type !== item.type) && (
                    <span className="palette__group">{paletteTypeLabels[item.type] ?? item.type}</span>
                  )}
                  <button
                    role="option"
                    aria-selected={activeIndex === index}
                    className={activeIndex === index ? 'is-active' : ''}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => open(item)}
                  >
                    <i>{itemIcon(item.type, item.route)}</i>
                    <span><strong>{item.title}</strong><small>{paletteSnippet(item)}</small></span>
                  </button>
                </li>
              )
            })}
          </ul>
        ) : (
          <p>Нічого не знайдено</p>
        )}
      </div>
    </DialogBase>
  )
}
