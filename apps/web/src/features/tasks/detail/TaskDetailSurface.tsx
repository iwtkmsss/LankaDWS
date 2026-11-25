import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { TaskAttachmentView } from '@lankadws/contracts'
import { AlertTriangle, CalendarDays, Plus } from 'lucide-react'
import { type ReactNode, type RefObject, useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ApiProblem, api, apiUrl, jsonBody } from '../../../shared/api/client'
import { useAuth } from '../../../shared/auth/AuthProvider'
import { formatDateTime } from '../../../shared/lib/format'
import { placedPhotos } from '../../../shared/inline-photos/InlinePhotoCanvas'
import { placementToPhoto, type InlinePhoto } from '../../../shared/inline-photos/inlinePhotos'
import {
  Card,
  ErrorState,
  PageDataLoader,
  PageHeader,
  StatusBadge,
  UnsavedChangesDialog,
  useModalCloseGuard,
} from '../../../shared/ui'
import { notifyError, notifySuccess } from '../../../shared/ui/notify'
import { TaskChecklist } from './TaskChecklist'
import { TaskDelegateForm } from './TaskDelegateForm'
import { TaskDetailHeading } from './TaskDetailHeading'
import { TaskDiscussion } from './TaskDiscussion'
import { TaskEditForm } from './TaskEditForm'
import { TaskMaterials } from './TaskMaterials'
import { TaskParticipants } from './TaskParticipants'
import { TaskPlanning } from './TaskPlanning'
import { TaskRelations } from './TaskRelations'
import { taskPriorityLabel } from './taskLabels'
import { refreshTask, useTaskDetail } from './useTaskDetail'
import './task-detail.css'

export function TaskDetailPage({ id }: { id: string }) {
  const location = useLocation()
  const navigate = useNavigate()

  return <TaskDetailSurface id={id} onBack={() => navigate(`/tasks${location.search}`)} />
}

