import type { PropsWithChildren } from 'react'
import { useEffect, useMemo, useState } from 'react'
import {
  Bell,
  BookOpen,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  ChartNoAxesColumnIncreasing,
  CheckSquare2,
  ChevronDown,
  FileText,
  Gauge,
  KeyRound,
  LogOut,
  Menu,
  MessageCircle,
  Search,
  Settings,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react'
import { Link, NavLink, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { routes } from '../app/routes'
import { api } from '../shared/api/client'
import { useAuth } from '../shared/auth/AuthProvider'
import { Avatar, IconButton } from '../shared/ui'

const iconByPath: Record<string, typeof Gauge> = {
  '/overview': Gauge,
  '/tasks': CheckSquare2,
  '/requests': BriefcaseBusiness,
  '/calendar': CalendarDays,
  '/documents': FileText,
  '/knowledge': BookOpen,
  '/employees': Users,
  '/analytics': ChartNoAxesColumnIncreasing,
  '/admin': Settings,
}

export function AppShell({ children }: PropsWithChildren) {
  const { user, can, logout } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [mobileNav, setMobileNav] = useState(false)
  const [adminOpen, setAdminOpen] = useState(location.pathname.startsWith('/admin'))
  const [profileOpen, setProfileOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [companyOpen, setCompanyOpen] = useState(false)
  const nav = useMemo(() => routes.filter((route) => route.nav && can(route.permission)), [can])

  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen(true)
      } else if (event.key === 'Escape') {
        setPaletteOpen(false)
        setCompanyOpen(false)
        setProfileOpen(false)
      }
    }
    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  }, [])

  if (!user) return null
  const companyScope = searchParams.get('company') ?? user.primaryCompanyId
  const currentCompany =
    user.companies.find((company) => company.id === companyScope) ??
    user.companies.find((company) => company.id === user.primaryCompanyId) ??
    user.companies[0]
  const companyLabel = companyScope === 'all' ? 'Усі компанії' : (currentCompany?.displayName ?? 'Компанія')
  const scopedPath = (path: string) => `${path}?company=${encodeURIComponent(companyScope)}`
  function selectCompany(companyId: string) {
    setSearchParams((current) => {
      current.set('company', companyId)
      current.delete('page')
      return current
    })
    setCompanyOpen(false)
  }
  return (
    <div className="app-frame">
      <a className="skip-link" href="#main-content">
        Перейти до вмісту
      </a>
      {mobileNav && <button className="nav-scrim" aria-label="Закрити меню" onClick={() => setMobileNav(false)} />}
      <aside className={`sidebar ${mobileNav ? 'is-open' : ''}`}>
        <div className="sidebar__brand">
          <span className="brand-mark">B</span>
          <span>
            <strong>BERT</strong>
            <small>CRM workspace</small>
          </span>
          <IconButton label="Закрити меню" onClick={() => setMobileNav(false)}>
            <X size={18} />
          </IconButton>
        </div>
        <nav aria-label="Головна навігація">
          {nav.map((route) => {
            const Icon = iconByPath[route.path] ?? Gauge
            if (route.path === '/admin')
              return (
                <div className="admin-nav" key={route.path}>
                  <div className={`nav-parent ${location.pathname.startsWith('/admin') ? 'is-active' : ''}`}>
                    <NavLink to={scopedPath('/admin')} end onClick={() => setMobileNav(false)}>
                      <Icon size={18} />
                      <span>{route.title}</span>
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
                <span>{route.title}</span>
              </NavLink>
            )
          })}
        </nav>
        <div className="sidebar__profile">
          {profileOpen && (
            <div className="profile-popover">
              <strong>{user.displayName}</strong>
              <small>
                @{user.username} · {companyLabel}
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
            onClick={() => setProfileOpen((value) => !value)}
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
          <div className="company-switcher">
            <button
              className="company-chip"
              aria-haspopup="listbox"
              aria-expanded={companyOpen}
              onClick={() => setCompanyOpen((value) => !value)}
            >
              <Building2 size={16} />
              <span>{companyLabel}</span>
              <ChevronDown size={14} />
            </button>
            {companyOpen && (
              <div className="company-popover" role="listbox" aria-label="Область компанії">
                {user.companies.length > 1 && (
                  <button
                    role="option"
                    aria-selected={companyScope === 'all'}
                    className={companyScope === 'all' ? 'is-selected' : ''}
                    onClick={() => selectCompany('all')}
                  >
                    <span>Усі компанії</span>
                    <small>Доступні дані без змішування кешу</small>
                  </button>
                )}
                {user.companies.map((company) => (
                  <button
                    role="option"
                    aria-selected={companyScope === company.id}
                    className={companyScope === company.id ? 'is-selected' : ''}
                    key={company.id}
                    onClick={() => selectCompany(company.id)}
                  >
                    <span>{company.displayName}</span>
                    <small>{company.id === user.primaryCompanyId ? 'Основна компанія' : 'Додатковий доступ'}</small>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button className="search-trigger" aria-label="Пошук у BERT CRM" onClick={() => setPaletteOpen(true)}>
            <Search size={17} />
            <span>Пошук у BERT CRM</span>
            <kbd>Ctrl K</kbd>
          </button>
          <div className="topbar__actions">
            <IconButton label="Повідомлення" onClick={() => navigate(scopedPath('/messages'))}>
              <MessageCircle size={19} />
            </IconButton>
            <IconButton label="Сповіщення" onClick={() => navigate(scopedPath('/notifications'))}>
              <Bell size={19} />
              <i />
            </IconButton>
          </div>
        </header>
        <main id="main-content" className="main-content">
          {children}
        </main>
      </div>
      {paletteOpen && <CommandPalette companyScope={companyScope} onClose={() => setPaletteOpen(false)} />}
      <nav className="bottom-nav" aria-label="Мобільна навігація">
        {nav.slice(0, 4).map((route) => {
          const Icon = iconByPath[route.path] ?? Gauge
          return (
            <NavLink key={route.path} to={scopedPath(route.path)}>
              <Icon size={19} />
              <span>{route.title}</span>
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

function CommandPalette({ onClose, companyScope }: { onClose: () => void; companyScope: string }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Array<{ id: string; title: string; type: string; route: string }>>([])
  const navigate = useNavigate()
  async function search(value: string) {
    setQuery(value)
    if (value.trim().length < 2) return setResults([])
    const data = await api<{
      items: Array<{ id: string; title: string; type: string; route: string }>
    }>(`/search?q=${encodeURIComponent(value)}&company=${encodeURIComponent(companyScope)}`).catch(() => ({ items: [] }))
    setResults(data.items)
  }
  return (
    <div
      className="palette-layer"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose()
      }}
    >
      <section className="palette" role="dialog" aria-modal="true" aria-label="Глобальний пошук">
        <div>
          <Search size={20} />
          <input
            autoFocus
            value={query}
            onChange={(event) => void search(event.target.value)}
            placeholder="Завдання, заявки, документи, люди…"
          />
          <IconButton label="Закрити пошук" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </div>
        {query.length < 2 ? (
          <p>Введіть щонайменше 2 символи. Результати враховують ваші права й компанію.</p>
        ) : results.length ? (
          <ul>
            {results.map((item) => (
              <li key={`${item.type}:${item.id}`}>
                <button
                  onClick={() => {
                    navigate(`${item.route}?company=${encodeURIComponent(companyScope)}`)
                    onClose()
                  }}
                >
                  <span>{item.title}</span>
                  <small>{item.type}</small>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p>Нічого не знайдено</p>
        )}
      </section>
    </div>
  )
}
