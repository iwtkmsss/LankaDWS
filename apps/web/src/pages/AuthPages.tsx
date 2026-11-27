import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { PASSWORD_MIN_LENGTH } from '@lankadws/contracts'
import { ArrowRight, Check, CheckCircle2, Copy, Eye, EyeOff, KeyRound, LockKeyhole, LogOut, UserRound } from 'lucide-react'
import { Navigate, useNavigate } from 'react-router-dom'
import { api, jsonBody } from '../shared/api/client'
import { useAuth } from '../shared/auth/AuthProvider'
import { removeWhitespace } from '../shared/lib/credentials'
import { encodeQr, qrSvgPath } from '../shared/lib/qr'
import { BrandMark, Button, Skeleton } from '../shared/ui'

/** The sign-in page frame: the brand panel and the card on the right, shared by the password and 2FA steps. */
function AuthLayout({ children }: { children: React.ReactNode }) {
  return <main className="auth-page">
    <section className="auth-panel"><div className="auth-brand"><BrandMark /><strong>Lanka</strong></div><div className="auth-copy"><span className="eyebrow">Внутрішній простір команди</span><h2>Робота, рішення й знання в одному місці.</h2></div><img src="/assets/auth/editorial-workspace.png" alt="Світлий сучасний робочий простір Lanka" width="720" height="480" /></section>
    <section className="login-card"><div className="login-stage">{children}</div></section>
  </main>
}

/**
 * Sign-in: the password first, then, in the same card without leaving the page, the authenticator
 * code or the mandatory 2FA enrolment. A restricted session (page reload, redirect) resumes at its step.
 */
export function LoginPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [pendingStep, setPendingStep] = useState<'CHALLENGE' | 'ENROLL' | null>(null)
  if (auth.state === 'loading') return <main className="center-state"><Skeleton rows={5} /></main>
  if (auth.state === 'authenticated') return <Navigate to="/" replace />
  const secondFactorStep = auth.state === 'restricted'
    ? pendingStep ?? auth.user?.secondFactorStep ?? (auth.user?.mustEnroll2FA ? 'ENROLL' : null)
    : null
  if (secondFactorStep === 'CHALLENGE') return <AuthLayout><TwoFactorChallenge /></AuthLayout>
  if (secondFactorStep === 'ENROLL') return <AuthLayout><TwoFactorSetupWizard /></AuthLayout>
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(''); setBusy(true)
    try {
      const step = await auth.login({ username, password })
      if (step === 'TWO_FACTOR') setPendingStep('CHALLENGE')
      else if (step === 'TWO_FACTOR_SETUP') setPendingStep('ENROLL')
      else navigate(step === 'FIRST_LOGIN' ? '/first-login' : '/', { replace: true })
    } catch { setError('Перевірте нікнейм і пароль та спробуйте ще раз.') } finally { setBusy(false) }
  }
  return <AuthLayout>
    <div><span className="eyebrow">З поверненням</span><h1>Увійти до Lanka</h1></div>
    <form onSubmit={submit}><label>Нікнейм<div className="field-with-icon"><UserRound size={17} aria-hidden="true" /><input autoComplete="username" value={username} onChange={(event) => setUsername(removeWhitespace(event.target.value).toLowerCase())} required pattern="[a-z0-9._\-]{3,32}" placeholder="maria" /></div></label><label>Пароль<div className="field-with-icon"><LockKeyhole size={17} /><input autoComplete="current-password" type={show ? 'text' : 'password'} value={password} onChange={(event) => setPassword(removeWhitespace(event.target.value))} required /><button type="button" aria-label={show ? 'Сховати пароль' : 'Показати пароль'} onClick={() => setShow((value) => !value)}>{show ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label>{error && <div className="form-error" role="alert">{error}</div>}<Button disabled={busy}>{busy ? 'Перевіряємо…' : <>Увійти <ArrowRight size={17} /></>}</Button></form>
    {__LANKADWS_DEMO_MODE__ && <aside className="demo-note"><strong>Демо-режим</strong><span>maria / andrii / olena / dmytro</span><code>{__LANKADWS_DEMO_PASSWORD__}</code></aside>}
  </AuthLayout>
}

