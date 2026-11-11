import { useMutation, useQueryClient } from '@tanstack/react-query'
import { FEED_PHOTO_MIME_TYPES } from '@lankadws/contracts'
import type { TaskAttachmentView, TaskDetailView } from '@lankadws/contracts'
import { CalendarDays, Flag } from 'lucide-react'
import { useState, type Dispatch, type SetStateAction } from 'react'
import { ApiProblem, api, jsonBody } from '../../../shared/api/client'
import { DateTimePicker } from '../../../shared/ui/DateTimePicker'
import { FormattedTextarea } from '../../../shared/text/FormattedTextarea'
import { InlinePhotoButton, useObjectUrls } from '../../../shared/inline-photos/InlinePhotoButton'
import { InlinePhotoEditor } from '../../../shared/inline-photos/InlinePhotoEditor'
import { imageRatio, initialPlacement, toPhotoLayout, type InlinePhoto } from '../../../shared/inline-photos/inlinePhotos'
import { Button } from '../../../shared/ui'
import { toLocalDateTimeInput } from '../../../shared/lib/format'
import { refreshTask } from './useTaskDetail'

export function TaskEditForm({
  id,
  task,
  editPhotos,
  setEditPhotos,
  editCreatorId,
  canAttachFiles,
  markDirty,
  clearDirty,
  onClose,
}: {
  id: string
  task: TaskDetailView
  editPhotos: InlinePhoto[]
  setEditPhotos: Dispatch<SetStateAction<InlinePhoto[]>>
  editCreatorId: string
  canAttachFiles: boolean
  markDirty: (form: string) => void
  clearDirty: (form: string) => void
  onClose: () => void
}) {
  const client = useQueryClient()
  const objectUrl = useObjectUrls()
  const [editMessage, setEditMessage] = useState('')
  const updateTask = useMutation({
    mutationFn: (input: {
      title: string
      description: string
      photoLayout: ReturnType<typeof toPhotoLayout>
      assigneeId: string
      creatorId?: string
      deadline: string | null
      priority: string
      blockReason: string | null
      requiresAcceptance: boolean
      expectedVersion: number
    }) => api<{ version: number }>(`/tasks/${id}`, {
      method: 'PATCH',
      body: jsonBody(input),
    }),
    onSuccess: () => {
      setEditMessage('')
      clearDirty('edit')
      onClose()
      refreshTask(client, id)
    },
    onError: (error) => {
      setEditMessage(
        error instanceof ApiProblem && error.problem.status === 409
          ? 'Завдання вже змінилося. Оновіть його та повторіть редагування.'
          : 'Не вдалося зберегти зміни. Перевірте поля й доступ відповідального.',
      )
    },
  })
  const stageEditPhoto = useMutation({
    mutationFn: async (file: File) => {
      const body = new FormData()
      body.append('file', file)
      return api<TaskAttachmentView>(`/tasks/${id}/attachments?draft=true`, { method: 'POST', body })
    },
    onError: () => setEditMessage('Не вдалося додати фото. Перевірте формат, розмір або ліміт.'),
  })
  // Photos stay staged until the edit is saved: no attachment, no notification before that.
  async function placeEditPhotos(files: File[]) {
    for (const file of files.filter((item) => FEED_PHOTO_MIME_TYPES.some((mime) => mime === item.type))) {
      const attachment = await stageEditPhoto.mutateAsync(file).catch(() => null)
      if (!attachment) continue
      const src = objectUrl(file)
      const ratio = await imageRatio(src)
      setEditPhotos((current) => [...current, { id: attachment.id, name: attachment.fileName, src, ratio, ...initialPlacement(current.length) }])
      markDirty('edit')
    }
  }
  return (
    <form
      id="task-edit-form"
      className="task-edit-form task-edit-form--inline"
      onChange={() => markDirty('edit')}
      onSubmit={(event) => {
        event.preventDefault()
        const form = new FormData(event.currentTarget)
        const deadline = String(form.get('deadline') ?? '')
        const creatorId = String(form.get('creatorId') ?? '')
        updateTask.mutate({
          title: String(form.get('title') ?? ''),
          description: String(form.get('description') ?? ''),
          photoLayout: toPhotoLayout(editPhotos),
          assigneeId: String(form.get('assigneeId') ?? task.assignee.id),
          creatorId: creatorId || undefined,
          deadline: deadline ? new Date(deadline).toISOString() : null,
          priority: String(form.get('priority') ?? task.priority),
          blockReason: String(form.get('blockReason') ?? '') || null,
          requiresAcceptance: form.get('requiresAcceptance') === 'on',
          expectedVersion: task.version,
        })
      }}
    >
      <div className="span-2"><InlinePhotoEditor photos={editPhotos} disabled={updateTask.isPending}
        onRemove={(photoId) => { setEditPhotos((current) => current.filter((photo) => photo.id !== photoId)); markDirty('edit') }}
        onUpdate={(photoId, placement) => { setEditPhotos((current) => current.map((photo) => photo.id === photoId ? { ...photo, ...placement } : photo)); markDirty('edit') }}
      ><FormattedTextarea label="Опис"
          candidateUrl={`/tasks/${id}/mention-candidates`}
          toolbarActions={<InlinePhotoButton disabled={!canAttachFiles || stageEditPhoto.isPending || updateTask.isPending} onFiles={(files) => void placeEditPhotos(files)} />}
          onPasteImages={(files) => { if (canAttachFiles && !stageEditPhoto.isPending && !updateTask.isPending) void placeEditPhotos(files) }}
          name="description"
          defaultValue={task.description}
          rows={3}
          maxLength={20000}
          placeholder="Опис завдання"
        /></InlinePhotoEditor>
      </div>
      <input type="hidden" name="assigneeId" value={task.assignee.id} />
      {task.canTransferCreator && <input type="hidden" name="creatorId" value={editCreatorId} />}
      {editMessage && (
        <div className="form-error span-2" role="alert">{editMessage}</div>
      )}
      <div className="task-edit-form__footer span-2">
      <div className="task-edit-form__workflow">
        <label>
          <span className="task-edit-field-label"><Flag size={14} aria-hidden="true" />Пріоритет</span>
          <select name="priority" defaultValue={task.priority}>
            <option value="LOW">Низький</option>
            <option value="MEDIUM">Середній</option>
            <option value="HIGH">Високий</option>
            <option value="CRITICAL">Терміновий</option>
          </select>
        </label>
        <label>
          <span className="task-edit-field-label"><CalendarDays size={14} aria-hidden="true" />Строк</span>
          <DateTimePicker
            name="deadline"
            type="datetime-local"
            defaultValue={toLocalDateTimeInput(task.deadline)}
          />
        </label>
        <label
          className="task-create-acceptance"
          title="Після завершення відповідальним задача перейде постановнику на перевірку."
        >
          <span><strong>Прийняти після завершення</strong></span>
          <input name="requiresAcceptance" type="checkbox" defaultChecked={task.requiresAcceptance} />
        </label>
      </div>
      <div className="form-actions">
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            clearDirty('edit')
            onClose()
          }}
        >
          Скасувати
        </Button>
        <Button disabled={updateTask.isPending || stageEditPhoto.isPending}>
          Зберегти зміни
        </Button>
      </div>
      </div>
    </form>
  )
}
