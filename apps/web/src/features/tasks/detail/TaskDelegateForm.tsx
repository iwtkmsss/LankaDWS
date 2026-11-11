import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { TaskDetailView } from '@lankadws/contracts'
import { useState } from 'react'
import { api, jsonBody } from '../../../shared/api/client'
import { UserSearchCombobox } from '../../employees/UserSearchCombobox'
import { Button } from '../../../shared/ui'

export function TaskDelegateForm({
  id,
  task,
  onClose,
}: {
  id: string
  task: TaskDetailView
  onClose: () => void
}) {
  const client = useQueryClient()
  const [delegateId, setDelegateId] = useState('')
  const [delegateError, setDelegateError] = useState('')
  const closeDelegate = () => {
    setDelegateId('')
    setDelegateError('')
    onClose()
  }
  const delegateTask = useMutation({
    mutationFn: () => api(`/tasks/${id}/delegate`, { method: 'POST', body: jsonBody({ userId: delegateId, expectedVersion: task.version }) }),
    onSuccess: () => {
      closeDelegate()
      void client.invalidateQueries({ queryKey: ['task', id] })
      void client.invalidateQueries({ queryKey: ['task-activity', id] })
      void client.invalidateQueries({ queryKey: ['tasks'] })
    },
    onError: () => setDelegateError('Не вдалося делегувати завдання. Оновіть сторінку та перевірте доступ.'),
  })
  return (
    <form className="task-delegate-form" onSubmit={(event) => { event.preventDefault(); delegateTask.mutate() }}>
      <div className="task-delegate-form__row">
        <UserSearchCombobox label="Новий відповідальний" value={delegateId} onChange={setDelegateId} excludeIds={[task.assignee.id]} />
        <div className="form-actions"><Button type="button" variant="ghost" onClick={closeDelegate}>Скасувати</Button><Button disabled={!delegateId || delegateTask.isPending}>Делегувати</Button></div>
      </div>
      {delegateError && <div className="form-error" role="alert">{delegateError}</div>}
    </form>
  )
}
