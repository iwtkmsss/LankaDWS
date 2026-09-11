import type { PrincipalView, TaskParticipantRoleV2 } from '@lankadws/contracts'
import { Eye, UserCheck, UserCog, UsersRound, X } from 'lucide-react'
import { useCallback, type ReactNode } from 'react'
import { Avatar } from '../../../shared/ui'
import { AsyncTaskCombobox } from '../AsyncTaskCombobox'
import type {
  TaskCreateDraft,
  TaskCreateOptions,
  TaskCreateParticipantDraft,
  TaskCreateUserOption,
  UpdateTaskCreateDraft,
} from './types'

const participantRoleLabels: Record<TaskParticipantRoleV2, string> = {
  RESPONSIBLE: 'Відповідальний',
  COLLABORATOR: 'Співвиконавець',
  WATCHER: 'Спостерігач',
}

function userLabel(
  userId: string,
  users: TaskCreateUserOption[],
  currentUser: PrincipalView | null,
): TaskCreateUserOption {
  const option = users.find((user) => user.id === userId)
  if (option) return option
  if (currentUser?.id === userId) return currentUser
  return { id: userId, displayName: 'Вибраний користувач', avatarAsset: null, jobTitle: '' }
}

function PersonCard({
  person,
  roleLabel,
  onRemove,
}: {
  person: TaskCreateUserOption
  roleLabel: string
  onRemove?: () => void
}) {
  return (
    <li className="task-create-role-person">
      <Avatar name={person.displayName} src={person.avatarAsset} size="sm" />
      <span>
        <strong>{person.displayName}</strong>
        <small>{person.jobTitle || roleLabel}</small>
      </span>
      {onRemove && (
        <button
          type="button"
          className="icon-button"
          aria-label={`Прибрати ${person.displayName} з ролі «${roleLabel}»`}
          onClick={onRemove}
        >
          <X size={15} aria-hidden />
        </button>
      )}
    </li>
  )
}

function ParticipantRoleCard({
  role,
  title,
  description,
  icon,
  required = false,
  draft,
  users,
  currentUser,
  update,
}: {
  role: TaskParticipantRoleV2
  title: string
  description: string
  icon: ReactNode
  required?: boolean
  draft: TaskCreateDraft
  users: TaskCreateUserOption[]
  currentUser: PrincipalView | null
  update: UpdateTaskCreateDraft
}) {
  const selected = draft.participants.filter((participant) => participant.role === role)
  const loadOptions = useCallback(async (search: string) => {
    const normalizedSearch = search.trim().toLocaleLowerCase('uk')
    return users
      .filter((person) => !selected.some((participant) => participant.userId === person.id))
      .filter((person) => `${person.displayName} ${person.jobTitle}`.toLocaleLowerCase('uk').includes(normalizedSearch))
      .map((person) => {
        const currentRole = draft.participants.find((participant) => participant.userId === person.id)?.role
        const detail = currentRole
          ? `${person.jobTitle || 'Учасник команди'} · Зараз: ${participantRoleLabels[currentRole]}`
          : person.jobTitle
        return { id: person.id, label: person.displayName, detail }
      })
  }, [draft.participants, selected, users])

  function assign(userId: string) {
    if (!userId) return
    update((current) => ({
      ...current,
      participants: [
        ...current.participants.filter((participant) => participant.userId !== userId),
        { userId, role },
      ],
    }))
  }

  function remove(participant: TaskCreateParticipantDraft) {
    update((current) => ({
      ...current,
      participants: current.participants.filter((item) => item.userId !== participant.userId),
    }))
  }

  return (
    <section className="task-create-role-card" aria-labelledby={`task-create-role-${role}`}>
      <header className="task-create-role-card__header">
        <span className="task-create-role-card__icon">{icon}</span>
        <span>
          <strong id={`task-create-role-${role}`}>{title}</strong>
          <small>{description}</small>
        </span>
        <span className="task-create-role-card__count">
          {required && <i>Обов’язково</i>}
          {selected.length}
        </span>
      </header>

      {selected.length > 0 ? (
        <ul className="task-create-role-card__people" aria-label={`${title}: вибрані люди`}>
          {selected.map((participant) => (
            <PersonCard
              key={participant.userId}
              person={userLabel(participant.userId, users, currentUser)}
              roleLabel={title}
              onRemove={() => remove(participant)}
            />
          ))}
        </ul>
      ) : (
        <p className="task-create-role-card__empty">Ще нікого не додано</p>
      )}

      <AsyncTaskCombobox
        label={`Додати: ${title.toLocaleLowerCase('uk')}`}
        value=""
        placeholder="Почніть вводити ім’я"
        clearOnSelect
        loadOptions={loadOptions}
        onChange={assign}
      />
    </section>
  )
}

