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
  mobileOrder?: number
  navIcon?: LucideIcon
  capability?: OrganizationCapabilityCode
  releaseState?: 'planned' | 'released'
  adminChild?: boolean
  component: LazyExoticComponent<ComponentType>
}

const Overview = lazy(() => import('../pages/OverviewPage'))
const Feed = lazy(() => import('../pages/FeedPage').then((module) => ({ default: module.FeedPage })))
const Tasks = lazy(() => import('../pages/TasksPage'))
const Calendar = lazy(() => import('../pages/CalendarPage'))
const Content = lazy(() => import('../pages/ContentPages'))
const Communication = lazy(() => import('../pages/CommunicationPages'))
const Settings = lazy(() => import('../pages/SettingsPages'))
const Lifecycle = lazy(() => import('../pages/LifecyclePage'))
const Admin = lazy(() => import('../pages/AdminPages'))
const Organization = lazy(() => import('../pages/OrganizationPage'))
const Companies = lazy(() => import('../pages/CompaniesPage'))

export const routes: RouteMeta[] = [
  { path: '/overview', title: 'Огляд', nav: true, navGroup: 'primary', navOrder: 1, mobileOrder: 1, navIcon: Gauge, component: Overview },
  { path: '/tasks', title: 'Завдання', nav: true, navGroup: 'management', navOrder: 1, mobileOrder: 2, navIcon: CheckSquare2, component: Tasks },
  { path: '/tasks/new', title: 'Нове завдання', component: Tasks },
  { path: '/tasks/:taskId', title: 'Деталі завдання', component: Tasks },
  { path: '/calendar', title: 'Календар', nav: true, navGroup: 'communication', navOrder: 3, mobileOrder: 4, navIcon: CalendarDays, component: Calendar },
  { path: '/calendar/events/:eventId', title: 'Подія календаря', component: Calendar },
  { path: '/documents', title: 'Документи', component: Content },
  { path: '/documents/:documentId', title: 'Документ', component: Content },
  { path: '/knowledge', title: 'База знань', nav: true, navGroup: 'management', navOrder: 2, navIcon: BookOpen, component: Content },
  { path: '/knowledge/:articleSlug', title: 'Стаття', component: Content },
  { path: '/employees', title: 'Працівники', nav: true, navGroup: 'company', navOrder: 1, navIcon: Users, component: Content },
  { path: '/employees/org', title: 'Структура організації', component: Organization },
  { path: '/employees/:employeeId', title: 'Профіль працівника', component: Content },
  { path: '/analytics', title: 'Аналітика', nav: true, navGroup: 'management', navOrder: 3, navIcon: ChartNoAxesColumnIncreasing, component: Content },
  { path: '/announcements', title: 'Оголошення', component: Communication },
  { path: '/announcements/new', title: 'Нове оголошення', component: Communication },
  { path: '/announcements/:announcementId', title: 'Оголошення', component: Communication },
  { path: '/notifications', title: 'Сповіщення', nav: true, navGroup: 'communication', navOrder: 4, navIcon: Bell, component: Communication },
  { path: '/feed', title: 'Жива стрічка', capability: 'FEED', nav: true, navGroup: 'communication', navOrder: 1, navIcon: Newspaper, component: Feed },
  { path: '/messages', title: 'Чат', nav: true, navGroup: 'communication', navOrder: 2, mobileOrder: 3, navIcon: MessageCircle, component: Communication },
  { path: '/messages/:threadId', title: 'Діалог', component: Communication },
  { path: '/groups', title: 'Робочі групи', capability: 'GROUPS_UI', nav: true, navGroup: 'company', navOrder: 2, navIcon: Building2, releaseState: 'released', component: Content },
  { path: '/groups/:groupId', title: 'Робоча група', capability: 'GROUPS_UI', releaseState: 'released', component: Content },
  { path: '/drive', title: 'Диск', nav: true, navGroup: 'company', navOrder: 3, navIcon: FileText, releaseState: 'released', component: Content },
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
