import type { ComponentType, LazyExoticComponent } from 'react'
import { lazy } from 'react'

export interface RouteMeta {
  path: string
  title: string
  permission?: string
  nav?: boolean
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

export const routes: RouteMeta[] = [
  { path: '/overview', title: 'Огляд', nav: true, component: Overview },
  { path: '/tasks', title: 'Завдання', permission: 'tasks.read', nav: true, component: Tasks },
  { path: '/tasks/new', title: 'Нове завдання', permission: 'tasks.create', component: Tasks },
  { path: '/tasks/:taskId', title: 'Деталі завдання', permission: 'tasks.read', component: Tasks },
  { path: '/requests', title: 'Заявки', permission: 'requests.read', nav: true, component: Requests },
  { path: '/requests/new', title: 'Нова заявка', permission: 'requests.create', component: Requests },
  { path: '/requests/:requestId', title: 'Деталі заявки', permission: 'requests.read', component: Requests },
  { path: '/calendar', title: 'Календар', permission: 'calendar.read', nav: true, component: Calendar },
  { path: '/calendar/events/:eventId', title: 'Подія календаря', permission: 'calendar.read', component: Calendar },
  { path: '/documents', title: 'Документи', permission: 'documents.read', nav: true, component: Content },
  { path: '/documents/:documentId', title: 'Документ', permission: 'documents.read', component: Content },
  { path: '/knowledge', title: 'База знань', permission: 'knowledge.read', nav: true, component: Content },
  { path: '/knowledge/:articleSlug', title: 'Стаття', permission: 'knowledge.read', component: Content },
  { path: '/employees', title: 'Працівники', permission: 'employees.read', nav: true, component: Content },
  { path: '/employees/:employeeId', title: 'Профіль працівника', permission: 'employees.read', component: Content },
  { path: '/analytics', title: 'Аналітика', permission: 'analytics.read', nav: true, component: Content },
  { path: '/announcements', title: 'Оголошення', permission: 'announcements.read', component: Communication },
  { path: '/announcements/new', title: 'Нове оголошення', permission: 'announcements.create', component: Communication },
  { path: '/announcements/:announcementId', title: 'Оголошення', permission: 'announcements.read', component: Communication },
  { path: '/notifications', title: 'Сповіщення', permission: 'notifications.read', component: Communication },
  { path: '/messages', title: 'Повідомлення', permission: 'messages.read', component: Communication },
  { path: '/messages/:threadId', title: 'Діалог', permission: 'messages.read', component: Communication },
  { path: '/settings/profile', title: 'Профіль', component: Settings },
  { path: '/settings/notifications', title: 'Налаштування сповіщень', component: Settings },
  { path: '/settings/security', title: 'Безпека профілю', component: Settings },
  { path: '/settings/sessions', title: 'Активні сесії', component: Settings },
  { path: '/onboarding/:processId', title: 'Онбординг', permission: 'employees.read', component: Lifecycle },
  { path: '/offboarding/:processId', title: 'Офбординг', permission: 'employees.read', component: Lifecycle },
  { path: '/admin', title: 'Адміністрування', permission: 'system.manage', nav: true, component: Admin },
  { path: '/admin/users', title: 'Користувачі', permission: 'users.manage', adminChild: true, component: Admin },
  { path: '/admin/users/:userId', title: 'Користувач', permission: 'users.manage', component: Admin },
  { path: '/admin/companies', title: 'Компанії', permission: 'companies.manage', adminChild: true, component: Admin },
  { path: '/admin/companies/:companyId', title: 'Компанія', permission: 'companies.manage', component: Admin },
  { path: '/admin/roles', title: 'Ролі та права', permission: 'roles.manage', adminChild: true, component: Admin },
  { path: '/admin/roles/:roleId', title: 'Редактор ролі', permission: 'roles.manage', component: Admin },
  { path: '/admin/security', title: 'Безпека', permission: 'security.manage', adminChild: true, component: Admin },
  { path: '/admin/audit', title: 'Журнал дій', permission: 'audit.read', adminChild: true, component: Admin },
  { path: '/admin/audit/:eventId', title: 'Подія журналу', permission: 'audit.read', component: Admin },
  { path: '/admin/system', title: 'Система', permission: 'system.manage', adminChild: true, component: Admin },
]

export function routeTitle(pathname: string): string {
  const match = [...routes].sort((a, b) => b.path.length - a.path.length).find((route) => {
    const pattern = route.path.replace(/:[^/]+/g, '[^/]+')
    return new RegExp(`^${pattern}$`).test(pathname)
  })
  return match?.title ?? 'Сторінку не знайдено'
}