function ReporterRoleCard({
  draft,
  users,
  currentUser,
  update,
}: {
  draft: TaskCreateDraft
  users: TaskCreateUserOption[]
  currentUser: PrincipalView | null
  update: UpdateTaskCreateDraft
}) {
  const reporter = draft.reporterId ? userLabel(draft.reporterId, users, currentUser) : null
  const loadOptions = useCallback(async (search: string) => {
    const normalizedSearch = search.trim().toLocaleLowerCase('uk')
    return users
      .filter((person) => person.id !== draft.reporterId)
      .filter((person) => `${person.displayName} ${person.jobTitle}`.toLocaleLowerCase('uk').includes(normalizedSearch))
      .map((person) => ({ id: person.id, label: person.displayName, detail: person.jobTitle }))
  }, [draft.reporterId, users])

  return (
    <section className="task-create-role-card" aria-labelledby="task-create-role-reporter">
      <header className="task-create-role-card__header">
        <span className="task-create-role-card__icon"><UserCog size={18} aria-hidden /></span>
        <span>
          <strong id="task-create-role-reporter">Постановник</strong>
          <small>Створює доручення та приймає результат</small>
        </span>
        <span className="task-create-role-card__count"><i>Обов’язково</i>{reporter ? 1 : 0}</span>
      </header>

      {reporter && (
        <ul className="task-create-role-card__people" aria-label="Постановник">
          <PersonCard person={reporter} roleLabel="Постановник" />
        </ul>
      )}

      <AsyncTaskCombobox
        label="Змінити постановника"
        value={draft.reporterId}
        selectedOption={reporter ? { id: reporter.id, label: reporter.displayName, detail: reporter.jobTitle } : null}
        placeholder="Почніть вводити ім’я"
        loadOptions={loadOptions}
        onChange={(reporterId) => {
          if (!reporterId) return
          update((current) => ({ ...current, reporterId }))
        }}
      />
    </section>
  )
}

export function TaskParticipantsSection({
  draft,
  options,
  currentUser,
  optionsLoading,
  optionsError,
  update,
  onRetryOptions,
}: {
  draft: TaskCreateDraft
  options?: TaskCreateOptions
  currentUser: PrincipalView | null
  optionsLoading: boolean
  optionsError: boolean
  update: UpdateTaskCreateDraft
  onRetryOptions: () => void
}) {
  if (optionsLoading && !options) {
    return <p className="task-create-local-state" role="status">Завантажуємо список людей…</p>
  }
  if (optionsError && !options) {
    return (
      <div className="task-create-local-error">
        <span>Не вдалося завантажити учасників. Введені значення збережено.</span>
        <button type="button" onClick={onRetryOptions}>Повторити</button>
      </div>
    )
  }
  if (!options) return null

  return (
    <div className="task-create-participants">
      <div className="task-create-role-grid">
        <ParticipantRoleCard
          role="RESPONSIBLE"
          title="Відповідальний"
          description="Веде завдання та відповідає за результат"
          icon={<UserCheck size={18} aria-hidden />}
          required
          draft={draft}
          users={options.users}
          currentUser={currentUser}
          update={update}
        />
        <ReporterRoleCard
          draft={draft}
          users={options.users}
          currentUser={currentUser}
          update={update}
        />
        <ParticipantRoleCard
          role="COLLABORATOR"
          title="Співвиконавець"
          description="Допомагає виконувати завдання"
          icon={<UsersRound size={18} aria-hidden />}
          draft={draft}
          users={options.users}
          currentUser={currentUser}
          update={update}
        />
        <ParticipantRoleCard
          role="WATCHER"
          title="Спостерігач"
          description="Стежить за перебігом без відповідальності"
          icon={<Eye size={18} aria-hidden />}
          draft={draft}
          users={options.users}
          currentUser={currentUser}
          update={update}
        />
      </div>
    </div>
  )
}
