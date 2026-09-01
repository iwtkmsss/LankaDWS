import { useState, type FormEvent } from 'react'
import { ArrowRight, CheckCircle2, Eye, EyeOff, KeyRound, LockKeyhole, ShieldCheck } from 'lucide-react'
import { Navigate, useNavigate } from 'react-router-dom'
import { api, jsonBody } from '../shared/api/client'
import { useAuth } from '../shared/auth/AuthProvider'
import { removeWhitespace } from '../shared/lib/credentials'
import { BrandMark, Button } from '../shared/ui'

export function LoginPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  if (auth.state === 'authenticated') return <Navigate to="/" replace />
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(''); setBusy(true)
    try {
      const step = await auth.login({ username, password })
      navigate(step === 'AUTHENTICATED' ? '/' : step === 'FIRST_LOGIN' ? '/first-login' : step === 'TWO_FACTOR' ? '/access/challenge' : '/access/setup', { replace: true })
    } catch { setError('Перевірте нікнейм і пароль та спробуйте ще раз.') } finally { setBusy(false) }
  }
  return <main className="auth-page">
    <section className="auth-panel"><div className="auth-brand"><BrandMark /><strong>Lanka</strong></div><div className="auth-copy"><span className="eyebrow">Внутрішній простір команди</span><h2>Робота, рішення й знання — в одному місці.</h2></div><img src="/assets/auth/editorial-workspace.png" alt="Світлий сучасний робочий простір Lanka" width="720" height="480" /></section>
    <section className="login-card"><div><span className="eyebrow">З поверненням</span><h1>Увійти до Lanka</h1></div>
      <form onSubmit={submit}><label>Нікнейм<div className="field-with-icon"><span>@</span><input autoComplete="username" value={username} onChange={(event) => setUsername(removeWhitespace(event.target.value).toLowerCase())} required pattern="[a-z0-9._\-]{3,32}" placeholder="maria" /></div></label><label>Пароль<div className="field-with-icon"><LockKeyhole size={17} /><input autoComplete="current-password" type={show ? 'text' : 'password'} value={password} onChange={(event) => setPassword(removeWhitespace(event.target.value))} required /><button type="button" aria-label={show ? 'Сховати пароль' : 'Показати пароль'} onClick={() => setShow((value) => !value)}>{show ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label>{error && <div className="form-error" role="alert">{error}</div>}<Button disabled={busy}>{busy ? 'Перевіряємо…' : <>Увійти <ArrowRight size={17} /></>}</Button><a href="/access-help">Не вдається увійти?</a></form>
      {__BERT_DEMO_MODE__ && <aside className="demo-note"><strong>Демо-режим</strong><span>maria / andrii / olena / dmytro</span><code>{__BERT_DEMO_PASSWORD__}</code></aside>}
    </section>
  </main>
}

export function RestrictedAccessPage({ mode }: { mode: 'first-login' | 'password-changed' | 'help' | 'setup' | 'challenge' }) {
  const navigate = useNavigate()
  const { refresh } = useAuth()
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [code, setCode] = useState('')
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null)
  const [error, setError] = useState('')
  async function change(event: FormEvent) {
    event.preventDefault(); setError('')
    try { await api('/auth/first-login/password', { method: 'POST', body: jsonBody({ newPassword: password, confirmation }) }); navigate('/password-changed', { replace: true }) } catch { setError('Пароль не відповідає політиці або значення не збігаються.') }
  }
  async function startSetup() { const data = await api<{ secret: string; uri: string }>('/auth/2fa/setup', { method: 'POST' }); setSetup(data) }
  async function confirm(event: FormEvent) { event.preventDefault(); try { await api('/auth/2fa/confirm', { method: 'POST', body: jsonBody({ code }) }); await refresh(); navigate('/', { replace: true }) } catch { setError('Код не підтверджено. Перевірте час на пристрої.') } }
  async function challenge(event: FormEvent) { event.preventDefault(); try { await api('/auth/2fa/challenge', { method: 'POST', body: jsonBody({ code }) }); await refresh(); navigate('/', { replace: true }) } catch { setError('Код не підтверджено. Перевірте час на пристрої.') } }
  if (mode === 'password-changed') return <AccessCard icon={<CheckCircle2 />} title="Пароль змінено" text="Тимчасову сесію завершено. Увійдіть ще раз із власним паролем."><Button onClick={() => navigate('/login', { replace: true })}>До входу</Button></AccessCard>
  if (mode === 'help') return <AccessCard variant="help" icon={<KeyRound />} title="Допомога з доступом" text="У Lanka немає відновлення через email. Зверніться до уповноваженого адміністратора організації — він запустить контрольоване відновлення."><div className="access-card-actions"><Button onClick={() => navigate('/login')}>До входу</Button></div></AccessCard>
  if (mode === 'challenge') return <AccessCard icon={<ShieldCheck />} title="Підтвердьте вхід" text="Введіть одноразовий код із застосунку-автентифікатора."><form onSubmit={challenge} className="compact-form"><label>6-значний код<input autoFocus inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" value={code} onChange={(event) => setCode(event.target.value)} required /></label>{error && <div className="form-error">{error}</div>}<Button>Підтвердити</Button></form></AccessCard>
  if (mode === 'setup') return <AccessCard icon={<ShieldCheck />} title="Захистіть обліковий запис" text="Для вашої ролі потрібна двофакторна автентифікація.">{!setup ? <Button onClick={() => void startSetup()}>Почати налаштування</Button> : <form onSubmit={confirm} className="compact-form"><p>Додайте секрет до застосунку-автентифікатора:</p><code>{setup.secret}</code><label>6-значний код<input inputMode="numeric" pattern="[0-9]{6}" value={code} onChange={(event) => setCode(event.target.value)} required /></label>{error && <div className="form-error">{error}</div>}<Button>Підтвердити</Button></form>}</AccessCard>
  return <AccessCard icon={<KeyRound />} title="Створіть власний пароль" text="Тимчасовий пароль більше не діятиме після збереження."><form onSubmit={change} className="compact-form"><label>Новий пароль<input type="password" minLength={15} value={password} onChange={(event) => setPassword(removeWhitespace(event.target.value))} required /></label><label>Повторіть пароль<input type="password" minLength={15} value={confirmation} onChange={(event) => setConfirmation(removeWhitespace(event.target.value))} required /></label>{error && <div className="form-error">{error}</div>}<Button>Зберегти пароль</Button></form></AccessCard>
}

function AccessCard({ icon, title, text, children, variant = 'default' }: { icon: React.ReactNode; title: string; text: string; children: React.ReactNode; variant?: 'default' | 'help' }) {
  const help = variant === 'help'
  return <main className="access-page"><section className={`access-card ${help ? 'access-card--help' : ''}`}><div className="access-card-header"><span className={help ? 'access-brand-lockup' : 'auth-brand'}><BrandMark size="lg" />{help ? <span className="access-brand-name"><strong>Lanka</strong></span> : <strong>Lanka</strong>}</span><div className="access-icon">{icon}</div></div><div><h1>{title}</h1><p>{text}</p></div>{children}</section></main>
}
