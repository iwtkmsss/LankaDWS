import type { TaskParticipantRoleV2 } from '@bert-crm/contracts'
import { UserRoundPlus, UsersRound } from 'lucide-react'
import { Avatar } from '../../../shared/ui'
import type {
  TaskCreateDraft,
  TaskCreateOptions,
  UpdateTaskCreateDraft,
} from './types'

const roleLabels: Record<TaskParticipantRoleV2, string> = {
  RESPONSIBLE: 'Відповідальний',
  COLLABORATOR: 'Співвиконавець',
  WATCHER: 'Спостерігач',
}

export function TaskParticipantsSection({
  draft,
  options,
  update,
}: {
  draft: TaskCreateDraft
  options: TaskCreateOptions
  update: UpdateTaskCreateDraft
}) {
  return (
    <section className="task-create-section" aria-labelledby="task-create-participants-title">
      <header>
        <div>
          <span className="task-create-kicker">Крок 2</span>
          <h3 id="task-create-participants-title">Учасники</h3>
        </div>
        <p>Кожна людина має одну чітку роль у завданні.</p>
      </header>
      <div className="task-create-participant-summary">
        <UsersRound size={18} aria-hidden />
        <span>
          <strong>{draft.participants.length}</strong>
          учасників · {draft.participants.filter((item) => item.role === 'RESPONSIBLE').length} відповідальних
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
          {options.users.map((user) => (
            <option key={user.id} value={user.id}>
              {user.displayName}{user.jobTitle ? ` · ${user.jobTitle}` : ''}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="task-create-people">
        <legend>Команда завдання</legend>
        {options.users.length === 0 ? (
          <div className="task-create-empty">
            <UserRoundPlus size={24} aria-hidden />
            <p>Для цього контексту немає доступних учасників.</p>
          </div>
        ) : (
          <ul>
            {options.users.map((user) => {
              const participant = draft.participants.find((item) => item.userId === user.id)
              return (
                <li key={user.id} className={participant ? 'is-selected' : ''}>
                  <label className="task-create-person">
                    <input
                      type="checkbox"
                      checked={Boolean(participant)}
                      onChange={(event) => update((current) => ({
                        ...current,
                        participants: event.target.checked
                          ? [...current.participants, {
                              userId: user.id,
                              role: 'COLLABORATOR',
                            }]
                          : current.participants.filter((item) => item.userId !== user.id),
                      }))}
                    />
                    <Avatar name={user.displayName} src={user.avatarAsset} size="sm" />
                    <span>
                      <strong>{user.displayName}</strong>
                      <small>{user.jobTitle || 'Учасник команди'}</small>
                    </span>
                  </label>
                  <select
                    value={participant?.role ?? 'COLLABORATOR'}
                    disabled={!participant}
                    aria-label={`Роль: ${user.displayName}`}
                    onChange={(event) => update((current) => ({
                      ...current,
                      participants: current.participants.map((item) => (
                        item.userId === user.id
                          ? {
                              ...item,
                              role: event.target.value as TaskParticipantRoleV2,
                            }
                          : item
                      )),
                    }))}
                  >
                    {Object.entries(roleLabels).map(([value, label]) => (
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
        Постановник може одночасно бути відповідальним, співвиконавцем або спостерігачем.
      </p>
    </section>
  )
}
