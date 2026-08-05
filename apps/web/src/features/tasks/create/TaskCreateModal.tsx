import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  CalendarClock,
  ChevronDown,
  CircleCheck,
  Link2,
  ListChecks,
  LoaderCircle,
  PackageOpen,
  RotateCcw,
  Save,
  Users,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'
import { api, ApiProblem, idempotencyKey, jsonBody } from '../../../shared/api/client'
import { useAuth } from '../../../shared/auth/AuthProvider'
import {
  Button,
  ConfirmationDialog,
  Modal,
  useModalCloseGuard,
} from '../../../shared/ui'
import { loadTaskCreateOptions } from './api'
import { clearTaskDraft, loadTaskDraft, saveTaskDraft, taskDraftKey } from './draft'
import { TaskChecklistSection } from './TaskChecklistSection'
import { TaskBasicsSection, TaskContextSection } from './TaskMainSection'
import { TaskParticipantsSection, TaskResponsibleField } from './TaskParticipantsSection'
import { TaskPlanningSection } from './TaskPlanningSection'
import { TaskRelationsSection } from './TaskRelationsSection'
import {
  mapTaskCreatePayload,
  validateTaskCreateDraft,
  type TaskCreateDraft,
  type TaskCreateSection,
  type TaskCreateValidation,
} from './types'
import './task-create.css'

type DetailSection = 'context' | Exclude<TaskCreateSection, 'main'>
type DraftSaveState = 'saving' | 'saved' | 'error'

function defaultDraft(
  userId: string,
  groupId: string,
  initialResponsibleId: string,
): TaskCreateDraft {
  return {
    title: '',
    description: '',
    groupId,
    projectId: '',
    parentTaskId: '',
    reporterId: userId,
    priority: 'MEDIUM',
    startsAt: '',
    dueAt: '',
    estimatedMinutes: '',
    participants: [{
      userId: initialResponsibleId || userId,
      role: 'RESPONSIBLE',
    }],
    checklistItems: [],
    tagIds: [],
    relations: [],
    reminders: [],
    recurrence: null,
    attachments: [],
  }
}

