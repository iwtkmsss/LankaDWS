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
          },
          {
            id: 'usr_marko',
            displayName: 'Марко Литвин',
            avatarAsset: null,
            jobTitle: 'Дизайнер',
          },
        ]} />
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: 'Дні народження' })).toBeVisible()
    expect(screen.getAllByText('Сьогодні')).toHaveLength(2)
    expect(screen.getByRole('link', { name: /Марія Іваненко/ })).toHaveAttribute(
      'href',
      '/employees/usr_maria',
    )
    expect(screen.queryByText(/років|1994|12\.05|Продуктова дизайнерка/)).not.toBeInTheDocument()
  })
})
