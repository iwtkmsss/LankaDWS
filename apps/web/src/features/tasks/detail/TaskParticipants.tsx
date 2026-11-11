import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { TaskDetailView, TaskParticipantRole } from '@lankadws/contracts'
import { UserRoundCheck, UserRoundPen, Users, X } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { ApiProblem, api, jsonBody } from '../../../shared/api/client'
import { personName } from '../../../shared/lib/personName'
import { UserSearchCombobox } from '../../employees/UserSearchCombobox'
import { UserProfileLink } from '../../employees/UserProfileDrawer'
import { Avatar, ConfirmationDialog } from '../../../shared/ui'
import { refreshTask } from './useTaskDetail'

type TaskRolePerson = { id: string; displayName: string }
type TaskPersonAction =
  | { kind: 'assign'; person: TaskRolePerson }
  | { kind: 'add' | 'remove'; person: TaskRolePerson; role: TaskParticipantRole }

function taskPersonActionCopy(action: TaskPersonAction, assigneeName: string) {
  const name = personName(action.person.displayName)
  if (action.kind === 'assign') {
    return { title: 'Змінити відповідального?', description: `Відповідальним за завдання стане ${name} замість ${assigneeName}.`, confirmLabel: 'Змінити', confirmVariant: 'primary' as const }
  }
  const [accusative, instrumental] = action.role === 'CO_EXECUTOR' ? ['співвиконавця', 'співвиконавцем'] : ['спостерігача', 'спостерігачем']
  return action.kind === 'add'
    ? { title: `Додати ${accusative}?`, description: `${name} стане ${instrumental} цього завдання.`, confirmLabel: 'Додати', confirmVariant: 'primary' as const }
    : { title: `Вилучити ${accusative}?`, description: `${name} більше не буде ${instrumental} цього завдання.`, confirmLabel: 'Вилучити', confirmVariant: 'danger' as const }
}

export function TaskParticipants({
  id,
  task,
  editOpen,
  canManageTask,
  editCreatorId,
  setEditCreatorId,
  markDirty,
  clearDirty,
}: {
  id: string
  task: TaskDetailView
  editOpen: boolean
  canManageTask: boolean
  editCreatorId: string
  setEditCreatorId: (userId: string) => void
  markDirty: (form: string) => void
  clearDirty: (form: string) => void
}) {
  const client = useQueryClient()
  const [personAction, setPersonAction] = useState<TaskPersonAction | null>(null)
  const [participantMessage, setParticipantMessage] = useState('')
  const reassignResponsible = useMutation({
    mutationFn: (assigneeId: string) => {
      if (!task) throw new Error('task_reassign_context')
      return api<{ version: number }>(`/tasks/${id}`, {
        method: 'PATCH',
        body: jsonBody({
          title: task.title,
          description: task.description,
          assigneeId,
          deadline: task.deadline,
          priority: task.priority,
          blockReason: task.blockReason,
          expectedVersion: task.version,
        }),
      })
    },
    onSuccess: () => {
      setParticipantMessage('Відповідального змінено.')
      refreshTask(client, id)
    },
    onError: (error) => {
      setParticipantMessage(
        error instanceof ApiProblem && error.problem.status === 409
          ? 'Завдання вже змінилося. Оновіть його та повторіть зміну відповідального.'
          : 'Не вдалося змінити відповідального.',
      )
    },
  })
  const addParticipant = useMutation({
    mutationFn: (input: {
      userId: string
      role: TaskParticipantRole
      expectedVersion: number
    }) => api(`/tasks/${id}/participants/${encodeURIComponent(input.userId)}`, {
      method: 'PUT',
      body: jsonBody({
        role: input.role === 'CO_EXECUTOR' ? 'COLLABORATOR' : 'WATCHER',
        expectedVersion: input.expectedVersion,
      }),
    }),
    onSuccess: () => {
      setParticipantMessage('Учасника додано.')
      clearDirty('participant')
      void client.invalidateQueries({ queryKey: ['task', id] })
      void client.invalidateQueries({ queryKey: ['tasks'] })
    },
    onError: (error) => {
      setParticipantMessage(
        error instanceof ApiProblem && error.problem.status === 409
          ? 'Склад завдання вже змінився. Оновіть його та повторіть дію.'
          : 'Не вдалося додати учасника. Перевірте, чи людина активна в організації.',
      )
    },
  })
  const removeParticipant = useMutation({
    mutationFn: (input: {
      userId: string
      role: TaskParticipantRole
      expectedVersion: number
    }) => api(`/tasks/${id}/participants/${encodeURIComponent(input.userId)}`, {
      method: 'DELETE',
      body: jsonBody({ expectedVersion: input.expectedVersion }),
    }),
    onSuccess: () => {
      setParticipantMessage('Учасника вилучено.')
      void client.invalidateQueries({ queryKey: ['task', id] })
      void client.invalidateQueries({ queryKey: ['tasks'] })
    },
    onError: (error) => {
      setParticipantMessage(
        error instanceof ApiProblem && error.problem.status === 409
          ? 'Склад завдання вже змінився. Оновіть його та повторіть дію.'
          : 'Не вдалося вилучити учасника.',
      )
    },
  })
  return (
    <>
  <div className="task-detail-roles" data-task-section="participants">
    <TaskSingleRoleCard
      label="Постановник"
      person={task.reporter}
    >
      {editOpen && task.canTransferCreator && (
        <div className="task-role-card__add">
          <UserSearchCombobox
            label="Змінити постановника"
            value={editCreatorId}
            defaultUser={task.creator}
            onChange={(userId) => { setEditCreatorId(userId); markDirty('edit') }}
          />
        </div>
      )}
    </TaskSingleRoleCard>
    <TaskSingleRoleCard
      label="Відповідальний"
      person={task.assignee}
      canChange={editOpen && task.canReassign && task.status !== 'IN_REVIEW'}
      onChange={(person) => setPersonAction({ kind: 'assign', person })}
    />
    <TaskParticipantGroup
      label="Співвиконавці"
      emptyLabel="Співвиконавців ще немає"
      participants={task.coExecutors}
      role="CO_EXECUTOR"
      canEdit={editOpen && canManageTask && task.canManageParticipants}
      excludedUserIds={[
        task.assignee.id,
        task.reporter.id,
        ...task.coExecutors.map((participant) => participant.user.id),
      ]}
      addPending={addParticipant.isPending}
      removePending={removeParticipant.isPending}
      onAdd={(person) => setPersonAction({ kind: 'add', person, role: 'CO_EXECUTOR' })}
      onRemove={(person) => setPersonAction({ kind: 'remove', person, role: 'CO_EXECUTOR' })}
    />
    <TaskParticipantGroup
      label="Спостерігачі"
      emptyLabel="Спостерігачів ще немає"
      participants={task.observers}
      role="OBSERVER"
      canEdit={editOpen && canManageTask && task.canManageParticipants}
      excludedUserIds={[
        task.assignee.id,
        task.reporter.id,
        ...task.observers.map((participant) => participant.user.id),
      ]}
      addPending={addParticipant.isPending}
      removePending={removeParticipant.isPending}
      onAdd={(person) => setPersonAction({ kind: 'add', person, role: 'OBSERVER' })}
      onRemove={(person) => setPersonAction({ kind: 'remove', person, role: 'OBSERVER' })}
    />
    {participantMessage && (
      <p className="task-participant-message" aria-live="polite">{participantMessage}</p>
    )}
  </div>
  {personAction && <ConfirmationDialog
    {...taskPersonActionCopy(personAction, personName(task.assignee.displayName))}
    onRequestClose={() => setPersonAction(null)}
    onConfirm={() => {
      setPersonAction(null)
      if (personAction.kind === 'assign') {
        reassignResponsible.mutate(personAction.person.id)
        return
      }
      const participant = personAction.kind === 'add' ? addParticipant : removeParticipant
      participant.mutate({ userId: personAction.person.id, role: personAction.role, expectedVersion: task.version })
    }}
  />}
    </>
  )
}

