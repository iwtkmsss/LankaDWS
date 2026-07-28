import type { ComponentType, LazyExoticComponent } from 'react'
import { lazy } from 'react'
import type { OrganizationCapabilityCode } from '@bert-crm/contracts'
import {
  BookOpen,
  Building2,
  Bell,
  CalendarDays,
  ChartNoAxesColumnIncreasing,
  CheckSquare2,
  FileText,
  FileSearch,
  Gauge,
  KeyRound,
  MessageCircle,
  Newspaper,
  Database,
  ShieldCheck,
  Settings as SettingsIcon,
  Users,
  type LucideIcon,
} from 'lucide-react'

export interface RouteMeta {
  path: string
  title: string
  permission?: string
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

export const routes: RouteMeta[] = [
  { path: '/overview', title: 'Огляд', nav: true, navGroup: 'primary', navOrder: 1, mobileOrder: 1, navIcon: Gauge, component: Overview },
  { path: '/tasks', title: 'Завдання', permission: 'tasks.read', nav: true, navGroup: 'management', navOrder: 1, mobileOrder: 2, navIcon: CheckSquare2, component: Tasks },
  { path: '/tasks/new', title: 'Нове завдання', permission: 'tasks.create', component: Tasks },
  { path: '/tasks/:taskId', title: 'Деталі завдання', permission: 'tasks.read', component: Tasks },
  { path: '/calendar', title: 'Календар', permission: 'calendar.read', nav: true, navGroup: 'communication', navOrder: 3, mobileOrder: 4, navIcon: CalendarDays, component: Calendar },
  { path: '/calendar/events/:eventId', title: 'Подія календаря', permission: 'calendar.read', component: Calendar },
  { path: '/documents', title: 'Документи', permission: 'documents.read', component: Content },
  { path: '/documents/:documentId', title: 'Документ', permission: 'documents.read', component: Content },
  { path: '/knowledge', title: 'База знань', permission: 'knowledge.read', nav: true, navGroup: 'management', navOrder: 2, navIcon: BookOpen, component: Content },
  { path: '/knowledge/:articleSlug', title: 'Стаття', permission: 'knowledge.read', component: Content },
  { path: '/employees', title: 'Працівники', permission: 'employees.read', nav: true, navGroup: 'company', navOrder: 1, navIcon: Users, component: Content },
  { path: '/employees/org', title: 'Структура організації', permission: 'employees.org.read', component: Organization },
  { path: '/employees/:employeeId', title: 'Профіль працівника', permission: 'employees.read', component: Content },
  { path: '/analytics', title: 'Аналітика', permission: 'analytics.read', nav: true, navGroup: 'management', navOrder: 3, navIcon: ChartNoAxesColumnIncreasing, component: Content },
  { path: '/announcements', title: 'Оголошення', permission: 'announcements.read', component: Communication },
  { path: '/announcements/new', title: 'Нове оголошення', permission: 'announcements.create', component: Communication },
  { path: '/announcements/:announcementId', title: 'Оголошення', permission: 'announcements.read', component: Communication },
  { path: '/notifications', title: 'Сповіщення', permission: 'notifications.read', nav: true, navGroup: 'communication', navOrder: 4, navIcon: Bell, component: Communication },
  { path: '/feed', title: 'Жива стрічка', permission: 'feed.read', capability: 'FEED', nav: true, navGroup: 'communication', navOrder: 1, navIcon: Newspaper, component: Feed },
  { path: '/messages', title: 'Чат', permission: 'messages.read', nav: true, navGroup: 'communication', navOrder: 2, mobileOrder: 3, navIcon: MessageCircle, component: Communication },
  { path: '/messages/:threadId', title: 'Діалог', permission: 'messages.read', component: Communication },
  { path: '/groups', title: 'Робочі групи', permission: 'groups.read', capability: 'GROUPS_UI', nav: true, navGroup: 'company', navOrder: 2, navIcon: Building2, releaseState: 'released', component: Content },
  { path: '/groups/:groupId', title: 'Робоча група', permission: 'groups.read', capability: 'GROUPS_UI', releaseState: 'released', component: Content },
  { path: '/drive', title: 'Диск', permission: 'documents.read', nav: true, navGroup: 'company', navOrder: 3, navIcon: FileText, releaseState: 'released', component: Content },
  { path: '/drive/:documentId', title: 'Файл на диску', permission: 'documents.read', releaseState: 'released', component: Content },
  { path: '/settings/profile', title: 'Профіль', component: Settings },
  { path: '/settings/notifications', title: 'Налаштування сповіщень', component: Settings },
  { path: '/settings/security', title: 'Безпека профілю', component: Settings },
  { path: '/settings/sessions', title: 'Активні сесії', component: Settings },
  { path: '/onboarding/:processId', title: 'Онбординг', permission: 'employees.read', component: Lifecycle },
  { path: '/offboarding/:processId', title: 'Офбординг', permission: 'employees.read', component: Lifecycle },
  { path: '/admin', title: 'Адміністрування', permission: 'system.manage', nav: true, navGroup: 'administration', navOrder: 1, navIcon: SettingsIcon, component: Admin },
  { path: '/admin/users', title: 'Користувачі', permission: 'users.manage', nav: true, navGroup: 'administration', navOrder: 2, navIcon: Users, adminChild: true, component: Admin },
  { path: '/admin/users/:userId', title: 'Користувач', permission: 'users.manage', component: Admin },
  { path: '/admin/roles', title: 'Ролі та права', permission: 'roles.manage', nav: true, navGroup: 'administration', navOrder: 3, navIcon: KeyRound, adminChild: true, component: Admin },
  { path: '/admin/roles/:roleId', title: 'Редактор ролі', permission: 'roles.manage', component: Admin },
  { path: '/admin/security', title: 'Безпека', permission: 'security.manage', nav: true, navGroup: 'administration', navOrder: 4, navIcon: ShieldCheck, adminChild: true, component: Admin },
  { path: '/admin/audit', title: 'Журнал дій', permission: 'audit.read', nav: true, navGroup: 'administration', navOrder: 5, navIcon: FileSearch, adminChild: true, component: Admin },
  { path: '/admin/audit/:eventId', title: 'Подія журналу', permission: 'audit.read', component: Admin },
  { path: '/admin/import', title: 'Імпорт даних', permission: 'system.manage', nav: true, navGroup: 'administration', navOrder: 6, navIcon: Database, adminChild: true, component: Admin },
  { path: '/admin/system', title: 'Система', permission: 'system.manage', nav: true, navGroup: 'administration', navOrder: 7, navIcon: SettingsIcon, adminChild: true, component: Admin },
]

export function navigationRoutes(
  can: (permission?: string) => boolean,
  canUseCapability: (capability: OrganizationCapabilityCode) => boolean,
): RouteMeta[] {
  return routes
    .filter((route) =>
      route.nav
      && route.releaseState !== 'planned'
      && can(route.permission)
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
