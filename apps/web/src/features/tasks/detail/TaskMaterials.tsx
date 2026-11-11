import type { TaskDetailView } from '@lankadws/contracts'
import { ChevronDown, ChevronRight, Link2, Paperclip, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { formatDateTime } from '../../../shared/lib/format'
import { FileDropOverlay, useFileDropTarget } from '../../../shared/files/FileDropzone'
import { TaskAttachment, TaskFilesArchive } from './taskFiles'

export function TaskMaterials({
  task,
  canAttachFiles,
  uploadPending,
  removePending,
  uploadFiles,
  onRemoveAttachment,
  contentMessage,
}: {
  task: TaskDetailView
  canAttachFiles: boolean
  uploadPending: boolean
  removePending: boolean
  uploadFiles: (files: File[], selectForComment: boolean) => Promise<void>
  onRemoveAttachment: (fileId: string) => void
  contentMessage: string
}) {
  const materialsDrop = useFileDropTarget({
    disabled: !canAttachFiles,
    onFiles: (files) => void uploadFiles(files, false),
  })
  return (
    <details
      className="task-detail-materials is-file-drop-target"
      data-task-section="materials"
      {...materialsDrop.dropTargetProps}
    >
        <FileDropOverlay active={materialsDrop.isDragging} label="Відпустіть файли, щоб додати до завдання" />
        <summary aria-label="Матеріали">
          <span className="task-detail-card-icon"><Paperclip size={18} /></span>
          <span>
            <strong>Матеріали</strong>
            <small>Файли й пов’язані джерела</small>
          </span>
          <small className="task-detail-count">
            {task.attachments.length + task.sourceLinks.length || 'Немає'}
          </small>
          <ChevronDown size={18} />
        </summary>
        <div className="task-materials__body">
          {task.sourceLinks.length > 0 && (
            <div className="task-source-links">
              <span>Джерело</span>
              {task.sourceLinks.map((source) => (
                <Link key={source.id} to={source.href}>
                  <Link2 size={16} />
                  <span>
                    <strong>{source.label}</strong>
                    <small>{formatDateTime(source.createdAt)}</small>
                  </span>
                  <ChevronRight size={15} />
                </Link>
              ))}
            </div>
          )}
          {task.attachments.length > 0 && (
            <div className="task-attachment-list" aria-label="Файли завдання">
              <span>Файли</span>
              {task.attachments.map((attachment) => (
                <div className="task-attachment-row" key={attachment.id}>
                  <TaskAttachment attachment={attachment} actions />
                  {attachment.canRemove && (
                    <button
                      type="button"
                      aria-label={`Вилучити ${attachment.fileName}`}
                      title="Вилучити"
                      className="task-attachment-action task-attachment-action--remove"
                      disabled={removePending}
                      onClick={() => onRemoveAttachment(attachment.id)}
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              ))}
              <TaskFilesArchive attachments={task.attachments} />
            </div>
          )}
          {task.canAttachFiles && (
            <label className="task-file-picker">
              <Paperclip size={16} />
              <span>
                <strong>{uploadPending ? 'Додаємо…' : 'Додати файл'}</strong>
                <small>Перетягніть файли сюди · до 20 файлів у завданні</small>
              </span>
              <input
                type="file"
                multiple
                aria-label="Додати файл"
                disabled={uploadPending}
                onChange={(event) => {
                  void uploadFiles([...event.target.files ?? []], false)
                  event.currentTarget.value = ''
                }}
              />
            </label>
          )}
          {contentMessage && (
            <p className="task-content-message" aria-live="polite">{contentMessage}</p>
          )}
        </div>
    </details>
  )
}
