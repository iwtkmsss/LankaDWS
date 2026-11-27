import { Inbox, Search, TriangleAlert } from 'lucide-react'
import { Button, PageDataLoader } from '../../shared/ui'

export function FeedLoading() {
  return <PageDataLoader delay={0} label="Завантаження стрічки" />
}

export function FeedPageState({ kind, onAction }: { kind: 'empty' | 'filtered' | 'error'; onAction: () => void }) {
  const error = kind === 'error'
  const filtered = kind === 'filtered'
  return <div className={`stream-page-state${error ? ' is-error' : ''}`} role={error ? 'alert' : undefined}>
    <span>{error ? <TriangleAlert size={25} /> : filtered ? <Search size={25} /> : <Inbox size={25} />}</span>
    <h2>{error ? 'Не вдалося завантажити стрічку' : filtered ? 'За цим посиланням нічого немає' : 'Оновлень ще немає'}</h2>
    <p>{error ? 'Перевірте з’єднання та спробуйте ще раз.' : filtered ? 'Поверніться до всієї стрічки, щоб побачити оновлення.' : 'Тут з’являться публікації, завдання, події та матеріали команди.'}</p>
    <Button type="button" variant="secondary" onClick={onAction}>{error ? 'Спробувати ще раз' : filtered ? 'Показати всю стрічку' : 'Створити публікацію'}</Button>
  </div>
}
