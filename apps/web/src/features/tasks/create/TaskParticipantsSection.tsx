import { personName } from '../../../shared/lib/personName'
import type { PrincipalView, TaskParticipantRoleV2 } from '@lankadws/contracts'
import { Eye, UserCheck, UserCog, UsersRound, X } from 'lucide-react'
import { type ReactNode } from 'react'
import { Avatar } from '../../../shared/ui'
import { UserSearchCombobox } from '../../employees/UserSearchCombobox'
import type {
  TaskCreateDraft,
  TaskCreateOptions,
  TaskCreateParticipantDraft,
  TaskCreateUserOption,
  UpdateTaskCreateDraft,
} from './types'

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
      <Avatar name={personName(person.displayName)} src={person.avatarAsset} size="sm" />
      <span>
        <strong>{personName(person.displayName)}</strong>
        <small>{person.jobTitle || roleLabel}</small>
      </span>
      {onRemove && (
        <button
          type="button"
          className="icon-button"
          aria-label={`Прибрати ${personName(person.displayName)} з ролі «${roleLabel}»`}
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
  single = false,
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
  single?: boolean
  draft: TaskCreateDraft
  users: TaskCreateUserOption[]
  currentUser: PrincipalView | null
  update: UpdateTaskCreateDraft
}) {
  const selected = draft.participants.filter((participant) => participant.role === role)

  function assign(userId: string) {
    if (!userId) return
    update((current) => ({
      ...current,
      participants: [
        ...current.participants.filter((participant) => (
          participant.userId !== userId && (!single || participant.role !== role)
        )),
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
              onRemove={required && single ? undefined : () => remove(participant)}
            />
          ))}
        </ul>
      ) : (
        <p className="task-create-role-card__empty">Ще нікого не додано</p>
      )}

      <UserSearchCombobox
        label={`${single ? 'Змінити' : 'Додати'}: ${title.toLocaleLowerCase('uk')}`}
        value=""
        placeholder="Почніть вводити ім’я"
        clearOnSelect
        includeAdmins
        excludeIds={selected.map((participant) => participant.userId)}
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

      {currentUser?.accountType === 'ADMIN' && (
        <UserSearchCombobox
          label="Змінити постановника"
          value={draft.reporterId}
          placeholder="Почніть вводити ім’я"
          includeAdmins
          defaultUser={reporter}
          excludeIds={draft.reporterId ? [draft.reporterId] : []}
          onChange={(reporterId) => {
            if (!reporterId) return
            update((current) => ({ ...current, reporterId }))
          }}
        />
      )}
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
        <ReporterRoleCard
          draft={draft}
          users={options.users}
          currentUser={currentUser}
          update={update}
        />
        <ParticipantRoleCard
          role="RESPONSIBLE"
          title="Відповідальний"
          description="Веде завдання та відповідає за результат"
          icon={<UserCheck size={18} aria-hidden />}
          required
          single
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
