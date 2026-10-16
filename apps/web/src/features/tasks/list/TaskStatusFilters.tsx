import { TASK_STATUS_GROUPS, type TaskStatusGroup, type TaskStatusPreset } from './task-status-filters'
import { TaskActiveStatusAccordion } from './TaskActiveStatusAccordion'

export function TaskStatusFilters({ selected, onChange }: {
  group: TaskStatusGroup
  selected: TaskStatusPreset[]
  onChange: (group: TaskStatusGroup, selected: TaskStatusPreset[]) => void
}) {
  const allSelected = TASK_STATUS_GROUPS.slice(0, 2).every((item) => item.options.every((option) => selected.includes(option.value)))
  const isGroupSelected = (item: typeof TASK_STATUS_GROUPS[number]) => item.value === 'ALL'
    ? allSelected : item.options.every((option) => selected.includes(option.value))
  const selectedGroups = TASK_STATUS_GROUPS.map((item, index) => isGroupSelected(item) ? index : -1)
    .filter((index) => index >= 0)
  return <div className="task-presets task-status-filters" role="group" aria-label="Статуси завдань">
    <span className="task-filter-selection__label">Задачі:</span>
    <div className="task-status-groups">
    {selectedGroups.length > 0 && <div className="task-filter-selection task-status-group-selection" aria-hidden="true"
      style={{ gridColumn: `${selectedGroups[0]! + 1} / ${selectedGroups[selectedGroups.length - 1]! + 2}` }} />}
    {TASK_STATUS_GROUPS.map((item) => {
      const active = isGroupSelected(item)
      const partial = item.value === 'ACTIVE' && !active && item.options.some((option) => selected.includes(option.value))
      return <div className={`task-status-filter${active ? ' is-active' : ''}${partial ? ' is-partial' : ''}`} key={item.value}
        style={{ gridColumn: TASK_STATUS_GROUPS.indexOf(item) + 1 }}>
        <div className="task-status-filter__control">
          <button type="button" aria-pressed={active} onClick={() => {
            const options = item.value === 'ALL' && allSelected ? TASK_STATUS_GROUPS[0]!.options : item.options
            const values = options.map((option) => option.value)
            const current = allSelected ? [] : selected
            onChange('ALL', item.value === 'ALL' ? values : active && !allSelected
              ? current.filter((value) => !values.includes(value))
              : [...current, ...values.filter((value) => !current.includes(value))])
          }}>{item.label}</button>
          {item.value === 'ACTIVE' && <TaskActiveStatusAccordion selected={selected} onChange={(values) => onChange('ALL', values)} />}
        </div>
      </div>
    })}
    </div>
  </div>
}
