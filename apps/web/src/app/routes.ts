import type { ComponentType, LazyExoticComponent } from 'react'
import { lazy } from 'react'
import type { OrganizationCapabilityCode } from '@bert-crm/contracts'

export interface RouteMeta {
  path: string
  title: string
  permission?: string
  nav?: boolean
  navGroup?: 'core' | 'more'
  navOrder?: number
  capability?: OrganizationCapabilityCode
  releaseState?: 'planned' | 'released'
  adminChild?: boolean
  component: LazyExoticComponent<ComponentType>
}

const Overview = lazy(() => import('../pages/OverviewPage'))
const Tasks = lazy(() => import('../pages/TasksPage'))
const Requests = lazy(() => import('../pages/RequestsPage'))
const Calendar = lazy(() => import('../pages/CalendarPage'))
const Content = lazy(() => import('../pages/ContentPages'))
const Communication = lazy(() => import('../pages/CommunicationPages'))
const Settings = lazy(() => import('../pages/SettingsPages'))
const Lifecycle = lazy(() => import('../pages/LifecyclePage'))
const Admin = lazy(() => import('../pages/AdminPages'))
const Organization = lazy(() => import('../pages/OrganizationPage'))

export const routes: RouteMeta[] = [
  { path: '/overview', title: 'Огляд', nav: true, navGroup: 'core', navOrder: 1, component: Overview },
  { path: '/tasks', title: 'Завдання', permission: 'tasks.read', nav: true, navGroup: 'core', navOrder: 2, component: Tasks },
  { path: '/tasks/new', title: 'Нове завдання', permission: 'tasks.create', component: Tasks },
  { path: '/tasks/:taskId', title: 'Деталі завдання', permission: 'tasks.read', component: Tasks },
  { path: '/requests', title: 'Заявки', permission: 'requests.read', nav: true, navGroup: 'more', navOrder: 1, component: Requests },
  { path: '/requests/new', title: 'Нова заявка', permission: 'requests.create', component: Requests },
  { path: '/requests/:requestId', title: 'Деталі заявки', permission: 'requests.read', component: Requests },
  { path: '/calendar', title: 'Календар', permission: 'calendar.read', nav: true, navGroup: 'core', navOrder: 4, component: Calendar },
  { path: '/calendar/events/:eventId', title: 'Подія календаря', permission: 'calendar.read', component: Calendar },
  { path: '/documents', title: 'Документи', permission: 'documents.read', component: Content },
  { path: '/documents/:documentId', title: 'Документ', permission: 'documents.read', component: Content },
  { path: '/knowledge', title: 'База знань', permission: 'knowledge.read', nav: true, navGroup: 'more', navOrder: 6, component: Content },
  { path: '/knowledge/:articleSlug', title: 'Стаття', permission: 'knowledge.read', component: Content },
  { path: '/employees', title: 'Працівники', permission: 'employees.read', nav: true, navGroup: 'more', navOrder: 5, component: Content },
  { path: '/employees/org', title: 'Структура організації', permission: 'employees.org.read', component: Organization },
  { path: '/employees/:employeeId', title: 'Профіль працівника', permission: 'employees.read', component: Content },
  { path: '/analytics', title: 'Аналітика', permission: 'analytics.read', nav: true, navGroup: 'more', navOrder: 7, component: Content },
  { path: '/announcements', title: 'Оголошення', permission: 'announcements.read', component: Communication },
  { path: '/announcements/new', title: 'Нове оголошення', permission: 'announcements.create', component: Communication },
  { path: '/announcements/:announcementId', title: 'Оголошення', permission: 'announcements.read', component: Communication },
  { path: '/notifications', title: 'Сповіщення', permission: 'notifications.read', component: Communication },
  { path: '/messages', title: 'Чат', permission: 'messages.read', nav: true, navGroup: 'core', navOrder: 3, component: Communication },
  { path: '/messages/:threadId', title: 'Діалог', permission: 'messages.read', component: Communication },
  { path: '/groups', title: 'Робочі групи', permission: 'groups.read', nav: true, navGroup: 'more', navOrder: 2, releaseState: 'released', component: Content },
  { path: '/groups/:groupId', title: 'Робоча група', permission: 'groups.read', releaseState: 'released', component: Content },
  { path: '/drive', title: 'Диск', permission: 'documents.read', nav: true, navGroup: 'more', navOrder: 3, releaseState: 'released', component: Content },
  { path: '/drive/:documentId', title: 'Файл на диску', permission: 'documents.read', releaseState: 'released', component: Content },
  { path: '/settings/profile', title: 'Профіль', component: Settings },
  { path: '/settings/notifications', title: 'Налаштування сповіщень', component: Settings },
  { path: '/settings/security', title: 'Безпека профілю', component: Settings },
  { path: '/settings/sessions', title: 'Активні сесії', component: Settings },
  { path: '/onboarding/:processId', title: 'Онбординг', permission: 'employees.read', component: Lifecycle },
  { path: '/offboarding/:processId', title: 'Офбординг', permission: 'employees.read', component: Lifecycle },
  { path: '/admin', title: 'Адміністрування', permission: 'system.manage', nav: true, navGroup: 'more', navOrder: 8, component: Admin },
  { path: '/admin/users', title: 'Користувачі', permission: 'users.manage', adminChild: true, component: Admin },
  { path: '/admin/users/:userId', title: 'Користувач', permission: 'users.manage', component: Admin },
  { path: '/admin/roles', title: 'Ролі та права', permission: 'roles.manage', adminChild: true, component: Admin },
  { path: '/admin/roles/:roleId', title: 'Редактор ролі', permission: 'roles.manage', component: Admin },
  { path: '/admin/security', title: 'Безпека', permission: 'security.manage', adminChild: true, component: Admin },
  { path: '/admin/audit', title: 'Журнал дій', permission: 'audit.read', adminChild: true, component: Admin },
  { path: '/admin/audit/:eventId', title: 'Подія журналу', permission: 'audit.read', component: Admin },
  { path: '/admin/import', title: 'Імпорт даних', permission: 'system.manage', adminChild: true, component: Admin },
  { path: '/admin/system', title: 'Система', permission: 'system.manage', adminChild: true, component: Admin },
]

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
