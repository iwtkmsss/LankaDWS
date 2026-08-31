import type { FeedBirthdayView } from '@bert-crm/contracts'
import { CakeSlice, ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Avatar, Card } from '../shared/ui'

export function FeedBirthdayHighlight({ birthdays }: { birthdays: FeedBirthdayView[] }) {
  if (birthdays.length === 0) return null
  return (
    <Card className="feed-birthday-highlight">
      <header>
        <span className="feed-birthday-highlight__icon" aria-hidden>
          <CakeSlice size={17} />
        </span>
        <h2>Дні народження</h2>
      </header>
      <div className="feed-birthday-highlight__people">
        {birthdays.map((birthday) => (
          <Link
            key={birthday.id}
            className={birthday.isToday ? 'is-today' : undefined}
            to={`/organization?view=people&employeeId=${birthday.id}`}
          >
            <Avatar name={birthday.displayName} src={birthday.avatarAsset} />
            <span>
              <strong>{birthday.displayName}</strong>
              <small>День народження · {formatBirthdayDate(birthday.birthdayDate)}</small>
            </span>
            <ChevronRight size={17} aria-hidden />
          </Link>
        ))}
      </div>
    </Card>
  )
}

function formatBirthdayDate({ month, day }: FeedBirthdayView['birthdayDate']): string {
  return new Intl.DateTimeFormat('uk-UA', { day: 'numeric', month: 'long' })
    .format(new Date(Date.UTC(2024, month - 1, day)))
}
