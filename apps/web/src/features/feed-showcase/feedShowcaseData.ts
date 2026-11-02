import type { FeedAttachmentView, FeedCommentView } from '@lankadws/contracts'
import type { FeedCardModel, FeedCardViewState } from './FeedCardDesign'

export type ShowcaseSection = 'overview' | 'posts' | 'events' | 'tasks' | 'files' | 'page' | 'composer' | 'all'
export interface FeedStory {
  id: string
  group: 'posts' | 'events' | 'tasks'
  title: string
  description: string
  item: FeedCardModel
  view?: Partial<FeedCardViewState>
  featured?: boolean
}
export const people = {
  maria: { id: 'demo-maria', displayName: 'Іваненко Марія', avatarAsset: '/assets/avatars/avatar-maria.webp' },
  andrii: { id: 'demo-andrii', displayName: 'Коваль Андрій', avatarAsset: '/assets/avatars/avatar-andrii.webp' },
  olena: { id: 'demo-olena', displayName: 'Бондар Олена', avatarAsset: '/assets/avatars/avatar-olena.webp' },
}
export function demoFile(id: string, scanStatus: FeedAttachmentView['scanStatus'] = 'CLEAN', fileName = 'План роботи команди.pdf', mimeType?: string): FeedAttachmentView {
  const extension = fileName.split('.').at(-1) ?? ''
  const types: Record<string, string> = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', zip: 'application/zip', txt: 'text/plain', webp: 'image/webp' }
  return { id, scanStatus, fileName, mimeType: mimeType ?? types[extension] ?? 'application/octet-stream', bytes: 2_750_000 }
}
export const demoComments: FeedCommentView[] = [
  { id: 'comment-1', author: people.olena, body: 'Дякую! Переглянула план. Пропоную додати короткий підсумок зустрічі.', mentions: [], replyToCommentId: null, createdAt: '2026-10-26T11:35:00Z', editedAt: null },
  { id: 'comment-2', author: people.andrii, body: 'Домовилися, додам підсумок до кінця дня.', mentions: [], replyToCommentId: 'comment-1', createdAt: '2026-10-26T11:40:00Z', editedAt: null },
  { id: 'comment-3', author: people.maria, body: 'Оновлення: матеріали вже доступні для всієї команди.', mentions: [], replyToCommentId: null, createdAt: '2026-10-26T11:45:00Z', editedAt: null },
]
const post: FeedCardModel = { kind: 'POST', author: people.maria, date: '23 жовтня о 15:44', audience: 'Всім співробітникам', body: 'Оновили робочий простір команди. Тут зібрані важливі рішення, матеріали та наступні кроки.', likes: 0, comments: [] }
const event: FeedCardModel = { kind: 'EVENT', title: 'Планування роботи команди', author: people.andrii, date: '23 жовтня о 12:23', audience: 'Вся організація', body: '', metadata: [{ label: 'Дата', value: '28 жовтня 2026' }, { label: 'Час', value: '10:00 — 11:00' }] }
const task: FeedCardModel = { kind: 'TASK', title: 'Підготувати матеріали до зустрічі команди', date: '26 жовтня о 09:30', audience: '', body: '', changes: { messages: 0, status: 0, participants: 0 }, metadata: [{ label: 'Завдання', value: '2417' }, { label: 'Постановник', value: people.andrii.displayName, person: people.andrii }, { label: 'Відповідальний', value: people.maria.displayName, person: people.maria }, { label: 'Строк', value: '28 жовтня, 17:00' }] }

