import type { ComponentType, LazyExoticComponent } from 'react'
import { lazy } from 'react'
import type { OrganizationCapabilityCode } from '@bert-crm/contracts'
import {
  BookOpen, Building2, Bell, CalendarDays, ChartNoAxesColumnIncreasing,
  CheckSquare2, FileText, FileSearch, Gauge, MessageCircle, Newspaper,
  Database, ShieldCheck, Settings as SettingsIcon, Users, type LucideIcon,
} from 'lucide-react'

export interface RouteMeta {
  path: string
  title: string
  adminOnly?: boolean
  nav?: boolean
  navGroup?: 'primary' | 'communication' | 'company' | 'management' | 'administration'
  navOrder?: number
  navIcon?: LucideIcon
  capability?: OrganizationCapabilityCode
  releaseState?: 'planned' | 'released'
  adminChild?: boolean
  component: LazyExoticComponent<ComponentType>
  preload?: () => Promise<unknown>
}

const loadOverview = () => import('../pages/OverviewPage')
const loadFeed = () => import('../pages/FeedPage').then((module) => ({ default: module.FeedPage }))
const loadTasks = () => import('../pages/TasksPage')
const loadCalendar = () => import('../pages/CalendarPage')
const loadContent = () => import('../pages/ContentPages')
const loadCommunication = () => import('../pages/CommunicationPages')
const loadSettings = () => import('../pages/SettingsPages')
const loadLifecycle = () => import('../pages/LifecyclePage')
const loadAdmin = () => import('../pages/AdminPages')
const loadOrganization = () => import('../pages/OrganizationPage')
const loadCompanies = () => import('../pages/CompaniesPage')

const Overview = lazy(loadOverview)
const Feed = lazy(loadFeed)
const Tasks = lazy(loadTasks)
const Calendar = lazy(loadCalendar)
const Content = lazy(loadContent)
const Communication = lazy(loadCommunication)
const Settings = lazy(loadSettings)
const Lifecycle = lazy(loadLifecycle)
const Admin = lazy(loadAdmin)
const Organization = lazy(loadOrganization)
const Companies = lazy(loadCompanies)

