import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { PageResult, RequestListItem } from '@bert-crm/contracts'
import { ArrowLeft, ArrowRight, CalendarRange, Check, CheckCircle2, Clock3, FileClock, Plus, Search, ShieldCheck, UserRoundCheck, XCircle } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api, idempotencyKey, jsonBody } from '../shared/api/client'
import { useAuth } from '../shared/auth/AuthProvider'
import { formatDate, formatDateTime } from '../shared/lib/format'
import { Avatar, Button, Card, Drawer, EmptyState, ErrorState, PageHeader, Skeleton, StatusBadge, Tabs } from '../shared/ui'

interface Employee { id: string; displayName: string; jobTitle: string; avatarAsset?: string | null }
interface RequestDetail { id: string; number: string; companyId: string; version: number; decisionStatus: string; executionStatus: string; currentApproverId?: string | null; author: Employee; currentApprover: { id: string; displayName: string } | null; privateFieldsHidden: boolean; snapshots: Array<{ id: string; version: number; safeSummary: string; valuesJson: string; submittedAt: string }>; approvals: Array<{ id: string; state: string; comment?: string; decidedAt?: string; requestVersion: number }>; effects: Array<{ id: string; effectType: string; state: string }> }
interface RequestPageResult extends PageResult<RequestListItem> {
  counts: { mine: number; approval: number; company: number }
}

export default function RequestsPage() {
  const { requestId } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const { can } = useAuth()
  const rawSegment = params.get('tab') ?? 'mine'
  const segment = rawSegment === 'approval' && can('requests.approve')
    ? 'approval'
    : rawSegment === 'company' && can('confidential.hr.read')
      ? 'company'
      : 'mine'
  const page = Math.max(1, Number(params.get('page') ?? 1) || 1)
  const company = params.get('company') ?? ''
  const search = params.get('q') ?? ''
  const [searchDraft, setSearchDraft] = useState(search)
  useEffect(() => setSearchDraft(search), [search])
  const requestQuery = new URLSearchParams({
    segment,
    page: String(page),
    company,
  })
  if (search) requestQuery.set('q', search)
  const query = useQuery({
    queryKey: ['requests', segment, page, company, search],
    queryFn: () => api<RequestPageResult>(`/requests?${requestQuery.toString()}`),
    enabled: location.pathname !== '/requests/new',
  })
  const updateParams = (updates: Record<string, string | null>) => {
    setParams((current) => {
      for (const [key, value] of Object.entries(updates)) {
        if (value) current.set(key, value)
        else current.delete(key)
      }
      return current
    }, { replace: true })
  }
  if (location.pathname === '/requests/new') {
    return <AbsenceWizard onDone={(id) => {
      const next = new URLSearchParams(params)
      next.delete('type')
      next.delete('requestId')
      next.set('tab', 'mine')
      navigate(`/requests/${id}?${next.toString()}`, { replace: true })
    }} />
  }
  const totalPages = Math.max(1, Math.ceil((query.data?.total ?? 0) / (query.data?.pageSize ?? 25)))
  const createParams = new URLSearchParams()
  createParams.set('type', 'absence')
  if (company) createParams.set('company', company)
  return (
    <div className="requests-page">
      <PageHeader
        title="Заявки"
        description="Одна черга для подання, погодження та контролю виконання"
        action={can('requests.create') && (
          <Link to={`/requests/new?${createParams.toString()}`} className="button button--primary">
            <Plus size={17} />
            Нова заявка
          </Link>
        )}
      />
      <Card className="list-card request-list-card">
        <div className="list-toolbar request-toolbar">
          <Tabs
            value={segment}
            onChange={(value) => updateParams({ tab: value, page: null })}
            items={[
              { value: 'mine', label: 'Мої', count: query.data?.counts.mine },
              ...(can('requests.approve') ? [{
                value: 'approval',
                label: 'На погодження',
                count: query.data?.counts.approval,
              }] : []),
              ...(can('confidential.hr.read') ? [{
                value: 'company',
                label: 'Організація',
                count: query.data?.counts.company,
              }] : []),
            ]}
          />
          <form className="search-field" onSubmit={(event) => {
            event.preventDefault()
            updateParams({ q: searchDraft.trim() || null, page: null })
          }}>
            <Search size={17} />
            <input
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              placeholder="Номер або період"
              aria-label="Пошук заявок"
            />
          </form>
        </div>
        {query.isLoading ? <Skeleton rows={7} /> : query.isError ? (
          <ErrorState onRetry={() => void query.refetch()} />
        ) : query.data?.items.length ? (
          <>
            <div className="request-list">
              {query.data.items.map((item) => {
                const actor = segment === 'mine' ? item.currentApprover : item.author
                const overdue = item.decisionStatus === 'PENDING'
                  && Boolean(item.slaDueAt && new Date(item.slaDueAt) < new Date())
                return (
                  <Link to={`/requests/${item.id}${location.search}`} key={item.id}>
                    <span className="request-list__icon"><FileClock size={20} /></span>
                    <span className="request-list__copy">
                      <span>
                        <strong>{item.type}</strong>
                        <small>{item.number}</small>
                        {overdue && <em>Прострочено</em>}
                      </span>
                      <p>{item.safeSummary}</p>
                      <small>
                        {segment === 'mine' ? 'Погоджує' : 'Автор'}: {actor?.displayName ?? 'не призначено'}
                        {' · '}{formatDateTime(item.updatedAt)}
                      </small>
                    </span>
                    <span className="request-list__status">
                      <StatusBadge status={item.decisionStatus} />
                      {item.decisionStatus === 'APPROVED' && <StatusBadge status={item.executionStatus} />}
                    </span>
                    <ArrowRight size={17} />
                  </Link>
                )
              })}
            </div>
            {totalPages > 1 && (
              <nav className="request-pagination" aria-label="Сторінки заявок">
                <Button
                  variant="secondary"
                  disabled={page <= 1}
                  onClick={() => updateParams({ page: String(page - 1) })}
                >
                  <ArrowLeft size={16} />
                  Назад
                </Button>
                <span>Сторінка {page} з {totalPages}</span>
                <Button
                  variant="secondary"
                  disabled={page >= totalPages}
                  onClick={() => updateParams({ page: String(page + 1) })}
                >
                  Далі
                  <ArrowRight size={16} />
                </Button>
              </nav>
            )}
          </>
        ) : (
          <EmptyState
            title={search ? 'Нічого не знайдено' : 'Заявок немає'}
            description={search
              ? 'Перевірте номер або змініть період пошуку.'
              : segment === 'approval'
                ? 'Усі рішення опрацьовано.'
                : 'Створіть першу заявку — наприклад, на відпустку.'}
            action={search
              ? <Button variant="secondary" onClick={() => {
                  setSearchDraft('')
                  updateParams({ q: null, page: null })
                }}>Очистити пошук</Button>
              : undefined}
          />
        )}
      </Card>
      {requestId && (
        <RequestDrawer id={requestId} onClose={() => navigate(`/requests${location.search}`)} />
      )}
    </div>
  )
}