export function TaskDetailSurface({ id, onBack }: { id: string; onBack: () => void }) {
  const client = useQueryClient()
  const location = useLocation()
  const { user } = useAuth()
  const { query, activity } = useTaskDetail(id)
  const detailStackRef = useRef<HTMLDivElement>(null)
  useDiscussionBaselineHeight(detailStackRef, id, Boolean(query.data))
  const [editPhotos, setEditPhotos] = useState<InlinePhoto[]>([])
  const [delegateOpen, setDelegateOpen] = useState(false)
  const [commentAttachments, setCommentAttachments] = useState<TaskAttachmentView[]>([])
  const [contentMessage, setContentMessage] = useState('')
  const [editOpen, setEditOpen] = useState(false)
  const [editCreatorId, setEditCreatorId] = useState('')
  const [subtaskFormOpen, setSubtaskFormOpen] = useState(false)
  const [statusError, setStatusError] = useState('')
  const [linksOpen, setLinksOpen] = useState(false)
  const [dirtyForms, setDirtyForms] = useState<string[]>([])
  // Unsent drafts live in the discussion and checklist components; they only report whether they are dirty.
  const [discussionDirty, setDiscussionDirty] = useState(false)
  const [checklistDirty, setChecklistDirty] = useState(false)
  const markDirty = (form: string) => {
    setDirtyForms((current) => current.includes(form) ? current : [...current, form])
  }
  const clearDirty = (form: string) => {
    setDirtyForms((current) => current.filter((item) => item !== form))
  }
  const closeGuard = useModalCloseGuard({
    dirty: Boolean(
      dirtyForms.length
      || discussionDirty
      || commentAttachments.length
      || checklistDirty,
    ),
    onRequestClose: onBack,
  })
  const statusErrorRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!statusError || !statusErrorRef.current) return
    statusErrorRef.current.scrollIntoView({ block: 'center' })
    statusErrorRef.current.focus({ preventScroll: true })
  }, [statusError])
  const status = useMutation({
    mutationFn: (input: { action: 'START' | 'COMPLETE' | 'APPROVE' | 'RETURN_TO_WORK'; expectedVersion: number; note?: string }) =>
      api(`/tasks/${id}/transitions`, { method: 'POST', body: jsonBody(input) }),
    onSuccess: (_result, input) => {
      setStatusError('')
      void client.invalidateQueries({ queryKey: ['task', id] })
      if (query.data?.parentTaskId) {
        void client.invalidateQueries({ queryKey: ['task', query.data.parentTaskId] })
      }
      void client.invalidateQueries({ queryKey: ['tasks'] })
      notifySuccess(
        input.action === 'START' ? 'Завдання взято в роботу'
          : input.action === 'COMPLETE' ? 'Завдання завершено'
            : input.action === 'APPROVE' ? 'Завдання підтверджено'
              : 'Завдання повернуто в роботу',
      )
    },
    onError: (error) => {
      setStatusError(
        error instanceof ApiProblem && error.problem.code === 'task_completion_blocked'
          ? error.problem.detail ?? 'Спочатку завершіть активні підзадачі.'
          : 'Не вдалося змінити статус. Оновіть завдання та спробуйте ще раз.',
      )
    },
  })
  const uploadAttachment = useMutation({
    mutationFn: async (input: { file: File; selectForComment: boolean }) => {
      const body = new FormData()
      body.append('file', input.file)
      return api<TaskAttachmentView>(`/tasks/${id}/attachments${input.selectForComment ? '?draft=true' : ''}`, {
        method: 'POST',
        body,
      })
    },
    onSuccess: (attachment, input) => {
      if (input.selectForComment) {
        setCommentAttachments((current) => (
          current.some((item) => item.id === attachment.id)
            ? current
            : [...current, attachment].slice(0, 5)
        ))
        return
      }
      setContentMessage('Файл додано. Він відкриється після безпечної перевірки.')
      refreshTask(client, id)
      notifySuccess('Файл додано')
    },
    onError: () => setContentMessage('Не вдалося додати файл. Перевірте формат, розмір або ліміт.'),
  })
  const removeAttachment = useMutation({
    mutationFn: (fileId: string) =>
      api(`/tasks/${id}/attachments/${encodeURIComponent(fileId)}`, {
        method: 'DELETE',
      }),
    onSuccess: (_result, fileId) => {
      setContentMessage('Файл вилучено із завдання та коментарів.')
      setEditPhotos((current) => current.filter((photo) => photo.id !== fileId))
      setCommentAttachments((current) => current.filter((attachment) => attachment.id !== fileId))
      refreshTask(client, id)
      notifySuccess('Файл видалено', { undo: () => restoreAttachment(fileId) })
    },
    onError: () => setContentMessage('Не вдалося вилучити файл. Оновіть завдання й спробуйте ще раз.'),
  })
  // Restores also serve «Скасувати» on the success notices (decision 2026-11-18).
  const restoreAttachment = async (fileId: string) => {
    await api(`/tasks/${id}/attachments/${encodeURIComponent(fileId)}/restore`, { method: 'POST' })
    setContentMessage('')
    refreshTask(client, id)
  }
  const unarchive = async (expectedVersion: number) => {
    await api(`/tasks/${id}/restore`, { method: 'POST', body: jsonBody({ expectedVersion }) })
    refreshTask(client, id)
  }
  const archiveTask = useMutation({
    mutationFn: () => api<{ id: string; version: number }>(`/tasks/${id}/archive`, {
      method: 'POST', body: jsonBody({ expectedVersion: query.data?.version }),
    }),
    onSuccess: (result) => {
      refreshTask(client, id)
      notifySuccess('Завдання архівовано', { undo: () => unarchive(result.version) })
    },
  })
  const restoreTask = useMutation({
    mutationFn: (expectedVersion: number) => unarchive(expectedVersion),
    onSuccess: () => notifySuccess('Завдання відновлено'),
    onError: () => notifyError('Не вдалося відновити завдання. Оновіть його та спробуйте ще раз'),
  })
  const restoreHiddenAttachment = useMutation({
    mutationFn: (fileId: string) => restoreAttachment(fileId),
    onSuccess: () => notifySuccess('Файл відновлено'),
    onError: () => setContentMessage('Не вдалося відновити файл. Оновіть завдання й спробуйте ще раз.'),
  })
  const attachDriveFile = useMutation({
    mutationFn: (fileId: string) => api<TaskAttachmentView>(`/tasks/${id}/attachments/from-drive?draft=true`, {
      method: 'POST',
      body: jsonBody({ fileId }),
    }),
    onSuccess: (attachment) => {
      setCommentAttachments((current) => (
        current.some((item) => item.id === attachment.id) ? current : [...current, attachment].slice(0, 5)
      ))
    },
    onError: () => setContentMessage('Не вдалося додати файл із Диска.'),
  })
  const canAttachFiles = Boolean(query.data?.canAttachFiles)
    && !uploadAttachment.isPending
    && !attachDriveFile.isPending
  async function uploadFiles(files: File[], selectForComment: boolean) {
    for (const file of files) {
      await uploadAttachment.mutateAsync({ file, selectForComment }).catch(() => undefined)
    }
  }
  const canManageTask = Boolean(
    query.data
    && user
    && query.data.canEdit
    && (user.accountType === 'ADMIN' || user.id === query.data.reporter.id),
  )
  const toggleEdit = () => {
    if (!query.data) return
    const task = query.data
    setDelegateOpen(false)
    setEditCreatorId(task.creator.id)
    if (editOpen) clearDirty('edit')
    else setEditPhotos(placedPhotos(task.photoLayout, task.attachments).map(({ placement, file }) => (
      placementToPhoto(placement, file, apiUrl(`/files/${encodeURIComponent(file.id)}/download?inline=true`))
    )))
    setEditOpen((value) => !value)
  }
  return (
    <>
      <TaskDetailLayout
        title={query.data?.number ?? 'Завдання'}
      >
      {query.isLoading ? (
        <PageDataLoader />
      ) : query.isError || !query.data ? (
        <ErrorState onRetry={() => void query.refetch()} />
      ) : (
        <div className="detail-stack" ref={detailStackRef}>
          <div className="task-detail-main">
          <section className="task-detail-overview">
            <TaskDetailHeading
              id={id}
              task={query.data}
              editOpen={editOpen}
              canManageTask={canManageTask}
              statusPending={status.isPending}
              archivePending={archiveTask.isPending}
              restorePending={restoreTask.isPending}
              onStatus={(input) => status.mutate({
                action: input.action,
                expectedVersion: query.data.version,
                ...(input.note !== undefined ? { note: input.note } : {}),
              })}
              onArchive={() => archiveTask.mutate()}
              onRestore={() => restoreTask.mutate(query.data.version)}
              onToggleEdit={toggleEdit}
              onDelegate={() => setDelegateOpen(true)}
              onCreateSubtask={() => {
                setLinksOpen(true)
                setSubtaskFormOpen(true)
              }}
              onRequestClose={() => closeGuard.requestClose('close-button')}
              markDirty={markDirty}
            />
            {delegateOpen && (
              <TaskDelegateForm id={id} task={query.data} onClose={() => setDelegateOpen(false)} />
            )}
            {editOpen && (
              <TaskEditForm
                id={id}
                task={query.data}
                editPhotos={editPhotos}
                setEditPhotos={setEditPhotos}
                editCreatorId={editCreatorId}
                canAttachFiles={canAttachFiles}
                markDirty={markDirty}
                clearDirty={clearDirty}
                onClose={() => setEditOpen(false)}
              />
            )}
          </section>
          {statusError && (
            <div
              className="task-blocker"
              id="task-status-error"
              role="alert"
              tabIndex={-1}
              ref={statusErrorRef}
            >
              <AlertTriangle size={18} />
              <span>
                <strong>Завдання ще не готове до завершення</strong>
                <small>{statusError}</small>
                {status.error instanceof ApiProblem
                  && status.error.problem.blockingSubtaskIds?.length
                  ? (
                      <span className="task-blocker__links">
                        {status.error.problem.blockingSubtaskIds.map((blockingId) => {
                          const subtask = query.data?.subtasks.find((item) => item.id === blockingId)
                          return (
                            <Link key={blockingId} to={`/tasks/${blockingId}${location.search}`}>
                              {subtask?.title ?? blockingId}
                            </Link>
                          )
                        })}
                      </span>
                    )
                  : null}
              </span>
            </div>
          )}
          <TaskMaterials
            task={query.data}
            canAttachFiles={canAttachFiles}
            uploadPending={uploadAttachment.isPending}
            removePending={removeAttachment.isPending}
            uploadFiles={uploadFiles}
            onRemoveAttachment={(fileId) => removeAttachment.mutate(fileId)}
            restorePending={restoreHiddenAttachment.isPending}
            onRestoreAttachment={(fileId) => restoreHiddenAttachment.mutate(fileId)}
            contentMessage={contentMessage}
          />
          <TaskDiscussion
            id={id}
            task={query.data}
            activity={activity}
            canAttachFiles={canAttachFiles}
            attachmentBusy={uploadAttachment.isPending || attachDriveFile.isPending}
            commentAttachments={commentAttachments}
            setCommentAttachments={setCommentAttachments}
            uploadFiles={uploadFiles}
            attachFromDrive={(fileId) => attachDriveFile.mutateAsync(fileId)}
            setContentMessage={setContentMessage}
            onDraftDirtyChange={setDiscussionDirty}
          />
          </div>
          <aside className="task-detail-sidebar" aria-label="Керування завданням">
          <section className="task-detail-status-card" aria-labelledby={`task-status-${id}`}>
            <header>
              <span className="task-detail-card-icon"><CalendarDays size={18} /></span>
              <h3 id={`task-status-${id}`}>Статус і строки</h3>
              <div className="task-detail-status-card__accent">
                <StatusBadge status={query.data.status} />
              </div>
            </header>
            <dl>
              <div>
                <dt>Створено</dt>
                <dd>{formatDateTime(query.data.createdAt)}</dd>
              </div>
              <div>
                <dt>Строк</dt>
                <dd>{query.data.deadline ? formatDateTime(query.data.deadline) : 'Без строку'}</dd>
              </div>
              <div>
                <dt>Оновлено</dt>
                <dd>{formatDateTime(query.data.updatedAt)}</dd>
              </div>
              <div>
                <dt>Пріоритет</dt>
                <dd>{taskPriorityLabel(query.data.priority)}</dd>
              </div>
            </dl>
          </section>
          <TaskPlanning
            id={id}
            task={query.data}
            canManageTask={canManageTask}
            markDirty={markDirty}
            clearDirty={clearDirty}
          />
          <TaskChecklist
            id={id}
            task={query.data}
            canManageTask={canManageTask}
            onDraftDirtyChange={setChecklistDirty}
          />
          <TaskRelations
            id={id}
            task={query.data}
            canManageTask={canManageTask}
            linksOpen={linksOpen}
            setLinksOpen={setLinksOpen}
            subtaskFormOpen={subtaskFormOpen}
            setSubtaskFormOpen={setSubtaskFormOpen}
            markDirty={markDirty}
            clearDirty={clearDirty}
          />
          <TaskParticipants
            id={id}
            task={query.data}
            editOpen={editOpen}
            canManageTask={canManageTask}
            editCreatorId={editCreatorId}
            setEditCreatorId={setEditCreatorId}
            markDirty={markDirty}
            clearDirty={clearDirty}
          />
          </aside>
        </div>
        )}
      </TaskDetailLayout>
      <UnsavedChangesDialog
        guard={closeGuard}
        title="Повернутися до списку завдань?"
        description="Незбережені зміни в завданні буде втрачено."
      />
    </>
  )
}