function TaskSingleRoleCard({
  label,
  person,
  canChange = false,
  onChange,
  children,
}: {
  label: 'Постановник' | 'Відповідальний'
  person: TaskDetailView['reporter']
  canChange?: boolean
  onChange?: (person: TaskRolePerson) => void
  children?: ReactNode
}) {
  const headingId = label === 'Постановник' ? 'task-reporter' : 'task-responsible'
  return (
    <section className="task-role-card task-role-card--single" aria-labelledby={headingId}>
      <header>
        <span className="task-role-card__icon">{label === 'Постановник' ? <UserRoundPen size={18} aria-hidden /> : <UserRoundCheck size={18} aria-hidden />}</span>
        <h3 id={headingId}>{label}</h3>
      </header>
      <UserProfileLink className="task-role-card__person" userId={person.id}>
        <Avatar size="sm" name={personName(person.displayName)} src={person.avatarAsset} />
        <strong>{personName(person.displayName)}</strong>
      </UserProfileLink>
      {canChange && onChange && (
        <div className="task-role-card__add">
          <UserSearchCombobox
            label="Змінити відповідального"
            value=""
            clearOnSelect
            placeholder="Почніть вводити ім’я"
            excludeIds={[person.id]}
            onSelect={onChange}
          />
        </div>
      )}
      {children}
    </section>
  )
}

function TaskParticipantGroup({
  label,
  emptyLabel,
  participants,
  role,
  canEdit,
  excludedUserIds,
  addPending,
  removePending,
  onAdd,
  onRemove,
}: {
  label: string
  emptyLabel: string
  participants: TaskDetailView['coExecutors']
  role: TaskParticipantRole
  canEdit: boolean
  excludedUserIds: string[]
  addPending: boolean
  removePending: boolean
  onAdd: (person: TaskRolePerson) => void
  onRemove: (person: TaskRolePerson) => void
}) {
  const headingId = `task-role-${role.toLowerCase()}`
  return (
    <section className="task-role-card task-role-group" aria-labelledby={headingId}>
      <header>
        <span className="task-role-card__icon"><Users size={18} /></span>
        <h3 id={headingId}>{label}</h3>
        <small className="task-detail-count">{participants.length}</small>
      </header>
      {participants.length ? (
        <div className="task-role-people">
          {participants.map((participant) => (
            <div className="task-person-chip" key={participant.id}>
              <UserProfileLink className="task-person-chip__profile" userId={participant.user.id}>
                <Avatar
                  size="sm"
                  name={personName(participant.user.displayName)}
                  src={participant.user.avatarAsset}
                />
                <strong>{personName(participant.user.displayName)}</strong>
              </UserProfileLink>
              {canEdit && (
                <button
                  type="button"
                  className="task-participant-remove"
                  aria-label={`Вилучити ${personName(participant.user.displayName)} з ролі «${label}»`}
                  disabled={removePending}
                  onClick={() => onRemove(participant.user)}
                >
                  <X size={15} />
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="task-role-card__empty">{emptyLabel}</p>
      )}
      {canEdit && (
        <div className="task-role-card__add">
          <UserSearchCombobox
            label={role === 'CO_EXECUTOR' ? 'Додати співвиконавця' : 'Додати спостерігача'}
            value=""
            clearOnSelect
            disabled={addPending}
            placeholder="Почніть вводити ім’я"
            excludeIds={excludedUserIds}
            onSelect={(person) => { if (!addPending) onAdd(person) }}
          />
        </div>
      )}
    </section>
  )
}
