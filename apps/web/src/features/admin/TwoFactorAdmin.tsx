import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ShieldAlert } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { api, jsonBody } from '../../shared/api/client'
import { useAuth } from '../../shared/auth/AuthProvider'
import { formatDateTime } from '../../shared/lib/format'
import { removeWhitespace } from '../../shared/lib/credentials'
import { Button } from '../../shared/ui'
import { notifySuccess } from '../../shared/ui/notify'

function problemText(error: unknown) {
  const problem = error && typeof error === 'object' && 'problem' in error ? error.problem as { detail?: string; title?: string; code?: string } : undefined
  if (problem?.code === 'reauth_failed') return 'Пароль або код із застосунку не підійшов.'
  return problem?.detail ?? problem?.title ?? 'Не вдалося виконати дію.'
}

/** Confirms the administrator's identity (password, plus a code once their own app is connected). */
async function reauthenticate(password: string, code: string): Promise<string> {
  const result = await api<{ challengeId: string }>('/auth/reauth', { method: 'POST', body: jsonBody({ password, ...(code ? { code } : {}) }) })
  return result.challengeId
}

function ReauthFields({ password, code, onPassword, onCode }: { password: string; code: string; onPassword: (value: string) => void; onCode: (value: string) => void }) {
  const { user } = useAuth()
  return <>
    <label>Ваш пароль<input type="password" autoComplete="current-password" value={password} onChange={(event) => onPassword(removeWhitespace(event.target.value))} required /></label>
    {user?.secondFactorEnrolled && <label>Код із вашого застосунку<input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => onCode(event.target.value.replace(/\D/gu, '').slice(0, 6))} required /></label>}
  </>
}

/** The second-factor block in the administrator's user drawer: reset a lost app, or let the person in briefly without a code. */
const EXEMPTION_HOURS = [1, 2, 4, 8, 12, 24]

export function UserTwoFactorPanel({ userId, isSelf, enrolled, exemptUntil }: { userId: string; isSelf: boolean; enrolled: boolean; exemptUntil: string | null }) {
  const client = useQueryClient()
  const [action, setAction] = useState<'reset' | 'exempt' | null>(null)
  const [hours, setHours] = useState(1)
  const [reason, setReason] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const invalidate = () => { void client.invalidateQueries({ queryKey: ['admin-user', userId] }); void client.invalidateQueries({ queryKey: ['admin-users'] }) }
  const close = () => { setAction(null); setReason(''); setPassword(''); setCode('') }
  const run = useMutation({
    mutationFn: async () => {
      const challengeId = await reauthenticate(password, code)
      const headers = { 'x-reauth-challenge': challengeId }
      if (action === 'reset') return api(`/admin/users/${userId}/two-factor/reset`, { method: 'POST', headers, body: jsonBody({ reason }) })
      return api(`/admin/users/${userId}/two-factor/exemption`, { method: 'PUT', headers, body: jsonBody({ minutes: hours * 60, reason }) })
    },
    onSuccess: () => { notifySuccess(action === 'reset' ? 'Одноразові коди скинуто' : `Вхід без коду дозволено на ${hours} год`); close(); invalidate() },
  })
  const endExemption = useMutation({
    mutationFn: () => api(`/admin/users/${userId}/two-factor/exemption`, { method: 'PUT', body: jsonBody({ minutes: null, reason: '' }) }),
    onSuccess: () => { notifySuccess('Вхід без коду скасовано'); invalidate() },
  })
  function submit(event: FormEvent) { event.preventDefault(); if (!run.isPending) run.mutate() }
  return <section className="two-factor-panel span-2" aria-labelledby={`two-factor-${userId}`}>
    <h3 id={`two-factor-${userId}`}>Одноразові коди (OTP)</h3>
    <p className="two-factor-panel__status">
      <strong>{enrolled ? 'Застосунок підключено' : 'Не підключено: при вході відкриється майстер підключення'}</strong>
      {exemptUntil && <span><ShieldAlert size={15} aria-hidden="true" /> Вхід без коду до {formatDateTime(exemptUntil)}</span>}
    </p>
    {isSelf
      ? <p className="privacy-note">Власні коди скидає інший адміністратор.</p>
      : !action && <div className="two-factor-panel__actions">
        {enrolled && <Button type="button" variant="secondary" onClick={() => setAction('reset')}>Скинути коди</Button>}
        {exemptUntil
          ? <Button type="button" variant="secondary" disabled={endExemption.isPending} onClick={() => endExemption.mutate()}>Скасувати вхід без коду</Button>
          : <Button type="button" variant="secondary" onClick={() => setAction('exempt')}>Пустити без коду…</Button>}
      </div>}
    {endExemption.isError && <p role="alert" className="form-error">{problemText(endExemption.error)}</p>}
    {action && <form className="compact-form" onSubmit={submit}>
      <p className="two-factor-warning">{action === 'reset'
        ? 'Застосунок людини буде відв’язано, усі її сесії завершаться. При наступному вході вона підключить застосунок заново.'
        : 'Людина зможе входити лише за паролем протягом вибраного часу (щонайбільше добу). Потім код знову стане обов’язковим.'}</p>
      {action === 'exempt' && <label>На скільки<select value={hours} onChange={(event) => setHours(Number(event.target.value))}>{EXEMPTION_HOURS.map((value) => <option key={value} value={value}>{value === 24 ? '1 добу' : `${value} год`}</option>)}</select></label>}
      <label>Причина<input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} required placeholder="Наприклад: загубив телефон" /></label>
      <ReauthFields password={password} code={code} onPassword={setPassword} onCode={setCode} />
      {run.isError && <p role="alert" className="form-error">{problemText(run.error)}</p>}
      <div className="setup-nav"><Button type="button" variant="secondary" onClick={close}>Скасувати</Button><Button variant="danger" disabled={run.isPending}>{action === 'reset' ? 'Скинути коди' : hours === 24 ? 'Пустити без коду на добу' : `Пустити без коду на ${hours} год`}</Button></div>
    </form>}
  </section>
}
