import type { PropsWithChildren } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { OrganizationCapability } from '@bert-crm/contracts'
import { useQuery } from '@tanstack/react-query'
import {
  Bell,
  BookOpen,
  Building2,
  CalendarDays,
  ChartNoAxesColumnIncreasing,
  CheckSquare2,
  ChevronDown,
  FileText,
  Gauge,
  Ellipsis,
  KeyRound,
  LogOut,
  Megaphone,
  Menu,
  MessageCircle,
  Newspaper,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { routes } from '../app/routes'
import { api } from '../shared/api/client'
import { useAuth } from '../shared/auth/AuthProvider'
import { Avatar, BrandMark, IconButton } from '../shared/ui'

const iconByPath: Record<string, typeof Gauge> = {
  '/overview': Gauge,
  '/tasks': CheckSquare2,
  '/messages': MessageCircle,
  '/calendar': CalendarDays,
  '/documents': FileText,
  '/knowledge': BookOpen,
  '/employees': Users,
  '/analytics': ChartNoAxesColumnIncreasing,
  '/admin': Settings,
}

interface QuickCreateAction {
  path: string
  title: string
  description: string
  icon: typeof Gauge
}

export function AppShell({ children }: PropsWithChildren) {
  const { user, can, canUseCapability, logout } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [mobileNav, setMobileNav] = useState(false)
  const [adminOpen, setAdminOpen] = useState(location.pathname.startsWith('/admin'))
  const [moreOpen, setMoreOpen] = useState(true)
  const [profileOpen, setProfileOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const organizationId = user?.organization.id ?? ''
  const nav = useMemo(() => routes
    .filter((route) => route.nav && route.releaseState !== 'planned' && can(route.permission) && (!route.capability || canUseCapability(route.capability)))
    .sort((left, right) => (left.navOrder ?? 0) - (right.navOrder ?? 0)), [can, canUseCapability])
  const coreNav = nav.filter((route) => route.navGroup === 'core')
  const moreNav = nav.filter((route) => route.navGroup === 'more')
  const feedActive = canUseCapability(OrganizationCapability.Feed)
  const quickCreateActions: QuickCreateAction[] = [
    ...(can('tasks.create') ? [{
      path: '/tasks/new',
      title: 'Нове завдання',
      description: 'Поставити роботу собі або колезі',
      icon: CheckSquare2,
    }] : []),
    ...(can('messages.write') ? [{
      path: '/messages?new=1',
      title: 'Новий діалог',
      description: 'Написати людині або команді',
      icon: MessageCircle,
    }] : []),
    ...(can('calendar.manage') && canUseCapability(OrganizationCapability.CalendarWrite) ? [{
      path: '/calendar?new=1',
      title: 'Нова подія',
      description: 'Додати зустріч або робочу подію',
      icon: CalendarDays,
    }] : []),
    ...(can('groups.create') && canUseCapability(OrganizationCapability.GroupsUi) ? [{
      path: '/groups?new=1',
      title: 'Нова група',
      description: 'Створити простір команди або проєкту',
      icon: Building2,
    }] : []),
    ...(can('documents.manage') && canUseCapability(OrganizationCapability.Drive) ? [{
      path: '/drive?new=1',
      title: 'Завантажити файл',
      description: 'Додати робочий файл на Диск',
      icon: FileText,
    }] : []),
    ...(can('announcements.create') ? [{
      path: '/announcements/new',
      title: 'Нове оголошення',
      description: 'Повідомити команді важливе',
      icon: Megaphone,
    }] : []),
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
        title: route.path === '/overview' && feedActive ? 'Стрічка' : route.title,
        type: 'QUICK',
        safeSnippet: 'Відкрити розділ',
      })),
  ]
  const notificationSummary = useQuery({
    queryKey: ['notifications', 'summary'],
    queryFn: () => api<{ action: number; unread: number }>('/notifications/summary'),
    enabled: Boolean(user && can('notifications.read')),
    refetchInterval: 60_000,
  })
  const chatSummary = useQuery({
    queryKey: ['threads', 'summary', organizationId],
    queryFn: () => api<{ all: number; unread: number }>('/messages/summary'),
    enabled: Boolean(user && can('messages.read')),
    refetchInterval: location.pathname.startsWith('/messages') ? false : 30_000,
    refetchIntervalInBackground: false,
  })
  const chatUnread = chatSummary.data?.unread ?? 0

  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen(true)
      } else if (event.key === 'Escape') {
        setPaletteOpen(false)
        setProfileOpen(false)
        setCreateOpen(false)
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
  function renderNavRoute(route: (typeof routes)[number]) {
    const Icon = route.path === '/overview' && feedActive ? Newspaper : (iconByPath[route.path] ?? Gauge)
    const title = route.path === '/overview' && feedActive ? 'Стрічка' : route.title
    if (route.path === '/admin')
      return (
        <div className="admin-nav" key={route.path}>
          <div className={`nav-parent ${location.pathname.startsWith('/admin') ? 'is-active' : ''}`}>
            <NavLink to={scopedPath('/admin')} end onClick={() => setMobileNav(false)}>
              <Icon size={18} />
              <span>{title}</span>
            </NavLink>
            <button
              aria-label={adminOpen ? 'Згорнути адміністрування' : 'Розгорнути адміністрування'}
              onClick={() => setAdminOpen((value) => !value)}
            >
              <ChevronDown size={16} className={adminOpen ? 'rotated' : ''} />
            </button>
          </div>
          {adminOpen && (
            <div className="admin-nav__children">
              {routes
                .filter((item) => item.adminChild && can(item.permission))
                .map((item) => (
                  <NavLink key={item.path} to={scopedPath(item.path)} onClick={() => setMobileNav(false)}>
                    {item.title}
                  </NavLink>
                ))}
            </div>
          )}
        </div>
      )
    return (
      <NavLink key={route.path} to={scopedPath(route.path)} onClick={() => setMobileNav(false)}>
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
  return (
    <div className="app-frame">
      <a className="skip-link" href="#main-content">
        Перейти до вмісту
      </a>
      {mobileNav && <button className="nav-scrim" aria-label="Закрити меню" onClick={() => setMobileNav(false)} />}
      <aside className={`sidebar ${mobileNav ? 'is-open' : ''}`}>
        <div className="sidebar__brand">
          <BrandMark />
          <span>
            <strong>BERT</strong>
            <small>CRM workspace</small>
          </span>
          <IconButton label="Закрити меню" onClick={() => setMobileNav(false)}>
            <X size={18} />
          </IconButton>
        </div>
        <nav aria-label="Головна навігація">
          {coreNav.map(renderNavRoute)}
          {moreNav.length > 0 && (
            <div className="more-nav">
              <button
                className="more-nav__trigger"
                aria-expanded={moreOpen}
                onClick={() => setMoreOpen((value) => !value)}
              >
                <Ellipsis size={18} />
                <span>Ще</span>
                <ChevronDown size={16} className={moreOpen ? 'rotated' : ''} />
              </button>
              {moreOpen && <div className="more-nav__children">{moreNav.map(renderNavRoute)}</div>}
            </div>
          )}
        </nav>
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
            onClick={() => {
              setCreateOpen(false)
              setProfileOpen((value) => !value)
            }}
            aria-expanded={profileOpen}
          >
            <Avatar name={user.displayName} src={user.avatarAsset} />
            <span>
              <strong>{user.displayName}</strong>
              <small>{user.displayRole}</small>
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
          {quickCreateActions.length > 0 && (
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
        <main id="main-content" className="main-content">
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
        {coreNav.map((route) => {
          const Icon = route.path === '/overview' && feedActive ? Newspaper : (iconByPath[route.path] ?? Gauge)
          const title = route.path === '/overview' && feedActive ? 'Стрічка' : route.title
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
        <button onClick={() => { setMoreOpen(true); setMobileNav(true) }}>
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
  const paletteRef = useRef<HTMLElement>(null)
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
    if (baseRoute === '/overview') return <Gauge size={18} />
    return <Gauge size={18} />
  }

  return (
    <div
      className="palette-layer"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose()
      }}
    >
      <section
        ref={paletteRef}
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Глобальний пошук"
        onKeyDown={(event) => {
          if (event.key !== 'Tab' || !paletteRef.current) return
          const focusable = [...paletteRef.current.querySelectorAll<HTMLElement>('input, button:not(:disabled)')]
          if (!focusable.length) return
          const first = focusable[0]
          const last = focusable.at(-1)!
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault()
            last.focus()
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault()
            first.focus()
          }
        }}
      >
        <div>
          <Search size={20} />
          <input
            autoFocus
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
        </div>
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
        <footer><span><kbd>↑</kbd><kbd>↓</kbd> вибір · <kbd>Enter</kbd> відкрити</span><span><kbd>Esc</kbd> закрити</span></footer>
      </section>
    </div>
  )
}