export const routes: RouteMeta[] = [
  { path: '/overview', title: 'Огляд', nav: true, navGroup: 'primary', navOrder: 7, navIcon: Gauge, component: Overview, preload: loadOverview },
  { path: '/tasks', title: 'Завдання', nav: true, navGroup: 'primary', navOrder: 2, navIcon: CheckSquare2, component: Tasks, preload: loadTasks },
  { path: '/tasks/new', title: 'Нове завдання', component: Tasks },
  { path: '/tasks/:taskId', title: 'Деталі завдання', component: Tasks },
  { path: '/calendar', title: 'Календар', nav: true, navGroup: 'primary', navOrder: 5, navIcon: CalendarDays, component: Calendar, preload: loadCalendar },
  { path: '/calendar/events/:eventId', title: 'Подія календаря', component: Calendar },
  { path: '/documents', title: 'Документи', component: Content },
  { path: '/documents/:documentId', title: 'Документ', component: Content },
  { path: '/knowledge', title: 'База знань', nav: true, navGroup: 'management', navOrder: 1, navIcon: BookOpen, component: Content },
  { path: '/knowledge/:articleSlug', title: 'Стаття', component: Content },
  { path: '/employees', title: 'Працівники', nav: true, navGroup: 'primary', navOrder: 6, navIcon: Users, component: Content, preload: loadContent },
  { path: '/employees/org', title: 'Структура організації', component: Organization },
  { path: '/employees/:employeeId', title: 'Профіль працівника', component: Content },
  { path: '/analytics', title: 'Аналітика', nav: true, navGroup: 'management', navOrder: 2, navIcon: ChartNoAxesColumnIncreasing, component: Content },
  { path: '/announcements', title: 'Оголошення', component: Communication },
  { path: '/announcements/new', title: 'Нове оголошення', component: Communication },
  { path: '/announcements/:announcementId', title: 'Оголошення', component: Communication },
  { path: '/notifications', title: 'Сповіщення', nav: true, navGroup: 'communication', navOrder: 4, navIcon: Bell, component: Communication },
  { path: '/feed', title: 'Жива стрічка', capability: 'FEED', nav: true, navGroup: 'primary', navOrder: 1, navIcon: Newspaper, component: Feed, preload: loadFeed },
  { path: '/messages', title: 'Чат', nav: true, navGroup: 'primary', navOrder: 3, navIcon: MessageCircle, component: Communication, preload: loadCommunication },
  { path: '/messages/:threadId', title: 'Діалог', component: Communication },
  { path: '/groups', title: 'Робочі групи', capability: 'GROUPS_UI', nav: true, navGroup: 'company', navOrder: 1, navIcon: Building2, releaseState: 'released', component: Content },
  { path: '/groups/:groupId', title: 'Робоча група', capability: 'GROUPS_UI', releaseState: 'released', component: Content },
  { path: '/drive', title: 'Диск', nav: true, navGroup: 'primary', navOrder: 4, navIcon: FileText, releaseState: 'released', component: Content, preload: loadContent },
  { path: '/drive/:documentId', title: 'Файл на диску', releaseState: 'released', component: Content },
  { path: '/settings/profile', title: 'Профіль', component: Settings },
  { path: '/settings/notifications', title: 'Налаштування сповіщень', component: Settings },
  { path: '/settings/security', title: 'Безпека профілю', component: Settings },
  { path: '/settings/sessions', title: 'Активні сесії', component: Settings },
  { path: '/onboarding/:processId', title: 'Онбординг', component: Lifecycle },
  { path: '/offboarding/:processId', title: 'Офбординг', component: Lifecycle },
  { path: '/admin', title: 'Адміністрування', adminOnly: true, nav: true, navGroup: 'administration', navOrder: 1, navIcon: SettingsIcon, component: Admin },
  { path: '/admin/companies', title: 'Компанії', adminOnly: true, nav: true, navGroup: 'administration', navOrder: 2, navIcon: Building2, adminChild: true, component: Companies },
  { path: '/admin/companies/:companyId', title: 'Компанія', adminOnly: true, component: Companies },
  { path: '/admin/users', title: 'Користувачі', adminOnly: true, nav: true, navGroup: 'administration', navOrder: 3, navIcon: Users, adminChild: true, component: Admin },
  { path: '/admin/users/:userId', title: 'Користувач', adminOnly: true, component: Admin },
  { path: '/admin/security', title: 'Безпека', adminOnly: true, nav: true, navGroup: 'administration', navOrder: 4, navIcon: ShieldCheck, adminChild: true, component: Admin },
  { path: '/admin/audit', title: 'Журнал дій', adminOnly: true, nav: true, navGroup: 'administration', navOrder: 5, navIcon: FileSearch, adminChild: true, component: Admin },
  { path: '/admin/audit/:eventId', title: 'Подія журналу', adminOnly: true, component: Admin },
  { path: '/admin/import', title: 'Імпорт даних', adminOnly: true, nav: true, navGroup: 'administration', navOrder: 6, navIcon: Database, adminChild: true, component: Admin },
  { path: '/admin/system', title: 'Система', adminOnly: true, nav: true, navGroup: 'administration', navOrder: 7, navIcon: SettingsIcon, adminChild: true, component: Admin },
]

export const mobileNavigation = {
  primary: ['/feed', '/tasks', '/messages', '/drive'],
  more: ['/calendar', '/employees', '/overview'],
} as const

export const mobileNavigationLabels: Record<string, string> = {
  '/employees': 'Співробітники',
}

export function navigationRoutes(
  isAdmin: boolean,
  canUseCapability: (capability: OrganizationCapabilityCode) => boolean,
): RouteMeta[] {
  return routes
    .filter((route) => route.nav
      && route.releaseState !== 'planned'
      && (!route.adminOnly || isAdmin)
      && (!route.capability || canUseCapability(route.capability)))
    .sort((left, right) => (left.navOrder ?? 0) - (right.navOrder ?? 0))
}

export function routeTitle(pathname: string): string {
  const match = [...routes].sort((a, b) => {
    const dynamicDifference = (a.path.match(/:/g)?.length ?? 0) - (b.path.match(/:/g)?.length ?? 0)
    return dynamicDifference || b.path.length - a.path.length
  }).find((route) => {
    const pattern = route.path.replace(/:[^/]+/g, '[^/]+')
    return new RegExp(`^${pattern}$`).test(pathname)
  })
  return match?.title ?? 'Сторінку не знайдено'
}
