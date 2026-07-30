import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleCheck, LoaderCircle, RotateCcw, Save } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { api, ApiProblem, idempotencyKey, jsonBody } from '../../../shared/api/client'
import { useAuth } from '../../../shared/auth/AuthProvider'
import {
  Button,
  ConfirmationDialog,
  Modal,
  Skeleton,
  useModalCloseGuard,
} from '../../../shared/ui'
import { loadTaskCreateOptions } from './api'
import { clearTaskDraft, loadTaskDraft, saveTaskDraft, taskDraftKey } from './draft'
import { TaskChecklistSection } from './TaskChecklistSection'
import { TaskFormNavigation } from './TaskFormNavigation'
import { TaskMainSection } from './TaskMainSection'
import { TaskParticipantsSection } from './TaskParticipantsSection'
import { TaskPlanningSection } from './TaskPlanningSection'
import { TaskRelationsSection } from './TaskRelationsSection'
import {
  mapTaskCreatePayload,
  validateTaskCreateDraft,
  type TaskCreateDraft,
  type TaskCreateSection,
} from './types'
import './task-create.css'

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
  const { user, can } = useAuth()
  const queryClient = useQueryClient()
  const userId = user?.id ?? ''
  const draftKey = taskDraftKey(userId, groupId)
  const initial = useMemo(
    () => defaultDraft(userId, groupId, initialResponsibleId),
    [groupId, initialResponsibleId, userId],
  )
  const restored = useMemo(() => loadTaskDraft(draftKey), [draftKey])
  const [draft, setDraft] = useState<TaskCreateDraft>(() => restored ?? initial)
  const [section, setSection] = useState<TaskCreateSection>('main')
  const [message, setMessage] = useState('')
  const [restoredVisible, setRestoredVisible] = useState(Boolean(restored))
  const titleRef = useRef<HTMLInputElement>(null)
  const continueEditingRef = useRef<HTMLButtonElement>(null)
  const initialFocusApplied = useRef(false)
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
      setMessage(error instanceof ApiProblem
        ? error.problem.detail ?? 'Сервер не прийняв дані. Перевірте форму.'
        : 'Не вдалося створити завдання. Спробуйте ще раз.')
    },
  })

  useEffect(() => {
    if (!dirty || create.isSuccess) return
    const timer = window.setTimeout(() => saveTaskDraft(draftKey, draft), 450)
    return () => window.clearTimeout(timer)
  }, [create.isSuccess, dirty, draft, draftKey])

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

  useEffect(() => {
    if (!options.data || initialFocusApplied.current) return
    initialFocusApplied.current = true
    titleRef.current?.focus()
  }, [options.data])

  function update(updateDraft: (current: TaskCreateDraft) => TaskCreateDraft) {
    setDraft(updateDraft)
    setMessage('')
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (create.isPending) return
    const issue = validateTaskCreateDraft(draft)
    if (issue) {
      setSection(issue.section)
      setMessage(issue.message)
      if (issue.field === 'title') {
        window.setTimeout(() => titleRef.current?.focus(), 0)
      }
      return
    }
    create.mutate()
  }

  const footer = (
    <>
      <span className="task-create-autosave" role="status">
        <Save size={14} aria-hidden /> Чернетка зберігається автоматично
      </span>
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
          ? <LoaderCircle className="spin" size={17} />
          : <CircleCheck size={17} />}
        {create.isPending ? 'Створення…' : 'Створити завдання'}
      </Button>
    </>
  )

  return (
    <>
      <Modal
        title="Нове завдання"
        description={groupId ? 'Завдання в контексті робочої групи' : 'Повна постановка роботи в одному вікні'}
        onRequestClose={closeGuard.requestClose}
        closeDisabled={create.isPending}
        initialFocusRef={titleRef}
        className="task-create-dialog"
        size="xl"
        footer={footer}
      >
        <form id="task-create-form" className="task-create-form" onSubmit={submit}>
          <TaskFormNavigation value={section} onChange={setSection} />
          <div className="task-create-content">
            {restoredVisible && (
              <div className="task-create-restored" role="status">
                <RotateCcw size={17} aria-hidden />
                <span><strong>Чернетку відновлено.</strong> Перевірте дані перед створенням.</span>
                <button type="button" onClick={() => setRestoredVisible(false)}>Гаразд</button>
              </div>
            )}
            {options.isLoading && <Skeleton rows={5} />}
            {options.isError && (
              <div className="form-error">
                Не вдалося завантажити доступні проєкти, людей і завдання.
                <button type="button" onClick={() => void options.refetch()}>Спробувати ще раз</button>
              </div>
            )}
            {options.data && section === 'main' && (
              <TaskMainSection
                draft={draft}
                options={options.data}
                update={update}
                titleRef={titleRef}
                onOptionsChanged={() => void options.refetch()}
              />
            )}
            {options.data && section === 'participants' && (
              <TaskParticipantsSection draft={draft} options={options.data} update={update} />
            )}
            {section === 'checklist' && (
              <TaskChecklistSection draft={draft} update={update} />
            )}
            {options.data && section === 'planning' && (
              <TaskPlanningSection
                draft={draft}
                options={options.data}
                update={update}
                canManageRecurrence={
                  can('tasks.recurrence.manage') || can('tasks.manage')
                }
              />
            )}
            {options.data && section === 'relations' && (
              <TaskRelationsSection draft={draft} options={options.data} update={update} />
            )}
            {message && (
              <div className="form-error task-create-message" role="alert">{message}</div>
            )}
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
            <>
              <button
                ref={continueEditingRef}
                type="button"
                className="button button--secondary"
                onClick={() => closeGuard.cancelClose()}
              >
                Продовжити редагування
              </button>
              <Button
                type="button"
                onClick={() => {
                  closeGuard.confirmClose(() => saveTaskDraft(draftKey, draft))
                }}
              >
                Закрити й зберегти
              </Button>
              <Button
                type="button"
                variant="danger"
                onClick={() => {
                  closeGuard.confirmClose(() => clearTaskDraft(draftKey))
                }}
              >
                Видалити чернетку
              </Button>
            </>
          )}
        >
          <p>Незбережене на сервері завдання не буде створене.</p>
        </ConfirmationDialog>
      )}
    </>
  )
}
