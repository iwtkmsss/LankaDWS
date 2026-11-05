import { useQuery } from '@tanstack/react-query'
import type { TaskDetailView } from '@lankadws/contracts'
import { ArrowLeft } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { TaskCreateForm } from '../features/tasks/create/TaskCreateForm'
import { api } from '../shared/api/client'
import { Button, ErrorState, PageDataLoader, PageHeader } from '../shared/ui'

export default function TaskCreatePage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const initialResponsibleId = params.get('assigneeId') ?? ''
  const copyFrom = params.get('copyFrom') ?? ''
  const copySource = useQuery({
    queryKey: ['task-copy-source', copyFrom],
    queryFn: () => api<TaskDetailView>(`/tasks/${encodeURIComponent(copyFrom)}`),
    enabled: Boolean(copyFrom),
  })
  const close = () => {
    const listParams = new URLSearchParams(params)
    listParams.delete('copyFrom')
    const search = listParams.toString()
    navigate(`/tasks${search ? `?${search}` : ''}`)
  }

  return (
    <div className="task-create-page">
      <PageHeader
        title="Нове завдання"
        action={(
          <Button variant="secondary" onClick={close}>
            <ArrowLeft size={17} aria-hidden />
            Повернутися назад
          </Button>
        )}
      />
      {copyFrom && copySource.isError ? (
        <ErrorState title="Не вдалося завантажити завдання для копіювання" onRetry={() => void copySource.refetch()} />
      ) : copyFrom && !copySource.isSuccess ? (
        <PageDataLoader />
      ) : (
        <TaskCreateForm
          key={`${initialResponsibleId}:${copyFrom}`}
          initialResponsibleId={initialResponsibleId}
          copyFrom={copyFrom}
          copySource={copySource.data}
          onClose={close}
          onDone={(id) => navigate(`/tasks/${id}`, { replace: true })}
        />
      )}
    </div>
  )
}
