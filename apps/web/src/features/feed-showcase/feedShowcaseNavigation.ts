import type { ShowcaseSection } from './feedShowcaseData'

export const showcaseBlockTypes = [
  { id: 'posts', label: 'Публікації', section: 'posts', placement: 'Жива стрічка → Основний список → Картка публікації' },
  { id: 'events', label: 'Події календаря', section: 'events', placement: 'Жива стрічка → Основний список → Картка події' },
  { id: 'tasks', label: 'Завдання', section: 'tasks', placement: 'Жива стрічка → Основний список → Оновлення завдання' },
  { id: 'previews', label: 'Перегляд вкладень', section: 'files', placement: 'Жива стрічка → Вкладення публікації → Вікно перегляду' },
  { id: 'list', label: 'Стани списку', section: 'page', placement: 'Жива стрічка → Основний список оновлень' },
  { id: 'attention', label: 'Потребує уваги', section: 'page', placement: 'Жива стрічка → Права колонка → Потребує уваги' },
  { id: 'work-overview', label: 'Робочий огляд', section: 'page', placement: 'Жива стрічка → Верхня частина сторінки → Робочий огляд' },
  { id: 'birthdays', label: 'Дні народження', section: 'page', placement: 'Жива стрічка → Права колонка → Дні народження' },
  { id: 'composer', label: 'Створення публікації', section: 'composer', placement: 'Жива стрічка → Шапка → Створити публікацію → Модальне вікно' },
] as const satisfies ReadonlyArray<{ id: string; label: string; section: ShowcaseSection; placement: string }>

export type ShowcaseBlockType = typeof showcaseBlockTypes[number]['id']

export function showcaseBlockType(story: { id: string; group: string }): ShowcaseBlockType {
  if (story.id.startsWith('preview-')) return 'previews'
  if (story.id.startsWith('attention-')) return 'attention'
  if (story.id.startsWith('overview-')) return 'work-overview'
  if (story.id.startsWith('birthdays-')) return 'birthdays'
  if (story.group === 'page') return 'list'
  return story.group as 'posts' | 'events' | 'tasks' | 'composer'
}

export function showcasePlacement(story: { id: string; group: string }): string {
  if (story.id === 'page-pagination') return 'Жива стрічка → Під основним списком → Давніші записи'
  return showcaseBlockTypes.find((type) => type.id === showcaseBlockType(story))!.placement
}
