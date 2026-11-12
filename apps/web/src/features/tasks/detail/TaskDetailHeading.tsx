import type { TaskDetailView } from '@lankadws/contracts'
import { ArrowLeft, Archive, CheckCircle2, CirclePlus, Copy, MoreHorizontal, Pencil, Play, RotateCcw, X } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../../shared/auth/AuthProvider'
import { FormattedText } from '../../../shared/text/FormattedText'
import { InlinePhotoCanvas, placedPhotos } from '../../../shared/inline-photos/InlinePhotoCanvas'
import { Button, ConfirmationDialog, useDetailsMenu } from '../../../shared/ui'
import { TaskInlinePhoto } from './taskFiles'

type StatusActionInput = { action: 'START' | 'COMPLETE' | 'APPROVE' | 'RETURN_TO_WORK'; note?: string }

export function TaskDetailHeading({
  id,
  task,
  editOpen,
  canManageTask,
  statusPending,
  archivePending,
  onStatus,
  onArchive,
  onToggleEdit,
  onDelegate,
  onCreateSubtask,
  onRequestClose,
  markDirty,
}: {
  id: string
  task: TaskDetailView
  editOpen: boolean
  canManageTask: boolean
  statusPending: boolean
  archivePending: boolean
  onStatus: (input: StatusActionInput) => void
  onArchive: () => void
  onToggleEdit: () => void
  onDelegate: () => void
  onCreateSubtask: () => void
  onRequestClose: () => void
  markDirty: (form: string) => void
}) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { detailsProps, close: closeActions } = useDetailsMenu()
  const [confirmArchive, setConfirmArchive] = useState(false)
  return (
    <div className="task-detail-heading">
      <div className="task-detail-heading__bar">
      <span className="task-detail-number">Завдання {task.number}</span>
      <div className="task-detail-heading-actions">
        {!editOpen && task.availableStatusActions.length > 0 && (
          <div className="task-detail-status-actions">
            {task.availableStatusActions.includes('START') && <Button type="button" disabled={statusPending} onClick={() => onStatus({ action: 'START' })}><Play size={16} />Почати роботу</Button>}
            {task.availableStatusActions.includes('COMPLETE') && <Button type="button" disabled={statusPending} onClick={() => onStatus({ action: 'COMPLETE' })}><CheckCircle2 size={16} />Завершити</Button>}
            {task.availableStatusActions.includes('APPROVE') && <Button type="button" disabled={statusPending} onClick={() => onStatus({ action: 'APPROVE' })}><CheckCircle2 size={16} />Прийняти</Button>}
            {task.status !== 'DONE' && task.availableStatusActions.includes('RETURN_TO_WORK') && <Button type="button" variant="secondary" disabled={statusPending} onClick={() => {
              const note = window.prompt('Коментар для відповідального (необов’язково):')
              if (note !== null) onStatus({ action: 'RETURN_TO_WORK', note })
            }}><RotateCcw size={16} />Повернути в роботу</Button>}
          </div>
        )}
        <details className="task-detail-actions-menu" {...detailsProps}>
          <summary aria-label="Дії із завданням">
            <MoreHorizontal size={20} />
          </summary>
          <div role="menu">
          <button type="button" role="menuitem" onClick={() => navigate(`/tasks/new?copyFrom=${encodeURIComponent(id)}`)}><Copy size={16} />Копіювати задачу</button>
          {task.status === 'DONE' && task.availableStatusActions.includes('RETURN_TO_WORK') && <button type="button" role="menuitem" disabled={statusPending} onClick={() => { closeActions(); onStatus({ action: 'RETURN_TO_WORK' }) }}><RotateCcw size={16} />Відновити завдання</button>}
          {!editOpen && (task.canReassign || task.assignee.id === user?.id) && <button type="button" role="menuitem" onClick={() => { closeActions(); onDelegate() }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 13h7m-3-3 3 3-3 3" /><circle cx="16" cy="6" r="3" /><path d="M11 21v-2a5 5 0 0 1 10 0v2" /></svg>Делегувати</button>}
          {canManageTask && task.status !== 'IN_REVIEW' && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                closeActions()
                onToggleEdit()
              }}
            >
              {editOpen ? <X size={16} /> : <Pencil size={16} />}
              {editOpen ? 'Закрити редагування' : 'Редагувати'}
            </button>
          )}
          {canManageTask && task.canCreateSubtask && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                closeActions()
                onCreateSubtask()
              }}
            >
              <CirclePlus size={16} />
              Створити підзавдання
            </button>
          )}
          {canManageTask && task.status !== 'ARCHIVED' && (
            <button type="button" role="menuitem" disabled={archivePending} onClick={() => {
              closeActions()
              setConfirmArchive(true)
            }}><Archive size={16} />Архівувати</button>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              closeActions()
              onRequestClose()
            }}
          >
            <ArrowLeft size={16} />
            До списку
          </button>
          </div>
        </details>
      </div>
      </div>
      <div className="task-detail-heading__body">
        <h2 className={editOpen ? 'sr-only' : undefined}>{task.title}</h2>
        {editOpen ? <label className="task-detail-title-field">
          <span className="sr-only">Назва</span>
          <textarea
            form="task-edit-form"
            name="title"
            rows={1}
            defaultValue={task.title}
            maxLength={180}
            required
            onChange={(event) => {
              const singleLine = event.currentTarget.value.replace(/\r?\n/g, ' ')
              if (singleLine !== event.currentTarget.value) event.currentTarget.value = singleLine
              markDirty('edit')
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              event.currentTarget.form?.requestSubmit()
            }}
          />
        </label> : <InlinePhotoCanvas photos={placedPhotos(task.photoLayout, task.attachments)} renderPhoto={(file) => <TaskInlinePhoto attachment={file} />}>
          <FormattedText body={task.description || (task.photoLayout?.length ? '' : 'Опис не додано.')} />
        </InlinePhotoCanvas>}
      </div>
      {confirmArchive && <ConfirmationDialog
        title="Архівувати це завдання?"
        confirmLabel="Архівувати"
        confirmDisabled={archivePending}
        onConfirm={() => { setConfirmArchive(false); onArchive() }}
        onRequestClose={() => setConfirmArchive(false)}
      />}
    </div>
  )
}