const DESKTOP_DETAIL_QUERY = '(min-width: 861px)'
const DISCUSSION_MIN_HEIGHT = 360

/**
 * On desktop the collapsed discussion ends where the sidebar ends in its initial
 * state. The height follows the sidebar while its sections load, then is frozen
 * at the first interaction inside the sidebar, so adding participants or opening
 * sidebar sections extends only the sidebar, not the chat.
 */
function useDiscussionBaselineHeight(stackRef: RefObject<HTMLDivElement | null>, taskId: string, ready: boolean) {
  useEffect(() => {
    const stack = stackRef.current
    const sidebar = stack?.querySelector<HTMLElement>('.task-detail-sidebar')
    const main = stack?.querySelector<HTMLElement>('.task-detail-main')
    if (!stack || !sidebar || !main || typeof ResizeObserver === 'undefined') return
    let frozen = false
    let width = window.innerWidth
    const measure = () => {
      const discussion = main.querySelector<HTMLElement>('.task-discussion')
      if (!discussion || discussion.classList.contains('is-expanded')) return
      if (!window.matchMedia?.(DESKTOP_DETAIL_QUERY).matches) {
        stack.style.removeProperty('--task-discussion-height')
        return
      }
      const offset = discussion.getBoundingClientRect().top - main.getBoundingClientRect().top
      const height = Math.max(DISCUSSION_MIN_HEIGHT, Math.round(sidebar.getBoundingClientRect().height - offset))
      stack.style.setProperty('--task-discussion-height', `${height}px`)
    }
    const freeze = () => { frozen = true }
    const observer = new ResizeObserver(() => { if (!frozen) measure() })
    const onResize = () => {
      if (window.innerWidth === width) return
      width = window.innerWidth
      if (!frozen) measure()
    }
    observer.observe(sidebar)
    measure()
    sidebar.addEventListener('pointerdown', freeze)
    sidebar.addEventListener('focusin', freeze)
    window.addEventListener('resize', onResize)
    return () => {
      observer.disconnect()
      sidebar.removeEventListener('pointerdown', freeze)
      sidebar.removeEventListener('focusin', freeze)
      window.removeEventListener('resize', onResize)
      stack.style.removeProperty('--task-discussion-height')
    }
  }, [stackRef, taskId, ready])
}

function TaskDetailLayout({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <div className="task-detail-page">
      <PageHeader title={title} action={(
        <Link className="button button--primary" to="/tasks/new">
          <Plus size={17} />
          Створити завдання
        </Link>
      )} />
      <Card className="task-detail-surface">{children}</Card>
    </div>
  )
}
