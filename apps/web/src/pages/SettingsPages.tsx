import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { SessionView } from '@bert-crm/contracts'
import { AtSign, BadgeCheck, BellRing, BriefcaseBusiness, Building2, CalendarDays, Check, Clock3, KeyRound, Laptop, Languages, LogOut, Mail, Network, PersonStanding, Phone, Save, ShieldCheck, Smartphone, UserRound } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { api, jsonBody } from '../shared/api/client'
import { useAuth } from '../shared/auth/AuthProvider'
import { formatDateTime } from '../shared/lib/format'
import { removeWhitespace } from '../shared/lib/credentials'
import { Avatar, Button, Card, ErrorState, PageHeader, Skeleton } from '../shared/ui'

export default function SettingsPages() {
  const path = useLocation().pathname
  return (
    <div>
      <PageHeader title="Особисті налаштування" description="Профіль, сповіщення та захист вашого облікового запису" />
      <div className="settings-layout">
        <nav aria-label="Налаштування">
          <NavLink to="/settings/profile">
            <UserRound size={17} />
            Профіль
          </NavLink>
          <NavLink to="/settings/notifications">
            <BellRing size={17} />
            Сповіщення
          </NavLink>
          <NavLink to="/settings/security">
            <KeyRound size={17} />
            Безпека
          </NavLink>
          <NavLink to="/settings/sessions">
            <Laptop size={17} />
            Сесії
          </NavLink>
        </nav>
        <section>
          {path.endsWith('/profile') ? (
            <ProfileSettings />
          ) : path.endsWith('/notifications') ? (
            <NotificationSettings />
          ) : path.endsWith('/security') ? (
            <SecuritySettings />
          ) : (
            <SessionsSettings />
          )}
        </section>
      </div>
    </div>
  )
}

function ProfileSettings() {
  const { user, refresh } = useAuth()
  const client = useQueryClient()
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [avatarBusy, setAvatarBusy] = useState(false)
  if (!user) return null
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaved(false)
    setError('')
    const data = new FormData(event.currentTarget)
    try {
      await api('/me/profile', {
        method: 'PATCH',
        body: jsonBody({
          contactEmail: data.get('contactEmail') || null,
          phone: data.get('phone') || null,
          gender: data.get('gender') || null,
          birthDate: data.get('birthDate') || null,
          timezone: data.get('timezone'),
          locale: data.get('locale'),
        }),
      })
      await refresh()
      setSaved(true)
    } catch {
      setError('Не вдалося зберегти профіль.')
    }
  }
  async function waitForAvatar(avatarAsset: string) {
    for (let attempt = 0; attempt < 24; attempt += 1) {
      const response = await fetch(avatarAsset, { credentials: 'include', cache: 'no-store' })
      if (response.ok) return
      if (response.status !== 403) throw new Error('avatar_unavailable')
      await new Promise((resolve) => window.setTimeout(resolve, 250))
    }
    throw new Error('avatar_scan_timeout')
  }

  async function uploadAvatar(file: File | undefined) {
    if (!file) return
    setError('')
    setSaved(false)
    setAvatarBusy(true)
    try {
      const data = new FormData()
      data.set('file', file)
      const result = await api<{ avatarAsset: string }>('/me/avatar', { method: 'POST', body: data })
      await waitForAvatar(result.avatarAsset)
      await Promise.all([refresh(), client.invalidateQueries()])
      setSaved(true)
    } catch {
      setError('Не вдалося завантажити аватар. Оберіть зображення до 2 МБ.')
    } finally {
      setAvatarBusy(false)
    }
  }
  async function removeAvatar() {
    setError('')
    setSaved(false)
    setAvatarBusy(true)
    try {
      await api('/me/avatar', { method: 'DELETE' })
      await Promise.all([refresh(), client.invalidateQueries()])
      setSaved(true)
    } catch {
      setError('Не вдалося видалити аватар.')
    } finally {
      setAvatarBusy(false)
    }
  }
  return (
    <Card className="settings-card">
      <header>
        <Avatar size="lg" name={user.displayName} src={user.avatarAsset} />
        <div>
          <h2>Профіль</h2>
          <p>Дані, які колеги бачать у робочих процесах.</p>
          <span className="avatar-actions">
            {avatarBusy && <span className="avatar-progress" role="status">Обробляємо фото…</span>}
            <label className={`avatar-upload${avatarBusy ? ' is-disabled' : ''}`}>
              Змінити фото
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                disabled={avatarBusy}
                onChange={(event) => void uploadAvatar(event.currentTarget.files?.[0])}
              />
            </label>
            {user.avatarAsset && (
              <button type="button" className="avatar-remove" disabled={avatarBusy} onClick={() => void removeAvatar()}>
                Видалити
              </button>
            )}
          </span>
        </div>
      </header>
      <form className="profile-form" onSubmit={submit}>
        <div className="profile-fields-list" role="group" aria-label="Робочі дані профілю">
          <label>
            <span className="profile-field-label"><UserRound size={15} aria-hidden="true" />Ім’я</span>
            <input value={user.displayName} disabled readOnly />
          </label>
          <label>
            <span className="profile-field-label"><AtSign size={15} aria-hidden="true" />Нік</span>
            <input value={`@${user.username}`} disabled readOnly />
          </label>
          <label>
            <span className="profile-field-label"><BadgeCheck size={15} aria-hidden="true" />Тип ОЗ</span>
            <input value={user.accountType === 'ADMIN' ? 'Глобальний адміністратор' : 'Користувач компанії'} disabled readOnly />
          </label>
          <label>
            <span className="profile-field-label"><BriefcaseBusiness size={15} aria-hidden="true" />Посада</span>
            <input value={user.positionTitle} disabled readOnly />
          </label>
          <label>
            <span className="profile-field-label"><Building2 size={15} aria-hidden="true" />Компанія</span>
            <input value={user.company?.name ?? 'Усі компанії'} disabled readOnly />
          </label>
          <div className="profile-org-branch">
            <span><Network size={15} aria-hidden="true" />Підрозділ</span>
            <p className={user.orgUnitPath.length ? 'profile-org-branch__value' : undefined}>
              {user.orgUnitPath[user.orgUnitPath.length - 1]?.name ?? 'Не призначено'}
            </p>
          </div>
        </div>
        <div className="profile-fields-list" role="group" aria-label="Особисті та контактні дані профілю">
          <label>
            <span className="profile-field-label"><PersonStanding size={15} aria-hidden="true" />Стать</span>
            <select name="gender" defaultValue={user.gender ?? ''}>
              <option value="">Не вказувати</option>
              <option value="FEMALE">Жінка</option>
              <option value="MALE">Чоловік</option>
              <option value="OTHER">Інше</option>
            </select>
          </label>
          <label>
            <span className="profile-field-label"><CalendarDays size={15} aria-hidden="true" />День народження</span>
            <input name="birthDate" type="date" defaultValue={user.birthDate ?? ''} />
          </label>
          <label>
            <span className="profile-field-label"><Phone size={15} aria-hidden="true" />Телефон</span>
            <input name="phone" type="tel" defaultValue={user.phone ?? ''} />
          </label>
          <label>
            <span className="profile-field-label"><Mail size={15} aria-hidden="true" />Email</span>
            <input name="contactEmail" type="email" defaultValue={user.contactEmail ?? ''} />
          </label>
          <label>
            <span className="profile-field-label"><Languages size={15} aria-hidden="true" />Мова</span>
            <select name="locale" defaultValue={user.locale}>
              <option value="uk-UA">Українська</option>
              <option value="en-US">English</option>
            </select>
          </label>
          <label>
            <span className="profile-field-label"><Clock3 size={15} aria-hidden="true" />Часовий пояс</span>
            <select name="timezone" defaultValue={user.timezone}>
              <option>Europe/Kyiv</option>
              <option>Europe/Warsaw</option>
              <option>Europe/London</option>
            </select>
          </label>
        </div>
        {error && <div className="form-error span-2">{error}</div>}
        {saved && (
          <p className="success-note span-2">
            <Check size={16} />
            Зміни збережено
          </p>
        )}
        <div className="form-actions span-2">
          <Button>
            <Save size={17} />
            Зберегти
          </Button>
        </div>
      </form>
    </Card>
  )
}