export function RestrictedAccessPage({ mode }: { mode: 'first-login' | 'password-changed' }) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')
  async function change(event: FormEvent) {
    event.preventDefault(); setError('')
    try { await api('/auth/first-login/password', { method: 'POST', body: jsonBody({ newPassword: password, confirmation }) }); navigate('/password-changed', { replace: true }) } catch { setError('Пароль не відповідає політиці або значення не збігаються.') }
  }
  if (mode === 'password-changed') return <AccessCard icon={<CheckCircle2 />} title="Пароль змінено" text="Тимчасову сесію завершено. Увійдіть ще раз із власним паролем."><Button onClick={() => navigate('/login', { replace: true })}>До входу</Button></AccessCard>
  return <AccessCard icon={<KeyRound />} title="Створіть власний пароль" text="Тимчасовий пароль більше не діятиме після збереження."><form onSubmit={change} className="compact-form">{user?.username && <input type="text" name="username" autoComplete="username" value={user.username} readOnly hidden />}<label>Новий пароль<input type="password" autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} value={password} onChange={(event) => setPassword(removeWhitespace(event.target.value))} required /></label><label>Повторіть пароль<input type="password" autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} value={confirmation} onChange={(event) => setConfirmation(removeWhitespace(event.target.value))} required /></label>{error && <div className="form-error">{error}</div>}<Button>Зберегти пароль</Button></form></AccessCard>
}

const onlyDigits = (value: string) => value.replace(/\D/gu, '').slice(0, 6)
const CODE_ERROR = 'Код не підійшов. Введіть новий код із застосунку.'

function useFinishSignIn() {
  const navigate = useNavigate()
  const { refresh } = useAuth()
  return async () => { await refresh(); navigate('/', { replace: true }) }
}

function SignOutLink() {
  const navigate = useNavigate()
  const { logout } = useAuth()
  return <button type="button" className="access-link access-link--muted" onClick={() => void logout().then(() => navigate('/login', { replace: true }))}><LogOut size={15} aria-hidden="true" />Вийти</button>
}

/**
 * Six separate cells for the code. One real input lies over them, so typing, pasting a whole code
 * and one-time-code autofill keep working; the cells only show the digits and where the next goes.
 */
function CodeField({ value, onChange, autoFocus = false }: { value: string; onChange: (value: string) => void; autoFocus?: boolean }) {
  const [focused, setFocused] = useState(autoFocus)
  return <label>Код із застосунку
    <span className="otp-cells">
      <input className="otp-input" autoFocus={autoFocus} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={value} onChange={(event) => onChange(onlyDigits(event.target.value))} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} required />
      {Array.from({ length: 6 }, (_, index) => <span key={index} aria-hidden="true" className={`otp-cell${value[index] ? ' otp-cell--filled' : ''}${focused && index === Math.min(value.length, 5) ? ' otp-cell--active' : ''}`}>{value[index] ?? ''}</span>)}
    </span>
  </label>
}

/** The enrolment QR code; it is also a link, so tapping it on the phone opens the authenticator app. */
function QrLink({ uri }: { uri: string }) {
  const { path, size } = useMemo(() => {
    const modules = encodeQr(uri)
    return { path: qrSvgPath(modules), size: modules.length + 8 }
  }, [uri])
  return <a className="setup-qr" href={uri} aria-label="QR-код для застосунку-автентифікатора. Натисніть, щоб відкрити застосунок на цьому пристрої">
    <svg viewBox={`0 0 ${size} ${size}`} aria-hidden="true" shapeRendering="crispEdges"><rect width={size} height={size} fill="#fff" /><path d={path} fill="#000" /></svg>
  </a>
}

/** Demo installations accept any code; the note tells testers so (the server enforces it, not the client). */
function DemoCodeNote() {
  if (!__LANKADWS_DEMO_MODE__) return null
  return <p className="demo-hint">Демо: підійде будь-який 6-значний код.</p>
}

