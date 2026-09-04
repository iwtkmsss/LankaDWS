import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { UserProfileLink, UserProfileProvider, useUserProfile } from './UserProfileDrawer'

function ProfileRequestState() {
  const { requestedUserId, closeUserProfile } = useUserProfile()
  return (
    <div>
      <output aria-label="Запитаний користувач">{requestedUserId ?? 'none'}</output>
      <button type="button" onClick={closeUserProfile}>Очистити</button>
    </div>
  )
}

function renderProfile(initialEntry: string, child = <ProfileRequestState />) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <UserProfileProvider>{child}</UserProfileProvider>
    </MemoryRouter>,
  )
}

describe('UserProfileProvider', () => {
  it('exposes and clears the user requested for the right chat panel', () => {
    renderProfile('/feed?filter=ALL&employeeId=usr_maria')

    expect(screen.getByRole('status', { name: 'Запитаний користувач' })).toHaveTextContent('usr_maria')
    fireEvent.click(screen.getByRole('button', { name: 'Очистити' }))
    expect(screen.getByRole('status', { name: 'Запитаний користувач' })).toHaveTextContent('none')
  })

  it('requests the chat without leaving the current route', () => {
    renderProfile('/tasks?status=OPEN', <><UserProfileLink userId="usr_maria">Написати Марії</UserProfileLink><ProfileRequestState /></>)

    expect(screen.getByRole('link', { name: 'Написати Марії' })).toHaveAttribute(
      'href',
      '/tasks?status=OPEN&employeeId=usr_maria',
    )
    fireEvent.click(screen.getByRole('link', { name: 'Написати Марії' }))
    expect(screen.getByRole('status', { name: 'Запитаний користувач' })).toHaveTextContent('usr_maria')
  })
})