interface Preference {
  emailEnabled: boolean
  inAppEnabled: boolean
  digest: string
  quietStart: string
  quietEnd: string
}
function NotificationSettings() {
  const query = useQuery({
    queryKey: ['notification-preferences'],
    queryFn: () => api<Preference>('/me/notification-preferences'),
  })
  const client = useQueryClient()
  const save = useMutation({
    mutationFn: (input: Preference) => api('/me/notification-preferences', { method: 'PATCH', body: jsonBody(input) }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['notification-preferences'] }),
  })
  if (query.isLoading)
    return (
      <Card>
        <Skeleton />
      </Card>
    )
  if (query.isError || !query.data) return <ErrorState />
  return (
    <Card className="settings-card">
      <header>
        <span className="settings-icon">
          <BellRing />
        </span>
        <div>
          <h2>Сповіщення</h2>
          <p>Критичні security-події не можна вимкнути.</p>
        </div>
      </header>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          const data = new FormData(event.currentTarget)
          save.mutate({
            emailEnabled: data.get('email') === 'on',
            inAppEnabled: true,
            digest: String(data.get('digest')),
            quietStart: String(data.get('quietStart')),
            quietEnd: String(data.get('quietEnd')),
          })
        }}
        className="preference-form"
      >
        <label>
          <span>
            <strong>У застосунку</strong>
            <small>Задачі, погодження, згадки й безпека</small>
          </span>
          <input type="checkbox" checked readOnly />
        </label>
        <label>
          <span>
            <strong>Email-дайджест</strong>
            <small>Без приватного вмісту в темі листа</small>
          </span>
          <input type="checkbox" name="email" defaultChecked={query.data.emailEnabled} />
        </label>
        <label>
          <span>
            <strong>Частота дайджесту</strong>
          </span>
          <select name="digest" defaultValue={query.data.digest}>
            <option value="IMMEDIATE">Одразу</option>
            <option value="DAILY">Щодня</option>
            <option value="WEEKLY">Щотижня</option>
          </select>
        </label>
        <div className="quiet-hours">
          <label>
            Тихий режим від
            <input type="time" name="quietStart" defaultValue={query.data.quietStart} />
          </label>
          <label>
            до
            <input type="time" name="quietEnd" defaultValue={query.data.quietEnd} />
          </label>
        </div>
        <Button disabled={save.isPending}>
          <Save size={17} />
          Зберегти
        </Button>
        {save.isSuccess && (
          <p className="success-note">
            <Check size={16} />
            Збережено
          </p>
        )}
      </form>
    </Card>
  )
}

