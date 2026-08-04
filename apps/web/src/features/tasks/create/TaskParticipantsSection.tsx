import type { PrincipalView, TaskParticipantRoleV2 } from '@bert-crm/contracts'
import { Plus, Trash2, UserRoundPlus, UsersRound } from 'lucide-react'
import { Avatar, Button } from '../../../shared/ui'
import type {
  TaskCreateDraft,
  TaskCreateOptions,
  TaskCreateUserOption,
  UpdateTaskCreateDraft,
} from './types'

type AdditionalParticipantRole = Exclude<TaskParticipantRoleV2, 'RESPONSIBLE'>

const additionalRoleLabels: Record<AdditionalParticipantRole, string> = {
  COLLABORATOR: 'Співвиконавець',
  WATCHER: 'Спостерігач',
}

function userLabel(
  userId: string,
  users: TaskCreateUserOption[],
  currentUser: PrincipalView | null,
): { displayName: string; avatarAsset: string | null; jobTitle: string } {
  const option = users.find((user) => user.id === userId)
  if (option) return option
  if (currentUser?.id === userId) return currentUser
  return { displayName: 'Вибраний користувач', avatarAsset: null, jobTitle: '' }
}

export function TaskResponsibleField({
  draft,
  options,
  currentUser,
  optionsLoading,
  optionsError,
  update,
  onOpenParticipants,
  onRetryOptions,
}: {
  draft: TaskCreateDraft
  options?: TaskCreateOptions
  currentUser: PrincipalView | null
  optionsLoading: boolean
  optionsError: boolean
  update: UpdateTaskCreateDraft
  onOpenParticipants: () => void
  onRetryOptions: () => void
}) {
  const users = options?.users ?? []
  const responsible = draft.participants.filter((participant) => participant.role === 'RESPONSIBLE')
  const additionalCount = draft.participants.length - responsible.length

  return (
    <section className="task-create-responsible" aria-labelledby="task-create-responsible-title">
      <header className="task-create-core__header task-create-core__header--compact">
        <div>
          <span className="task-create-kicker">Виконання</span>
          <h3 id="task-create-responsible-title">Відповідальні</h3>
        </div>
        <Button type="button" variant="ghost" onClick={onOpenParticipants}>
          <UsersRound size={16} />
          {additionalCount > 0 ? `Інші учасники · ${additionalCount}` : 'Додати інших учасників'}
        </Button>
      </header>
      <div className="task-create-responsible__list" aria-label="Відповідальні за завдання">
        {responsible.length === 0 ? (
          <p className="task-create-help">Додайте принаймні одного відповідального.</p>
        ) : responsible.map((participant) => {
          const person = userLabel(participant.userId, users, currentUser)
          return (
            <span className="task-create-responsible__person" key={participant.userId}>
              <Avatar name={person.displayName} src={person.avatarAsset} size="sm" />
              <span>
                <strong>{person.displayName}</strong>
                <small>{person.jobTitle || 'Відповідальний'}</small>
              </span>
              <button
                type="button"
                className="icon-button"
                aria-label={`Прибрати відповідального ${person.displayName}`}
                onClick={() => update((current) => ({
                  ...current,
                  participants: current.participants.filter(
                    (item) => item.userId !== participant.userId,
                  ),
                }))}
              >
                <Trash2 size={15} />
              </button>
            </span>
          )
        })}
      </div>
      {optionsLoading && !options && (
        <p className="task-create-local-state" role="status">Завантажуємо список людей…</p>
      )}
      {optionsError && !options && (
        <div className="task-create-local-error">
          <span>Список людей недоступний. Поточних відповідальних збережено.</span>
          <button type="button" onClick={onRetryOptions}>Повторити</button>
        </div>
      )}
      {options && (
        <label className="task-create-responsible__add">
          Додати відповідального
          <span>
            <select
              value=""
              onChange={(event) => {
                const userId = event.target.value
                if (!userId) return
                update((current) => {
                  const existing = current.participants.some((item) => item.userId === userId)
                  return {
                    ...current,
                    participants: existing
                      ? current.participants.map((item) => (
                        item.userId === userId ? { ...item, role: 'RESPONSIBLE' } : item
                      ))
                      : [...current.participants, { userId, role: 'RESPONSIBLE' }],
                  }
                })
              }}
            >
              <option value="">Оберіть людину</option>
              {users
                .filter((person) => !responsible.some((item) => item.userId === person.id))
                .map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.displayName}{person.jobTitle ? ` · ${person.jobTitle}` : ''}
                  </option>
                ))}
            </select>
            <Plus size={17} aria-hidden />
          </span>
        </label>
      )}
    </section>
  )
}