function TaskDisclosure({
  id,
  title,
  description,
  summary,
  icon,
  open,
  onToggle,
  children,
}: {
  id: DetailSection
  title: string
  description: string
  summary: string
  icon: ReactNode
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  const buttonId = `task-create-${id}-toggle`
  const panelId = `task-create-${id}-panel`
  return (
    <section className={`task-create-disclosure ${open ? 'is-open' : ''}`}>
      <button
        id={buttonId}
        type="button"
        className="task-create-disclosure__trigger"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
      >
        <span className="task-create-disclosure__icon">{icon}</span>
        <span className="task-create-disclosure__copy">
          <strong>{title}</strong>
          <small>{description}</small>
        </span>
        <span className="task-create-disclosure__summary">{summary}</span>
        <ChevronDown size={18} className="task-create-disclosure__chevron" aria-hidden />
      </button>
      {open && (
        <div
          id={panelId}
          className="task-create-disclosure__panel"
          role="region"
          aria-labelledby={buttonId}
        >
          {children}
        </div>
      )}
    </section>
  )
}

function OptionsSectionState({
  loading,
  label,
  onRetry,
}: {
  loading: boolean
  label: string
  onRetry: () => void
}) {
  if (loading) {
    return <p className="task-create-local-state" role="status">Завантажуємо {label}…</p>
  }
  return (
    <div className="task-create-local-error">
      <span>Не вдалося завантажити {label}. Введені значення збережено.</span>
      <button type="button" onClick={onRetry}>Повторити</button>
    </div>
  )
}

export function TaskCreateModal({
  groupId,
  initialResponsibleId = '',
  onClose,
  onDone,
}: {
  groupId: string
  initialResponsibleId?: string
  onClose: () => void
  onDone: (taskId: string) => void
}) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const userId = user?.id ?? ''
  const draftKey = taskDraftKey(userId, groupId)
  const initial = useMemo(
    () => defaultDraft(userId, groupId, initialResponsibleId),
    [groupId, initialResponsibleId, userId],
  )
  const restored = useMemo(() => loadTaskDraft(draftKey), [draftKey])
  const [draft, setDraft] = useState<TaskCreateDraft>(() => restored ?? initial)
  const [openSections, setOpenSections] = useState<Set<DetailSection>>(() => new Set())
  const [serverMessage, setServerMessage] = useState('')
  const [validation, setValidation] = useState<TaskCreateValidation | null>(null)
  const [restoredVisible, setRestoredVisible] = useState(Boolean(restored))
  const [draftSaveState, setDraftSaveState] = useState<DraftSaveState>('saved')
  const titleRef = useRef<HTMLInputElement>(null)
  const dueAtRef = useRef<HTMLInputElement>(null)
  const errorRef = useRef<HTMLDivElement>(null)
  const continueEditingRef = useRef<HTMLButtonElement>(null)
  const idempotencyRef = useRef(idempotencyKey('task'))
  const lastPayloadRef = useRef('')
  const pristineRef = useRef(JSON.stringify(initial))
  const dirty = JSON.stringify(draft) !== pristineRef.current
  const closeGuard = useModalCloseGuard({
    dirty,
    onRequestClose: () => onClose(),
  })
  const options = useQuery({
    queryKey: ['task-create-options', groupId, draft.projectId],
    queryFn: () => loadTaskCreateOptions(groupId, draft.projectId),
    enabled: Boolean(userId),
    retry: false,
  })
  const create = useMutation({
    mutationFn: async () => {
      const payload = mapTaskCreatePayload(draft)
      const serialized = JSON.stringify(payload)
      if (lastPayloadRef.current && lastPayloadRef.current !== serialized) {
        idempotencyRef.current = idempotencyKey('task')
      }
      lastPayloadRef.current = serialized
      return api<{ id: string }>('/tasks', {
        method: 'POST',
        headers: { 'idempotency-key': idempotencyRef.current },
        body: jsonBody(payload),
      })
    },
    onSuccess: (result) => {
      clearTaskDraft(draftKey)
      void queryClient.invalidateQueries({ queryKey: ['tasks'] })
      closeGuard.closeForSuccess(() => onDone(result.id))
    },
    onError: (error) => {
      setValidation(null)
      setServerMessage(error instanceof ApiProblem
        ? error.problem.detail ?? 'Сервер не прийняв дані. Перевірте форму.'
        : 'Не вдалося створити завдання. Спробуйте ще раз.')
      window.setTimeout(() => {
        errorRef.current?.scrollIntoView({ block: 'nearest' })
        errorRef.current?.focus({ preventScroll: true })
      }, 0)
    },
  })

  const persistDraft = useCallback(() => {
    setDraftSaveState('saving')
    try {
      saveTaskDraft(draftKey, draft)
      setDraftSaveState('saved')
    } catch {
      setDraftSaveState('error')
    }
  }, [draft, draftKey])

  useEffect(() => {
    if (!dirty || create.isSuccess) return
    setDraftSaveState('saving')
    const timer = window.setTimeout(persistDraft, 450)
    return () => window.clearTimeout(timer)
  }, [create.isSuccess, dirty, draft, persistDraft])

  useEffect(() => {
    if (!options.data) return
    const availableIds = new Set(options.data.users.map((option) => option.id))
    setDraft((current) => {
      const participants = current.participants.filter((participant) => (
        availableIds.has(participant.userId)
      ))
      if (
        !participants.some((participant) => participant.role === 'RESPONSIBLE')
        && availableIds.has(userId)
      ) {
        participants.push({ userId, role: 'RESPONSIBLE' })
      }
      const reporterId = availableIds.has(current.reporterId)
        ? current.reporterId
        : availableIds.has(userId) ? userId : ''
      if (
        reporterId === current.reporterId
        && participants.length === current.participants.length
      ) {
        return current
      }
      return { ...current, reporterId, participants }
    })
  }, [options.data, userId])

  function update(updateDraft: (current: TaskCreateDraft) => TaskCreateDraft) {
    setDraft(updateDraft)
    setServerMessage('')
    setValidation(null)
  }

  function openSection(section: DetailSection) {
    setOpenSections((current) => {
      const next = new Set(current)
      next.add(section)
      return next
    })
  }

  function toggleSection(section: DetailSection) {
    setOpenSections((current) => {
      const next = new Set(current)
      if (next.has(section)) next.delete(section)
      else next.add(section)
      return next
    })
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (create.isPending) return
    const issue = validateTaskCreateDraft(draft)
    if (issue) {
      setServerMessage('')
      setValidation(issue)
      if (issue.section !== 'main') openSection(issue.section)
      window.setTimeout(() => {
        const field = issue.field === 'title'
          ? titleRef.current
          : issue.field === 'dueAt' ? dueAtRef.current : null
        const target = field ?? errorRef.current
        target?.scrollIntoView({ block: 'nearest' })
        target?.focus({ preventScroll: true })
      }, 0)
      return
    }
    create.mutate()
  }

  const responsibleCount = draft.participants.filter((item) => item.role === 'RESPONSIBLE').length
  const additionalParticipantCount = draft.participants.length - responsibleCount
  const projectName = options.data?.projects.find((item) => item.id === draft.projectId)?.name
  const contextSummary = [
    projectName,
    draft.tagIds.length ? `${draft.tagIds.length} тег.` : '',
    draft.attachments.length ? `${draft.attachments.length} файл.` : '',
  ].filter(Boolean).join(' · ') || 'Не налаштовано'
  const planningSummary = [
    draft.reminders.length ? `${draft.reminders.length} нагад.` : '',
    draft.recurrence ? 'Повторення увімкнено' : '',
  ].filter(Boolean).join(' · ') || 'Не налаштовано'
  const retryOptions = () => { void options.refetch() }
  const errorMessage = validation?.message || serverMessage

  const footer = (
    <>
      <Button
        type="button"
        variant="secondary"
        disabled={create.isPending}
        onClick={() => closeGuard.requestClose('cancel-button')}
      >
        Скасувати
      </Button>
      <Button type="submit" form="task-create-form" disabled={create.isPending}>
        {create.isPending
          ? <LoaderCircle className="spin" size={17} aria-hidden />
          : <CircleCheck size={17} aria-hidden />}
        {create.isPending ? 'Створення…' : 'Створити завдання'}
      </Button>
    </>
  )

  return (
    <>
      <Modal
        title="Нове завдання"
        description={groupId
          ? 'Контекст робочої групи вже застосовано. Спочатку опишіть результат і відповідальних.'
          : 'Спочатку опишіть результат і відповідальних; додаткові параметри можна налаштувати нижче.'}
        onRequestClose={closeGuard.requestClose}
        closeDisabled={create.isPending}
        initialFocusRef={titleRef}
        className="task-create-dialog"
        size="lg"
        footer={footer}
      >
        <form id="task-create-form" className="task-create-form" noValidate onSubmit={submit}>
          <div className={`task-create-save-status task-create-save-status--${draftSaveState}`}>
            {draftSaveState === 'saving' && (
              <><LoaderCircle className="spin" size={14} aria-hidden /><span>Збереження…</span></>
            )}
            {draftSaveState === 'saved' && (
              <><Save size={14} aria-hidden /><span>Збережено</span></>
            )}
            {draftSaveState === 'error' && (
              <>
                <AlertCircle size={15} aria-hidden />
                <span role="alert">Не вдалося зберегти</span>
                <span aria-hidden>·</span>
                <button type="button" onClick={persistDraft}>Повторити</button>
              </>
            )}
          </div>

          {restoredVisible && (
            <div className="task-create-restored" role="status">
              <RotateCcw size={17} aria-hidden />
              <span><strong>Чернетку відновлено.</strong> Перевірте дані перед створенням.</span>
              <button type="button" onClick={() => setRestoredVisible(false)}>Гаразд</button>
            </div>
          )}

          {errorMessage && (
            <div
              id="task-create-error"
              ref={errorRef}
              className="form-error task-create-message"
              role="alert"
              tabIndex={-1}
            >
              {errorMessage}
            </div>
          )}

          <TaskBasicsSection
            draft={draft}
            update={update}
            titleRef={titleRef}
            dueAtRef={dueAtRef}
            invalidField={validation?.field}
          />

          <TaskResponsibleField
            draft={draft}
            options={options.data}
            currentUser={user}
            optionsLoading={options.isLoading}
            optionsError={options.isError}
            update={update}
            onOpenParticipants={() => openSection('participants')}
            onRetryOptions={retryOptions}
          />

          <div className="task-create-details" aria-label="Додаткові параметри">
            <div className="task-create-details__intro">
              <div>
                <span className="task-create-kicker">Необов’язково</span>
                <h3>Додаткові параметри</h3>
              </div>
              <p>Відкрийте лише ті секції, які потрібні для цього завдання.</p>
            </div>

            <TaskDisclosure
              id="context"
              title="Контекст і матеріали"
              description="Проєкт, ієрархія, теги та вкладення"
              summary={contextSummary}
              icon={<PackageOpen size={18} aria-hidden />}
              open={openSections.has('context')}
              onToggle={() => toggleSection('context')}
            >
              <TaskContextSection
                draft={draft}
                options={options.data}
                optionsLoading={options.isLoading}
                optionsError={options.isError}
                update={update}
                onRetryOptions={retryOptions}
                onOptionsChanged={retryOptions}
              />
            </TaskDisclosure>

            <TaskDisclosure
              id="participants"
              title="Учасники"
              description="Постановник, співвиконавці та спостерігачі"
              summary={additionalParticipantCount ? `${additionalParticipantCount} додано` : 'Не додано'}
              icon={<Users size={18} aria-hidden />}
              open={openSections.has('participants')}
              onToggle={() => toggleSection('participants')}
            >
              <TaskParticipantsSection
                draft={draft}
                options={options.data}
                optionsLoading={options.isLoading}
                optionsError={options.isError}
                update={update}
                onRetryOptions={retryOptions}
              />
            </TaskDisclosure>

            <TaskDisclosure
              id="checklist"
              title="Чек-ліст"
              description="Конкретні кроки до готового результату"
              summary={draft.checklistItems.length ? `${draft.checklistItems.length} пункт.` : 'Не додано'}
              icon={<ListChecks size={18} aria-hidden />}
              open={openSections.has('checklist')}
              onToggle={() => toggleSection('checklist')}
            >
              <TaskChecklistSection draft={draft} update={update} />
            </TaskDisclosure>

            <TaskDisclosure
              id="planning"
              title="Планування"
              description="Оцінка часу, нагадування та повторення"
              summary={planningSummary}
              icon={<CalendarClock size={18} aria-hidden />}
              open={openSections.has('planning')}
              onToggle={() => toggleSection('planning')}
            >
              {options.data ? (
                <TaskPlanningSection
                  draft={draft}
                  options={options.data}
                  update={update}
                  canManageRecurrence
                />
              ) : (
                <OptionsSectionState
                  loading={options.isLoading}
                  label="дані для планування"
                  onRetry={retryOptions}
                />
              )}
            </TaskDisclosure>

            <TaskDisclosure
              id="relations"
              title="Зв’язки"
              description="Батьківське завдання, залежності та дублікати"
              summary={draft.relations.length ? `${draft.relations.length} додано` : 'Не додано'}
              icon={<Link2 size={18} aria-hidden />}
              open={openSections.has('relations')}
              onToggle={() => toggleSection('relations')}
            >
              {options.data ? (
                <TaskRelationsSection draft={draft} options={options.data} update={update} />
              ) : (
                <OptionsSectionState
                  loading={options.isLoading}
                  label="доступні завдання і зв’язки"
                  onRetry={retryOptions}
                />
              )}
            </TaskDisclosure>
          </div>
        </form>
      </Modal>
      {closeGuard.isConfirmationOpen && (
        <ConfirmationDialog
          title="Закрити форму?"
          description="Чернетка залишиться на цьому пристрої протягом 7 днів."
          onRequestClose={() => closeGuard.cancelClose()}
          initialFocusRef={continueEditingRef}
          footer={(
            <div className="task-create-draft-actions">
              <div>
                <button
                  ref={continueEditingRef}
                  type="button"
                  className="button button--primary"
                  onClick={() => closeGuard.cancelClose()}
                >
                  Продовжити редагування
                </button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    closeGuard.confirmClose(() => saveTaskDraft(draftKey, draft))
                  }}
                >
                  Зберегти чернетку і закрити
                </Button>
              </div>
              <Button
                type="button"
                variant="danger"
                onClick={() => {
                  closeGuard.confirmClose(() => clearTaskDraft(draftKey))
                }}
              >
                Видалити чернетку
              </Button>
            </div>
          )}
        >
          <p>Незбережене на сервері завдання не буде створене.</p>
        </ConfirmationDialog>
      )}
    </>
  )
}