function SecuritySettings() {
  return (
    <div className="settings-stack">
      <Card className="settings-card">
        <header>
          <span className="settings-icon"><KeyRound /></span>
          <div>
            <h2>Пароль керується адміністратором</h2>
            <p>Адміністратор встановлює пароль під час створення облікового запису та може змінити його в картці користувача.</p>
          </div>
        </header>
        <p className="privacy-note"><ShieldCheck size={16} />Поточний пароль не зберігається у відкритому вигляді та не може бути показаний нікому.</p>
      </Card>
    </div>
  )

  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    setSaved(false)
    setError('')
    try {
      await api('/auth/password', {
        method: 'POST',
        body: jsonBody({
          currentPassword: data.get('currentPassword'),
          newPassword: data.get('newPassword'),
          confirmation: data.get('confirmation'),
        }),
      })
      event.currentTarget.reset()
      setSaved(true)
    } catch {
      setError('Не вдалося змінити пароль. Перевірте поточний пароль і політику нового.')
    }
  }
  return (
    <div className="settings-stack">
      <Card className="settings-card">
        <header>
          <span className="settings-icon">
            <KeyRound />
          </span>
          <div>
            <h2>Змінити пароль</h2>
            <p>Щонайменше 15 символів; без передбачуваних фраз і нікнейма.</p>
          </div>
        </header>
        <form className="security-form" onSubmit={submit}>
          <label>
            Поточний пароль
            <input name="currentPassword" type="password" required autoComplete="current-password" onInput={(event) => { event.currentTarget.value = removeWhitespace(event.currentTarget.value) }} />
          </label>
          <label>
            Новий пароль
            <input name="newPassword" type="password" minLength={15} required autoComplete="new-password" onInput={(event) => { event.currentTarget.value = removeWhitespace(event.currentTarget.value) }} />
          </label>
          <label>
            Повторіть новий пароль
            <input name="confirmation" type="password" minLength={15} required autoComplete="new-password" onInput={(event) => { event.currentTarget.value = removeWhitespace(event.currentTarget.value) }} />
          </label>
          {error && <div className="form-error">{error}</div>}
          {saved && (
            <p className="success-note">
              <Check size={16} />
              Пароль змінено, інші сесії завершено.
            </p>
          )}
          <Button>Змінити пароль</Button>
        </form>
      </Card>
      <Card className="security-summary">
        <ShieldCheck size={25} />
        <div>
          <h3>Двофакторна автентифікація</h3>
          <p>Керування 2FA і recovery codes потребує повторного підтвердження особи.</p>
        </div>
        <span>Захищено</span>
      </Card>
    </div>
  )
}

function SessionsSettings() {
  const client = useQueryClient()
  const query = useQuery({ queryKey: ['sessions'], queryFn: () => api<SessionView[]>('/me/sessions') })
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/me/sessions/${id}`, { method: 'DELETE' }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['sessions'] }),
  })
  const others = useMutation({
    mutationFn: () => api('/me/sessions/revoke-others', { method: 'POST' }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['sessions'] }),
  })
  return (
    <Card className="settings-card">
      <header>
        <span className="settings-icon">
          <Laptop />
        </span>
        <div>
          <h2>Активні сесії</h2>
          <p>Завершуйте доступ на пристроях, які більше не використовуєте.</p>
        </div>
      </header>
      {query.isLoading ? (
        <Skeleton />
      ) : query.isError ? (
        <ErrorState />
      ) : (
        <div className="session-list">
          {query.data?.map((session) => (
            <article key={session.id}>
              <span>{session.deviceLabel.toLowerCase().includes('mobile') ? <Smartphone /> : <Laptop />}</span>
              <div>
                <strong>{session.deviceLabel}</strong>
                <small>
                  {session.current ? 'Цей пристрій' : `Остання активність ${formatDateTime(session.lastSeenAt)}`}
                </small>
              </div>
              {session.current ? (
                <b>Поточна</b>
              ) : (
                <Button variant="ghost" onClick={() => revoke.mutate(session.id)}>
                  <LogOut size={16} />
                  Завершити
                </Button>
              )}
            </article>
          ))}
        </div>
      )}
      <footer>
        <Button variant="secondary" onClick={() => others.mutate()} disabled={others.isPending}>
          Завершити всі інші сесії
        </Button>
      </footer>
    </Card>
  )
}