/** Mandatory 2FA enrolment on one screen: scan the QR code (or add the key by hand), enter the code. */
function TwoFactorSetupWizard() {
  const finish = useFinishSignIn()
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [code, setCode] = useState('')
  const [copied, setCopied] = useState(false)
  const [manualKey, setManualKey] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const started = useRef(false)
  async function load() {
    setLoadFailed(false)
    try { setSetup(await api<{ secret: string; uri: string }>('/auth/2fa/setup', { method: 'POST' })) } catch { setLoadFailed(true) }
  }
  useEffect(() => {
    // One secret per screen: a second request would replace the key the QR code already shows.
    if (started.current) return
    started.current = true
    void load()
  }, [])
  async function confirm(event: FormEvent) {
    event.preventDefault(); setError(''); setBusy(true)
    try { await api('/auth/2fa/confirm', { method: 'POST', body: jsonBody({ code }) }); await finish() } catch { setError(CODE_ERROR) } finally { setBusy(false) }
  }
  async function copySecret() {
    if (!setup) return
    try { await navigator.clipboard.writeText(setup.secret); setCopied(true) } catch { setCopied(false) }
  }
  const secretGroups = setup?.secret.match(/.{1,4}/gu) ?? []
  return <TwoFactorFrame title="Підключення 2FA">
    <form onSubmit={confirm} className="compact-form setup-single">
      <p>Відскануйте QR-код застосунком-автентифікатором і введіть код із нього.</p>
      <div className="setup-key-area">
        {!setup
          ? loadFailed
            ? <div className="setup-key-area__state"><p className="form-error" role="alert">Не вдалося отримати ключ.</p><Button type="button" variant="secondary" onClick={() => void load()}>Спробувати ще раз</Button></div>
            : <div className="setup-key-area__state"><Skeleton /></div>
          : !manualKey
            ? <>
              <QrLink uri={setup.uri} />
              <button type="button" className="access-link" onClick={() => setManualKey(true)}>Не сканується?</button>
            </>
            : <>
              <div className="setup-more__panel">
                <dl className="setup-key">
                  <div className="setup-key__row"><dt>Назва</dt><dd>LankaDWS</dd></div>
                  <div className="setup-key__row"><dt>Тип</dt><dd>За часом (TOTP)</dd></div>
                  <div className="setup-key__secret">
                    <dt>Ключ</dt>
                    <dd>
                      <code aria-label={secretGroups.join(' ')}>{secretGroups.map((group, index) => <span key={index}>{group}</span>)}</code>
                      <button type="button" className="setup-key__copy" onClick={() => void copySecret()} aria-label="Копіювати ключ" title="Копіювати ключ">{copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}</button>
                    </dd>
                  </div>
                </dl>
              </div>
              <button type="button" className="access-link" onClick={() => setManualKey(false)}>Показати QR-код</button>
            </>}
      </div>
      <CodeField value={code} onChange={setCode} />
      <DemoCodeNote />
      {error && <div className="form-error" role="alert">{error}</div>}
      <Button disabled={busy || !setup || code.length !== 6}>{busy ? 'Перевіряємо…' : 'Підключити'}</Button>
    </form>
    <SignOutLink />
  </TwoFactorFrame>
}

/** The code step after the password. Without the phone, an administrator resets 2FA. */
function TwoFactorChallenge() {
  const finish = useFinishSignIn()
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(''); setBusy(true)
    try {
      await api('/auth/2fa/challenge', { method: 'POST', body: jsonBody({ code }) })
      await finish()
    } catch { setError(CODE_ERROR) } finally { setBusy(false) }
  }
  return <TwoFactorFrame title="Підтвердження входу">
    <form onSubmit={submit} className="compact-form challenge-body">
      <CodeField autoFocus value={code} onChange={setCode} />
      <DemoCodeNote />
      {error && <div className="form-error" role="alert">{error}</div>}
      <Button disabled={busy || code.length !== 6}>{busy ? 'Перевіряємо…' : 'Увійти'}</Button>
      <details className="setup-more">
        <summary>Немає доступу до телефону?</summary>
        <div className="setup-more__panel">
          <p>Зверніться до адміністратора: він скине 2FA, і при наступному вході ви підключите його заново.</p>
        </div>
      </details>
    </form>
    <SignOutLink />
  </TwoFactorFrame>
}

/** Heading of a 2FA step inside the sign-in card. */
function TwoFactorFrame({ title, children }: { title: string; children: React.ReactNode }) {
  return <>
    <div><span className="eyebrow">Захист входу</span><h1>{title}</h1></div>
    {children}
  </>
}

function AccessCard({ icon, title, text, children }: { icon: React.ReactNode; title: string; text?: string; children: React.ReactNode }) {
  return <main className="access-page"><section className="access-card"><div className="access-card-header"><span className="auth-brand"><BrandMark size="lg" /><strong>Lanka</strong></span><div className="access-icon">{icon}</div></div><div><h1>{title}</h1>{text && <p>{text}</p>}</div>{children}</section></main>
}
