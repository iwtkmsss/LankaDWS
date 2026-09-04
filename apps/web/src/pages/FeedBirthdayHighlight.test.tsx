import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { FeedBirthdayHighlight } from './FeedBirthdayHighlight'

describe('FeedBirthdayHighlight', () => {
  it('renders safe employee profile links without age or birth date', () => {
    render(
      <MemoryRouter>
        <FeedBirthdayHighlight birthdays={[
          {
            id: 'usr_maria',
            displayName: 'Марія Іваненко',
            avatarAsset: null,
            jobTitle: 'Продуктова дизайнерка',
            birthdayDate: { month: 5, day: 12 },
            isToday: true,
          },
          {
            id: 'usr_marko',
            displayName: 'Марко Литвин',
            avatarAsset: null,
            jobTitle: 'Дизайнер',
            birthdayDate: { month: 5, day: 15 },
            isToday: false,
          },
        ]} />
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: 'Дні народження' })).toBeVisible()
    expect(screen.getByText('День народження · 12 травня')).toBeVisible()
    expect(screen.getByText('День народження · 15 травня')).toBeVisible()
    expect(screen.getByRole('link', { name: /Марія Іваненко/ })).toHaveAttribute(
      'href',
      '/?employeeId=usr_maria',
    )
    expect(screen.queryByText(/років|1994|Продуктова дизайнерка/)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Марія Іваненко/ })).toHaveClass('is-today')
  })
})