export function TaskParticipantsSection({
  draft,
  options,
  optionsLoading,
  optionsError,
  update,
  onRetryOptions,
}: {
  draft: TaskCreateDraft
  options?: TaskCreateOptions
  optionsLoading: boolean
  optionsError: boolean
  update: UpdateTaskCreateDraft
  onRetryOptions: () => void
}) {
  if (optionsLoading && !options) {
    return <p className="task-create-local-state" role="status">Завантажуємо постановника та учасників…</p>
  }
  if (optionsError && !options) {
    return (
      <div className="task-create-local-error">
        <span>Не вдалося завантажити постановника й інших учасників. Введені значення збережено.</span>
        <button type="button" onClick={onRetryOptions}>Повторити</button>
      </div>
    )
  }
  if (!options) return null

  const responsibleIds = new Set(
    draft.participants
      .filter((participant) => participant.role === 'RESPONSIBLE')
      .map((participant) => participant.userId),
  )
  const additionalParticipants = draft.participants.filter(
    (participant) => participant.role !== 'RESPONSIBLE',
  )
  const availableUsers = options.users.filter((person) => !responsibleIds.has(person.id))

  return (
    <div className="task-create-participants">
      <div className="task-create-participant-summary">
        <UsersRound size={18} aria-hidden />
        <span>
          <strong>{additionalParticipants.length}</strong>
          {additionalParticipants.length === 1 ? 'інший учасник' : 'інших учасників'}
        </span>
      </div>
      <label className="task-create-reporter">
        Постановник
        <select
          value={draft.reporterId}
          onChange={(event) => update((current) => ({
            ...current,
            reporterId: event.target.value,
          }))}
        >
          <option value="" disabled>Оберіть постановника</option>
          {options.users.map((person) => (
            <option key={person.id} value={person.id}>
              {person.displayName}{person.jobTitle ? ` · ${person.jobTitle}` : ''}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="task-create-people">
        <legend>Співвиконавці та спостерігачі</legend>
        {availableUsers.length === 0 ? (
          <div className="task-create-empty task-create-empty--compact">
            <UserRoundPlus size={24} aria-hidden />
            <p>Інших доступних учасників немає.</p>
          </div>
        ) : (
          <ul>
            {availableUsers.map((person) => {
              const participant = additionalParticipants.find((item) => item.userId === person.id)
              return (
                <li key={person.id} className={participant ? 'is-selected' : ''}>
                  <label className="task-create-person">
                    <input
                      type="checkbox"
                      checked={Boolean(participant)}
                      onChange={(event) => update((current) => ({
                        ...current,
                        participants: event.target.checked
                          ? [...current.participants, {
                              userId: person.id,
                              role: 'COLLABORATOR',
                            }]
                          : current.participants.filter((item) => item.userId !== person.id),
                      }))}
                    />
                    <Avatar name={person.displayName} src={person.avatarAsset} size="sm" />
                    <span>
                      <strong>{person.displayName}</strong>
                      <small>{person.jobTitle || 'Учасник команди'}</small>
                    </span>
                  </label>
                  <select
                    value={participant?.role ?? 'COLLABORATOR'}
                    disabled={!participant}
                    aria-label={`Роль: ${person.displayName}`}
                    onChange={(event) => update((current) => ({
                      ...current,
                      participants: current.participants.map((item) => (
                        item.userId === person.id
                          ? {
                              ...item,
                              role: event.target.value as AdditionalParticipantRole,
                            }
                          : item
                      )),
                    }))}
                  >
                    {Object.entries(additionalRoleLabels).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </li>
              )
            })}
          </ul>
        )}
      </fieldset>
      <p className="task-create-help">
        Відповідальні налаштовуються в основному блоці. Тут додаються лише інші ролі.
      </p>
    </div>
  )
}