export const feedStories: FeedStory[] = [
  { id: 'post-basic', group: 'posts', title: 'Звичайна публікація', description: 'Базова структура: автор → зміст → дії.', featured: true, item: post },
  { id: 'post-pending', group: 'posts', title: 'Очікує вашого ознайомлення', description: 'Особиста дія відокремлена від типу матеріалу. Спробуйте підтвердити.', featured: true, item: { ...post, acknowledgement: { state: 'pending' } } },
  { id: 'post-observer', group: 'posts', title: 'Ознайомлення для автора', description: 'Автор бачить кількість підтверджень із загальної кількості адресатів.', featured: true, item: { ...post, author: people.andrii, canManage: true, acknowledgement: { state: 'summary', acknowledgedCount: 3, recipientCount: 8 } } },
  { id: 'post-reactions', group: 'posts', title: 'Лайки й обговорення', description: 'Активний лайк, лічильники, коментар і вкладена відповідь.', featured: true, item: { ...post, author: people.olena, likes: 4, liked: true, comments: demoComments }, view: { commentsOpen: true } },
  { id: 'post-other-like', group: 'posts', title: 'Є чужі лайки', description: 'Лічильник є, особиста реакція не активна.', item: { ...post, likes: 1 } },
  { id: 'post-partial', group: 'posts', title: 'Очікується особисте підтвердження', description: 'Користувач може підтвердити ознайомлення кнопкою.', item: { ...post, acknowledgement: { state: 'pending' } } },
  { id: 'post-done', group: 'posts', title: 'Ви ознайомилися', description: 'Зелений статус особистого підтвердження.', item: { ...post, acknowledgement: { state: 'done' } } },
  { id: 'post-everyone', group: 'posts', title: 'Ознайомлення підтверджено', description: 'Особисте підтвердження виконано.', item: { ...post, acknowledgement: { state: 'done' } } },
  { id: 'post-observer-complete', group: 'posts', title: 'Усі адресати ознайомилися', description: 'Автор бачить повну кількість підтверджень.', item: { ...post, canManage: true, acknowledgement: { state: 'summary', acknowledgedCount: 8, recipientCount: 8 } } },
  { id: 'post-no-recipients', group: 'posts', title: 'Немає адресатів', description: 'Автор бачить нуль адресатів ознайомлення.', item: { ...post, canManage: true, acknowledgement: { state: 'summary', acknowledgedCount: 0, recipientCount: 0 } } },
  { id: 'post-ack-loading', group: 'posts', title: 'Підтвердження виконується', description: 'Кнопка заблокована на час запиту.', item: { ...post, acknowledgement: { state: 'loading' } } },
  { id: 'post-ack-error', group: 'posts', title: 'Помилка підтвердження', description: 'Запропонований стан помилки для узгодження з карткою події. Можна повторити дію.', item: { ...post, acknowledgement: { state: 'error' } } },
  { id: 'post-rich', group: 'posts', title: 'Форматований текст і згадка', description: 'Списки, виділення, посилання й таблиця у спільному форматуванні сайту.', item: { ...post, body: '**План на тиждень**\n\n- Узгодити матеріали з командою\n- Підготувати короткий підсумок\n\nІваненко Марія, перегляньте наступні кроки.\n\n|Напрям|Наступна дія|\n|Матеріали|Підготувати до середи|\n|Зустріч|Узгодити порядок денний|\n\n[Документація](https://example.com)', mentions: [{ userId: people.maria.id, start: 94, end: 108, active: false }] } },
  { id: 'post-long', group: 'posts', title: 'Довгий текст і довга аудиторія', description: 'Перенесення тексту, довгого імені й кількох компаній.', item: { ...post, author: { displayName: 'Коваленко-Савченко Олександра Володимирівна', avatarAsset: null }, audience: 'LankaDWS Україна, LankaDWS Захід, LankaDWS Центральний офіс', body: Array.from({ length: 4 }, (_, index) => `${index + 1}. Команда узгодила порядок роботи та відповідальних за підготовку матеріалів. Зберіть питання до наступної зустрічі й додайте контекст, який допоможе прийняти рішення.`).join('\n\n') } },
  { id: 'post-files', group: 'posts', title: 'Текст і вкладення', description: 'Готові файли: PDF, зображення і текст. Перегляд працює локально.', item: { ...post, attachments: [demoFile('pdf'), demoFile('image', 'CLEAN', 'Командна зустріч.webp', 'image/webp'), demoFile('text', 'CLEAN', 'Підсумок зустрічі.txt', 'text/plain')] } },
  { id: 'post-file-only', group: 'posts', title: 'Публікація лише з файлом', description: 'Без порожнього текстового блоку.', item: { ...post, body: '', attachments: [demoFile('only-file')] } },
  { id: 'post-scan-states', group: 'posts', title: 'Усі стани вкладень', description: 'Шість станів перевірки; небезпечні файли не мають дій перегляду.', item: { ...post, attachments: [demoFile('scan-1', 'QUARANTINED', 'Матеріали на перевірці.pdf'), demoFile('scan-2', 'SCANNING', 'Перевірка документа.docx'), demoFile('scan-3'), demoFile('scan-4', 'INFECTED', 'Заблокований файл.zip'), demoFile('scan-5', 'UNSUPPORTED', 'Непідтримуваний формат.bin'), demoFile('scan-6', 'FAILED', 'Помилка перевірки.xlsx')] } },
  { id: 'post-new', group: 'posts', title: 'Нове оновлення', description: 'Окрема позначка новизни, незалежна від ознайомлення.', item: { ...post, isNew: true, acknowledgement: { state: 'pending' } } },
  { id: 'post-edited', group: 'posts', title: 'Редагована публікація', description: 'Позначка зміни в зоні службових дій.', item: { ...post, edited: true } },
  { id: 'post-menu', group: 'posts', title: 'Меню автора', description: 'Доступ до редагування та архівації.', item: { ...post, canManage: true }, view: { menuOpen: true } },
  { id: 'post-edit', group: 'posts', title: 'Редагування', description: 'Спільний редактор форматування, збереження і скасування.', item: { ...post, canManage: true }, view: { mode: 'edit' } },
  { id: 'post-saving', group: 'posts', title: 'Збереження змін', description: 'Редактор і повторне збереження заблоковані.', item: { ...post, canManage: true }, view: { mode: 'saving' } },
  { id: 'post-archive', group: 'posts', title: 'Підтвердження архівації', description: 'Небезпечна дія в окремому блоці з поясненням.', item: { ...post, canManage: true }, view: { mode: 'archive' } },
  { id: 'post-archiving', group: 'posts', title: 'Архівація виконується', description: 'Стан очікування завершення дії.', item: { ...post, canManage: true }, view: { mode: 'archiving' } },
  { id: 'post-empty-comments', group: 'posts', title: 'Обговорення ще порожнє', description: 'Порожній список із доступним полем введення.', item: post, view: { commentsOpen: true } },
  { id: 'post-reply', group: 'posts', title: 'Написання відповіді', description: 'Видимий адресат відповіді та можливість її скасувати.', item: { ...post, comments: demoComments }, view: { commentsOpen: true, replyTo: 'comment-1', comment: 'Додам матеріали до наступної зустрічі.' } },
  { id: 'post-comment-sending', group: 'posts', title: 'Коментар надсилається', description: 'Текст збережений у полі; повторне надсилання заблоковане.', item: post, view: { commentsOpen: true, comment: 'Дякую за оновлення!', sending: true } },
  { id: 'post-like-loading', group: 'posts', title: 'Лайк обробляється', description: 'Реакція тимчасово недоступна для повторного натискання.', item: { ...post, likes: 3 }, view: { liking: true } },
  { id: 'event-basic', group: 'events', title: 'Подія із зазначеним часом', description: 'Заголовок, дата, час, автор і окремий перехід у календар.', item: event },
  { id: 'event-pending', group: 'events', title: 'Подія на весь день з ознайомленням', description: 'Той самий блок ознайомлення, що й у публікації.', featured: true, item: { ...event, title: 'Командний день планування', metadata: [{ label: 'Дата', value: '28 жовтня 2026' }, { label: 'Тривалість', value: 'Увесь день' }], acknowledgement: { state: 'pending' } } },
  { id: 'event-partial', group: 'events', title: 'Подія очікує вашого підтвердження', description: 'Від мене ще очікується дія.', item: { ...event, acknowledgement: { state: 'pending' } } },
  { id: 'event-done', group: 'events', title: 'Ви ознайомилися з подією', description: 'Особиста дія завершена, закріплення зняте.', item: { ...event, acknowledgement: { state: 'done' } } },
  { id: 'event-observer', group: 'events', title: 'Організатор без особистої дії', description: 'Організатору не потрібно підтверджувати власну подію.', item: { ...event, acknowledgement: { state: 'observer' } } },
  { id: 'event-everyone', group: 'events', title: 'Ви підтвердили подію', description: 'Зелений статус особистого підтвердження.', item: { ...event, acknowledgement: { state: 'done' } } },
  { id: 'event-no-recipients', group: 'events', title: 'Подія без адресатів підтвердження', description: 'Блок особистого підтвердження не показується.', item: { ...event, acknowledgement: { state: 'observer' } } },
  { id: 'event-loading', group: 'events', title: 'Ознайомлення з подією виконується', description: 'Спільний стан очікування.', item: { ...event, acknowledgement: { state: 'loading' } } },
  { id: 'event-error', group: 'events', title: 'Помилка ознайомлення з подією', description: 'Помилка прив’язана до дії, доступна повторна спроба.', item: { ...event, acknowledgement: { state: 'error' } } },
  { id: 'event-history', group: 'events', title: 'Історична подія без автора', description: 'Історичний запис і відсутні необов’язкові дані.', item: { ...event, historical: true, author: undefined } },
  ...Array.from({ length: 8 }, (_, mask): FeedStory => ({ id: `task-changes-${mask}`, group: 'tasks', title: mask === 0 ? 'Завдання без непрочитаних змін' : `Комбінація змін ${mask} із 7`, description: ['Повідомлення', 'Зміни завдання', 'Учасники'].filter((_, index) => mask & (1 << index)).join(' + ') || 'Спокійний стан, усі оновлення переглянуті.', item: { ...task, changes: { messages: mask & 1 ? 3 : 0, status: mask & 2 ? 2 : 0, participants: mask & 4 ? 1 : 0 } } })),
  { id: 'task-large', group: 'tasks', title: 'Довга назва й великі лічильники', description: 'Перевірка щільності та перенесення на вузькому екрані.', item: { ...task, isNew: true, title: 'Узгодити остаточну редакцію матеріалів для всіх підрозділів і підготувати детальний план наступного етапу роботи команди', changes: { messages: 1234, status: 27, participants: 16 } } },
  { id: 'task-minimal', group: 'tasks', title: 'Завдання без відповідального та строку', description: 'Відсутні необов’язкові поля не залишають порожніх місць.', item: { ...task, metadata: [{ label: 'Завдання', value: '2418' }, { label: 'Постановник', value: people.andrii.displayName, person: people.andrii }] } },
]

// Derive mention offsets from the fixture text so they stay correct when copy changes.
const richStory = feedStories.find((story) => story.id === 'post-rich')!
const mentionStart = richStory.item.body.indexOf('Іваненко Марія')
richStory.item.mentions = [{ userId: people.maria.id, start: mentionStart, end: mentionStart + 'Іваненко Марія'.length, active: false }]
