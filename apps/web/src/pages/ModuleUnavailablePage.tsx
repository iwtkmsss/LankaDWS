import { ArrowLeft, Construction, Layers3 } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import { Card, PageHeader } from '../shared/ui'

export function ModuleUnavailablePage({ title, state }: { title: string; state: 'disabled' | 'preparing' }) {
  const [searchParams] = useSearchParams()
  const disabled = state === 'disabled'
  const company = searchParams.get('company')
  return (
    <div className="module-unavailable-page">
      <PageHeader title={title} description="LankaDWS розвивається поетапно без напівготових розділів" />
      <Card className="module-unavailable-card">
        <span className="module-unavailable-card__icon">{disabled ? <Layers3 /> : <Construction />}</span>
        <div>
          <span className="eyebrow">Кероване оновлення</span>
          <h2>{disabled ? 'Модуль ще не ввімкнено для організації' : 'Модуль готується до запуску'}</h2>
          <p>
            {disabled
              ? 'Поки що тут немає окремого робочого розділу. Чинні задачі, документи й повідомлення залишаються доступними у своїх звичних місцях.'
              : 'Capability вже підготовлено, але інтерфейс ще проходить перевірку. Ми відкриємо розділ лише після повного UX та access-control acceptance.'}
          </p>
          <Link className="button button--secondary" to={company ? `/tasks?company=${encodeURIComponent(company)}` : '/tasks'}>
            <ArrowLeft size={17} />
            До завдань
          </Link>
        </div>
      </Card>
    </div>
  )
}