function AbsenceWizard({ onDone }: { onDone: (id: string) => void }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const requestId = params.get('requestId')
  const initialCompanyId = user?.organization.id ?? ''
  const [selectedCompanyId, setSelectedCompanyId] = useState(initialCompanyId)
  const [step, setStep] = useState(1)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [values, setValues] = useState({ startDate: '', endDate: '', substituteId: '', privateHrComment: '' })
  const loadedExisting = useRef(false)
  const submitKey = useRef(idempotencyKey(requestId ? 'absence-resubmit' : 'absence'))
  const existing = useQuery({
    queryKey: ['request', requestId],
    queryFn: () => api<RequestDetail>(`/requests/${requestId}`),
    enabled: Boolean(requestId),
  })
  useEffect(() => {
    if (!existing.data || loadedExisting.current) return
    loadedExisting.current = true
    const latest = existing.data.snapshots[0]
    try {
      const parsed = JSON.parse(latest?.valuesJson ?? '{}') as {
        startAt?: string
        endAt?: string
        substituteId?: string
      }
      setSelectedCompanyId(existing.data.companyId)
      setValues((current) => ({
        ...current,
        startDate: parsed.startAt?.slice(0, 10) ?? '',
        endDate: parsed.endAt?.slice(0, 10) ?? '',
        substituteId: parsed.substituteId ?? '',
      }))
    } catch {
      setError('Не вдалося відновити попередні дані заявки.')
    }
  }, [existing.data])
  const employees = useQuery({
    queryKey: ['employees', 'absence', selectedCompanyId],
    queryFn: () => api<{ items: Employee[] }>(
      `/employees?company=${encodeURIComponent(selectedCompanyId)}`,
    ),
    enabled: Boolean(selectedCompanyId),
  })
  const substitute = employees.data?.items.find((item) => item.id === values.substituteId)
  const workdays = useMemo(() => { if (!values.startDate || !values.endDate) return 0; let count = 0; const current = new Date(`${values.startDate}T12:00:00Z`); const end = new Date(`${values.endDate}T12:00:00Z`); while (current <= end) { if (![0, 6].includes(current.getUTCDay())) count += 1; current.setUTCDate(current.getUTCDate() + 1) } return count }, [values.startDate, values.endDate])
  function next(event: FormEvent) { event.preventDefault(); if (step === 1 && (!values.startDate || !values.endDate || values.endDate < values.startDate)) return setError('Перевірте період відсутності.'); if (step === 2 && !values.substituteId) return setError('Оберіть заміну.'); setError(''); setStep((value) => Math.min(value + 1, 3)) }
  async function submit() {
    if (!selectedCompanyId || submitting) return
    setError('')
    setSubmitting(true)
    try {
      const result = await api<RequestDetail>('/requests/absence', {
        method: 'POST',
        headers: { 'idempotency-key': submitKey.current },
        body: jsonBody({
          ...values,
          companyId: selectedCompanyId,
          ...(requestId && existing.data ? {
            requestId,
            expectedVersion: existing.data.version,
          } : {}),
        }),
      })
      onDone(result.id)
    } catch {
      setError('Не вдалося подати заявку. Перевірте погоджувача та актуальність даних.')
    } finally {
      setSubmitting(false)
    }
  }
  if (requestId && existing.isLoading) return <Skeleton rows={8} />
  if (requestId && (existing.isError || !existing.data)) {
    return <ErrorState onRetry={() => void existing.refetch()} />
  }
  return <div className="wizard-page"><PageHeader title={requestId ? 'Виправити заявку' : 'Нова заявка'} description="Відсутність · Відпустка" /><div className="stepper" aria-label="Кроки заявки">{['Період', 'Заміна', 'Перевірка'].map((label, index) => <span className={step >= index + 1 ? 'is-active' : ''} key={label}><i>{step > index + 1 ? <Check size={14} /> : index + 1}</i>{label}</span>)}</div><div className="wizard-layout"><Card className="wizard-card"><form onSubmit={next}>
    {step === 1 && <div className="wizard-step"><span className="step-icon"><CalendarRange /></span><h2>Коли вас не буде?</h2><p>Дати відображатимуться у календарі без приватної причини.</p><div className="date-pair"><label>Перший день<input type="date" value={values.startDate} onChange={(event) => setValues({ ...values, startDate: event.target.value })} required /></label><ArrowRight /><label>Останній день<input type="date" min={values.startDate} value={values.endDate} onChange={(event) => setValues({ ...values, endDate: event.target.value })} required /></label></div>{workdays > 0 && <div className="workday-note"><Clock3 size={17} /><strong>{workdays} робочих днів</strong><span>за стандартним п’ятиденним графіком</span></div>}</div>}
    {step === 2 && <div className="wizard-step"><span className="step-icon"><UserRoundCheck /></span><h2>Хто підстрахує?</h2><p>Оберіть колегу, який бачитиме лише безпечну інформацію про період заміни.</p><div className="people-picker">{employees.data?.items.filter((item) => item.id !== user?.id).map((item) => <label className={values.substituteId === item.id ? 'is-selected' : ''} key={item.id}><input type="radio" name="substitute" value={item.id} checked={values.substituteId === item.id} onChange={() => setValues({ ...values, substituteId: item.id })} /><Avatar name={item.displayName} src={item.avatarAsset} /><span><strong>{item.displayName}</strong><small>{item.jobTitle}</small></span><CheckCircle2 size={19} /></label>)}</div><label>Приватний коментар для HR <span className="optional">необов’язково</span><textarea rows={3} maxLength={1000} value={values.privateHrComment} onChange={(event) => setValues({ ...values, privateHrComment: event.target.value })} placeholder="Не потрапляє у календар, пошук чи повідомлення керівнику" /></label></div>}
    {step === 3 && <div className="wizard-step"><span className="step-icon"><ShieldCheck /></span><h2>Перевірте перед надсиланням</h2><div className="review-block"><div><span>Тип</span><strong>Відсутність · Відпустка</strong></div><div><span>Період</span><strong>{formatDate(values.startDate)} — {formatDate(values.endDate)} · {workdays} робочих днів</strong></div><div><span>Заміна</span><strong>{substitute?.displayName}</strong></div><div><span>Погодження</span><strong>Безпосередній керівник · SLA 2 дні</strong></div></div><p className="privacy-note"><ShieldCheck size={17} />Приватний HR-коментар зберігається окремо й зашифровано. Керівник не побачить його.</p></div>}
    {error && <div className="form-error" role="alert">{error}</div>}<div className="form-actions"><Button type="button" variant="secondary" onClick={() => step === 1 ? navigate(`/requests?company=${encodeURIComponent(selectedCompanyId)}&tab=mine`) : setStep(step - 1)}><ArrowLeft size={17} />{step === 1 ? 'Скасувати' : 'Назад'}</Button>{step < 3 ? <Button>Далі <ArrowRight size={17} /></Button> : <Button type="button" disabled={submitting} onClick={() => void submit()}>{submitting ? 'Надсилаємо…' : requestId ? 'Надіслати повторно' : 'Надіслати на погодження'}</Button>}</div>
  </form></Card><aside className="wizard-aside" aria-label="Результат погодження"><strong>Що станеться після погодження?</strong><ul><li><CalendarRange size={17} />Відсутність з’явиться у календарі</li><li><UserRoundCheck size={17} />Заміна отримає безпечне сповіщення</li><li><ShieldCheck size={17} />HR побачить дозволені деталі</li></ul></aside></div></div>
}

function RequestDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { user, can } = useAuth()
  const client = useQueryClient()
  const [comment, setComment] = useState('')
  const [cancelConfirm, setCancelConfirm] = useState(false)
  const query = useQuery({
    queryKey: ['request', id],
    queryFn: () => api<RequestDetail>(`/requests/${id}`),
  })
  const invalidate = () => {
    void client.invalidateQueries({ queryKey: ['request', id] })
    void client.invalidateQueries({ queryKey: ['requests'] })
    void client.invalidateQueries({ queryKey: ['dashboard'] })
    void client.invalidateQueries({ queryKey: ['notifications'] })
  }
  const decision = useMutation({
    mutationFn: ({ action, version, comment: note }: {
      action: 'approve' | 'return' | 'reject'
      version: number
      comment?: string
    }) => api(`/requests/${id}/${action}`, {
      method: 'POST',
      headers: action === 'approve' ? { 'idempotency-key': idempotencyKey('approval') } : undefined,
      body: jsonBody({ expectedVersion: version, ...(note ? { comment: note } : {}) }),
    }),
    onSuccess: invalidate,
  })
  const cancel = useMutation({
    mutationFn: (version: number) => api(`/requests/${id}/cancel`, {
      method: 'POST',
      body: jsonBody({ expectedVersion: version }),
    }),
    onSuccess: () => {
      setCancelConfirm(false)
      invalidate()
    },
  })
  const latest = query.data?.snapshots[0]
  let values: { startAt?: string; endAt?: string; workdays?: number; substituteId?: string } = {}
  try {
    values = latest ? JSON.parse(latest.valuesJson) as typeof values : {}
  } catch {
    // Safe fields remain unavailable when an old snapshot cannot be parsed.
  }
  const isAuthor = query.data?.author.id === user?.id
  const mayDecide = query.data?.decisionStatus === 'PENDING'
    && query.data.currentApproverId === user?.id
    && can('requests.approve')
  const mayResubmit = Boolean(isAuthor && query.data?.decisionStatus === 'RETURNED')
  const mayCancel = Boolean(
    isAuthor
    && query.data
    && ['PENDING', 'RETURNED', 'DRAFT'].includes(query.data.decisionStatus),
  )
  let footer: ReactNode
  if (mayDecide && query.data) {
    footer = (
      <div className="decision-actions">
        <Button
          variant="secondary"
          disabled={!comment.trim() || decision.isPending}
          onClick={() => decision.mutate({ action: 'return', version: query.data!.version, comment })}
        >
          Повернути
        </Button>
        <Button
          variant="danger"
          disabled={!comment.trim() || decision.isPending}
          onClick={() => decision.mutate({ action: 'reject', version: query.data!.version, comment })}
        >
          <XCircle size={16} />
          Відхилити
        </Button>
        <Button
          disabled={decision.isPending}
          onClick={() => decision.mutate({ action: 'approve', version: query.data!.version })}
        >
          <Check size={16} />
          Погодити
        </Button>
      </div>
    )
  } else if ((mayResubmit || mayCancel) && query.data) {
    footer = cancelConfirm ? (
      <div className="decision-actions">
        <Button variant="secondary" onClick={() => setCancelConfirm(false)}>Не скасовувати</Button>
        <Button
          variant="danger"
          disabled={cancel.isPending}
          onClick={() => cancel.mutate(query.data!.version)}
        >
          Так, скасувати
        </Button>
      </div>
    ) : (
      <div className="decision-actions">
        {mayCancel && <Button variant="secondary" onClick={() => setCancelConfirm(true)}>Скасувати заявку</Button>}
        {mayResubmit && (
          <Link
            className="button button--primary"
            to={`/requests/new?requestId=${encodeURIComponent(id)}&company=${encodeURIComponent(query.data.companyId)}`}
          >
            Виправити й надіслати
          </Link>
        )}
      </div>
    )
  }
  return (
    <Drawer title={query.data?.number ?? 'Заявка'} onClose={onClose} footer={footer}>
      {query.isLoading ? <Skeleton rows={7} /> : query.isError || !query.data ? (
        <ErrorState onRetry={() => void query.refetch()} />
      ) : (
        <div className="detail-stack request-detail">
          <div>
            <div className="request-detail__status">
              <StatusBadge status={query.data.decisionStatus} />
              <StatusBadge status={query.data.executionStatus} />
            </div>
            <h3>{latest?.safeSummary ?? 'Заявка'}</h3>
            <div className="request-author">
              <Avatar name={query.data.author.displayName} src={query.data.author.avatarAsset} />
              <span>
                <strong>{query.data.author.displayName}</strong>
                <small>{query.data.author.jobTitle}</small>
              </span>
            </div>
          </div>
          <dl className="detail-grid">
            <div><dt>Період</dt><dd>{values.startAt && values.endAt ? `${formatDate(values.startAt)} — ${formatDate(values.endAt)}` : '—'}</dd></div>
            <div><dt>Робочих днів</dt><dd>{values.workdays ?? '—'}</dd></div>
            <div><dt>Погоджувач</dt><dd>{query.data.currentApprover?.displayName ?? '—'}</dd></div>
            <div><dt>Версія</dt><dd>{query.data.version}</dd></div>
          </dl>
          {query.data.privateFieldsHidden && (
            <p className="privacy-note">
              <ShieldCheck size={17} />
              Приватні HR-поля приховано відповідно до вашого content scope.
            </p>
          )}
          {query.data.effects.length > 0 && (
            <section>
              <h4>Виконання після погодження</h4>
              <div className="request-effects">
                {query.data.effects.map((effect) => (
                  <span key={effect.id}>
                    <StatusBadge status={effect.state} />
                    {effect.effectType === 'absence.calendar'
                      ? 'Календар'
                      : effect.effectType === 'absence.presence'
                        ? 'Статус присутності'
                        : 'Сповіщення'}
                  </span>
                ))}
              </div>
            </section>
          )}
          <section>
            <h4>Історія заявки</h4>
            <ol className="activity-timeline">
              {query.data.snapshots.map((item) => (
                <li key={item.id}>
                  <i />
                  <div>
                    <strong>Версія {item.version}</strong>
                    <p>{item.safeSummary}</p>
                    <small>{formatDateTime(item.submittedAt)}</small>
                  </div>
                </li>
              ))}
              {query.data.approvals.filter((item) => item.state !== 'PENDING').map((item) => (
                <li key={item.id}>
                  <i />
                  <div>
                    <strong><StatusBadge status={item.state} /></strong>
                    {item.comment && <p>{item.comment}</p>}
                    <small>{item.decidedAt ? formatDateTime(item.decidedAt) : `Версія ${item.requestVersion}`}</small>
                  </div>
                </li>
              ))}
            </ol>
          </section>
          {mayDecide && (
            <label>
              Коментар для повернення або відхилення
              <textarea
                rows={3}
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                placeholder="Обов’язковий для негативного рішення"
              />
            </label>
          )}
          {(decision.isError || cancel.isError) && (
            <p className="form-error" role="alert">
              Не вдалося зберегти рішення. Оновіть заявку та повторіть.
            </p>
          )}
        </div>
      )}
    </Drawer>
  )
}
